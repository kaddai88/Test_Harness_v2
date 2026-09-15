import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileDatabase, JsonFileSessionRepository } from "./providers/json-file.js";
import type { SessionRepository } from "./repositories/interfaces.js";

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); });

async function withJsonRepo<T>(fn: (repo: SessionRepository, filePath: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "th-persistence-"));
  const filePath = path.join(dir, "db.json");
  const db = new JsonFileDatabase(filePath);
  const repo = new JsonFileSessionRepository(db);
  cleanup.push(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return fn(repo, filePath);
}

async function seedPlanning(repo: SessionRepository) {
  await repo.create({ id: "s1", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
  await repo.transitionStatus("s1", { expected: ["queued", "pending" as never], target: "planning", reason: "lifecycle_start" });
}

describe("JsonFileSessionRepository transition contract", () => {
  it("accepts legal edges and persists/reloads lifecycle fields", async () => {
    await withJsonRepo(async (repo, filePath) => {
      await seedPlanning(repo);
      const terminalAt = "2026-09-14T00:00:00.000Z";
      await repo.transitionStatus("s1", {
        expected: ["planning"], target: "failed", reason: "failure_startup",
        sideEffects: { terminalAt, postProcessingStatus: "not_applicable" },
      });
      const reloadedDb = new JsonFileDatabase(filePath);
      const reloaded = new JsonFileSessionRepository(reloadedDb);
      cleanup.push(() => reloadedDb.close());
      await expect(reloaded.findById("s1")).resolves.toMatchObject({
        status: "failed", terminalAt, completedAt: terminalAt,
        statusReason: "failure_startup", postProcessingStatus: "not_applicable",
      });
    });
  });

  it("normalizes legacy records with lifecycle defaults", async () => {
    await withJsonRepo(async (_repo, filePath) => {
      fs.writeFileSync(filePath, JSON.stringify({ sessions: {
        s1: { id: "s1", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {},
          status: "pending", createdAt: "2026-09-14T00:00:00.000Z", startedAt: null,
          completedAt: null, createdBy: null, metadata: {} },
      }}));
      const db = new JsonFileDatabase(filePath);
      const repo = new JsonFileSessionRepository(db);
      cleanup.push(() => db.close());
      await expect(repo.findById("s1")).resolves.toMatchObject({
        status: "pending", cancelRequestedAt: null, terminalAt: null,
        statusReason: null, postProcessingStatus: "not_started", postProcessingError: null,
      });
      db.save();
      const reloadedDb = new JsonFileDatabase(filePath);
      const reloaded = new JsonFileSessionRepository(reloadedDb);
      cleanup.push(() => reloadedDb.close());
      await expect(reloaded.findById("s1")).resolves.toMatchObject({
        status: "pending", cancelRequestedAt: null, terminalAt: null,
        statusReason: null, postProcessingStatus: "not_started", postProcessingError: null,
      });
    });
  });

  it("rejects illegal and incomplete transitions without mutation", async () => {
    await withJsonRepo(async (repo) => {
      await seedPlanning(repo);
      await expect(repo.transitionStatus("s1", {
        expected: ["planning"], target: "failed", reason: "failure_startup",
      })).rejects.toThrow("requires terminalAt");
      await expect(repo.transitionStatus("s1", {
        expected: ["planning"], target: "running", reason: "queue_removed",
      })).rejects.toThrow("Invalid transition reason");
      expect((await repo.findById("s1"))?.status).toBe("planning");
    });
  });

  it("serializes competing transitions through the shared database authority", async () => {
    await withJsonRepo(async (repo) => {
      await seedPlanning(repo);
      await repo.transitionStatus("s1", { expected: ["planning"], target: "running", reason: "lifecycle_start" });
      const attempts = await Promise.all([
        repo.transitionStatus("s1", {
          expected: ["running"], target: "completed", reason: "completion_success",
          sideEffects: { terminalAt: "2026-09-14T00:00:00.000Z", postProcessingStatus: "pending" },
        }),
        repo.transitionStatus("s1", {
          expected: ["running"], target: "failed", reason: "failure_exception",
          sideEffects: { terminalAt: "2026-09-14T00:00:01.000Z", postProcessingStatus: "not_applicable" },
        }),
      ]);
      expect(attempts.filter((result) => result.applied)).toHaveLength(1);
      const row = await repo.findById("s1");
      expect(row?.status).toBe(attempts.find((result) => result.applied)?.currentState);
      expect(row?.terminalAt).toBe(row?.completedAt);
    });
  });

  it("does not mix cancel and completion side-effects", async () => {
    await withJsonRepo(async (repo) => {
      await seedPlanning(repo);
      await repo.transitionStatus("s1", { expected: ["planning"], target: "running", reason: "lifecycle_start" });
      const attempts = await Promise.all([
        repo.transitionStatus("s1", {
          expected: ["running"], target: "cancelling", reason: "user_cancel_requested",
          sideEffects: { cancelRequestedAt: "2026-09-14T00:00:00.000Z" },
        }),
        repo.transitionStatus("s1", {
          expected: ["running"], target: "completed", reason: "completion_success",
          sideEffects: { terminalAt: "2026-09-14T00:00:01.000Z", postProcessingStatus: "pending" },
        }),
      ]);
      expect(attempts.filter((result) => result.applied)).toHaveLength(1);
      const row = await repo.findById("s1");
      if (row?.status === "cancelling") {
        expect(row.cancelRequestedAt).toBe("2026-09-14T00:00:00.000Z");
        expect(row.terminalAt).toBeNull();
      } else {
        expect(row?.status).toBe("completed");
        expect(row?.cancelRequestedAt).toBeNull();
        expect(row?.terminalAt).toBe("2026-09-14T00:00:01.000Z");
      }
    });
  });
});
