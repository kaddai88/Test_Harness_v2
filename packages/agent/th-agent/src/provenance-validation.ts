/**
 * P2-E Provenance Validation (I7-A)
 *
 * Implements the provenance alignment validation primitive: compares decision
 * provenance against current observation to determine if an observation-dependent
 * action can execute.
 *
 * Core invariants (I7-A):
 * - The correctness predicate is: decision occurrence vs current occurrence
 * - Content SAME must NOT suppress occurrence mismatch
 * - Structural SAME must NOT suppress occurrence mismatch
 * - LEGACY_UNAVAILABLE → NOT VALID → fresh request required
 * - Current not 'current' → NOT VALID
 *
 * Phase 1b scope (I7-A):
 * - Alignment validation primitive
 * - Typed alignment result with diagnostic information
 * - Q1-Q6 conformance coverage
 *
 * NOT in scope (deferred to I7-B):
 * - Integration with actual action execution loop
 * - Pre-execution validation in tool execution boundary
 * - Multi-tool revalidation
 * - ALIGN log integration
 *
 * AUTHORITY BOUNDARY (I7-A, I6-R1):
 * Decision provenance is the SOLE correctness authority for the request-bound
 * occurrence. Structural comparison can be computed as auxiliary diagnostic,
 * but NEVER suppresses occurrence mismatch.
 */

import type {
  DecisionProvenance,
  CurrentObservationState,
  ObservationContentIdentity,
} from './identity-semantics.js';
import { isLegacyUnavailable } from './decision-provenance.js';
import {
  getCurrentOccurrenceId,
  getCurrentStateKind,
} from './current-lifecycle.js';

// ─── Alignment Result ────────────────────────────────────────────────────────

/**
 * Provenance alignment validation result
 *
 * This is the authoritative correctness verdict for whether an
 * observation-dependent action can execute.
 *
 * IMPORTANT (I7-A):
 * - `aligned: true` means the decision's occurrence matches current's occurrence
 * - `aligned: false` means the action CANNOT execute as aligned
 * - Structural comparison is NOT part of this verdict; it can be computed
 *   separately as auxiliary diagnostic but never suppresses misalignment
 */
export type ProvenanceAlignmentResult =
  | {
      aligned: true;
      /** Decision occurrence ID */
      decisionOccurrenceId: string;
      /** Current occurrence ID (same as decision) */
      currentOccurrenceId: string;
      /** Decision observation content identity */
      decisionObservationContent: ObservationContentIdentity;
      /** Current observation content identity */
      currentObservationContent: ObservationContentIdentity;
      /** Current state kind (always 'current' when aligned) */
      currentStateKind: 'current';
    }
  | {
      aligned: false;
      /** Why the action cannot execute */
      reason:
        | 'legacy_unavailable'       // Decision provenance is LEGACY_UNAVAILABLE
        | 'no_current'               // Current state is 'none'
        | 'current_unavailable'      // Current state is 'unavailable'
        | 'occurrence_mismatch';     // Decision occurrence ≠ current occurrence
      /** Decision occurrence ID (null if LEGACY_UNAVAILABLE) */
      decisionOccurrenceId: string | null;
      /** Current occurrence ID (null if no current) */
      currentOccurrenceId: string | null;
      /** Current state kind */
      currentStateKind: 'none' | 'current' | 'unavailable';
      /** If current_unavailable, which kind of unavailable event */
      currentUnavailableKind?:
        | 'invalidated'
        | 'explicit_unavailable'
        | 'acquisition_failure'
        | 'malformed_partial'
        | 'absent_body';
      /** Decision observation content identity (null if LEGACY_UNAVAILABLE) */
      decisionObservationContent: ObservationContentIdentity | null;
      /** Current observation content identity (null if no current) */
      currentObservationContent: ObservationContentIdentity | null;
    };

// ─── Validation Primitive ────────────────────────────────────────────────────

