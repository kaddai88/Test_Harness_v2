import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRuntimePackage,
  captureRuntimePackageManifest,
  removeWorkspaceServerSelfJunction,
  verifyRuntimePackage,
  writeRuntimePackageAttestation,
  writeRuntimePackageManifest,
} from "./runtime-package.js";
import { rawFileSha256 } from "./snapshot.js";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "th-runtime-package-"));
  roots.push(root);
  const packageRoot = path.join(root, "package");
  const targetPath = path.join(root, "live", "testharness.json");
  const dependency = path.join(packageRoot, "node_modules", ".pnpm", "dependency", "node_modules", "dependency");
  fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
  fs.mkdirSync(dependency, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "dist", "index.js"), "import 'dependency';\n");
  fs.writeFileSync(path.join(dependency, "index.js"), "export {};\n");
  fs.mkdirSync(path.join(packageRoot, "node_modules"), { recursive: true });
  fs.symlinkSync(dependency, path.join(packageRoot, "node_modules", "dependency"), "junction");
  return {
    root,
    packageRoot,
    targetPath,
    manifest: path.join(root, "runtime-manifest.json"),
    spec: {
      packageRoot,
      entrypoint: "dist/index.js",
      provider: "node" as const,
      topology: "single-process" as const,
      authorityDatastorePath: targetPath,
    },
  };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("runtime deploy package manifest", () => {
  it("is deterministic and binds the package entrypoint and internal junctions", () => {
    const target = fixture();
    const first = captureRuntimePackageManifest(target.spec);
    const second = captureRuntimePackageManifest(target.spec);
    expect(second.artifactIdentity).toBe(first.artifactIdentity);
    expect(first.entries).toContainEqual(expect.objectContaining({
      kind: "junction", relativePath: "node_modules/dependency",
      targetRelativePath: "node_modules/.pnpm/dependency/node_modules/dependency",
    }));
    writeRuntimePackageManifest(first, target.manifest);
    expect(verifyRuntimePackage(
      target.manifest, target.spec, first.artifactIdentity, rawFileSha256(target.manifest),
    )).toMatchObject({
      verified: true, entrypoint: "dist/index.js", provider: "node", topology: "single-process",
    });
  });

  it("rejects byte drift, missing files, and extra files", () => {
    const target = fixture();
    const manifest = captureRuntimePackageManifest(target.spec);
    writeRuntimePackageManifest(manifest, target.manifest);
    fs.appendFileSync(path.join(target.packageRoot, "dist", "index.js"), "// drift\n");
    const manifestSha256 = rawFileSha256(target.manifest);
    expect(() => verifyRuntimePackage(
      target.manifest, target.spec, manifest.artifactIdentity, manifestSha256,
    )).toThrow("Runtime package bytes");
    fs.writeFileSync(path.join(target.packageRoot, "dist", "index.js"), "import 'dependency';\n");
    fs.writeFileSync(path.join(target.packageRoot, "unexpected.txt"), "extra\n");
    expect(() => verifyRuntimePackage(
      target.manifest, target.spec, manifest.artifactIdentity, manifestSha256,
    )).toThrow("Runtime package bytes");
    fs.rmSync(path.join(target.packageRoot, "unexpected.txt"));
    fs.rmSync(path.join(target.packageRoot, "dist", "index.js"));
    expect(() => verifyRuntimePackage(
      target.manifest, target.spec, manifest.artifactIdentity, manifestSha256,
    )).toThrow();
  });

  it("rejects escaping junctions and manifest outputs inside the package", () => {
    const target = fixture();
    const external = path.join(target.root, "external");
    fs.mkdirSync(external);
    fs.writeFileSync(path.join(external, "outside.js"), "export {};\n");
    fs.symlinkSync(external, path.join(target.packageRoot, "outside"), "junction");
    expect(() => captureRuntimePackageManifest(target.spec)).toThrow("escapes package root");
    fs.rmSync(path.join(target.packageRoot, "outside"));
    const manifest = captureRuntimePackageManifest(target.spec);
    expect(() => writeRuntimePackageManifest(manifest, path.join(target.packageRoot, "manifest.json"))).toThrow("outside the package root");
  });

  it("removes only pnpm's source-server self-junction without touching its target", () => {
    const target = fixture();
    const workspace = path.join(target.root, "workspace");
    const sourceServer = path.join(workspace, "apps", "server", "th-server");
    const packageRoot = path.join(target.root, "deployed-package");
    fs.mkdirSync(sourceServer, { recursive: true });
    fs.writeFileSync(path.join(sourceServer, "source-marker.txt"), "source remains\n");
    fs.mkdirSync(path.join(packageRoot, "node_modules", "@test-harness"), { recursive: true });
    fs.symlinkSync(sourceServer, path.join(packageRoot, "node_modules", "@test-harness", "th-server"), "junction");
    removeWorkspaceServerSelfJunction(workspace, packageRoot);
    expect(fs.existsSync(path.join(packageRoot, "node_modules", "@test-harness", "th-server"))).toBe(false);
    expect(fs.readFileSync(path.join(sourceServer, "source-marker.txt"), "utf8")).toBe("source remains\n");
  });

  it("rejects future output paths whose existing junction ancestor resolves into the package", () => {
    const target = fixture();
    const manifest = captureRuntimePackageManifest(target.spec);
    const alias = path.join(target.root, "package-alias");
    fs.symlinkSync(target.packageRoot, alias, "junction");
    expect(() => writeRuntimePackageManifest(manifest, path.join(alias, "future", "manifest.json")))
      .toThrow("outside the package root");

    writeRuntimePackageManifest(manifest, target.manifest);
    const attestation = verifyRuntimePackage(
      target.manifest, target.spec, manifest.artifactIdentity, rawFileSha256(target.manifest),
    );
    expect(() => writeRuntimePackageAttestation(
      attestation, path.join(alias, "future", "attestation.json"),
    )).toThrow("outside the package root");
  });

  it("rejects a future package path whose junction ancestor resolves into source", () => {
    const target = fixture();
    const workspace = path.join(target.root, "workspace");
    const sourceServer = path.join(workspace, "apps", "server", "th-server");
    fs.mkdirSync(sourceServer, { recursive: true });
    const alias = path.join(target.root, "source-alias");
    fs.symlinkSync(sourceServer, alias, "junction");
    expect(() => buildRuntimePackage({ workspaceRoot: workspace, outputRoot: path.join(alias, "future-package") }))
      .toThrow("must not be nested in the source server package");
  });

  it("requires the exact frozen manifest SHA in addition to artifact identity", () => {
    const target = fixture();
    const manifest = captureRuntimePackageManifest(target.spec);
    writeRuntimePackageManifest(manifest, target.manifest);
    const frozenSha256 = rawFileSha256(target.manifest);
    const replacement = { ...manifest, capturedAt: new Date(Date.parse(manifest.capturedAt) + 1000).toISOString() };
    fs.writeFileSync(target.manifest, `${JSON.stringify(replacement, null, 2)}\n`);
    expect(replacement.artifactIdentity).toBe(manifest.artifactIdentity);
    expect(rawFileSha256(target.manifest)).not.toBe(frozenSha256);
    expect(() => verifyRuntimePackage(
      target.manifest, target.spec, manifest.artifactIdentity, frozenSha256,
    )).toThrow("Unexpected runtime package manifest SHA-256");
  });

  it("binds attestation SHA to the exact manifest bytes that were parsed", () => {
    const target = fixture();
    const manifest = captureRuntimePackageManifest(target.spec);
    writeRuntimePackageManifest(manifest, target.manifest);
    const frozenBytes = fs.readFileSync(target.manifest);
    const frozenSha256 = createHash("sha256").update(frozenBytes).digest("hex");
    const originalRead = fs.readFileSync.bind(fs);
    let manifestReads = 0;
    const readSpy = vi.spyOn(fs, "readFileSync").mockImplementation(((filePath: fs.PathOrFileDescriptor) => {
      const bytes = originalRead(filePath);
      if (typeof filePath === "string" && path.resolve(filePath) === path.resolve(target.manifest)) {
        manifestReads += 1;
        if (manifestReads === 1) fs.appendFileSync(target.manifest, " ");
      }
      return bytes;
    }) as typeof fs.readFileSync);
    try {
      const attestation = verifyRuntimePackage(
        target.manifest, target.spec, manifest.artifactIdentity, frozenSha256,
      );
      expect(manifestReads).toBe(1);
      expect(attestation.manifestSha256).toBe(frozenSha256);
      expect(rawFileSha256(target.manifest)).not.toBe(frozenSha256);
    } finally {
      readSpy.mockRestore();
    }
  });

  it("uses ordinal ordering and rejects a relative authority datastore path", () => {
    const target = fixture();
    fs.writeFileSync(path.join(target.packageRoot, "Z-runtime.js"), "export {};\n");
    fs.writeFileSync(path.join(target.packageRoot, "a-runtime.js"), "export {};\n");
    const manifest = captureRuntimePackageManifest(target.spec);
    const paths = manifest.entries.map(entry => entry.relativePath);
    expect(paths).toEqual([...paths].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
    expect(() => captureRuntimePackageManifest({ ...target.spec, authorityDatastorePath: "data/testharness.json" }))
      .toThrow("Authority datastore path must be absolute");
  });

  it("rejects provider, topology, and datastore target mismatches", () => {
    const target = fixture();
    const manifest = captureRuntimePackageManifest(target.spec);
    writeRuntimePackageManifest(manifest, target.manifest);
    const manifestSha256 = rawFileSha256(target.manifest);
    const verify = (spec: typeof target.spec) => verifyRuntimePackage(
      target.manifest, spec, manifest.artifactIdentity, manifestSha256,
    );
    expect(() => verify({ ...target.spec, provider: "other" as "node" })).toThrow();
    expect(() => verify({ ...target.spec, topology: "multi-process" as "single-process" })).toThrow();
    expect(() => verify({ ...target.spec, authorityDatastorePath: path.join(target.root, "other.json") }))
      .toThrow("Runtime package bytes");
  });
});
