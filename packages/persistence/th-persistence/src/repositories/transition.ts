import type {
  PostProcessingStatus,
  SessionStatus,
  SessionStatusReason,
} from "@test-harness/th-protocol";

export interface TransitionSideEffects {
  terminalAt?: string;
  cancelRequestedAt?: string;
  postProcessingStatus?: PostProcessingStatus;
}

export interface TransitionStatusOptions {
  expected: SessionStatus[];
  target: SessionStatus;
  reason: SessionStatusReason;
  sideEffects?: TransitionSideEffects;
}

export interface TransitionStatusResult {
  applied: boolean;
  currentState: SessionStatus;
  previousState?: SessionStatus;
}

export const TERMINAL_SESSION_STATES: readonly SessionStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

/** Keep legacy persisted names readable until caller migration is complete. */
export function canonicalSessionStatus(status: string): SessionStatus {
  if (status === "pending") return "queued";
  if (status === "executing") return "running";
  return status as SessionStatus;
}

const EDGE_REASONS: Readonly<Record<string, readonly SessionStatusReason[]>> = {
  "queued->planning": ["lifecycle_start"],
  "planning->running": ["lifecycle_start"],
  "queued->cancelling": ["user_cancel_requested"],
  "planning->cancelling": ["user_cancel_requested"],
  "running->cancelling": ["user_cancel_requested"],
  "cancelling->cancelled": ["user_cancel_quiesced"],
  "cancelling->failed": ["cancellation_quiescence_failure"],
  "running->completed": ["completion_success"],
  "running->failed": ["execution_timeout", "failure_exception", "worker_shutdown", "system_error"],
  "planning->failed": ["failure_startup", "failure_exception", "worker_shutdown", "system_error"],
};

export function expectedReasons(
  from: SessionStatus,
  target: SessionStatus,
): readonly SessionStatusReason[] | undefined {
  return EDGE_REASONS[`${from}->${target}`];
}

export function assertValidTransition(
  from: SessionStatus,
  options: TransitionStatusOptions,
): void {
  const edgeReasons = expectedReasons(from, options.target);
  if (edgeReasons === undefined) {
    throw new Error(`Invalid session transition: ${from} -> ${options.target}`);
  }
  if (!edgeReasons.includes(options.reason)) {
    throw new Error(
      `Invalid transition reason for ${from} -> ${options.target}: ${options.reason}`,
    );
  }

  const effects = options.sideEffects;
  const has = (value: unknown): boolean => value !== undefined;
  const isTerminal = TERMINAL_SESSION_STATES.includes(options.target);

  if (options.target === "cancelling") {
    if (!has(effects?.cancelRequestedAt)) {
      throw new Error("cancelling requires cancelRequestedAt");
    }
    if (has(effects?.terminalAt) || has(effects?.postProcessingStatus)) {
      throw new Error("cancelling forbids terminal side-effects");
    }
  } else if (isTerminal) {
    if (!has(effects?.terminalAt)) {
      throw new Error(`${options.target} requires terminalAt`);
    }
    const expectedPostProcessing =
      options.target === "cancelled" ? "not_applicable" : effects?.postProcessingStatus;
    if (
      !has(expectedPostProcessing) ||
      (options.target === "completed" && expectedPostProcessing !== "pending") ||
      (options.target === "cancelled" && expectedPostProcessing !== "not_applicable") ||
      (options.target === "failed" &&
        expectedPostProcessing !== "pending" &&
        expectedPostProcessing !== "not_applicable")
    ) {
      throw new Error(`${options.target} has invalid postProcessingStatus`);
    }
    if (has(effects?.cancelRequestedAt)) {
      throw new Error(`${options.target} forbids cancelRequestedAt`);
    }
  } else if (has(effects?.terminalAt) || has(effects?.cancelRequestedAt) || has(effects?.postProcessingStatus)) {
    throw new Error(`${options.target} forbids supplied side-effects`);
  }
}
