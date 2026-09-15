import { describe, expect, it } from "vitest";
import { InMemorySessionRepository } from "@test-harness/th-persistence";

const at = (value: string) => value;

async function createRunning() {
  const repo = new InMemorySessionRepository();
  await repo.create({ id: "s", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
  await repo.transitionStatus("s", {
    expected: ["queued", "pending" as never], target: "planning", reason: "lifecycle_start",
  });
  await repo.transitionStatus("s", {
    expected: ["planning"], target: "running", reason: "lifecycle_start",
  });
  return repo;
}

describe("Phase 2-D worker terminalization race contract", () => {
  it("converges terminal CAS loss to cancelling after stop evidence", async () => {
    const repo = await createRunning();
    await repo.transitionStatus("s", {
      expected: ["running"], target: "cancelling", reason: "user_cancel_requested",
      sideEffects: { cancelRequestedAt: at("2026-09-14T00:00:00.000Z") },
    });

    const terminal = await repo.transitionStatus("s", {
      expected: ["running"], target: "completed", reason: "completion_success",
      sideEffects: { terminalAt: at("2026-09-14T00:00:01.000Z"), postProcessingStatus: "pending" },
    });
    expect(terminal.applied).toBe(false);
    expect(terminal.currentState).toBe("cancelling");

    const converged = await repo.transitionStatus("s", {
      expected: ["cancelling"], target: "cancelled", reason: "user_cancel_quiesced",
      sideEffects: { terminalAt: at("2026-09-14T00:00:02.000Z"), postProcessingStatus: "not_applicable" },
    });
    expect(converged.applied).toBe(true);
    await expect(repo.findById("s")).resolves.toMatchObject({
      status: "cancelled", postProcessingStatus: "not_applicable",
    });
  });

  it("does not claim user_cancel_quiesced without stop evidence", async () => {
    const repo = await createRunning();
    await repo.transitionStatus("s", {
      expected: ["running"], target: "cancelling", reason: "user_cancel_requested",
      sideEffects: { cancelRequestedAt: at("2026-09-14T00:00:00.000Z") },
    });

    // The worker must leave the row in cancelling when its managed operation
    // has not reached the stop boundary; no terminal transition is attempted.
    await expect(repo.findById("s")).resolves.toMatchObject({ status: "cancelling" });
  });

  it("preserves an existing terminal state after a losing worker transition", async () => {
    const repo = await createRunning();
    const completed = await repo.transitionStatus("s", {
      expected: ["running"], target: "completed", reason: "completion_success",
      sideEffects: { terminalAt: at("2026-09-14T00:00:00.000Z"), postProcessingStatus: "pending" },
    });
    expect(completed.applied).toBe(true);

    const losingWorker = await repo.transitionStatus("s", {
      expected: ["running", "cancelling"], target: "failed", reason: "failure_exception",
      sideEffects: { terminalAt: at("2026-09-14T00:00:01.000Z"), postProcessingStatus: "pending" },
    });
    expect(losingWorker).toMatchObject({ applied: false, currentState: "completed" });
    await expect(repo.findById("s")).resolves.toMatchObject({
      status: "completed", postProcessingStatus: "pending",
    });
  });

  it("rejects a planning progression race and never authorizes execution", async () => {
    const repo = new InMemorySessionRepository();
    await repo.create({ id: "s", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
    await repo.transitionStatus("s", {
      expected: ["queued", "pending" as never], target: "planning", reason: "lifecycle_start",
    });
    await repo.transitionStatus("s", {
      expected: ["planning"], target: "cancelling", reason: "user_cancel_requested",
      sideEffects: { cancelRequestedAt: at("2026-09-14T00:00:00.000Z") },
    });
    const running = await repo.transitionStatus("s", {
      expected: ["planning"], target: "running", reason: "lifecycle_start",
    });
    expect(running).toMatchObject({ applied: false, currentState: "cancelling" });
  });
});
