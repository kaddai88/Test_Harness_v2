/**
 * P2-E Decision Provenance - Request-Bound Capture
 *
 * Implements request-bound provenance capture at model request construction boundary.
 *
 * Core invariant:
 * - Provenance MUST be captured at request construction time
 * - Provenance MUST NOT be backfilled at response time or tool execution time
 * - Provenance MUST be immutable after capture
 * - LEGACY_UNAVAILABLE cannot be used to fabricate exact provenance
 *
 * This module provides:
 * - Request-bound provenance capture
 * - Exact occurrence + observation content identity binding
 * - LEGACY_UNAVAILABLE non-fabrication path
 * - Fresh-observation → fresh-request → fresh-provenance rule
 * - Provenance immutability guarantees
 *
 * NOT in scope (deferred to I7):
 * - Current occurrence invalidation
 * - Stale-action verdict
 * - ALIGN cutover
 * - Tool-before-execution comparison
 * - Multi-tool revalidation
 */

import type {
  ObservationOccurrence,
  DecisionSnapshotProvenance,
  DecisionProvenance,
  ObservationContentIdentity,
} from './identity-semantics.js';

// ─── Request-Bound Provenance Capture ────────────────────────────────────────

/**
 * Capture request-bound provenance from an observation occurrence
 *
 * This function MUST be called at model request construction time, NOT at
 * response time or tool execution time. The captured provenance is immutable.
 *
 * @param occurrence - The observation occurrence used to construct the model request
 * @returns Immutable request-bound provenance binding
 */
export function captureRequestBoundProvenance(
  occurrence: ObservationOccurrence
): DecisionSnapshotProvenance {
  // Capture exact occurrence ID and observation content identity
  // This creates an immutable binding at request construction time
  return {
    occurrenceId: occurrence.occurrenceId.occurrenceId,
    observationContent: {
      contractVersion: occurrence.observationContent.contractVersion,
      contentHash: occurrence.observationContent.contentHash,
    },
  };
}

/**
 * Check if a provenance is LEGACY_UNAVAILABLE (type guard)
 */
export function isLegacyUnavailable(
  provenance: DecisionProvenance
): provenance is 'LEGACY_UNAVAILABLE' {
  return provenance === 'LEGACY_UNAVAILABLE';
}

/**
 * Check if a provenance is an exact request-bound provenance (type guard)
 */
export function isExactProvenance(
  provenance: DecisionProvenance
): provenance is DecisionSnapshotProvenance {
  return provenance !== 'LEGACY_UNAVAILABLE';
}

// ─── Fresh Observation → Fresh Request → Fresh Provenance ────────────────────

/**
 * Determine if a new model request is required based on provenance state
 *
 * SEMANTIC AUTHORITY (I6-R1):
 * Decision provenance is the SOLE correctness authority for the request-bound
 * occurrence. Any auxiliary request-occurrence marker may corroborate it, but
 * must never override it.
 *
 * Semantics:
 * - LEGACY_UNAVAILABLE → true (no exact provenance exists)
 * - exact provenance + no current → true (nothing to validate against)
 * - exact provenance O_n + current O_n → false (can reuse)
 * - exact provenance O_n + current O_m (m≠n) → true (fresh request required)
 * - exact provenance O_n + lastReqOcc O_m (m≠n) → true (fail closed:
 *   inconsistent state; the decision is actually bound to O_n per provenance,
 *   so we can NEVER trust lastReqOcc to override it)
 *
 * @param currentProvenance - The decision provenance (sole authority)
 * @param lastRequestOccurrenceId - OPTIONAL auxiliary consistency marker.
 *   If provided and inconsistent with provenance.occurrenceId, fails closed
 *   (requires fresh request). NEVER used as a fallback authority.
 * @param currentOccurrenceId - The current authoritative occurrence ID (null = no current)
 * @returns true if a new model request is required
 */
export function requiresFreshModelRequest(
  currentProvenance: DecisionProvenance,
  lastRequestOccurrenceId: string | null | undefined,
  currentOccurrenceId: string | null
): boolean {
  // LEGACY_UNAVAILABLE always requires a fresh request
  if (isLegacyUnavailable(currentProvenance)) {
    return true;
  }

  // No current occurrence → cannot validate against anything → fresh request
  if (currentOccurrenceId === null) {
    return true;
  }

  // PROVENANCE IS THE SOLE AUTHORITY:
  // If the decision's provenance does not match the current occurrence,
  // a fresh request is required — regardless of any auxiliary marker.
  if (currentProvenance.occurrenceId !== currentOccurrenceId) {
    return true;
  }

  // CONSISTENCY GUARD (fail closed):
  // If an auxiliary last-request marker exists and disagrees with provenance,
  // the state is inconsistent. Provenance is authoritative, but an
  // inconsistent auxiliary marker means we cannot trust the request path,
  // so we fail closed and require a fresh request.
  if (
    lastRequestOccurrenceId !== undefined &&
    lastRequestOccurrenceId !== null &&
    lastRequestOccurrenceId !== currentProvenance.occurrenceId
  ) {
    return true;
  }

  // Provenance matches current, auxiliary marker (if any) is consistent → reuse
  return false;
}

