import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemorySessionRepository } from "./providers/in-memory.js";
import { JsonFileDatabase, JsonFileSessionRepository } from "./providers/json-file.js";
import type { SessionRepository } from "./repositories/interfaces.js";

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

async function seed(repo: SessionRepository, status: "completed" | "failed" | "running" = "completed") {
  await repo.create({ id: "pp", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
  if (status === "completed") {
    await repo.transitionStatus("pp", {
      expected: ["queued", "pending" as never], target: "planning", reason: "lifecycle_start",
    });
    await repo.transitionStatus("pp", { expected: ["planning"], target: "running", reason: "lifecycle_start" });
    await repo.transitionStatus("pp", {
      expected: ["running"], target: "completed", reason: "completion_success",
      sideEffects: { terminalAt: "2026-09-14T00:00:00.000Z", postProcessingStatus: "pending" },
    });
  } else if (status === "failed") {
    await repo.transitionStatus("pp", {
      expected: ["queued", "pending" as never], target: "planning", reason: "lifecycle_start",
    });
    await repo.transitionStatus("pp", {
      expected: ["planning"], target: "failed", reason: "failure_startup",
      sideEffects: { terminalAt: "2026-09-14T00:00:00.000Z", postProcessingStatus: "pending" },
    });
  }
}

async function seedCancelled(repo: SessionRepository) {
  await repo.create({ id: "pp", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
  await repo.transitionStatus("pp", {
    expected: ["queued", "pending" as never], target: "planning", reason: "lifecycle_start",
  });
  await repo.transitionStatus("pp", {
    expected: ["planning"], target: "cancelling", reason: "user_cancel_requested",
    sideEffects: { cancelRequestedAt: "2026-09-14T00:00:00.000Z" },
  });
  await repo.transitionStatus("pp", {
    expected: ["cancelling"], target: "cancelled", reason: "user_cancel_quiesced",
    sideEffects: { terminalAt: "2026-09-14T00:00:01.000Z", postProcessingStatus: "not_applicable" },
  });
}
function suite(name: string, factory: () => SessionRepository) {
  describe(name, () => {
    it("runs pending to running and terminal outcomes", async () => {
      const repo = factory();
      await seed(repo);
      expect((await repo.transitionPostProcessingStatus("pp", { expected: ["pending"], target: "running" })).applied).toBe(true);
      expect((await repo.transitionPostProcessingStatus("pp", { expected: ["running"], target: "success" })).applied).toBe(true);
      await expect(repo.findById("pp")).resolves.toMatchObject({ postProcessingStatus: "success" });
    });

    it("supports partial and failed with persisted error", async () => {
      const repo = factory();
      await seed(repo);
      await repo.transitionPostProcessingStatus("pp", { expected: ["pending"], target: "running" });
      await expect(repo.transitionPostProcessingStatus("pp", { expected: ["running"], target: "failed", error: "summary failed" })).resolves.toMatchObject({ applied: true });
      await expect(repo.findById("pp")).resolves.toMatchObject({ postProcessingStatus: "failed", postProcessingError: "summary failed" });
    });

    it("rejects active, cancelled, wrong expected, and terminal follow-up transitions", async () => {
      const active = factory();
      await seed(active, "running");
      await expect(active.transitionPostProcessingStatus("pp", { expected: ["not_started"], target: "running" })).rejects.toThrow("completed or failed");

      const cancelled = factory();
      await seedCancelled(cancelled);
      await expect(cancelled.transitionPostProcessingStatus("pp", { expected: ["not_applicable"], target: "running" })).rejects.toThrow("not applicable");

      const repo = factory();
      await seed(repo);
      await expect(repo.transitionPostProcessingStatus("pp", { expected: ["running"], target: "success" })).resolves.toMatchObject({ applied: false, currentState: "pending" });
      await repo.transitionPostProcessingStatus("pp", { expected: ["pending"], target: "running" });
      await repo.transitionPostProcessingStatus("pp", { expected: ["running"], target: "success" });
      await expect(repo.transitionPostProcessingStatus("pp", { expected: ["success"], target: "running" })).rejects.toThrow("terminal");
    });

    it("allows only one competing pending to running winner", async () => {
      const repo = factory();
      await seed(repo);
      const results = await Promise.all([
        repo.transitionPostProcessingStatus("pp", { expected: ["pending"], target: "running" }),
        repo.transitionPostProcessingStatus("pp", { expected: ["pending"], target: "running" }),
      ]);
      expect(results.filter((r) => r.applied)).toHaveLength(1);
    });
  });
}

suite("in-memory PP transitions", () => new InMemorySessionRepository());
suite("JSON PP transitions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "th-pp-"));
  const db = new JsonFileDatabase(path.join(dir, "db.json"));
  cleanup.push(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return new JsonFileSessionRepository(db);
});

it("JSON PP result and error survive reload", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "th-pp-reload-"));
  const filePath = path.join(dir, "db.json");
  const db = new JsonFileDatabase(filePath);
  const repo = new JsonFileSessionRepository(db);
  await seed(repo);
  await repo.transitionPostProcessingStatus("pp", { expected: ["pending"], target: "running" });
  await repo.transitionPostProcessingStatus("pp", { expected: ["running"], target: "failed", error: "persisted error" });
  db.close();
  const reloadedDb = new JsonFileDatabase(filePath);
  const reloaded = new JsonFileSessionRepository(reloadedDb);
  expect(await reloaded.findById("pp")).toMatchObject({ postProcessingStatus: "failed", postProcessingError: "persisted error" });
  reloadedDb.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
