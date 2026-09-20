import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { rawFileSha256, stableJson } from "./snapshot.js";

export interface RuntimeArtifactFile {
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface RuntimeArtifactManifest {
  readonly format: "p6-runtime-artifact-v1";
  readonly capturedAt: string;
  readonly runtimeRoot: string;
  readonly entrypoint: string;
  readonly provider: "node";
  readonly topology: "single-process";
  readonly targetPath: string;
  readonly files: readonly RuntimeArtifactFile[];
  readonly artifactIdentity: string;
}

export interface RuntimeArtifactSpec {
  readonly runtimeRoot: string;
  readonly entrypoint: string;
  readonly provider: "node";
  readonly topology: "single-process";
  readonly targetPath: string;
}

export interface RuntimeAttestation {
  readonly format: "p6-runtime-attestation-v1";
  readonly attestedAt: string;
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly artifactIdentity: string;
  readonly runtimeRoot: string;
  readonly entrypoint: string;
  readonly provider: "node";
  readonly topology: "single-process";
  readonly targetPath: string;
  readonly verified: true;
}

function existingDirectory(input: string): string {
  const absolute = path.resolve(input);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Runtime root must be a real directory: ${absolute}`);
  return path.resolve(fs.realpathSync.native(absolute));
}

function safeEntrypoint(root: string, entrypoint: string): string {
  if (!entrypoint || path.isAbsolute(entrypoint)) throw new TypeError("Runtime entrypoint must be a relative path");
  const candidate = path.resolve(root, entrypoint);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("Runtime entrypoint must remain within the runtime root");
  }
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Runtime entrypoint must be a regular file: ${candidate}`);
  return relative.replaceAll("\\", "/");
}

function files(root: string): RuntimeArtifactFile[] {
  const result: RuntimeArtifactFile[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Runtime tree contains a symbolic link: ${candidate}`);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) result.push({
        relativePath: path.relative(root, candidate).replaceAll("\\", "/"),
        byteLength: fs.statSync(candidate).size,
        sha256: rawFileSha256(candidate),
      });
      else throw new Error(`Runtime tree contains an unsupported entry: ${candidate}`);
    }
  };
  visit(root);
  return result;
}

function identityBase(spec: Omit<RuntimeArtifactManifest, "capturedAt" | "artifactIdentity">): string {
  return stableJson(spec);
}

export function captureRuntimeArtifactManifest(spec: RuntimeArtifactSpec): RuntimeArtifactManifest {
  const runtimeRoot = existingDirectory(spec.runtimeRoot);
  const entrypoint = safeEntrypoint(runtimeRoot, spec.entrypoint);
  const manifestBase = {
    format: "p6-runtime-artifact-v1" as const,
    runtimeRoot,
    entrypoint,
    provider: spec.provider,
    topology: spec.topology,
    targetPath: path.resolve(spec.targetPath),
    files: files(runtimeRoot),
  };
  return {
    ...manifestBase,
    capturedAt: new Date().toISOString(),
    artifactIdentity: createHash("sha256").update(identityBase(manifestBase)).digest("hex"),
  };
}

export function writeRuntimeArtifactManifest(manifest: RuntimeArtifactManifest, outputPathInput: string): string {
  const outputPath = path.resolve(outputPathInput);
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return outputPath;
}

export function readRuntimeArtifactManifest(manifestPathInput: string): RuntimeArtifactManifest {
  const manifestPath = path.resolve(manifestPathInput);
  const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as RuntimeArtifactManifest;
  if (value.format !== "p6-runtime-artifact-v1" || value.provider !== "node" || value.topology !== "single-process") {
    throw new Error("Unsupported runtime artifact manifest");
  }
  const { capturedAt: _capturedAt, artifactIdentity, ...base } = value;
  const expected = createHash("sha256").update(identityBase(base)).digest("hex");
  if (artifactIdentity !== expected) throw new Error("Runtime artifact identity mismatch");
  return value;
}

export function verifyRuntimeArtifact(manifestPathInput: string, spec: RuntimeArtifactSpec, expectedArtifactIdentity: string): RuntimeAttestation {
  const manifestPath = path.resolve(manifestPathInput);
  const manifest = readRuntimeArtifactManifest(manifestPath);
  if (manifest.artifactIdentity !== expectedArtifactIdentity) throw new Error("Unexpected runtime artifact identity");
  const actual = captureRuntimeArtifactManifest(spec);
  const { capturedAt: _expectedCapturedAt, ...expectedComparable } = manifest;
  const { capturedAt: _actualCapturedAt, ...actualComparable } = actual;
  if (stableJson(expectedComparable) !== stableJson(actualComparable)) {
    throw new Error("Runtime bytes or deployment target do not match the frozen artifact manifest");
  }
  return {
    format: "p6-runtime-attestation-v1",
    attestedAt: new Date().toISOString(),
    manifestPath,
    manifestSha256: rawFileSha256(manifestPath),
    artifactIdentity: manifest.artifactIdentity,
    runtimeRoot: actual.runtimeRoot,
    entrypoint: actual.entrypoint,
    provider: actual.provider,
    topology: actual.topology,
    targetPath: actual.targetPath,
    verified: true,
  };
}

export function writeRuntimeAttestation(attestation: RuntimeAttestation, outputPathInput: string): string {
  const outputPath = path.resolve(outputPathInput);
  fs.writeFileSync(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return outputPath;
}
