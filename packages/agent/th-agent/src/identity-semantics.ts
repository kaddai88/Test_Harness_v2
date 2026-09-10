/**
 * P2-E Identity Semantics - Core Type Definitions
 *
 * This module defines the foundational types for the P2-E identity semantics implementation.
 * All types follow the approved design in P2-E-IDENTITY-SEMANTICS.md.
 *
 * Key principles:
 * - Three distinct concepts: observation content identity, occurrence identity, decision provenance
 * - Two independent identity domains: observation and structural
 * - Structural identity NEVER substitutes for occurrence identity at correctness boundaries
 * - Three-valued comparison: SAME / DIFFERENT / NOT COMPARABLE
 */

// ─── Identity Domains ───────────────────────────────────────────────────────

/**
 * Observation content identity - domain-scoped identity of model-visible evidence
 *
 * Answers: "Did the model receive the same snapshot-scoped browser evidence?"
 */
export interface ObservationContentIdentity {
  /** Normalization contract version (e.g., "v1") */
  contractVersion: string;
  /** Hash of normalized observation envelope */
  contentHash: string;
}

/**
 * Observation occurrence identity - unique locator for one observation event
 *
 * Answers: "When did this observation occur?"
 *
 * Two observations can have SAME content but DIFFERENT occurrence IDs.
 */
export interface ObservationOccurrenceIdentity {
  /** Unique ID for this occurrence (e.g., monotonic counter or UUID) */
  occurrenceId: string;
  /** Timestamp when this occurrence was recognized */
  timestamp: number;
}

/**
 * Structural identity - domain-scoped identity of semantic/actionable structure
 *
 * Answers: "Is this the same semantic and actionable page/view structure?"
 *
 * Note: This is just the hash. For full comparison, use StructuralEvidence.
 */
export interface StructuralIdentity {
  /** Hash of structural projection */
  structuralHash: string;
}

/**
 * Structural evidence - complete structural comparison record
 *
 * Contains contract version, completeness scope, and structural identity.
 * Used for three-valued structural comparison.
 */
export interface StructuralEvidence {
  /** Structural projection contract version */
  contractVersion: string;
  /** Evidence scope descriptor (e.g., "complete", "partial:main", "empty") */
  completenessScope: string;
  /** Structural identity within that scope */
  structuralIdentity: StructuralIdentity;
}

/**
 * Decision snapshot provenance - binds decision to exact observation occurrence
 *
 * Contains the exact occurrence identity and corresponding observation content identity.
 * Used for decision validation and stale-action detection.
 */
export interface DecisionSnapshotProvenance {
  /** Which observation occurrence was used for this decision */
  occurrenceId: string;
  /** What content was observed */
  observationContent: ObservationContentIdentity;
}

/**
 * Legacy unavailable provenance marker
 *
 * Used when decision provenance cannot be determined from legacy state.
 * Indicates that a fresh model request must be issued before validation.
 */
export const LEGACY_UNAVAILABLE = 'LEGACY_UNAVAILABLE' as const;
export type LegacyUnavailableProvenance = typeof LEGACY_UNAVAILABLE;

/**
 * Decision provenance type - either exact provenance or legacy unavailable
 */
export type DecisionProvenance = DecisionSnapshotProvenance | LegacyUnavailableProvenance;

// ─── Lifecycle States ────────────────────────────────────────────────────────

/**
 * Observation outcome - only for SUCCESSFUL observations
 *
 * Note: Acquisition failure does NOT create an ObservationOccurrence.
 * Failed acquisitions are handled separately via UnavailableEvent.
 *
 * Only successful observations (complete, empty, or accepted partial)
 * become recognized observation occurrences.
 */
export type ObservationOutcome =
  | 'complete'      // successful non-empty observation
  | 'empty'         // successful empty observation
  | 'partial';      // accepted partial observation

/**
 * Complete observation occurrence
 *
 * Represents one atomic observation event with all associated identities.
 */
export interface ObservationOccurrence {
  /** Unique occurrence locator */
  occurrenceId: ObservationOccurrenceIdentity;
  /** Typed outcome */
  outcome: ObservationOutcome;
  /** Observation content identity */
  observationContent: ObservationContentIdentity;
  /**
   * Canonical model-visible observation envelope used to derive the content identity.
   * Keeping it on the occurrence makes the occurrence the single co-origin for
   * the actual model-visible observation and request-bound provenance.
   */
  observationEnvelope?: import('./observation-projection.js').ObservationEnvelope;
  /** Structural evidence */
  structuralEvidence: StructuralEvidence;
}

/**
 * Unavailable event - discriminated union
 *
 * Distinguishes between multiple distinct reasons for unavailability:
 * - invalidated: state-changing action invalidated the current observation
 * - explicit_unavailable: authoritative acquisition explicitly reported unavailable
 * - acquisition_failure: acquisition process failed (network/tool error)
 * - malformed_partial: partial observation with unbounded/malformed completeness
 * - absent_body: tool result with absent body and no explicit outcome
 *
 * These represent different epistemic states and support different recovery policies.
 */
