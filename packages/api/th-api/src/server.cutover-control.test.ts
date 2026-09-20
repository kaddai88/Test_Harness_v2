import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "@test-harness/th-persistence";
import { createInMemoryQueue } from "@test-harness/th-queue";
import { CutoverControlPlane } from "./cutover-control.js";
import { APIServer } from "./server.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("APIServer cutover traffic control", () => {
  it("blocks mutation-capable routes while keeping status and control actions available", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "th-api-cutover-"));
    roots.push(root);
    const runtime = createInMemoryDatabase();
    const session = await runtime.sessions.create({
      targetUrl: "https://example.com",
      targetConfig: {},
      scanConfig: {},
    });
    const api = new APIServer({
      port: 0,
      repos: runtime,
      authority: runtime.authority,
      queue: createInMemoryQueue(),
      cutoverControl: new CutoverControlPlane({ token: "secret", auditPath: path.join(root, "control.jsonl") }),
    });
    await api.start();
    try {
      const base = `http://127.0.0.1:${api.getPort()}/api/v1`;
      const freeze = await fetch(`${base}/cutover/controls/freeze-entry`, {
        method: "POST", headers: { "x-cutover-control-token": "secret", "x-cutover-actor": "operator" },
      });
      expect(freeze.status).toBe(200);
      const paused = await fetch(`${base}/cutover/queue/pause`, {
        method: "POST", headers: { "x-cutover-control-token": "secret", "x-cutover-actor": "operator" },
      });
      expect(await paused.json()).toMatchObject({ queue: { state: "paused", isQuiescent: true } });
      const frozen = await fetch(`${base}/cutover/controls/confirm-frozen`, {
        method: "POST", headers: { "x-cutover-control-token": "secret", "x-cutover-actor": "operator" },
      });
      expect(frozen.status).toBe(200);
      const rejected = await fetch(`${base}/sessions`, { method: "POST", body: JSON.stringify({ targetUrl: "https://example.com" }) });
      expect(rejected.status).toBe(503);
      expect(await rejected.json()).toMatchObject({ error: "mutation_capable_traffic_blocked" });
      const report = await fetch(`${base}/sessions/${session.id}/report`);
      expect(report.status).toBe(200);
      expect(await runtime.reports.findBySessionIdAndFormat(session.id, "json")).toBeNull();
      const status = await fetch(`${base}/cutover/status`);
      expect(status.status).toBe(200);
      expect(await status.json()).toMatchObject({ control: { state: "frozen", mutationCapableTraffic: "blocked" } });
    } finally {
      await api.stop();
    }
  });
});
