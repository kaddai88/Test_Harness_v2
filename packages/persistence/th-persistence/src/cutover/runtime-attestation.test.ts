import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureRuntimeArtifactManifest,
  verifyRuntimeArtifact,
  writeRuntimeArtifactManifest,
} from "./runtime-attestation.js";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "th-runtime-attestation-"));
  roots.push(root);
  const runtime = path.join(root, "runtime");
  fs.mkdirSync(path.join(runtime, "dist"), { recursive: true });
  fs.writeFileSync(path.join(runtime, "dist", "index.js"), "console.log('server');\n");
  fs.writeFileSync(path.join(runtime, "package.json"), "{\"type\":\"module\"}\n");
  return { root, runtime, manifest: path.join(root, "frozen-runtime.json"), targetPath: path.join(root, "data", "testharness.json") };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("runtime artifact attestation", () => {
  it("binds exact single-process runtime bytes and target path", () => {
    const target = fixture();
    const spec = { runtimeRoot: target.runtime, entrypoint: "dist/index.js", provider: "node" as const, topology: "single-process" as const, targetPath: target.targetPath };
    const manifest = captureRuntimeArtifactManifest(spec);
    writeRuntimeArtifactManifest(manifest, target.manifest);
    expect(verifyRuntimeArtifact(target.manifest, spec, manifest.artifactIdentity)).toMatchObject({
      verified: true, provider: "node", topology: "single-process", artifactIdentity: manifest.artifactIdentity,
    });
  });

  it("rejects changed runtime bytes and a wrong identity", () => {
    const target = fixture();
    const spec = { runtimeRoot: target.runtime, entrypoint: "dist/index.js", provider: "node" as const, topology: "single-process" as const, targetPath: target.targetPath };
    const manifest = captureRuntimeArtifactManifest(spec);
    writeRuntimeArtifactManifest(manifest, target.manifest);
    expect(() => verifyRuntimeArtifact(target.manifest, spec, "different")).toThrow("Unexpected runtime artifact identity");
    fs.appendFileSync(path.join(target.runtime, "dist", "index.js"), "// changed\n");
    expect(() => verifyRuntimeArtifact(target.manifest, spec, manifest.artifactIdentity)).toThrow("Runtime bytes or deployment target");
  });

  it("rejects an entrypoint outside the selected runtime root", () => {
    const target = fixture();
    expect(() => captureRuntimeArtifactManifest({
      runtimeRoot: target.runtime, entrypoint: "../outside.js", provider: "node", topology: "single-process", targetPath: target.targetPath,
    })).toThrow("within the runtime root");
  });
});
