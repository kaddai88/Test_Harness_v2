import { describe, expect, it } from "vitest";
import { InMemorySessionRepository } from "@test-harness/th-persistence";

async function completedSession() {
  const repo = new InMemorySessionRepository();
  await repo.create({ id: "s", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
  await repo.transitionStatus("s", { expected: ["queued", "pending" as never], target: "planning", reason: "lifecycle_start" });
  await repo.transitionStatus("s", { expected: ["planning"], target: "running", reason: "lifecycle_start" });
  await repo.transitionStatus("s", {
    expected: ["running"], target: "completed", reason: "completion_success",
    sideEffects: { terminalAt: "2026-09-14T00:00:00.000Z", postProcessingStatus: "pending" },
  });
  return repo;
}

describe("Phase 2-D Gate D runtime PP guards", () => {
  it("cancelled terminal has zero normal post-processing transitions", async () => {
    const repo = new InMemorySessionRepository();
    await repo.create({ id: "s", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
    await repo.transitionStatus("s", { expected: ["queued", "pending" as never], target: "planning", reason: "lifecycle_start" });
    await repo.transitionStatus("s", { expected: ["planning"], target: "cancelling", reason: "user_cancel_requested", sideEffects: { cancelRequestedAt: "2026-09-14T00:00:00.000Z" } });
    await repo.transitionStatus("s", { expected: ["cancelling"], target: "cancelled", reason: "user_cancel_quiesced", sideEffects: { terminalAt: "2026-09-14T00:00:01.000Z", postProcessingStatus: "not_applicable" } });
    await expect(repo.transitionPostProcessingStatus("s", { expected: ["not_applicable"], target: "running" })).rejects.toThrow();
    await expect(repo.findById("s")).resolves.toMatchObject({ status: "cancelled", postProcessingStatus: "not_applicable" });
  });

  it("rejected terminal CAS leaves PP untouched and cannot start it", async () => {
    const repo = await completedSession();
    const rejected = await repo.transitionStatus("s", {
      expected: ["running"], target: "failed", reason: "failure_exception",
      sideEffects: { terminalAt: "2026-09-14T00:00:01.000Z", postProcessingStatus: "pending" },
    });
    expect(rejected).toMatchObject({ applied: false, currentState: "completed" });
    await expect(repo.findById("s")).resolves.toMatchObject({ status: "completed", postProcessingStatus: "pending" });
  });

  it("successful core can transition PP pending → running → failed with error without changing session status", async () => {
    const repo = await completedSession();
    expect((await repo.transitionPostProcessingStatus("s", { expected: ["pending"], target: "running" })).applied).toBe(true);
    expect((await repo.transitionPostProcessingStatus("s", { expected: ["running"], target: "failed", error: "summary failed" })).applied).toBe(true);
    await expect(repo.findById("s")).resolves.toMatchObject({ status: "completed", postProcessingStatus: "failed", postProcessingError: "summary failed" });
  });
});
