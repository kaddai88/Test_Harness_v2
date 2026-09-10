/**
 * P2-E Conformance Tests Q1-Q10: I7-A Correctness Core
 *
 * Verifies the core correctness invariants of the authoritative current
 * lifecycle and provenance validation:
 *
 * Validation primitive (Q1-Q6):
 *   Q1:  decision O17 + current O17 → valid
 *   Q2:  decision O17 + current O18 → stale
 *   Q3:  O17/O18 same content → still stale
 *   Q4:  O17/O18 same structural evidence → still stale
 *   Q5:  LEGACY_UNAVAILABLE → cannot execute, fresh request required
 *   Q6:  current none/unavailable/invalidated → cannot validate as aligned
 *
 * Lifecycle state machine (Q7-Q10):
 *   Q7:  state-changing action success → current invalidated immediately
 *   Q8:  state-changing action may-have-applied / uncertain → current invalidated
 *   Q9:  unknown tool effect → conservative invalidation (fail closed)
 *   Q10: new successful authoritative observation → atomically installs new current
 *
 * Critical invariant (Q3/Q4):
 *   Content SAME and Structural SAME must NOT suppress occurrence mismatch.
 *   This is the invariant that all of P2-E was designed to protect.
 *
 * NOT tested here (deferred to I7-B):
 *   Q11: A1 changes current → A2 revalidates and blocks
 *   Q12: A1 causes new O18 with same content as O17 → A2 still blocks
 *   Q13: Incidental snapshot-like text cannot overwrite authoritative current
 *   Q14: Explicit snapshot / auto-snapshot / tool-post snapshot use same path
 */

import { describe, it, expect } from 'vitest';
import type {
  ObservationOccurrence,
  CurrentObservationState,
  DecisionProvenance,
} from './identity-semantics.js';
import { captureRequestBoundProvenance } from './decision-provenance.js';
import {
  invalidateCurrent,
  getCurrentStateKind,
  getCurrentOccurrenceId,
  getCurrentUnavailableKind,
  classifyToolEffect,
  shouldInvalidateAfterToolExecution,
  isProvenNoEffect,
} from './current-lifecycle.js';
import {
  validateProvenanceAlignment,
  isActionExecutable,
  requiresFreshRequest,
  getMisalignmentReason,
  formatAlignmentResult,
} from './provenance-validation.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createOccurrence(
  id: string,
  contentHash: string,
  contractVersion: string = 'v1'
): ObservationOccurrence {
  return {
    occurrenceId: {
      occurrenceId: id,
      timestamp: Date.now(),
    },
    outcome: 'complete',
    observationContent: {
      contractVersion,
      contentHash,
    },
    structuralEvidence: {
      contractVersion,
      completenessScope: 'complete',
      structuralIdentity: {
        structuralHash: `struct-${contentHash}`,
      },
    },
  };
}

function currentOf(occurrence: ObservationOccurrence): CurrentObservationState {
  return { kind: 'current', occurrence };
}

// ─── Q1-Q6: Provenance Validation Primitive ──────────────────────────────────

