import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CutoverControlPlane } from "./cutover-control.js";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "th-cutover-control-"));
  roots.push(root);
  return { root, audit: path.join(root, "control-audit.jsonl") };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("CutoverControlPlane", () => {
  it("fails closed without a configured token and audit path", () => {
    const control = new CutoverControlPlane();
    expect(() => control.transition("freeze-entry", "token", "operator")).toThrow("not configured");
  });

  it("blocks session admission and mutations while allowing read probes", () => {
    const target = fixture();
    const control = new CutoverControlPlane({ token: "secret", auditPath: target.audit });
    expect(control.permitsMutationRequest("POST")).toBe(true);
    control.transition("freeze-entry", "secret", "operator");
    control.transition("confirm-frozen", "secret", "operator");
    control.transition("release-read-only", "secret", "operator");
    expect(control.status()).toMatchObject({ state: "read-only", newSessionAdmission: "blocked", mutationCapableTraffic: "blocked" });
    expect(control.permitsMutationRequest("POST")).toBe(false);
    expect(control.permitsMutationRequest("GET")).toBe(true);
    expect(() => control.transition("enable-mutation", "wrong", "operator")).toThrow("Invalid cutover control token");
    control.transition("enable-mutation", "secret", "operator");
    expect(control.status().state).toBe("mutation-enabled");
    expect(control.permitsMutationRequest("POST")).toBe(true);
    expect(fs.readFileSync(target.audit, "utf8").trim().split("\n")).toHaveLength(4);
  });

  it("requires an explicit abort transition and rejects an existing audit file", () => {
    const target = fixture();
    fs.writeFileSync(target.audit, "existing\n");
    const control = new CutoverControlPlane({ token: "secret", auditPath: target.audit });
    expect(() => control.transition("freeze-entry", "secret", "operator")).toThrow();
    expect(control.status().state).toBe("normal");
  });
});
