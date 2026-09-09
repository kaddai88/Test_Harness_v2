/**
 * P2-E Conformance Tests P1-P6: Request-Bound Decision Provenance
 *
 * Verifies the core invariants of request-bound provenance capture:
 *
 * P1: request built from O17 → provenance binds O17
 * P2: O18 appears before response → returned decision still binds O17
 * P3: same content observed as O17 and O18 → provenance still distinguishes exact occurrence
 * P4: LEGACY_UNAVAILABLE → cannot fabricate exact provenance
 * P5: fresh observation after legacy decision → old decision cannot be rebound → new model request required
 * P6: captured provenance cannot be mutated after request construction
 *
 * These tests verify that provenance is captured at request construction time,
 * not at response time or tool execution time.
 */

import { describe, it, expect } from 'vitest';
import type { ObservationOccurrence, ObservationOccurrenceIdentity } from './identity-semantics.js';
import {
  captureRequestBoundProvenance,
  isLegacyUnavailable,
  isExactProvenance,
  requiresFreshModelRequest,
  freezeProvenance,
  isProvenanceFrozen,
  constructModelRequest,
  formatProvenance,
  isSameOccurrence,
  hasSameObservationContent,
} from './decision-provenance.js';

// Helper to create a test occurrence
function createTestOccurrence(
  occurrenceId: string,
  contentHash: string,
  contractVersion: string = 'v1'
): ObservationOccurrence {
  return {
    occurrenceId: {
      occurrenceId,
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
        structuralHash: 'struct-' + contentHash,
      },
    },
  };
}

