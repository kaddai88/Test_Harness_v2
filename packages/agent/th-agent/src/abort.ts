import type { AbortReason, SessionStatusReason } from "@test-harness/th-protocol";
import { extractAbortReason } from "@test-harness/th-protocol";
import type { AgentResult } from "./context.js";

export { extractAbortReason };

export interface AbortOutcome {
  status: "failed" | "cancelled";
  reason: SessionStatusReason;
}

export function classifyAbortOutcome(reason: AbortReason): AbortOutcome {
  switch (reason) {
    case "user_cancel":
      return { status: "cancelled", reason: "user_cancel_quiesced" };
    case "deadline":
      return { status: "failed", reason: "execution_timeout" };
    case "worker_shutdown":
      return { status: "failed", reason: "worker_shutdown" };
    case "system":
      return { status: "failed", reason: "system_error" };
  }
}

export function abortResult(
  sessionId: string,
  turns: number,
  reason: AbortReason,
  error?: Error,
): AgentResult {
  const outcome = classifyAbortOutcome(reason);
  return { sessionId, turns, ...outcome, ...(error ? { error } : {}) };
}