export type UnavailableEvent =
  | {
      kind: 'invalidated';
      eventId: string;
      /** The occurrence that was invalidated */
      invalidatedOccurrenceId: string;
      /** The action that caused invalidation */
      invalidatingAction?: string;
      timestamp: number;
    }
  | {
      kind: 'explicit_unavailable';
      eventId: string;
      /** Reason from the authoritative acquisition */
      reason: string;
      timestamp: number;
    }
  | {
      kind: 'acquisition_failure';
      eventId: string;
      /** Reason for acquisition failure (network, tool error, timeout, etc.) */
      reason: string;
      timestamp: number;
    }
  | {
      kind: 'malformed_partial';
      eventId: string;
      /** Why the partial observation is malformed/unbounded */
      reason: string;
      timestamp: number;
    }
  | {
      kind: 'absent_body';
      eventId: string;
      /** Description of the absent body situation */
      reason: string;
      timestamp: number;
    };

/**
 * Current observation state
 *
 * Represents the authoritative current observation for validation purposes.
 */
export type CurrentObservationState =
  | { kind: 'none' }                                    // NoCurrentObservation
  | { kind: 'current'; occurrence: ObservationOccurrence }  // Current(Oₙ)
  | { kind: 'unavailable'; event: UnavailableEvent };   // CurrentUnavailable(Uₙ)

// ─── Comparison Results ──────────────────────────────────────────────────────

/**
 * Three-valued comparison result
 *
 * - SAME: content equality within one compatible domain
 * - DIFFERENT: content inequality within one compatible domain
 * - NOT_COMPARABLE: comparison undefined (contract or scope incompatibility)
 */
export type IdentityComparison =
  | { result: 'SAME' }
  | { result: 'DIFFERENT' }
  | { result: 'NOT_COMPARABLE'; reason: 'contract' | 'evidence_scope' };

// ─── Session Semantics Mode ──────────────────────────────────────────────────

/**
 * Identity semantics mode for a session
 *
 * Pinned at session creation and immutable for session lifetime.
 * Survives worker/process restart via durable session state.
 */
export type IdentitySemanticsMode = 'LEGACY' | 'P2E';

/**
 * Session identity semantics metadata
 *
 * Persisted as part of session state to ensure mode survives restart.
 * Fields are readonly to enforce immutability invariant at type level.
 *
 * semanticsVersion distinguishes the persistence schema version from the mode value.
 * This allows future P2E-v2 to reject/interpret old sessions safely.
 */
export interface SessionIdentitySemantics {
  /** Pinned semantics mode (immutable for session lifetime) */
  readonly mode: IdentitySemanticsMode;
  /** When this mode was pinned (immutable) */
  readonly pinnedAt: number;
  /** Persistence schema version (distinguishes mode value from schema interpretation) */
  readonly semanticsVersion: 'p2e-v1';
}

/**
 * Persisted session state for restart recovery
 *
 * Contains all information needed to restore a session's correctness authority
 * after worker restart. The recordVersion ensures future code can safely
 * interpret or reject old persisted state.
 *
 * CRITICAL INVARIANT (I8-A-R1):
 * A session's correctness mode survives restart; a browser observation's
 * authority does NOT automatically survive restart. On restart:
 * - Session mode (P2E/LEGACY) is restored
 * - Persisted current observation becomes non-authoritative (restart-invalidated)
 * - Fresh authoritative observation is required before execution
 * - Pending observation-dependent decisions must fail closed
 */
export interface PersistedSessionState {
  /** Session identifier */
  readonly sessionId: string;
  /** Pinned identity semantics (mode + version) */
  readonly semantics: SessionIdentitySemantics;
  /** Last known decision provenance (may be LEGACY_UNAVAILABLE) */
  readonly lastDecisionProvenance: DecisionProvenance;
  /**
   * Last known current observation state
   *
   * CRITICAL: On restart, this is historical evidence only.
   * It is NOT automatically authoritative after restart.
   * The persisted observation must be re-validated or replaced with a fresh
   * authoritative observation before execution can proceed.
   */
  readonly lastCurrentObservation: CurrentObservationState;
  /**
   * Occurrence counter for restart-safe occurrence ID allocation
   *
   * Ensures occurrence IDs (O0, O1, O2, ...) are unique across the entire
   * session lifetime, including across worker/process restarts.
   *
   * On restart, the counter is restored from this persisted value, preventing
   * ID reuse that could cause old decision provenance to collide with new
   * observations.
   *
   * I8-A-R3: This counter is incremented atomically when occurrences are
   * allocated, ensuring crash-safe uniqueness.
   */
  readonly occurrenceCounter: number;
  /**
   * Persistence record schema version
   *
   * CRITICAL (I8-A-R3): This is separate from semanticsVersion.
   * - recordVersion: Persistence schema version (how to decode the record)
   * - semanticsVersion: P2E identity semantics contract version
   *
   * This allows the persistence schema to evolve independently of the
   * identity semantics contract.
   */
  readonly recordVersion: 'record-v1';
  /** Timestamp when this state was persisted */
  readonly persistedAt: number;
}
