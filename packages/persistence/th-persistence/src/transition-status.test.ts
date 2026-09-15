import { describe, expect, it } from "vitest";
import { InMemorySessionRepository } from "./providers/in-memory.js";
import type { SessionRepository } from "./repositories/interfaces.js";

type ProviderFactory = () => SessionRepository;

async function createSession(repo: SessionRepository) {
  const row = await repo.create({
    id: "session-1",
    targetUrl: "https://example.com",
    targetConfig: {},
    scanConfig: {},
  });
  // The pre-P5 provider creates pending; the contract canonicalizes it as queued.
  await repo.transitionStatus("session-1", {
    expected: ["queued", "pending" as never],
    target: "planning",
    reason: "lifecycle_start",
  });
  return row;
}

function testProvider(name: string, factory: ProviderFactory) {
  describe(name, () => {
    it("accepts legal edge and persists reason", async () => {
      const repo = factory();
      await createSession(repo);
      const row = await repo.findById("session-1");
      expect(row?.status).toBe("planning");
      expect(row?.statusReason).toBe("lifecycle_start");
      expect(row?.postProcessingStatus).toBe("not_started");
    });

    it("rejects missing terminal side-effects without mutation", async () => {
      const repo = factory();
      await createSession(repo);
      await expect(repo.transitionStatus("session-1", {
        expected: ["planning"],
        target: "failed",
        reason: "failure_startup",
      })).rejects.toThrow("requires terminalAt");
      expect((await repo.findById("session-1"))?.status).toBe("planning");
    });

    it("rejects queue_removed because it has no Phase-2 edge", async () => {
      const repo = factory();
      await createSession(repo);
      await expect(repo.transitionStatus("session-1", {
        expected: ["planning"],
        target: "running",
        reason: "queue_removed",
      })).rejects.toThrow("Invalid transition reason");
    });

    it("enforces terminal irreversibility and atomic mirror", async () => {
      const repo = factory();
      await createSession(repo);
      const terminalAt = "2026-09-14T00:00:00.000Z";
      const applied = await repo.transitionStatus("session-1", {
        expected: ["planning"],
        target: "failed",
        reason: "failure_startup",
        sideEffects: {
          terminalAt,
          postProcessingStatus: "not_applicable",
        },
      });
      expect(applied.applied).toBe(true);
      const row = await repo.findById("session-1");
      expect(row?.terminalAt).toBe(terminalAt);
      expect(row?.completedAt).toBe(terminalAt);
      await expect(repo.transitionStatus("session-1", {
        expected: ["failed"],
        target: "running",
        reason: "lifecycle_start",
      })).resolves.toMatchObject({ applied: false, currentState: "failed" });
    });

    it("preserves cancelRequestedAt on repeated cancel intent", async () => {
      const repo = factory();
      await createSession(repo);
      const first = "2026-09-14T00:00:00.000Z";
      await repo.transitionStatus("session-1", {
        expected: ["planning"],
        target: "cancelling",
        reason: "user_cancel_requested",
        sideEffects: { cancelRequestedAt: first },
      });
      await expect(repo.transitionStatus("session-1", {
        expected: ["planning"],
        target: "cancelling",
        reason: "user_cancel_requested",
        sideEffects: { cancelRequestedAt: "2026-09-14T00:01:00.000Z" },
      })).resolves.toMatchObject({ applied: false, currentState: "cancelling" });
      expect((await repo.findById("session-1"))?.cancelRequestedAt).toBe(first);
    });

    it("allows only one concurrent transition winner", async () => {
      const repo = factory();
      await createSession(repo);
      const attempts = await Promise.all([
        repo.transitionStatus("session-1", {
          expected: ["planning"], target: "running", reason: "lifecycle_start",
        }),
        repo.transitionStatus("session-1", {
          expected: ["planning"], target: "cancelling", reason: "user_cancel_requested",
          sideEffects: { cancelRequestedAt: "2026-09-14T00:00:00.000Z" },
        }),
      ]);
      expect(attempts.filter((attempt) => attempt.applied)).toHaveLength(1);
    });
  });
}

testProvider("in-memory", () => new InMemorySessionRepository());