describe('P2-E Conformance P1-P6: Request-Bound Decision Provenance', () => {
  describe('P1: request built from O17 → provenance binds O17', () => {
    it('captured provenance binds the exact occurrence used for request construction', () => {
      const O17 = createTestOccurrence('O17', 'hash17');

      const provenance = captureRequestBoundProvenance(O17);

      // Provenance must bind O17's occurrence ID
      expect(provenance.occurrenceId).toBe('O17');

      // Provenance must bind O17's observation content identity
      expect(provenance.observationContent.contentHash).toBe('hash17');
      expect(provenance.observationContent.contractVersion).toBe('v1');
    });

    it('model request context captures provenance at construction time', () => {
      const O17 = createTestOccurrence('O17', 'hash17');

      const requestContext = constructModelRequest(O17);

      // Request context must bind O17
      expect(requestContext.occurrence.occurrenceId.occurrenceId).toBe('O17');
      expect(requestContext.provenance.occurrenceId).toBe('O17');
      expect(requestContext.provenance.observationContent.contentHash).toBe('hash17');

      // Request context must have a timestamp
      expect(requestContext.requestTimestamp).toBeGreaterThan(0);
    });
  });

  describe('P2: O18 appears before response → returned decision still binds O17', () => {
    it('provenance captured at request time is not affected by later occurrences', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const O18 = createTestOccurrence('O18', 'hash18');

      // Capture provenance at request construction time (using O17)
      const requestProvenance = captureRequestBoundProvenance(O17);

      // Later, O18 is ingested (simulating "O18 appears before response")
      // The request provenance must still bind O17, not O18
      expect(requestProvenance.occurrenceId).toBe('O17');
      expect(requestProvenance.occurrenceId).not.toBe('O18');
      expect(requestProvenance.observationContent.contentHash).toBe('hash17');
    });

    it('model request context provenance is independent of current observation changes', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const O18 = createTestOccurrence('O18', 'hash18');

      // Construct model request with O17
      const requestContext = constructModelRequest(O17);

      // Later, O18 becomes current (simulating state change)
      const currentOccurrence = O18;

      // Request context provenance must still bind O17
      expect(requestContext.provenance.occurrenceId).toBe('O17');
      expect(requestContext.provenance.occurrenceId).not.toBe(currentOccurrence.occurrenceId.occurrenceId);
    });
  });

  describe('P3: same content observed as O17 and O18 → provenance still distinguishes exact occurrence', () => {
    it('provenance distinguishes occurrences even when content is identical', () => {
      const sameContentHash = 'same-hash';

      // Two occurrences with identical content
      const O17 = createTestOccurrence('O17', sameContentHash);
      const O18 = createTestOccurrence('O18', sameContentHash);

      // Capture provenance for each
      const provenance17 = captureRequestBoundProvenance(O17);
      const provenance18 = captureRequestBoundProvenance(O18);

      // Both have the same observation content
      expect(provenance17.observationContent.contentHash).toBe(sameContentHash);
      expect(provenance18.observationContent.contentHash).toBe(sameContentHash);

      // But different occurrence IDs (event identity ≠ content identity)
      expect(provenance17.occurrenceId).toBe('O17');
      expect(provenance18.occurrenceId).toBe('O18');
      expect(provenance17.occurrenceId).not.toBe(provenance18.occurrenceId);
    });

    it('isSameOccurrence correctly distinguishes occurrences with same content', () => {
      const sameContentHash = 'same-hash';
      const O17 = createTestOccurrence('O17', sameContentHash);
      const O18 = createTestOccurrence('O18', sameContentHash);

      const provenance17 = captureRequestBoundProvenance(O17);
      const provenance18 = captureRequestBoundProvenance(O18);

      // Same observation content
      expect(hasSameObservationContent(provenance17, provenance18)).toBe(true);

      // But different occurrences
      expect(isSameOccurrence(provenance17, provenance18)).toBe(false);
    });
  });

  describe('P4: LEGACY_UNAVAILABLE → cannot fabricate exact provenance', () => {
    it('LEGACY_UNAVAILABLE is recognized as legacy provenance', () => {
      const legacyProvenance = 'LEGACY_UNAVAILABLE' as const;

      expect(isLegacyUnavailable(legacyProvenance)).toBe(true);
      expect(isExactProvenance(legacyProvenance)).toBe(false);
    });

    it('LEGACY_UNAVAILABLE cannot be converted to exact provenance', () => {
      const legacyProvenance = 'LEGACY_UNAVAILABLE' as const;

      // LEGACY_UNAVAILABLE is a distinct type, not a DecisionSnapshotProvenance
      expect(typeof legacyProvenance).toBe('string');
      expect(isExactProvenance(legacyProvenance)).toBe(false);

      // Cannot access occurrenceId or observationContent on LEGACY_UNAVAILABLE
      // (TypeScript would prevent this, but we verify the runtime behavior)
      expect(() => {
        const provenance = legacyProvenance as any;
        return provenance.occurrenceId;
      }).not.toThrow(); // Just accessing undefined is OK
    });

    it('requiresFreshModelRequest returns true for LEGACY_UNAVAILABLE', () => {
      const legacyProvenance = 'LEGACY_UNAVAILABLE' as const;

      // LEGACY_UNAVAILABLE always requires a fresh request
      expect(requiresFreshModelRequest(legacyProvenance, null, 'O17')).toBe(true);
      expect(requiresFreshModelRequest(legacyProvenance, 'O16', 'O17')).toBe(true);
      expect(requiresFreshModelRequest(legacyProvenance, 'O17', 'O17')).toBe(true);
    });
    it('formatProvenance formats LEGACY_UNAVAILABLE correctly', () => {
      const legacyProvenance = 'LEGACY_UNAVAILABLE' as const;
      expect(formatProvenance(legacyProvenance)).toBe('LEGACY_UNAVAILABLE');
    });
  });

  describe('P5: fresh observation after legacy decision → old decision cannot be rebound → new model request required', () => {
    it('requiresFreshModelRequest enforces fresh-observation → fresh-request rule', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance17 = captureRequestBoundProvenance(O17);

      // Last request used O17, current is still O17 → no fresh request needed
      expect(requiresFreshModelRequest(provenance17, 'O17', 'O17')).toBe(false);

      // Last request used O17, but current is now O18 → fresh request required
      expect(requiresFreshModelRequest(provenance17, 'O17', 'O18')).toBe(true);

      // I6-R1: provenance is the sole authority. Provenance O17 matches
      // current O17, so absence of the auxiliary marker does NOT force a
      // fresh request (see P5-extra tests for the authority matrix).
      expect(requiresFreshModelRequest(provenance17, null, 'O17')).toBe(false);
    });

    it('old decision provenance cannot be rebound to new occurrence', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const O18 = createTestOccurrence('O18', 'hash18');

      // Capture provenance for O17
      const provenance17 = captureRequestBoundProvenance(O17);

      // Provenance is bound to O17, cannot be rebound to O18
      expect(provenance17.occurrenceId).toBe('O17');
      expect(provenance17.occurrenceId).not.toBe('O18');

      // To use O18, must capture new provenance
      const provenance18 = captureRequestBoundProvenance(O18);
      expect(provenance18.occurrenceId).toBe('O18');
    });
  });

  describe('P5-extra (I6-R1): provenance is sole authority; auxiliary marker never overrides', () => {
    it('P5-extra-1: provenance=O17, lastReqOcc=O18, current=O18 → fresh request REQUIRED', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance17 = captureRequestBoundProvenance(O17);

      // The auxiliary marker says O18, current says O18, but the decision's
      // provenance is bound to O17. Provenance is authoritative: lastReqOcc
      // can NEVER override it into "no fresh request needed".
      expect(requiresFreshModelRequest(provenance17, 'O18', 'O18')).toBe(true);
    });

    it('P5-extra-2: provenance=O17, lastReqOcc=O17, current=O17 → fresh request NOT required', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance17 = captureRequestBoundProvenance(O17);

      // All three agree on O17 → no fresh request needed
      expect(requiresFreshModelRequest(provenance17, 'O17', 'O17')).toBe(false);
    });

    it('provenance=O17, lastReqOcc=null, current=O17 → fresh request NOT required (no auxiliary marker)', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance17 = captureRequestBoundProvenance(O17);

      // Provenance matches current; absence of auxiliary marker does not
      // force a fresh request (provenance is the sole authority)
      expect(requiresFreshModelRequest(provenance17, null, 'O17')).toBe(false);
    });

    it('provenance=O17, lastReqOcc=O17, current=O18 → fresh request REQUIRED (provenance vs current)', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance17 = captureRequestBoundProvenance(O17);

      // Provenance says O17 but current is O18 → fresh request required
      // (auxiliary marker agreeing with provenance cannot override current)
      expect(requiresFreshModelRequest(provenance17, 'O17', 'O18')).toBe(true);
    });

    it('exact provenance + no current occurrence → fresh request REQUIRED', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance17 = captureRequestBoundProvenance(O17);

      // No current occurrence to validate against
      expect(requiresFreshModelRequest(provenance17, null, null)).toBe(true);
      expect(requiresFreshModelRequest(provenance17, 'O17', null)).toBe(true);
    });

    it('LEGACY_UNAVAILABLE requires fresh request regardless of markers', () => {
      const legacyProvenance = 'LEGACY_UNAVAILABLE' as const;

      expect(requiresFreshModelRequest(legacyProvenance, null, null)).toBe(true);
      expect(requiresFreshModelRequest(legacyProvenance, 'O17', 'O17')).toBe(true);
      expect(requiresFreshModelRequest(legacyProvenance, 'O17', 'O18')).toBe(true);
    });
  });

  describe('P6: captured provenance cannot be mutated after request construction', () => {
    it('freezeProvenance creates immutable provenance', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);

      const frozen = freezeProvenance(provenance);

      // Frozen provenance is frozen
      expect(isProvenanceFrozen(frozen)).toBe(true);
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(Object.isFrozen(frozen.observationContent)).toBe(true);
    });

    it('constructModelRequest returns frozen provenance', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const requestContext = constructModelRequest(O17);

      // Model request provenance is frozen
      expect(isProvenanceFrozen(requestContext.provenance)).toBe(true);
    });

    it('frozen provenance cannot be mutated', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const frozen = freezeProvenance(provenance);

      // Attempting to mutate frozen provenance throws in strict mode
      expect(() => {
        (frozen as any).occurrenceId = 'O18';
      }).toThrow();

      expect(() => {
        (frozen.observationContent as any).contentHash = 'hash18';
      }).toThrow();
    });

    it('LEGACY_UNAVAILABLE is inherently immutable', () => {
      const legacyProvenance = 'LEGACY_UNAVAILABLE' as const;
      const frozen = freezeProvenance(legacyProvenance);

      expect(isProvenanceFrozen(frozen)).toBe(true);
      expect(frozen).toBe('LEGACY_UNAVAILABLE');
    });
  });

  describe('Diagnostic helpers', () => {
    it('formatProvenance formats exact provenance correctly', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);

      expect(formatProvenance(provenance)).toBe('O17:hash17');
    });

    it('isSameOccurrence correctly identifies same occurrence', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance1 = captureRequestBoundProvenance(O17);
      const provenance2 = captureRequestBoundProvenance(O17);

      expect(isSameOccurrence(provenance1, provenance2)).toBe(true);
    });

    it('hasSameObservationContent correctly identifies same content', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const O18 = createTestOccurrence('O18', 'hash17'); // Same content, different occurrence

      const provenance17 = captureRequestBoundProvenance(O17);
      const provenance18 = captureRequestBoundProvenance(O18);

      expect(hasSameObservationContent(provenance17, provenance18)).toBe(true);
    });

    it('isSameOccurrence returns false for LEGACY_UNAVAILABLE', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance17 = captureRequestBoundProvenance(O17);
      const legacyProvenance = 'LEGACY_UNAVAILABLE' as const;

      expect(isSameOccurrence(provenance17, legacyProvenance)).toBe(false);
      expect(isSameOccurrence(legacyProvenance, provenance17)).toBe(false);
    });

    it('hasSameObservationContent returns false for LEGACY_UNAVAILABLE', () => {
      const O17 = createTestOccurrence('O17', 'hash17');
      const provenance17 = captureRequestBoundProvenance(O17);
      const legacyProvenance = 'LEGACY_UNAVAILABLE' as const;

      expect(hasSameObservationContent(provenance17, legacyProvenance)).toBe(false);
      expect(hasSameObservationContent(legacyProvenance, provenance17)).toBe(false);
    });
  });
});