/**
 * Validate provenance alignment between decision and current observation
 *
 * CRITICAL INVARIANT (I7-A):
 * The ONLY correctness predicate is: decision occurrence vs current occurrence.
 * Content SAME and Structural SAME MUST NOT suppress occurrence mismatch.
 *
 * Validation rules:
 * 1. decisionProvenance is LEGACY_UNAVAILABLE → NOT VALID (reason: 'legacy_unavailable')
 *    → Fresh observation + fresh model request required
 * 2. currentObservation.kind !== 'current' → NOT VALID
 *    - kind='none' → reason: 'no_current'
 *    - kind='unavailable' → reason: 'current_unavailable'
 * 3. decision occurrence ≠ current occurrence → NOT VALID (reason: 'occurrence_mismatch')
 *    - Content SAME does NOT help
 *    - Structural SAME does NOT help
 *    - This is the "O17/O18 same content → still stale" invariant
 * 4. decision occurrence === current occurrence → VALID
 *
 * @param decisionProvenance - The decision's request-bound provenance
 * @param currentObservation - The current observation state
 * @returns Provenance alignment result with diagnostic information
 */
export function validateProvenanceAlignment(
  decisionProvenance: DecisionProvenance,
  currentObservation: CurrentObservationState
): ProvenanceAlignmentResult {
  // Rule 1: LEGACY_UNAVAILABLE → NOT VALID
  if (isLegacyUnavailable(decisionProvenance)) {
    return {
      aligned: false,
      reason: 'legacy_unavailable',
      decisionOccurrenceId: null,
      currentOccurrenceId: getCurrentOccurrenceId(currentObservation),
      currentStateKind: getCurrentStateKind(currentObservation),
      decisionObservationContent: null,
      currentObservationContent:
        currentObservation.kind === 'current'
          ? currentObservation.occurrence.observationContent
          : null,
    };
  }

  // decisionProvenance is DecisionSnapshotProvenance (narrowed by type guard)
  const decisionOccurrenceId = decisionProvenance.occurrenceId;
  const decisionObservationContent = decisionProvenance.observationContent;

  // Rule 2a: Current is 'none' → NOT VALID
  if (currentObservation.kind === 'none') {
    return {
      aligned: false,
      reason: 'no_current',
      decisionOccurrenceId,
      currentOccurrenceId: null,
      currentStateKind: 'none',
      decisionObservationContent,
      currentObservationContent: null,
    };
  }

  // Rule 2b: Current is 'unavailable' → NOT VALID
  if (currentObservation.kind === 'unavailable') {
    return {
      aligned: false,
      reason: 'current_unavailable',
      decisionOccurrenceId,
      currentOccurrenceId: null,
      currentStateKind: 'unavailable',
      currentUnavailableKind: currentObservation.event.kind,
      decisionObservationContent,
      currentObservationContent: null,
    };
  }

  // currentObservation.kind === 'current'
  const currentOccurrenceId = currentObservation.occurrence.occurrenceId.occurrenceId;
  const currentObservationContent = currentObservation.occurrence.observationContent;

  // Rule 3: Occurrence mismatch → NOT VALID
  // CRITICAL (I7-A): Content SAME / Structural SAME do NOT suppress this.
  // Even if decisionObservationContent.contentHash === currentObservationContent.contentHash,
  // if occurrence IDs differ, the decision is STALE.
  if (decisionOccurrenceId !== currentOccurrenceId) {
    return {
      aligned: false,
      reason: 'occurrence_mismatch',
      decisionOccurrenceId,
      currentOccurrenceId,
      currentStateKind: 'current',
      decisionObservationContent,
      currentObservationContent,
    };
  }

  // Rule 4: Occurrence match → VALID
  return {
    aligned: true,
    decisionOccurrenceId,
    currentOccurrenceId,
    decisionObservationContent,
    currentObservationContent,
    currentStateKind: 'current',
  };
}

// ─── Convenience Predicates ──────────────────────────────────────────────────

/**
 * Check if an observation-dependent action is executable
 *
 * This is the primitive used at action execution boundary.
 * Returns true iff provenance alignment is valid.
 *
 * NOTE (I7-A): This is a pure correctness check. It does NOT integrate with
 * the execution loop; that is I7-B's responsibility.
 *
 * @param decisionProvenance - The decision's request-bound provenance
 * @param currentObservation - The current observation state
 * @returns true if the action can execute as aligned
 */
export function isActionExecutable(
  decisionProvenance: DecisionProvenance,
  currentObservation: CurrentObservationState
): boolean {
  return validateProvenanceAlignment(decisionProvenance, currentObservation).aligned;
}

