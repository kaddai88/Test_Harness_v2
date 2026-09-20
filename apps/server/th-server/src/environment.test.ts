import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadServerEnvironment } from "./environment.js";

const roots: string[] = [];

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "th-server-env-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("loadServerEnvironment", () => {
  it("preserves explicit process environment values", () => {
    const root = fixture();
    const authorityDatastore = "E:\\Projects\\Test-Harness\\data\\testharness.json";
    const controlAudit = path.resolve(root, "audit", "control-plane-audit.jsonl");
    fs.writeFileSync(
      path.join(root, ".env"),
      [
        "PORT=8000",
        "DB_PATH=./data/from-dotenv.json",
        "CUTOVER_CONTROL_AUDIT_PATH=./audit/from-dotenv.jsonl",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, ".env.local"),
      [
        "PORT=8100",
        "DB_PATH=./data/from-dotenv-local.json",
        "CUTOVER_CONTROL_AUDIT_PATH=./audit/from-dotenv-local.jsonl",
      ].join("\n"),
    );
    const environment: NodeJS.ProcessEnv = {
      PORT: "3000",
      DB_PATH: authorityDatastore,
      CUTOVER_CONTROL_AUDIT_PATH: controlAudit,
    };

    loadServerEnvironment(root, environment);

    expect(environment).toMatchObject({
      PORT: "3000",
      DB_PATH: authorityDatastore,
      CUTOVER_CONTROL_AUDIT_PATH: controlAudit,
    });
    expect(path.win32.resolve("C:\\unrelated-cwd-a", environment.DB_PATH!)).toBe(authorityDatastore);
    expect(path.win32.resolve("D:\\unrelated-cwd-b", environment.DB_PATH!)).toBe(authorityDatastore);
  });

  it("uses dotenv values only when process values are absent", () => {
    const root = fixture();
    fs.writeFileSync(
      path.join(root, ".env"),
      ["PORT=8000", "DB_PATH=./data/default.json", "DEFAULT_ONLY=from-env"].join("\n"),
    );
    fs.writeFileSync(
      path.join(root, ".env.local"),
      ["PORT=8100", "LOCAL_ONLY=from-env-local"].join("\n"),
    );
    const environment: NodeJS.ProcessEnv = {};

    loadServerEnvironment(root, environment);

    expect(environment).toMatchObject({
      PORT: "8100",
      DB_PATH: "./data/default.json",
      DEFAULT_ONLY: "from-env",
      LOCAL_ONLY: "from-env-local",
    });
  });
});
