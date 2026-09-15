/**
 * Shared lifecycle contract types.
 *
 * These types are owned by the protocol package so agent, tools, worker, API,
 * and persistence can share the contract without a dependency cycle.
 * Runtime transition behavior belongs to later P5 implementation phases.
 */

/** Canonical session lifecycle states owned by the P5 contract. */
export type SessionStatus =
  | "queued"
  | "planning"
  | "running"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

/** Cause carried by an abort signal before it is mapped to a session outcome. */
export type AbortReason =
  | "user_cancel"
  | "worker_shutdown"
  | "deadline"
  | "system";

/** Durable reason for the session's current lifecycle state. */
export type SessionStatusReason =
  | "lifecycle_start"
  | "user_cancel_requested"
  | "user_cancel_quiesced"
  | "completion_success"
  | "execution_timeout"
  | "failure_exception"
  | "failure_startup"
  | "worker_shutdown"
  | "queue_removed"
  | "system_error"
  | "cancellation_quiescence_failure";

export function extractAbortReason(signal: AbortSignal): AbortReason {
  const value = signal.reason;
  if (value && typeof value === "object" && "reason" in value) {
    const reason = (value as { reason?: unknown }).reason;
    if (reason === "user_cancel" || reason === "worker_shutdown" || reason === "deadline" || reason === "system") {
      return reason;
    }
  }
  return "system";
}

export type PostProcessingStatus =
  | "not_started"
  | "pending"
  | "running"
  | "success"
  | "partial"
  | "failed"
  | "not_applicable";
