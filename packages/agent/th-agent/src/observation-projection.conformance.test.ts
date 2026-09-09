/**
 * P2-E Conformance Test C2: Observation Content Projection
 *
 * Verifies the core invariants of observation content identity:
 *
 * 1. Same semantic/model-visible observation → SAME
 * 2. Model-visible difference → DIFFERENT
 * 3. Same hash material under different contract → NOT_COMPARABLE
 * 4. Anti-regression: difference visible to model cannot be silently removed only for hashing
 *
 * This test ensures that ObservationContentIdentity reflects what the model actually sees,
 * not some hidden normalization.
 */

import { describe, it, expect } from 'vitest';
import {
  constructObservationEnvelope,
  constructObservationContentIdentity,
  compareObservationContentIdentities,
  constructObservationContentIdentityFromRaw,
} from './observation-projection.js';

describe('P2-E Conformance C2: Observation Content Projection', () => {
  describe('C2.1: Same semantic/model-visible observation → SAME', () => {
    it('identical snapshot and URL produce SAME identity', () => {
      const rawSnapshot = `
        button "Submit" [ref=e37]
        textbox "Username" [ref=e38]
        textbox "Password" [ref=e39]
      `;
      const url = 'https://example.com/login';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot, url);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot, url);

      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('SAME');
    });

    it('snapshot with refs preserved produces SAME identity when refs unchanged', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot, url);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot, url);

      expect(identity1.contentHash).toBe(identity2.contentHash);
      expect(identity1.contractVersion).toBe(identity2.contractVersion);
    });

    it('URL with tracking parameters removed produces SAME identity', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url1 = 'https://example.com/page?utm_source=google&utm_medium=cpc';
      const url2 = 'https://example.com/page';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot, url1);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot, url2);

      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('SAME');
    });
  });

  describe('C2.2: Model-visible difference → DIFFERENT', () => {
    it('different snapshot content produces DIFFERENT identity', () => {
      const rawSnapshot1 = `button "Submit" [ref=e37]`;
      const rawSnapshot2 = `button "Cancel" [ref=e42]`;
      const url = 'https://example.com/page';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot1, url);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot2, url);

      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('DIFFERENT');
    });

    it('different ref produces DIFFERENT identity', () => {
      const rawSnapshot1 = `button "Submit" [ref=e37]`;
      const rawSnapshot2 = `button "Submit" [ref=e42]`;
      const url = 'https://example.com/page';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot1, url);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot2, url);

      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('DIFFERENT');
    });

    it('different URL path produces DIFFERENT identity', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url1 = 'https://example.com/page1';
      const url2 = 'https://example.com/page2';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot, url1);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot, url2);

      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('DIFFERENT');
    });

    it('different semantic query parameter produces DIFFERENT identity', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url1 = 'https://example.com/page?tab=overview';
      const url2 = 'https://example.com/page?tab=details';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot, url1);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot, url2);

      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('DIFFERENT');
    });
  });

  describe('C2.3: Same hash material under different contract → NOT_COMPARABLE', () => {
    it('same observation with different contract versions produces NOT_COMPARABLE', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot, url, 'complete', 'v1');
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot, url, 'complete', 'v2');

      // Verify that the hash material is identical (same input)
      const envelope1 = constructObservationEnvelope(rawSnapshot, url, 'complete');
      const envelope2 = constructObservationEnvelope(rawSnapshot, url, 'complete');
      expect(envelope1.snapshotBody).toBe(envelope2.snapshotBody);
      expect(envelope1.effectiveLocation).toBe(envelope2.effectiveLocation);

      // But comparison is NOT_COMPARABLE due to different contract versions
      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('NOT_COMPARABLE');
      expect(comparison.reason).toBe('contract');
    });

    it('contract version is part of identity semantics, not just metadata', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const identity_v1 = constructObservationContentIdentityFromRaw(rawSnapshot, url, 'complete', 'v1');
      const identity_v2 = constructObservationContentIdentityFromRaw(rawSnapshot, url, 'complete', 'v2');

      // Even though the content is identical, different contracts cannot be compared
      expect(identity_v1.contractVersion).toBe('v1');
      expect(identity_v2.contractVersion).toBe('v2');

      const comparison = compareObservationContentIdentities(identity_v1, identity_v2);
      expect(comparison.result).not.toBe('SAME');
      expect(comparison.result).toBe('NOT_COMPARABLE');
    });
  });

  describe('C2.4: Anti-regression - model-visible difference cannot be silently removed', () => {
    it('ref difference visible to model produces DIFFERENT identity (not silently removed)', () => {
      // This is the critical anti-regression test
      // The old normalizeSnapshot approach might remove refs, making them invisible to identity
      // But refs ARE visible to the model, so they MUST affect identity

      const rawSnapshot1 = `button "Submit" [ref=e37]`;
      const rawSnapshot2 = `button "Submit" [ref=e42]`;
      const url = 'https://example.com/page';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot1, url);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot2, url);

      // Refs are visible to the model, so different refs MUST produce DIFFERENT identity
      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('DIFFERENT');

      // Verify that the snapshot body (which includes refs) is different
      const envelope1 = constructObservationEnvelope(rawSnapshot1, url, 'complete');
      const envelope2 = constructObservationEnvelope(rawSnapshot2, url, 'complete');
      expect(envelope1.snapshotBody).not.toBe(envelope2.snapshotBody);
    });

    it('snapshot text difference visible to model produces DIFFERENT identity', () => {
      const rawSnapshot1 = `button "Submit" [ref=e37]`;
      const rawSnapshot2 = `button "Cancel" [ref=e37]`;
      const url = 'https://example.com/page';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot1, url);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot2, url);

      // Text difference is visible to the model, so MUST produce DIFFERENT identity
      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('DIFFERENT');
    });

    it('empty vs non-empty snapshot produces DIFFERENT identity', () => {
      const rawSnapshot1 = ``;
      const rawSnapshot2 = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot1, url, 'empty');
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot2, url, 'complete');

      // Empty vs non-empty is visible to the model, so MUST produce DIFFERENT identity
      const comparison = compareObservationContentIdentities(identity1, identity2);
      expect(comparison.result).toBe('DIFFERENT');
    });
  });

  describe('C2.5: Observation envelope construction', () => {
    it('envelope includes all model-visible fields', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const envelope = constructObservationEnvelope(rawSnapshot, url, 'complete');

      expect(envelope.outcome).toBe('complete');
      expect(envelope.snapshotBody).toBe(rawSnapshot);
      expect(envelope.effectiveLocation).toBeTruthy();
      expect(envelope.browsingContext).toBeTruthy();
      expect(envelope.refNamespace).toBeTruthy();
    });

    it('URL query parameter order affects hash (order preserved per conservative policy)', () => {
      // This test documents that URL query parameter order is preserved in the current implementation.
      // Per P2-E conservative policy, unknown fields are included to prevent false equality.
      // Since the approved URL policy does not explicitly classify query parameter order as non-semantic,
      // the current implementation preserves insertion order.
      //
      // If future policy revision classifies query order as non-semantic, this test should be updated
      // and canonicalizeUrl() should sort query parameters.
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url1 = 'https://example.com/page?a=1&b=2&c=3';
      const url2 = 'https://example.com/page?c=3&a=1&b=2';

      const identity1 = constructObservationContentIdentityFromRaw(rawSnapshot, url1);
      const identity2 = constructObservationContentIdentityFromRaw(rawSnapshot, url2);

      const comparison = compareObservationContentIdentities(identity1, identity2);

      // Current behavior: DIFFERENT because URL.toString() preserves insertion order
      // This is consistent with conservative policy (preserve order unless explicitly non-semantic)
      expect(comparison.result).toBe('DIFFERENT');
    });

    it('tracking parameters are removed from effective location', () => {
      const rawSnapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page?utm_source=google&utm_medium=cpc&tab=overview';

      const envelope = constructObservationEnvelope(rawSnapshot, url, 'complete');

      // Tracking parameters should be removed
      expect(envelope.effectiveLocation).not.toContain('utm_source');
      expect(envelope.effectiveLocation).not.toContain('utm_medium');

      // Semantic parameters should be preserved
      expect(envelope.effectiveLocation).toContain('tab=overview');
    });
  });
});
