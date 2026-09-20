import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { rawFileSha256 } from "./snapshot.js";

export interface RuntimePackageFile {
  readonly kind: "file";
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface RuntimePackageJunction {
  readonly kind: "junction";
  readonly relativePath: string;
  readonly targetRelativePath: string;
}

export type RuntimePackageEntry = RuntimePackageFile | RuntimePackageJunction;

export interface RuntimePackageManifest {
  readonly format: "p6-runtime-package-v1";
  readonly capturedAt: string;
  readonly packageRoot: string;
  readonly entrypoint: string;
  readonly provider: "node";
  readonly topology: "single-process";
  readonly authorityDatastorePath: string;
  readonly entries: readonly RuntimePackageEntry[];
  readonly artifactIdentity: string;
}

export interface RuntimePackageSpec {
  readonly packageRoot: string;
  readonly entrypoint: string;
  readonly provider: "node";
  readonly topology: "single-process";
  readonly authorityDatastorePath: string;
}

export interface RuntimePackageAttestation {
  readonly format: "p6-runtime-package-attestation-v1";
  readonly attestedAt: string;
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly packageRoot: string;
  readonly entrypoint: string;
  readonly provider: "node";
  readonly topology: "single-process";
  readonly authorityDatastorePath: string;
  readonly artifactIdentity: string;
  readonly verified: true;
}

export interface RuntimePackageBuildOptions {
  readonly workspaceRoot: string;
  readonly outputRoot: string;
}

function canonicalDirectory(input: string, label: string): string {
  const absolute = path.resolve(input);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory: ${absolute}`);
  return path.resolve(fs.realpathSync.native(absolute));
}

function canonicalFuturePath(input: string): string {
  let candidate = path.resolve(input);
  const suffix: string[] = [];
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) throw new Error(`Cannot resolve output ancestor: ${input}`);
    suffix.unshift(path.basename(candidate));
    candidate = parent;
  }
  return path.resolve(fs.realpathSync.native(candidate), ...suffix);
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Runtime manifest contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort(ordinalCompare);
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  throw new TypeError("Runtime manifest contains an unsupported value");
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function normalizedEntrypoint(root: string, entrypoint: string): string {
  if (!entrypoint || path.isAbsolute(entrypoint)) throw new TypeError("Runtime package entrypoint must be relative");
  const candidate = path.resolve(root, entrypoint);
  if (!inside(root, candidate)) throw new Error("Runtime package entrypoint must remain within the package root");
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Runtime package entrypoint must be a regular file: ${candidate}`);
  return path.relative(root, candidate).replaceAll("\\", "/");
}

function packageEntries(root: string): RuntimePackageEntry[] {
  const entries: RuntimePackageEntry[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => ordinalCompare(left.name, right.name))) {
      const candidate = path.join(directory, entry.name);
      const relativePath = path.relative(root, candidate).replaceAll("\\", "/");
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        const resolvedTarget = path.resolve(fs.realpathSync.native(candidate));
        if (!inside(root, resolvedTarget)) throw new Error(`Runtime package junction escapes package root: ${candidate}`);
        entries.push({
          kind: "junction",
          relativePath,
          targetRelativePath: path.relative(root, resolvedTarget).replaceAll("\\", "/"),
        });
      } else if (stat.isDirectory()) {
        visit(candidate);
      } else if (stat.isFile()) {
        entries.push({ kind: "file", relativePath, byteLength: stat.size, sha256: rawFileSha256(candidate) });
      } else {
        throw new Error(`Runtime package contains an unsupported entry: ${candidate}`);
      }
    }
  };
  visit(root);
  return entries.sort((left, right) => ordinalCompare(left.relativePath, right.relativePath));
}

function manifestIdentity(base: Omit<RuntimePackageManifest, "capturedAt" | "artifactIdentity">): string {
  return createHash("sha256").update(canonicalJson(base)).digest("hex");
}

function assertOutputOutsidePackage(packageRoot: string, outputPath: string): void {
  if (inside(packageRoot, outputPath)) {
    throw new Error("Runtime manifest and attestation outputs must be outside the package root");
  }
}

export function captureRuntimePackageManifest(spec: RuntimePackageSpec): RuntimePackageManifest {
  if (spec.provider !== "node" || spec.topology !== "single-process") {
    throw new TypeError("Only provider=node and topology=single-process are supported");
  }
  if (!path.isAbsolute(spec.authorityDatastorePath)) {
    throw new TypeError("Authority datastore path must be absolute");
  }
  const packageRoot = canonicalDirectory(spec.packageRoot, "Runtime package root");
  const entrypoint = normalizedEntrypoint(packageRoot, spec.entrypoint);
  const base = {
    format: "p6-runtime-package-v1" as const,
    packageRoot,
    entrypoint,
    provider: spec.provider,
    topology: spec.topology,
    authorityDatastorePath: path.resolve(spec.authorityDatastorePath),
    entries: packageEntries(packageRoot),
  };
  return {
    ...base,
    capturedAt: new Date().toISOString(),
    artifactIdentity: manifestIdentity(base),
  };
}

