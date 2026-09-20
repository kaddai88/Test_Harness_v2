import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureFinalBackup } from "./final-backup.js";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "th-final-backup-"));
  roots.push(root);
  const datastore = path.join(root, "live", "data.json");
  const cognition = path.join(root, "live", "cognition");
  const profiles = path.join(root, "live", "profiles");
  fs.mkdirSync(cognition, { recursive: true });
  fs.mkdirSync(profiles, { recursive: true });
  fs.writeFileSync(datastore, "{\"sessions\":{}}\n");
  fs.writeFileSync(path.join(cognition, "semantic.json"), "[]\n");
  fs.writeFileSync(path.join(profiles, "example.json"), "{\"name\":\"example\"}\n");
  return { root, datastore, cognition, profiles, output: path.join(root, "backup") };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("captureFinalBackup", () => {
  it("creates a capture-only immutable backup without changing live bytes", () => {
    const target = fixture();
    const before = [target.datastore, path.join(target.cognition, "semantic.json"), path.join(target.profiles, "example.json")]
      .map((file) => fs.readFileSync(file));
    const result = captureFinalBackup([
      { id: "datastore", kind: "datastore", sourcePath: target.datastore },
      { id: "legacy-cognition", kind: "legacy-cognition", sourcePath: target.cognition },
      { id: "legacy-site-profiles", kind: "legacy-site-profiles", sourcePath: target.profiles },
    ], target.output);

    expect(result.evidence.execution).toEqual({ cloneRestore: false, preflightImport: false, rehearsal: false, liveMutation: "none" });
    expect(result.manifest.files).toHaveLength(3);
    expect(fs.existsSync(path.join(target.output, "success-clone"))).toBe(false);
    expect(fs.existsSync(path.join(target.output, "rollback-clone"))).toBe(false);
    expect([target.datastore, path.join(target.cognition, "semantic.json"), path.join(target.profiles, "example.json")]
      .map((file) => fs.readFileSync(file))).toEqual(before);
  });

  it("requires a create-new output root", () => {
    const target = fixture();
    fs.mkdirSync(target.output);
    expect(() => captureFinalBackup([
      { id: "datastore", kind: "datastore", sourcePath: target.datastore },
      { id: "legacy-cognition", kind: "legacy-cognition", sourcePath: target.cognition },
      { id: "legacy-site-profiles", kind: "legacy-site-profiles", sourcePath: target.profiles },
    ], target.output)).toThrow("must not already exist");
  });
});
