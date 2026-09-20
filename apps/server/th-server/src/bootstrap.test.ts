import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadServerApplication } from "./bootstrap.js";

const moduleEvaluation = vi.hoisted(() => ({
  environment: undefined as Record<string, string | undefined> | undefined,
}));

vi.mock("./app.js", () => {
  moduleEvaluation.environment = {
    port: process.env.PORT,
    dbPath: process.env.DB_PATH,
    auditPath: process.env.CUTOVER_CONTROL_AUDIT_PATH,
    defaultValue: process.env.BOOTSTRAP_DEFAULT,
  };
  return { TestHarnessServer: class TestHarnessServer {} };
});

const roots: string[] = [];
const environmentKeys = [
  "PORT",
  "DB_PATH",
  "CUTOVER_CONTROL_AUDIT_PATH",
  "BOOTSTRAP_DEFAULT",
] as const;
const originalEnvironment = new Map(
  environmentKeys.map((key) => [key, process.env[key]] as const),
);

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "th-server-bootstrap-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  for (const key of environmentKeys) {
    const originalValue = originalEnvironment.get(key);
    if (originalValue === undefined) delete process.env[key];
    else process.env[key] = originalValue;
  }
});

describe("loadServerApplication", () => {
  it("loads environment defaults before evaluating the application module", async () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, ".env"),
      [
        "PORT=8000",
        "DB_PATH=./data/from-dotenv.json",
        "CUTOVER_CONTROL_AUDIT_PATH=./audit/from-dotenv.jsonl",
        "BOOTSTRAP_DEFAULT=loaded-before-import",
      ].join("\n"),
    );
    process.env.PORT = "3000";
    process.env.DB_PATH = "E:\\Projects\\Test-Harness\\data\\testharness.json";
    process.env.CUTOVER_CONTROL_AUDIT_PATH =
      "E:\\Projects\\Test-Harness\\.p6-live-cutover\\run\\control-plane-audit.jsonl";
    delete process.env.BOOTSTRAP_DEFAULT;

    const application = await loadServerApplication(root);

    expect(application.TestHarnessServer).toBeDefined();
    expect(moduleEvaluation.environment).toEqual({
      port: "3000",
      dbPath: "E:\\Projects\\Test-Harness\\data\\testharness.json",
      auditPath:
        "E:\\Projects\\Test-Harness\\.p6-live-cutover\\run\\control-plane-audit.jsonl",
      defaultValue: "loaded-before-import",
    });
  });
});