export function writeRuntimePackageManifest(manifest: RuntimePackageManifest, outputPathInput: string): string {
  const outputPath = canonicalFuturePath(outputPathInput);
  assertOutputOutsidePackage(manifest.packageRoot, outputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return outputPath;
}

function parseRuntimePackageManifestBytes(bytes: Buffer): RuntimePackageManifest {
  const manifest = JSON.parse(bytes.toString("utf8")) as RuntimePackageManifest;
  if (manifest.format !== "p6-runtime-package-v1" || manifest.provider !== "node" || manifest.topology !== "single-process") {
    throw new Error("Unsupported runtime package manifest");
  }
  const { capturedAt: _capturedAt, artifactIdentity, ...base } = manifest;
  if (artifactIdentity !== manifestIdentity(base)) throw new Error("Runtime package artifact identity mismatch");
  return manifest;
}

function readBoundRuntimePackageManifest(manifestPathInput: string): {
  readonly manifestPath: string;
  readonly manifestSha256: string;
  readonly manifest: RuntimePackageManifest;
} {
  const inputPath = path.resolve(manifestPathInput);
  const stat = fs.lstatSync(inputPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Runtime package manifest must be a regular file: ${inputPath}`);
  }
  const manifestPath = path.resolve(fs.realpathSync.native(inputPath));
  const bytes = fs.readFileSync(manifestPath);
  return {
    manifestPath,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
    manifest: parseRuntimePackageManifestBytes(bytes),
  };
}

export function readRuntimePackageManifest(manifestPathInput: string): RuntimePackageManifest {
  return readBoundRuntimePackageManifest(manifestPathInput).manifest;
}

export function verifyRuntimePackage(
  manifestPathInput: string,
  spec: RuntimePackageSpec,
  expectedArtifactIdentity: string,
  expectedManifestSha256: string,
): RuntimePackageAttestation {
  const { manifestPath, manifestSha256, manifest } = readBoundRuntimePackageManifest(manifestPathInput);
  if (manifest.artifactIdentity !== expectedArtifactIdentity) throw new Error("Unexpected runtime package artifact identity");
  if (manifestSha256 !== expectedManifestSha256) throw new Error("Unexpected runtime package manifest SHA-256");
  const actual = captureRuntimePackageManifest(spec);
  const { capturedAt: _expectedCapturedAt, ...expectedComparable } = manifest;
  const { capturedAt: _actualCapturedAt, ...actualComparable } = actual;
  if (canonicalJson(expectedComparable) !== canonicalJson(actualComparable)) {
    throw new Error("Runtime package bytes, links, entrypoint, provider, topology, or datastore target do not match the frozen manifest");
  }
  return {
    format: "p6-runtime-package-attestation-v1",
    attestedAt: new Date().toISOString(),
    manifestPath,
    manifestSha256,
    packageRoot: actual.packageRoot,
    entrypoint: actual.entrypoint,
    provider: actual.provider,
    topology: actual.topology,
    authorityDatastorePath: actual.authorityDatastorePath,
    artifactIdentity: actual.artifactIdentity,
    verified: true,
  };
}

export function writeRuntimePackageAttestation(attestation: RuntimePackageAttestation, outputPathInput: string): string {
  const outputPath = canonicalFuturePath(outputPathInput);
  assertOutputOutsidePackage(attestation.packageRoot, outputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return outputPath;
}

function runPnpm(workspaceRoot: string, args: readonly string[]): void {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(executable, ["--dir", workspaceRoot, ...args], {
    stdio: "inherit",
    // Windows command shims are .cmd files and require a shell to execute.
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm ${args.join(" ")} failed with exit code ${String(result.status)}`);
}

/** Removes only pnpm legacy deploy's self-link back to the source workspace. */
export function removeWorkspaceServerSelfJunction(workspaceRootInput: string, packageRootInput: string): void {
  const workspaceRoot = canonicalDirectory(workspaceRootInput, "Workspace root");
  const packageRoot = canonicalDirectory(packageRootInput, "Runtime package root");
  const sourceServerRoot = canonicalDirectory(path.join(workspaceRoot, "apps", "server", "th-server"), "Source server package");
  const selfJunction = path.join(packageRoot, "node_modules", "@test-harness", "th-server");
  if (!fs.existsSync(selfJunction)) return;
  const stat = fs.lstatSync(selfJunction);
  if (!stat.isSymbolicLink()) throw new Error(`Unexpected runtime package self-link is not a junction: ${selfJunction}`);
  const target = path.resolve(fs.realpathSync.native(selfJunction));
  if (target !== sourceServerRoot) throw new Error(`Unexpected runtime package self-link target: ${selfJunction}`);
  // rmdir removes a Windows directory junction itself; it does not recurse into its target.
  fs.rmdirSync(selfJunction);
  if (fs.existsSync(selfJunction)) throw new Error(`Failed to remove runtime package self-link: ${selfJunction}`);
  if (!fs.existsSync(sourceServerRoot)) throw new Error("Source server package disappeared while removing self-link");
}

/** Builds runtime dependencies then emits a create-new, portable pnpm deploy package. */
export function buildRuntimePackage(options: RuntimePackageBuildOptions): string {
  const workspaceRoot = canonicalDirectory(options.workspaceRoot, "Workspace root");
  const outputRoot = canonicalFuturePath(options.outputRoot);
  if (fs.existsSync(outputRoot)) throw new Error(`Runtime package output must not already exist: ${outputRoot}`);
  if (inside(path.join(workspaceRoot, "apps", "server", "th-server"), outputRoot)) {
    throw new Error("Runtime package output must not be nested in the source server package");
  }
  runPnpm(workspaceRoot, ["--filter", "@test-harness/th-server...", "build"]);
  runPnpm(workspaceRoot, ["--filter", "@test-harness/th-server", "deploy", "--legacy", "--prod", outputRoot]);
  normalizedEntrypoint(canonicalDirectory(outputRoot, "Runtime package output"), "dist/index.js");
  removeWorkspaceServerSelfJunction(workspaceRoot, outputRoot);
  return outputRoot;
}
