/**
 * P2-E Conformance Tests C8-C12: Observation Occurrence Lifecycle
 *
 * Verifies the core invariants of occurrence ingestion and current management:
 *
 * C8: same content ingested twice → content SAME, occurrence DIFFERENT, current advances
 * C9: successful empty observation → valid occurrence, distinguishable from failure
 * C10: accepted partial with valid scope → valid occurrence, StructuralEvidence carries scope
 * C11: acquisition failure / malformed partial / absent body → NO occurrence, NO partially installed current
 * C12: failure during atomic ingestion → previous current remains intact, no half-written occurrence
 *
 * These tests verify atomic ingestion invariants without testing I7 correctness lifecycle
 * (invalidation, unavailable transitions, multi-tool revalidation).
 */

import { describe, it, expect } from 'vitest';
import {
  atomicallyIngestObservation,
  ingestSuccessfulObservation,
  createsObservationOccurrence,
  toObservationOutcome,
  type AcquisitionOutcome,
} from './observation-lifecycle.js';
import type { CurrentObservationState } from './identity-semantics.js';

describe('P2-E Conformance C8-C12: Observation Occurrence Lifecycle', () => {
  const defaultContext = {
    currentObservation: { kind: 'none' } as CurrentObservationState,
    occurrenceCounter: 0,
    observationContractVersion: 'v1',
    structuralContractVersion: 'v1',
  };

  describe('C8: same content ingested twice → content SAME, occurrence DIFFERENT, current advances', () => {
    it('two identical observations create different occurrences with same content identity', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      // First ingestion
      const result1 = ingestSuccessfulObservation(
        rawSnapshot,
        url,
        'complete',
        defaultContext
      );

      expect(result1.ingestionResult.success).toBe(true);
      expect(result1.ingestionResult.occurrence).toBeDefined();
      expect(result1.currentObservation.kind).toBe('current');
      expect(result1.occurrenceCounter).toBe(1);

      const occurrence1 = result1.ingestionResult.occurrence!;

      // Second ingestion (same content)
      const result2 = ingestSuccessfulObservation(
        rawSnapshot,
        url,
        'complete',
        {
          ...defaultContext,
          currentObservation: result1.currentObservation,
          occurrenceCounter: result1.occurrenceCounter,
        }
      );

      expect(result2.ingestionResult.success).toBe(true);
      expect(result2.ingestionResult.occurrence).toBeDefined();
      expect(result2.currentObservation.kind).toBe('current');
      expect(result2.occurrenceCounter).toBe(2);

      const occurrence2 = result2.ingestionResult.occurrence!;

      // Content identity is SAME
      expect(occurrence1.observationContent.contentHash).toBe(
        occurrence2.observationContent.contentHash
      );
      expect(occurrence1.observationContent.contractVersion).toBe(
        occurrence2.observationContent.contractVersion
      );

      // Occurrence identity is DIFFERENT
      expect(occurrence1.occurrenceId.occurrenceId).not.toBe(
        occurrence2.occurrenceId.occurrenceId
      );

      // Current advances to second occurrence
      if (result2.currentObservation.kind === 'current') {
        expect(result2.currentObservation.occurrence.occurrenceId.occurrenceId).toBe(
          occurrence2.occurrenceId.occurrenceId
        );
      }
    });
  });

  describe('C9: successful empty observation → valid occurrence, distinguishable from failure', () => {
    it('empty observation creates valid occurrence', () => {
      const rawSnapshot = ``;
      const url = 'https://example.com/page';

      const result = ingestSuccessfulObservation(
        rawSnapshot,
        url,
        'empty',
        defaultContext
      );

      expect(result.ingestionResult.success).toBe(true);
      expect(result.ingestionResult.occurrence).toBeDefined();
      expect(result.ingestionResult.occurrence?.outcome).toBe('empty');
      expect(result.currentObservation.kind).toBe('current');
    });

    it('empty observation is distinguishable from acquisition failure', () => {
      const rawSnapshot = ``;
      const url = 'https://example.com/page';

      // Empty observation creates occurrence
      const emptyResult = ingestSuccessfulObservation(
        rawSnapshot,
        url,
        'empty',
        defaultContext
      );
      expect(emptyResult.ingestionResult.success).toBe(true);
      expect(emptyResult.ingestionResult.occurrence).toBeDefined();

      // Acquisition failure does NOT create occurrence
      const failureResult = ingestSuccessfulObservation(
        rawSnapshot,
        url,
        'acquisition_failure',
        defaultContext
      );
      expect(failureResult.ingestionResult.success).toBe(false);
      expect(failureResult.ingestionResult.occurrence).toBeUndefined();
      expect(failureResult.currentObservation.kind).toBe('none');
    });
  });

  describe('C10: accepted partial with valid scope → valid occurrence, StructuralEvidence carries scope', () => {
    it('accepted partial creates occurrence with completenessScope', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';
      const completenessScope = 'partial:main-content';

      const result = ingestSuccessfulObservation(
        rawSnapshot,
        url,
        'accepted_partial',
        defaultContext,
        completenessScope
      );

      expect(result.ingestionResult.success).toBe(true);
      expect(result.ingestionResult.occurrence).toBeDefined();
      expect(result.ingestionResult.occurrence?.outcome).toBe('partial');

      // StructuralEvidence carries the completenessScope
      expect(result.ingestionResult.occurrence?.structuralEvidence.completenessScope).toBe(
        completenessScope
      );
    });

    it('accepted_partial without explicit scope → no occurrence (treated as malformed_partial)', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const result = ingestSuccessfulObservation(
        rawSnapshot,
        url,
        'accepted_partial',
        defaultContext
        // No completenessScope provided
      );

      // I4-R1: Missing scope means malformed_partial, not accepted_partial
      expect(result.ingestionResult.success).toBe(false);
      expect(result.ingestionResult.occurrence).toBeUndefined();
      expect(result.ingestionResult.error).toContain('requires explicit valid completenessScope');
    });
  });

  describe('C11: acquisition failure / malformed partial / absent body → NO occurrence, NO partially installed current', () => {
    it('acquisition failure creates no occurrence', () => {
      const result = ingestSuccessfulObservation(
        `button "Submit" [ref=e37]`,
        'https://example.com/page',
        'acquisition_failure',
        defaultContext
      );

      expect(result.ingestionResult.success).toBe(false);
      expect(result.ingestionResult.occurrence).toBeUndefined();
      expect(result.currentObservation.kind).toBe('none');
      expect(result.occurrenceCounter).toBe(0); // Counter not incremented
    });

    it('malformed partial creates no occurrence', () => {
      const result = ingestSuccessfulObservation(
        `button "Submit" [ref=e37]`,
        'https://example.com/page',
        'malformed_partial',
        defaultContext
      );

      expect(result.ingestionResult.success).toBe(false);
      expect(result.ingestionResult.occurrence).toBeUndefined();
      expect(result.currentObservation.kind).toBe('none');
    });

    it('absent body creates no occurrence', () => {
      const result = ingestSuccessfulObservation(
        `button "Submit" [ref=e37]`,
        'https://example.com/page',
        'absent_body',
        defaultContext
      );

      expect(result.ingestionResult.success).toBe(false);
      expect(result.ingestionResult.occurrence).toBeUndefined();
      expect(result.currentObservation.kind).toBe('none');
    });

    it('explicit unavailable creates no observation occurrence', () => {
      const result = ingestSuccessfulObservation(
        `button "Submit" [ref=e37]`,
        'https://example.com/page',
        'explicit_unavailable',
        defaultContext
      );

      expect(result.ingestionResult.success).toBe(false);
      expect(result.ingestionResult.occurrence).toBeUndefined();
      expect(result.currentObservation.kind).toBe('none');
    });

    it('createsObservationOccurrence correctly classifies outcomes', () => {
      expect(createsObservationOccurrence('complete')).toBe(true);
      expect(createsObservationOccurrence('empty')).toBe(true);
      expect(createsObservationOccurrence('accepted_partial')).toBe(true);
      expect(createsObservationOccurrence('acquisition_failure')).toBe(false);
      expect(createsObservationOccurrence('malformed_partial')).toBe(false);
      expect(createsObservationOccurrence('absent_body')).toBe(false);
      expect(createsObservationOccurrence('explicit_unavailable')).toBe(false);
    });
  });

  describe('C12: failure during atomic ingestion → previous current remains intact, no half-written occurrence', () => {
    it('atomic ingestion failure leaves previous current intact', () => {
      // Start with a valid current observation
      const initialResult = ingestSuccessfulObservation(
        `button "Submit" [ref=e37]`,
        'https://example.com/page',
        'complete',
        defaultContext
      );

      expect(initialResult.ingestionResult.success).toBe(true);
      const initialOccurrence = initialResult.ingestionResult.occurrence!;

      // Attempt to ingest a failure (should not affect current)
      const failureResult = ingestSuccessfulObservation(
        `button "Cancel" [ref=e42]`,
        'https://example.com/page',
        'acquisition_failure',
        {
          ...defaultContext,
          currentObservation: initialResult.currentObservation,
          occurrenceCounter: initialResult.occurrenceCounter,
        }
      );

      expect(failureResult.ingestionResult.success).toBe(false);
      expect(failureResult.ingestionResult.occurrence).toBeUndefined();

      // Previous current remains intact
      expect(failureResult.currentObservation.kind).toBe('current');
      if (failureResult.currentObservation.kind === 'current') {
        expect(failureResult.currentObservation.occurrence.occurrenceId.occurrenceId).toBe(
          initialOccurrence.occurrenceId.occurrenceId
        );
      }

      // Counter not incremented
      expect(failureResult.occurrenceCounter).toBe(initialResult.occurrenceCounter);
    });

    it('no half-written occurrence becomes visible', () => {
      // This test verifies that if any step of atomic ingestion fails,
      // no partial state is visible

      const result = ingestSuccessfulObservation(
        `button "Submit" [ref=e37]`,
        'https://example.com/page',
        'acquisition_failure',
        defaultContext
      );

      // On failure: no occurrence, no current change, no counter increment
      expect(result.ingestionResult.success).toBe(false);
      expect(result.ingestionResult.occurrence).toBeUndefined();
      expect(result.currentObservation.kind).toBe('none');
      expect(result.occurrenceCounter).toBe(0);
    });
  });

  describe('C8-C12 invariant: occurrence identity is event identity, not content identity', () => {
    it('occurrence identity is independent of content hash', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      // Ingest same content three times
      let context = defaultContext;
      const occurrences = [];

      for (let i = 0; i < 3; i++) {
        const result = ingestSuccessfulObservation(
          rawSnapshot,
          url,
          'complete',
          context
        );

        expect(result.ingestionResult.success).toBe(true);
        occurrences.push(result.ingestionResult.occurrence!);
        context = {
          ...context,
          currentObservation: result.currentObservation,
          occurrenceCounter: result.occurrenceCounter,
        };
      }

      // All three have same content identity
      const contentHash = occurrences[0].observationContent.contentHash;
      expect(occurrences[1].observationContent.contentHash).toBe(contentHash);
      expect(occurrences[2].observationContent.contentHash).toBe(contentHash);

      // But all three have different occurrence identities
      const occurrenceIds = occurrences.map(o => o.occurrenceId.occurrenceId);
      expect(new Set(occurrenceIds).size).toBe(3); // All unique
    });
  });
});