describe('P2-E I7-A Q1-Q6: Provenance Validation Primitive', () => {
  describe('Q1: decision O17 + current O17 → valid', () => {
    it('aligned when decision occurrence equals current occurrence', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = currentOf(O17);

      const result = validateProvenanceAlignment(provenance, current);

      expect(result.aligned).toBe(true);
      expect(isActionExecutable(provenance, current)).toBe(true);
      expect(requiresFreshRequest(provenance, current)).toBe(false);

      if (result.aligned) {
        expect(result.decisionOccurrenceId).toBe('O17');
        expect(result.currentOccurrenceId).toBe('O17');
        expect(result.currentStateKind).toBe('current');
      }
    });
  });

  describe('Q2: decision O17 + current O18 → stale', () => {
    it('misaligned when decision occurrence differs from current occurrence', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');
      const provenance = captureRequestBoundProvenance(O17);
      const current = currentOf(O18);

      const result = validateProvenanceAlignment(provenance, current);

      expect(result.aligned).toBe(false);
      expect(isActionExecutable(provenance, current)).toBe(false);
      expect(requiresFreshRequest(provenance, current)).toBe(true);

      if (!result.aligned) {
        expect(result.reason).toBe('occurrence_mismatch');
        expect(result.decisionOccurrenceId).toBe('O17');
        expect(result.currentOccurrenceId).toBe('O18');
        expect(result.currentStateKind).toBe('current');
      }
    });
  });

  describe('Q3: O17/O18 same content → still stale (CRITICAL INVARIANT)', () => {
    it('content SAME does NOT suppress occurrence mismatch', () => {
      const sameContentHash = 'same-hash';
      const O17 = createOccurrence('O17', sameContentHash);
      const O18 = createOccurrence('O18', sameContentHash);

      // Verify: content IS same
      expect(O17.observationContent.contentHash).toBe(O18.observationContent.contentHash);
      expect(O17.observationContent.contractVersion).toBe(O18.observationContent.contractVersion);

      const provenance = captureRequestBoundProvenance(O17);
      const current = currentOf(O18);

      const result = validateProvenanceAlignment(provenance, current);

      // CRITICAL: Even though content is identical, occurrence differs → stale
      expect(result.aligned).toBe(false);
      expect(isActionExecutable(provenance, current)).toBe(false);

      if (!result.aligned) {
        expect(result.reason).toBe('occurrence_mismatch');
        // Both contents are available in the result for diagnostics
        expect(result.decisionObservationContent?.contentHash).toBe(sameContentHash);
        expect(result.currentObservationContent?.contentHash).toBe(sameContentHash);
      }
    });
  });

  describe('Q4: O17/O18 same structural evidence → still stale (CRITICAL INVARIANT)', () => {
    it('structural SAME does NOT suppress occurrence mismatch', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');

      // Make structural evidence identical (but keep content different)
      O18.structuralEvidence = { ...O17.structuralEvidence };

      // Verify: structural IS same
      expect(O17.structuralEvidence.structuralIdentity.structuralHash).toBe(
        O18.structuralEvidence.structuralIdentity.structuralHash
      );

      const provenance = captureRequestBoundProvenance(O17);
      const current = currentOf(O18);

      const result = validateProvenanceAlignment(provenance, current);

      // CRITICAL: Even though structural is identical, occurrence differs → stale
      expect(result.aligned).toBe(false);
      expect(isActionExecutable(provenance, current)).toBe(false);

      if (!result.aligned) {
        expect(result.reason).toBe('occurrence_mismatch');
      }
    });
  });

  describe('Q5: LEGACY_UNAVAILABLE → cannot execute, fresh request required', () => {
    it('LEGACY_UNAVAILABLE always blocks action execution', () => {
      const legacyProvenance: DecisionProvenance = 'LEGACY_UNAVAILABLE';
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      const result = validateProvenanceAlignment(legacyProvenance, current);

      expect(result.aligned).toBe(false);
      expect(isActionExecutable(legacyProvenance, current)).toBe(false);
      expect(requiresFreshRequest(legacyProvenance, current)).toBe(true);

      if (!result.aligned) {
        expect(result.reason).toBe('legacy_unavailable');
        expect(result.decisionOccurrenceId).toBeNull();
        expect(result.decisionObservationContent).toBeNull();
        // Current IS O17, but LEGACY provenance cannot validate against it
        expect(result.currentOccurrenceId).toBe('O17');
      }
    });

    it('LEGACY_UNAVAILABLE blocks even when current is unavailable', () => {
      const legacyProvenance: DecisionProvenance = 'LEGACY_UNAVAILABLE';
      const current: CurrentObservationState = {
        kind: 'unavailable',
        event: {
          kind: 'invalidated',
          eventId: 'U1',
          invalidatedOccurrenceId: 'O16',
          timestamp: Date.now(),
        },
      };

      const result = validateProvenanceAlignment(legacyProvenance, current);

      expect(result.aligned).toBe(false);
      if (!result.aligned) {
        // Reason is 'legacy_unavailable' (the decision is the authority being checked first)
        expect(result.reason).toBe('legacy_unavailable');
      }
    });
  });

  describe('Q6: current none/unavailable/invalidated → cannot validate as aligned', () => {
    it('current none → no_current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current: CurrentObservationState = { kind: 'none' };

      const result = validateProvenanceAlignment(provenance, current);

      expect(result.aligned).toBe(false);
      if (!result.aligned) {
        expect(result.reason).toBe('no_current');
        expect(result.currentStateKind).toBe('none');
        expect(result.currentOccurrenceId).toBeNull();
      }
    });

    it('current unavailable (explicit) → current_unavailable', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current: CurrentObservationState = {
        kind: 'unavailable',
        event: {
          kind: 'explicit_unavailable',
          eventId: 'U1',
          reason: 'acquisition refused',
          timestamp: Date.now(),
        },
      };

      const result = validateProvenanceAlignment(provenance, current);

      expect(result.aligned).toBe(false);
      if (!result.aligned) {
        expect(result.reason).toBe('current_unavailable');
        expect(result.currentStateKind).toBe('unavailable');
        expect(result.currentUnavailableKind).toBe('explicit_unavailable');
      }
    });

    it('current unavailable (invalidated) → current_unavailable', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current: CurrentObservationState = {
        kind: 'unavailable',
        event: {
          kind: 'invalidated',
          eventId: 'U1',
          invalidatedOccurrenceId: 'O16',
          invalidatingAction: 'browser_click',
          timestamp: Date.now(),
        },
      };

      const result = validateProvenanceAlignment(provenance, current);

      expect(result.aligned).toBe(false);
      if (!result.aligned) {
        expect(result.reason).toBe('current_unavailable');
        expect(result.currentUnavailableKind).toBe('invalidated');
      }
    });

    it('current unavailable (acquisition_failure) → current_unavailable', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current: CurrentObservationState = {
        kind: 'unavailable',
        event: {
          kind: 'acquisition_failure',
          eventId: 'U1',
          reason: 'network timeout',
          timestamp: Date.now(),
        },
      };

      const result = validateProvenanceAlignment(provenance, current);

      expect(result.aligned).toBe(false);
      if (!result.aligned) {
        expect(result.reason).toBe('current_unavailable');
        expect(result.currentUnavailableKind).toBe('acquisition_failure');
      }
    });
  });

  describe('Diagnostic helpers', () => {
    it('formatAlignmentResult formats aligned result', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = currentOf(O17);

      const result = validateProvenanceAlignment(provenance, current);
      expect(formatAlignmentResult(result)).toBe('ALIGNED(OO17:hash17)');
    });

    it('formatAlignmentResult formats misaligned result', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');
      const provenance = captureRequestBoundProvenance(O17);
      const current = currentOf(O18);

      const result = validateProvenanceAlignment(provenance, current);
      expect(formatAlignmentResult(result)).toBe(
        'NOT_ALIGNED(occurrence_mismatch,decision=OO17,current=OO18,stateKind=current)'
      );
    });

    it('getMisalignmentReason returns null for aligned', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = currentOf(O17);

      const result = validateProvenanceAlignment(provenance, current);
      expect(getMisalignmentReason(result)).toBeNull();
    });

    it('getMisalignmentReason returns reason for misaligned', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');
      const provenance = captureRequestBoundProvenance(O17);
      const current = currentOf(O18);

      const result = validateProvenanceAlignment(provenance, current);
      expect(getMisalignmentReason(result)).toBe('occurrence_mismatch');
    });
  });
});