// ─── Provenance Immutability ─────────────────────────────────────────────────

/**
 * Freeze a provenance to ensure immutability
 *
 * This creates a deep-frozen copy that cannot be mutated.
 * Used to enforce provenance immutability after capture.
 *
 * @param provenance - The provenance to freeze
 * @returns Deep-frozen immutable provenance
 */
export function freezeProvenance<T extends DecisionProvenance>(provenance: T): Readonly<T> {
  if (isLegacyUnavailable(provenance)) {
    return provenance;
  }

  // Deep freeze the provenance object
  // At this point TypeScript has narrowed provenance to DecisionSnapshotProvenance
  const snapshot: DecisionSnapshotProvenance = provenance;
  return Object.freeze({
    ...snapshot,
    observationContent: Object.freeze({ ...snapshot.observationContent }),
  }) as Readonly<T>;
}

/**
 * Verify that a provenance is frozen (immutable)
 *
 * @param provenance - The provenance to check
 * @returns true if the provenance is frozen
 */
export function isProvenanceFrozen(provenance: DecisionProvenance): boolean {
  if (isLegacyUnavailable(provenance)) {
    return true; // LEGACY_UNAVAILABLE is inherently immutable
  }

  return (
    Object.isFrozen(provenance) &&
    Object.isFrozen(provenance.observationContent)
  );
}

// ─── Request Context ─────────────────────────────────────────────────────────

/**
 * Model request identity/provenance context (P2-E primitive)
 *
 * IMPORTANT (I6-R1): This currently constructs the authoritative P2-E request
 * identity/provenance context. It does NOT yet construct the actual LLM
 * request payload. Runtime model payload integration remains deferred to the
 * consumer cutover milestone.
 *
 * INVARIANT: The occurrence and provenance in this context are derived from
 * the SAME ObservationOccurrence. When consumer cutover occurs, the
 * model-visible observation and provenance MUST continue to be derived from
 * the same occurrence.
 */
export interface ModelRequestContext {
  /** The observation occurrence used to construct this request */
  occurrence: ObservationOccurrence;
  /** Immutable request-bound provenance */
  provenance: Readonly<DecisionSnapshotProvenance>;
  /** Request construction timestamp */
  requestTimestamp: number;
}

/**
 * Construct a P2-E model request identity/provenance context (I6 primitive)
 *
 * This function captures provenance at request construction time.
 * The returned context contains immutable provenance that cannot be
 * backfilled or mutated.
 *
 * IMPORTANT (I6-R1): This is the authoritative P2-E request context
 * primitive. It does NOT construct the actual LLM request payload — runtime
 * loop integration is deferred to consumer cutover. The occurrence and
 * provenance are derived from the SAME ObservationOccurrence by construction.
 *
 * @param occurrence - The observation occurrence to use for this request
 * @returns Model request context with immutable request-bound provenance
 */
export function constructModelRequest(occurrence: ObservationOccurrence): ModelRequestContext {
  const provenance = captureRequestBoundProvenance(occurrence);
  const frozenProvenance = freezeProvenance(provenance);

  return {
    occurrence,
    provenance: frozenProvenance,
    requestTimestamp: Date.now(),
  };
}

// ─── Diagnostic Helpers ──────────────────────────────────────────────────────

/**
 * Format provenance for logging/diagnostics
 */
export function formatProvenance(provenance: DecisionProvenance): string {
  if (isLegacyUnavailable(provenance)) {
    return 'LEGACY_UNAVAILABLE';
  }

  return `${provenance.occurrenceId}:${provenance.observationContent.contentHash}`;
}

/**
 * Check if two provenances refer to the same occurrence
 */
export function isSameOccurrence(
  provenanceA: DecisionProvenance,
  provenanceB: DecisionProvenance
): boolean {
  if (isLegacyUnavailable(provenanceA) || isLegacyUnavailable(provenanceB)) {
    return false;
  }

  return provenanceA.occurrenceId === provenanceB.occurrenceId;
}

/**
 * Check if two provenances have the same observation content
 */
export function hasSameObservationContent(
  provenanceA: DecisionProvenance,
  provenanceB: DecisionProvenance
): boolean {
  if (isLegacyUnavailable(provenanceA) || isLegacyUnavailable(provenanceB)) {
    return false;
  }

  return (
    provenanceA.observationContent.contractVersion ===
      provenanceB.observationContent.contractVersion &&
    provenanceA.observationContent.contentHash ===
      provenanceB.observationContent.contentHash
  );
}
