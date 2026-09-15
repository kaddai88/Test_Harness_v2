import { describe, expect, it } from "vitest";
import { abortResult, classifyAbortOutcome } from "./abort.js";
import { isExecutionStopEvidence, reportExecutionStopFacts } from "./execution-stop-evidence.js";

describe("Phase 2-C abort classification", () => {
  it.each([
    ["user_cancel", "cancelled", "user_cancel_quiesced"],
    ["deadline", "failed", "execution_timeout"],
    ["worker_shutdown", "failed", "worker_shutdown"],
    ["system", "failed", "system_error"],
  ] as const)("maps %s to %s/%s", (input, status, reason) => {
    expect(classifyAbortOutcome(input)).toEqual({ status, reason });
  });

  it("creates typed terminal result without a parallel reason string", () => {
    expect(abortResult("s1", 2, "user_cancel")).toEqual({
      sessionId: "s1",
      turns: 2,
      status: "cancelled",
      reason: "user_cancel_quiesced",
    });
  });
});

describe("Phase 2-C execution-stop evidence boundary", () => {
  it("reports agent/tool facts without asserting authoritative evidence", () => {
    const facts = reportExecutionStopFacts({
      executionSettled: true,
      activeWorkerOperations: 0,
      newWorkBlocked: true,
      planningStarted: false,
      abortReason: "user_cancel",
    });
    expect(facts.executionSettled).toBe(true);
    expect(isExecutionStopEvidence(facts)).toBe(false);
    expect(isExecutionStopEvidence({ confirmed: true })).toBe(false);
  });
});
