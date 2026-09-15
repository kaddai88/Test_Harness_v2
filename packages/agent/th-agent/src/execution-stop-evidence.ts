import type { AbortReason } from "@test-harness/th-protocol";

/**
 * Opaque evidence contract for a future worker-owned quiescence boundary.
 *
 * This module intentionally exposes no constructor or factory. Phase 2-D's
 * worker terminalization boundary will be the sole producer. Agent/tool code
 * may report facts needed by that boundary, but cannot assert quiescence.
 */
const executionStopEvidenceBrand: unique symbol = Symbol("ExecutionStopEvidence");

export interface ExecutionStopEvidence {
  readonly [executionStopEvidenceBrand]: true;
  readonly kind: "never_started" | "confirmed";
}

export interface ExecutionStopFacts {
  readonly executionSettled: boolean;
  readonly activeWorkerOperations: number;
  readonly newWorkBlocked: boolean;
  readonly planningStarted: boolean;
  readonly abortReason?: AbortReason;
}

/** Facts reported by agent/tool layers; not terminal evidence. */
export function reportExecutionStopFacts(facts: ExecutionStopFacts): ExecutionStopFacts {
  return { ...facts };
}

/** Prevents ordinary callers from constructing authoritative evidence. */
export function isExecutionStopEvidence(value: unknown): value is ExecutionStopEvidence {
  return typeof value === "object" && value !== null &&
    (value as Record<PropertyKey, unknown>)[executionStopEvidenceBrand] === true;
}
