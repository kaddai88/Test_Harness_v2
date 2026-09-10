/**
 * P2-E Observation Occurrence Lifecycle (I4)
 *
 * Implements atomic occurrence ingestion and current observation management.
 *
 * Core invariants:
 * - Occurrence identity is event identity, NOT derived from content hash
 * - Only successful recognized observations get occurrence (complete/empty/accepted-partial)
 * - Partial must have validated completenessScope BEFORE occurrence creation
 * - Atomic ingestion: all-or-nothing, failure leaves prior current intact
 * - Basic current installation only after full occurrence construction
 *
 * Phase 1a scope:
 * - Occurrence ID generation (unique event identity)
 * - Atomic ingestion (all-or-nothing)
 * - Typed outcome classification
 * - Basic current installation
 * - C8-C12 conformance coverage
 *
 * NOT in scope (deferred to I7):
 * - State-changing action invalidation
 * - Explicit unavailable transitions
 * - Multi-tool revalidation
 * - Stale-action enforcement
 */

import type {
  ObservationOccurrence,
  ObservationOccurrenceIdentity,
  ObservationContentIdentity,
  StructuralEvidence,
  CurrentObservationState,
  ObservationOutcome,
} from './identity-semantics.js';
import {
  constructObservationEnvelope,
  constructObservationContentIdentity,
} from './observation-projection.js';
import {
  constructStructuralProjection,
  constructStructuralEvidence,
} from './structural-projection.js';

// ─── Occurrence Outcome Classification ───────────────────────────────────────

/**
 * Classify acquisition outcome for occurrence creation
 *
 * Only successful recognized observations create occurrences:
 * - complete → occurrence
 * - empty → occurrence
 * - accepted partial → occurrence
 *
 * These do NOT create occurrences:
 * - acquisition_failure → NO occurrence
 * - malformed_partial → NO occurrence
 * - absent_body → NO occurrence
 * - explicit_unavailable → NO observation occurrence
 */
export type AcquisitionOutcome =
  | 'complete'
  | 'empty'
  | 'accepted_partial'
  | 'acquisition_failure'
  | 'malformed_partial'
  | 'absent_body'
  | 'explicit_unavailable';

/**
 * Determine if an acquisition outcome creates an observation occurrence
 */
export function createsObservationOccurrence(outcome: AcquisitionOutcome): boolean {
  return outcome === 'complete' || outcome === 'empty' || outcome === 'accepted_partial';
}

/**
 * Convert AcquisitionOutcome to ObservationOutcome (for occurrence creation)
 */
export function toObservationOutcome(outcome: AcquisitionOutcome): ObservationOutcome | null {
  switch (outcome) {
    case 'complete':
      return 'complete';
    case 'empty':
      return 'empty';
    case 'accepted_partial':
      return 'partial';
    default:
      return null; // No occurrence created
  }
}

// ─── Occurrence Identity Allocator ───────────────────────────────────────────

/**
 * Allocate a unique occurrence identity
 *
 * Occurrence identity represents EVENT identity, NOT content identity.
 * Two occurrences with identical content still have different occurrence IDs.
 *
 * Phase 1a: Session-local monotonic counter
 * Future phases may integrate with durable restart recovery.
 */
export function allocateOccurrenceIdentity(
  context: { occurrenceCounter: number }
): ObservationOccurrenceIdentity {
  const occurrenceId = `O${context.occurrenceCounter}`;
  const timestamp = Date.now();

  return {
    occurrenceId,
    timestamp,
  };
}

// ─── Atomic Ingestion ────────────────────────────────────────────────────────

/**
 * Result of atomic ingestion attempt
 */
export interface IngestionResult {
  success: boolean;
  occurrence?: ObservationOccurrence;
  error?: string;
}

/**
 * Atomically ingest a successful observation into the occurrence lifecycle
 *
 * Atomic invariant: all-or-nothing
 * - If any step fails, no partial state is visible
 * - Previous current remains authoritative on failure
 *
 * Steps:
 * 1. Classify outcome (must be successful: complete/empty/accepted-partial)
 * 2. Construct observation envelope and content identity
 * 3. Construct structural projection and evidence
 * 4. Allocate unique occurrence identity
 * 5. Construct complete ObservationOccurrence
 * 6. Return occurrence for current installation
 *
 * If any step throws, no occurrence is created and previous current remains intact.
 */