/**
 * Check if a fresh model request is required
 *
 * A fresh request is required when:
 * - Decision provenance is LEGACY_UNAVAILABLE (no exact provenance)
 * - Current is not 'current' (no authoritative observation)
 * - Decision occurrence ≠ current occurrence (stale decision)
 *
 * This is equivalent to: NOT isActionExecutable(...)
 * But named explicitly for clarity in the codebase.
 */
export function requiresFreshRequest(
  decisionProvenance: DecisionProvenance,
  currentObservation: CurrentObservationState
): boolean {
  return !isActionExecutable(decisionProvenance, currentObservation);
}

// ─── Diagnostic Helpers ──────────────────────────────────────────────────────

/**
 * Format alignment result for logging/diagnostics
 *
 * Output format:
 * - ALIGNED: "ALIGNED(O{id}:{hash})"
 * - NOT ALIGNED: "NOT_ALIGNED({reason},decision=O{id}|null,current=O{id}|null,stateKind={kind})"
 */
export function formatAlignmentResult(result: ProvenanceAlignmentResult): string {
  if (result.aligned) {
    return `ALIGNED(O${result.decisionOccurrenceId}:${result.decisionObservationContent.contentHash})`;
  }

  const decision = result.decisionOccurrenceId
    ? `O${result.decisionOccurrenceId}`
    : 'LEGACY';
  const current = result.currentOccurrenceId
    ? `O${result.currentOccurrenceId}`
    : result.currentStateKind === 'none'
      ? 'none'
      : 'unavailable';

  return `NOT_ALIGNED(${result.reason},decision=${decision},current=${current},stateKind=${result.currentStateKind})`;
}

/**
 * Get the reason for misalignment (or null if aligned)
 */
export type MisalignmentReason =
  | 'legacy_unavailable'
  | 'no_current'
  | 'current_unavailable'
  | 'occurrence_mismatch';

export function getMisalignmentReason(
  result: ProvenanceAlignmentResult
): MisalignmentReason | null {
  if (result.aligned) {
    return null;
  }
  return result.reason;
}

/**
 * Build domain-tagged diagnostic output for I7 alignment diagnostics
 *
 * This is the recommended diagnostic format for I7-B ALIGN integration:
 *
 * decisionOccurrence: O17
 * currentOccurrence: O18
 * decisionObservationContent: {contractVersion, contentHash}
 * currentObservationContent: {contractVersion, contentHash}
 * occurrenceAligned: false
 * currentStateKind: current
 *
 * Structural comparison can be added as auxiliary diagnostic by I7-B,
 * but MUST be tagged as non-authoritative for stale-action correctness.
 */
export interface AlignmentDiagnostic {
  decisionOccurrence: string | null;
  currentOccurrence: string | null;
  decisionObservationContent: ObservationContentIdentity | null;
  currentObservationContent: ObservationContentIdentity | null;
  occurrenceAligned: boolean;
  currentStateKind: 'none' | 'current' | 'unavailable';
  misalignmentReason?: MisalignmentReason;
  currentUnavailableKind?:
    | 'invalidated'
    | 'explicit_unavailable'
    | 'acquisition_failure'
    | 'malformed_partial'
    | 'absent_body';
}

export function getAlignmentDiagnostic(
  result: ProvenanceAlignmentResult
): AlignmentDiagnostic {
  if (result.aligned) {
    return {
      decisionOccurrence: result.decisionOccurrenceId,
      currentOccurrence: result.currentOccurrenceId,
      decisionObservationContent: result.decisionObservationContent,
      currentObservationContent: result.currentObservationContent,
      occurrenceAligned: true,
      currentStateKind: 'current',
    };
  }

  return {
    decisionOccurrence: result.decisionOccurrenceId,
    currentOccurrence: result.currentOccurrenceId,
    decisionObservationContent: result.decisionObservationContent,
    currentObservationContent: result.currentObservationContent,
    occurrenceAligned: false,
    currentStateKind: result.currentStateKind,
    misalignmentReason: result.reason,
    currentUnavailableKind:
      'currentUnavailableKind' in result ? result.currentUnavailableKind : undefined,
  };
}