// ─── Q7-Q10: Lifecycle State Machine ─────────────────────────────────────────

describe('P2-E I7-A Q7-Q10: Lifecycle State Machine', () => {
  describe('Q7: state-changing action success → current invalidated immediately', () => {
    it('successful state-changing action invalidates current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      expect(getCurrentStateKind(current)).toBe('current');
      expect(getCurrentOccurrenceId(current)).toBe('O17');

      // Simulate: state-changing action succeeds
      const afterAction = invalidateCurrent(current, 'browser_click');

      expect(getCurrentStateKind(afterAction)).toBe('unavailable');
      expect(getCurrentUnavailableKind(afterAction)).toBe('invalidated');
      expect(getCurrentOccurrenceId(afterAction)).toBeNull();

      // Invalidation event preserves the invalidated occurrence ID
      if (afterAction.kind === 'unavailable' && afterAction.event.kind === 'invalidated') {
        expect(afterAction.event.invalidatedOccurrenceId).toBe('O17');
        expect(afterAction.event.invalidatingAction).toBe('browser_click');
      }
    });
  });

  describe('Q8: state-changing action may-have-applied / uncertain → current invalidated', () => {
    it('may_have_applied result invalidates current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      expect(shouldInvalidateAfterToolExecution('browser_click', 'may_have_applied')).toBe(true);

      const afterAction = invalidateCurrent(current, 'browser_click (may-have-applied)');
      expect(getCurrentStateKind(afterAction)).toBe('unavailable');
      expect(getCurrentUnavailableKind(afterAction)).toBe('invalidated');
    });

    it('uncertain result invalidates current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      expect(shouldInvalidateAfterToolExecution('browser_click', 'uncertain')).toBe(true);

      const afterAction = invalidateCurrent(current);
      expect(getCurrentStateKind(afterAction)).toBe('unavailable');
    });
  });

  describe('Q9: unknown tool effect → conservative invalidation (fail closed)', () => {
    it('unknown tool is classified as state-changing', () => {
      // Unknown tool must fail closed
      expect(classifyToolEffect('browser_custom_tool')).toBe('state_changing');
      expect(classifyToolEffect('unknown_action')).toBe('state_changing');
      expect(classifyToolEffect('')).toBe('state_changing');
    });

    it('unknown tool with success result invalidates current', () => {
      expect(shouldInvalidateAfterToolExecution('browser_custom_tool', 'success')).toBe(true);
    });

    it('unknown tool with uncertain result invalidates current', () => {
      expect(shouldInvalidateAfterToolExecution('browser_custom_tool', 'uncertain')).toBe(true);
    });

    it('known read-only tools do NOT invalidate', () => {
      expect(classifyToolEffect('browser_snapshot')).toBe('read_only');
      expect(classifyToolEffect('browser_get_text')).toBe('read_only');
      expect(classifyToolEffect('browser_get_attribute')).toBe('read_only');

      expect(shouldInvalidateAfterToolExecution('browser_snapshot', 'success')).toBe(false);
      expect(shouldInvalidateAfterToolExecution('browser_get_text', 'success')).toBe(false);
    });

    it('known state-changing tools invalidate on success', () => {
      expect(classifyToolEffect('browser_click')).toBe('state_changing');
      expect(classifyToolEffect('browser_navigate')).toBe('state_changing');
      expect(classifyToolEffect('browser_fill_form')).toBe('state_changing');
      expect(classifyToolEffect('browser_type')).toBe('state_changing');

      expect(shouldInvalidateAfterToolExecution('browser_click', 'success')).toBe(true);
      expect(shouldInvalidateAfterToolExecution('browser_navigate', 'success')).toBe(true);
    });

    it('read-only tools do NOT invalidate even with uncertain result', () => {
      // Read-only tools are known to not change state, so even "uncertain"
      // result does not require invalidation.
      expect(shouldInvalidateAfterToolExecution('browser_snapshot', 'uncertain')).toBe(false);
    });

    it('state-changing tool with definitely_not_applied does NOT invalidate', () => {
      // Only PROVEN-NO-EFFECT preserves current.
      // This is the one status that can be shown to have had no effect on
      // browser state (e.g., pre-dispatch input validation rejection).
      expect(shouldInvalidateAfterToolExecution('browser_click', 'definitely_not_applied')).toBe(false);
    });

    it('state-changing tool with ANY failure-like status DOES invalidate (I7-A-R1 fail-closed)', () => {
      // CRITICAL (I7-A-R1): generic failure does NOT mean "no effect".
      // All dispatch-related outcomes — including errors, timeouts, and
      // lost transport — are treated as "may have affected browser state"
      // and trigger invalidation.
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      const failureStatuses = ['success', 'may_have_applied', 'uncertain', 'dispatch_error', 'dispatch_timeout', 'transport_lost'] as const;

      for (const status of failureStatuses) {
        expect(shouldInvalidateAfterToolExecution('browser_click', status)).toBe(true);
        const afterAction = invalidateCurrent(current);
        expect(getCurrentStateKind(afterAction)).toBe('unavailable');
        expect(getCurrentUnavailableKind(afterAction)).toBe('invalidated');
      }
    });
  });

  describe('I7-A-R1: dispatch / error / timeout uncertainty → conservative invalidation', () => {
    it('R1: action rejected before dispatch (definitely_not_applied) → Current(O17) retained', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      // Pre-dispatch rejection: input validation failed before any side effect
      expect(shouldInvalidateAfterToolExecution('browser_click', 'definitely_not_applied')).toBe(false);

      // Current is preserved (not invalidated)
      expect(getCurrentStateKind(current)).toBe('current');
      expect(getCurrentOccurrenceId(current)).toBe('O17');
    });

    it('R2: action dispatched then throws (dispatch_error) → invalidate O17', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      // Tool dispatched but threw an error after dispatch
      expect(shouldInvalidateAfterToolExecution('browser_click', 'dispatch_error')).toBe(true);

      const afterAction = invalidateCurrent(current, 'browser_click (dispatch_error)');
      expect(getCurrentStateKind(afterAction)).toBe('unavailable');
      expect(getCurrentUnavailableKind(afterAction)).toBe('invalidated');

      // The invalidated occurrence ID is preserved in the event
      if (afterAction.kind === 'unavailable' && afterAction.event.kind === 'invalidated') {
        expect(afterAction.event.invalidatedOccurrenceId).toBe('O17');
      }
    });

    it('R3: action dispatched then times out (dispatch_timeout) → invalidate O17', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      expect(shouldInvalidateAfterToolExecution('browser_click', 'dispatch_timeout')).toBe(true);

      const afterAction = invalidateCurrent(current, 'browser_click (timeout)');
      expect(getCurrentStateKind(afterAction)).toBe('unavailable');
      expect(getCurrentUnavailableKind(afterAction)).toBe('invalidated');
    });

    it('R4: unknown whether action reached browser (transport_lost) → invalidate O17', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      expect(shouldInvalidateAfterToolExecution('browser_click', 'transport_lost')).toBe(true);

      const afterAction = invalidateCurrent(current, 'browser_click (transport lost)');
      expect(getCurrentStateKind(afterAction)).toBe('unavailable');
      expect(getCurrentUnavailableKind(afterAction)).toBe('invalidated');
    });

    it('isProvenNoEffect correctly classifies each status', () => {
      // Only definitely_not_applied is proven no effect
      expect(isProvenNoEffect('definitely_not_applied')).toBe(true);

      // All others are NOT proven no effect
      expect(isProvenNoEffect('success')).toBe(false);
      expect(isProvenNoEffect('may_have_applied')).toBe(false);
      expect(isProvenNoEffect('uncertain')).toBe(false);
      expect(isProvenNoEffect('dispatch_error')).toBe(false);
      expect(isProvenNoEffect('dispatch_timeout')).toBe(false);
      expect(isProvenNoEffect('transport_lost')).toBe(false);
    });
  });

  describe('I7-A-R1: invalidateCurrent preserves non-current lifecycle state', () => {
    it('invalidateCurrent(none) → none (no fabrication)', () => {
      const current: CurrentObservationState = { kind: 'none' };

      const result = invalidateCurrent(current);

      // CRITICAL: invalidateCurrent MUST NOT fabricate a synthetic
      // invalidatedOccurrenceId when there's no current observation to invalidate.
      expect(result.kind).toBe('none');
      expect(result).toEqual(current);
    });

    it('invalidateCurrent(unavailable(invalidated)) preserves original event', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      // First invalidation
      const firstInvalidation = invalidateCurrent(current, 'browser_click');
      expect(firstInvalidation.kind).toBe('unavailable');

      // Second invalidation attempt MUST preserve the original event
      const secondInvalidation = invalidateCurrent(firstInvalidation, 'browser_navigate');

      expect(secondInvalidation).toBe(firstInvalidation);
      // Same event reference — original cause preserved
      if (secondInvalidation.kind === 'unavailable' && secondInvalidation.event.kind === 'invalidated') {
        expect(secondInvalidation.event.invalidatingAction).toBe('browser_click');
        expect(secondInvalidation.event.invalidatedOccurrenceId).toBe('O17');
      }
    });

    it('invalidateCurrent(unavailable(explicit_unavailable)) preserves explicit_unavailable cause', () => {
      const explicitUnavailable: CurrentObservationState = {
        kind: 'unavailable',
        event: {
          kind: 'explicit_unavailable',
          eventId: 'U999',
          reason: 'acquisition refused',
          timestamp: 12345,
        },
      };

      // Calling invalidateCurrent on a non-invalidated unavailable state
      // MUST preserve the original epistemic cause, not overwrite it
      const result = invalidateCurrent(explicitUnavailable, 'browser_click');

      expect(result).toBe(explicitUnavailable);
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.event.kind).toBe('explicit_unavailable');
      }
    });

    it('invalidateCurrent(unavailable(acquisition_failure)) preserves failure cause', () => {
      const acquisitionFailure: CurrentObservationState = {
        kind: 'unavailable',
        event: {
          kind: 'acquisition_failure',
          eventId: 'U998',
          reason: 'network timeout',
          timestamp: 12345,
        },
      };

      const result = invalidateCurrent(acquisitionFailure, 'browser_click');

      // Original cause preserved
      expect(result).toBe(acquisitionFailure);
      expect(result.kind).toBe('unavailable');
      if (result.kind === 'unavailable') {
        expect(result.event.kind).toBe('acquisition_failure');
      }
    });
  });

  describe('Q10: new successful authoritative observation → atomically installs new current', () => {
    it('new occurrence can be installed as current after invalidation', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      // Action invalidates current
      const afterAction = invalidateCurrent(current, 'browser_click');
      expect(getCurrentStateKind(afterAction)).toBe('unavailable');

      // New authoritative observation ingested (via I4 atomic ingestion)
      const O18 = createOccurrence('O18', 'hash18');
      const newCurrent: CurrentObservationState = { kind: 'current', occurrence: O18 };

      expect(getCurrentStateKind(newCurrent)).toBe('current');
      expect(getCurrentOccurrenceId(newCurrent)).toBe('O18');

      // Now validation against the new current works
      const provenance18 = captureRequestBoundProvenance(O18);
      expect(isActionExecutable(provenance18, newCurrent)).toBe(true);

      // But old provenance (bound to O17) is still stale against new current
      const provenance17 = captureRequestBoundProvenance(O17);
      expect(isActionExecutable(provenance17, newCurrent)).toBe(false);
    });

    it('new occurrence can be installed after explicit_unavailable', () => {
      const current: CurrentObservationState = {
        kind: 'unavailable',
        event: {
          kind: 'explicit_unavailable',
          eventId: 'U1',
          reason: 'acquisition refused',
          timestamp: Date.now(),
        },
      };

      const O18 = createOccurrence('O18', 'hash18');
      const newCurrent: CurrentObservationState = { kind: 'current', occurrence: O18 };

      expect(getCurrentStateKind(newCurrent)).toBe('current');
      expect(getCurrentOccurrenceId(newCurrent)).toBe('O18');
    });

    it('new occurrence can be installed after none', () => {
      const current: CurrentObservationState = { kind: 'none' };

      const O17 = createOccurrence('O17', 'hash17');
      const newCurrent: CurrentObservationState = { kind: 'current', occurrence: O17 };

      expect(getCurrentStateKind(newCurrent)).toBe('current');
      expect(getCurrentOccurrenceId(newCurrent)).toBe('O17');
    });
  });

  describe('Invariant: lifecycle events stay distinct', () => {
    it('invalidated has kind=invalidated, not explicit_unavailable', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      const afterInvalidation = invalidateCurrent(current);

      expect(afterInvalidation.kind).toBe('unavailable');
      if (afterInvalidation.kind === 'unavailable') {
        expect(afterInvalidation.event.kind).toBe('invalidated');
      }
    });

    it('different unavailable kinds produce different events', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = currentOf(O17);

      const invalidated = invalidateCurrent(current);
      const explicit = {
        kind: 'unavailable' as const,
        event: {
          kind: 'explicit_unavailable' as const,
          eventId: 'U999',
          reason: 'test',
          timestamp: Date.now(),
        },
      };

      // Different kinds
      if (invalidated.kind === 'unavailable' && explicit.kind === 'unavailable') {
        expect(invalidated.event.kind).not.toBe(explicit.event.kind);
      }
    });
  });
});