export function atomicallyIngestObservation(
  rawSnapshot: string,
  url: string,
  outcome: AcquisitionOutcome,
  context: {
    occurrenceCounter: number;
    observationContractVersion: string;
    structuralContractVersion: string;
  },
  partialCompletenessScope?: string
): IngestionResult {
  // Step 1: Classify outcome
  if (!createsObservationOccurrence(outcome)) {
    return {
      success: false,
      error: `Outcome '${outcome}' does not create observation occurrence`,
    };
  }

  // I4-R1: Validate partial completeness scope
  // accepted_partial requires explicit valid scope, otherwise treat as malformed_partial
  if (outcome === 'accepted_partial') {
    if (!partialCompletenessScope || partialCompletenessScope.trim() === '') {
      return {
        success: false,
        error: 'accepted_partial requires explicit valid completenessScope; missing scope treated as malformed_partial',
      };
    }
  }

  const observationOutcome = toObservationOutcome(outcome);
  if (!observationOutcome) {
    return {
      success: false,
      error: 'Failed to convert outcome',
    };
  }

  try {
    // Step 2: Construct observation envelope and content identity
    const envelope = constructObservationEnvelope(rawSnapshot, url, observationOutcome);
    const observationContent = constructObservationContentIdentity(
      envelope,
      context.observationContractVersion
    );

    // Step 3: Construct structural projection and evidence
    const structuralProjection = constructStructuralProjection(rawSnapshot, url);
    // At this point, partialCompletenessScope is guaranteed to be non-empty for accepted_partial
    const completenessScope = outcome === 'accepted_partial'
      ? partialCompletenessScope!
      : 'complete';
    const structuralEvidence = constructStructuralEvidence(
      structuralProjection,
      context.structuralContractVersion,
      completenessScope
    );

    // Step 4: Allocate unique occurrence identity
    const occurrenceId = allocateOccurrenceIdentity(context);

    // Step 5: Construct complete ObservationOccurrence
    const occurrence: ObservationOccurrence = {
      occurrenceId,
      outcome: observationOutcome,
      observationContent,
      observationEnvelope: envelope,
      structuralEvidence,
    };

    // Step 6: Return occurrence for current installation
    return {
      success: true,
      occurrence,
    };
  } catch (error) {
    // Atomic failure: no partial state visible
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during ingestion',
    };
  }
}

// ─── Current Observation Installation ────────────────────────────────────────

/**
 * Install a new occurrence as the current observation
 *
 * This is a basic installation that sets current = new occurrence.
 * I7 will add invalidation/unavailable transitions.
 *
 * IMPORTANT: This should only be called after successful atomic ingestion.
 * The caller is responsible for ensuring the occurrence is complete.
 */
export function installCurrentObservation(
  current: CurrentObservationState,
  occurrence: ObservationOccurrence
): CurrentObservationState {
  // Basic installation: just set current to the new occurrence
  // I7 will add invalidation logic
  return {
    kind: 'current',
    occurrence,
  };
}

/**
 * Increment occurrence counter after successful ingestion
 *
 * This must be called after successful installation to maintain monotonic uniqueness.
 */
export function incrementOccurrenceCounter(context: { occurrenceCounter: number }): number {
  return context.occurrenceCounter + 1;
}

// ─── Ingestion Workflow ──────────────────────────────────────────────────────

/**
 * Complete ingestion workflow: classify, ingest, install, increment
 *
 * This is the high-level API for ingesting a successful observation.
 * It orchestrates the atomic ingestion and current installation.
 *
 * Returns the updated context with new current observation and incremented counter.
 * If ingestion fails, returns the original context unchanged.
 */
export function ingestSuccessfulObservation(
  rawSnapshot: string,
  url: string,
  outcome: AcquisitionOutcome,
  context: {
    currentObservation: CurrentObservationState;
    occurrenceCounter: number;
    observationContractVersion: string;
    structuralContractVersion: string;
  },
  partialCompletenessScope?: string
): {
  currentObservation: CurrentObservationState;
  occurrenceCounter: number;
  ingestionResult: IngestionResult;
} {
  // Attempt atomic ingestion
  const ingestionResult = atomicallyIngestObservation(
    rawSnapshot,
    url,
    outcome,
    context,
    partialCompletenessScope
  );

  if (!ingestionResult.success || !ingestionResult.occurrence) {
    // Atomic failure: return original context unchanged
    return {
      currentObservation: context.currentObservation,
      occurrenceCounter: context.occurrenceCounter,
      ingestionResult,
    };
  }

  // Install new occurrence as current
  const newCurrent = installCurrentObservation(context.currentObservation, ingestionResult.occurrence);

  // Increment occurrence counter
  const newCounter = incrementOccurrenceCounter(context);

  return {
    currentObservation: newCurrent,
    occurrenceCounter: newCounter,
    ingestionResult,
  };
}
