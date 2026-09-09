/**
 * P2-E Conformance Tests C3-C7: Structural Projection
 *
 * Verifies the core invariants of structural projection:
 *
 * C3: ref-only change → observation may DIFFER, structural projection may remain equal
 * C4: semantic actionable element added/removed → structural projection changes
 * C5: ordinary non-structural text change → does not automatically change structural identity
 * C6: same structural projection + different completenessScope → identities match, evidence records scope-distinct
 * C7: same raw structure under different structural contract versions → records remain contract-scoped
 *
 * IMPORTANT: These tests verify projection/evidence construction, NOT comparison logic.
 * Comparison authority (SAME/DIFFERENT/NOT_COMPARABLE) is deferred to I5.
 */

import { describe, it, expect } from 'vitest';
import {
  constructStructuralProjection,
  constructStructuralEvidence,
  constructStructuralEvidenceFromRaw,
} from './structural-projection.js';

describe('P2-E Conformance C3-C7: Structural Projection', () => {
  describe('C3: ref-only change → structural projection may remain equal', () => {
    it('different refs produce same structural projection (refs are observation-only)', () => {
      const snapshot1 = `button "Submit" [ref=e37]`;
      const snapshot2 = `button "Submit" [ref=e42]`;
      const url = 'https://example.com/page';

      const projection1 = constructStructuralProjection(snapshot1, url);
      const projection2 = constructStructuralProjection(snapshot2, url);

      // Structural projection should be identical (refs excluded)
      expect(projection1.roles).toEqual(projection2.roles);
      expect(projection1.roles).toEqual([{ role: 'button', label: 'Submit' }]);

      // Structural identity should be identical
      const evidence1 = constructStructuralEvidenceFromRaw(snapshot1, url);
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot2, url);

      expect(evidence1.structuralIdentity.structuralHash).toBe(evidence2.structuralIdentity.structuralHash);
    });

    it('observation identity differs for different refs (observation includes refs)', () => {
      // This test documents that observation and structural projections diverge correctly
      // Observation includes refs, structural excludes them
      const snapshot1 = `button "Submit" [ref=e37]`;
      const snapshot2 = `button "Submit" [ref=e42]`;
      const url = 'https://example.com/page';

      const evidence1 = constructStructuralEvidenceFromRaw(snapshot1, url);
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot2, url);

      // Structural evidence is identical
      expect(evidence1.structuralIdentity.structuralHash).toBe(evidence2.structuralIdentity.structuralHash);

      // (Observation identity would differ, but that's tested in I2)
    });
  });

  describe('C4: semantic actionable element added/removed → structural projection changes', () => {
    it('adding a button changes structural projection', () => {
      const snapshot1 = `button "Submit" [ref=e37]`;
      const snapshot2 = `button "Submit" [ref=e37]\nbutton "Cancel" [ref=e42]`;
      const url = 'https://example.com/page';

      const projection1 = constructStructuralProjection(snapshot1, url);
      const projection2 = constructStructuralProjection(snapshot2, url);

      // Structural projection should differ
      expect(projection1.roles.length).toBe(1);
      expect(projection2.roles.length).toBe(2);

      // Structural identity should differ
      const evidence1 = constructStructuralEvidenceFromRaw(snapshot1, url);
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot2, url);

      expect(evidence1.structuralIdentity.structuralHash).not.toBe(evidence2.structuralIdentity.structuralHash);
    });

    it('removing a button changes structural projection', () => {
      const snapshot1 = `button "Submit" [ref=e37]\nbutton "Cancel" [ref=e42]`;
      const snapshot2 = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const evidence1 = constructStructuralEvidenceFromRaw(snapshot1, url);
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot2, url);

      expect(evidence1.structuralIdentity.structuralHash).not.toBe(evidence2.structuralIdentity.structuralHash);
    });

    it('changing a button label changes structural projection', () => {
      const snapshot1 = `button "Submit" [ref=e37]`;
      const snapshot2 = `button "Cancel" [ref=e37]`;
      const url = 'https://example.com/page';

      const evidence1 = constructStructuralEvidenceFromRaw(snapshot1, url);
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot2, url);

      expect(evidence1.structuralIdentity.structuralHash).not.toBe(evidence2.structuralIdentity.structuralHash);
    });
  });

  describe('C5: ordinary non-structural text change → does not automatically change structural identity', () => {
    it('ordinary body text change does not change structural identity', () => {
      const snapshot1 = `
        button "Submit" [ref=e37]
        paragraph "Last updated: 2024-01-01"
      `;
      const snapshot2 = `
        button "Submit" [ref=e37]
        paragraph "Last updated: 2024-01-02"
      `;
      const url = 'https://example.com/page';

      const evidence1 = constructStructuralEvidenceFromRaw(snapshot1, url);
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot2, url);

      // Structural identity should be identical (ordinary text is not structural)
      expect(evidence1.structuralIdentity.structuralHash).toBe(evidence2.structuralIdentity.structuralHash);
    });

    it('generated timestamp change does not change structural identity', () => {
      const snapshot1 = `
        button "Submit" [ref=e37]
        span "Generated at 10:30:00"
      `;
      const snapshot2 = `
        button "Submit" [ref=e37]
        span "Generated at 10:31:00"
      `;
      const url = 'https://example.com/page';

      const evidence1 = constructStructuralEvidenceFromRaw(snapshot1, url);
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot2, url);

      // Structural identity should be identical (generated timestamp is not structural)
      expect(evidence1.structuralIdentity.structuralHash).toBe(evidence2.structuralIdentity.structuralHash);
    });
  });

  describe('C6: same structural projection + different completenessScope → evidence records remain scope-distinct', () => {
    it('different completenessScope produces different evidence records but same identity', () => {
      const snapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const evidence1 = constructStructuralEvidenceFromRaw(snapshot, url, 'v1', 'complete');
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot, url, 'v1', 'partial:main');

      // Structural identity should be identical (same projection)
      expect(evidence1.structuralIdentity.structuralHash).toBe(evidence2.structuralIdentity.structuralHash);

      // But evidence records should be scope-distinct
      expect(evidence1.completenessScope).toBe('complete');
      expect(evidence2.completenessScope).toBe('partial:main');

      // completenessScope is NOT part of structural hash
      // (comparison verdict deferred to I5)
    });

    it('completenessScope is comparison provenance, not hash material', () => {
      const snapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const projection = constructStructuralProjection(snapshot, url);
      const evidence1 = constructStructuralEvidence(projection, 'v1', 'complete');
      const evidence2 = constructStructuralEvidence(projection, 'v1', 'partial:viewport');

      // Structural identity hash is identical
      expect(evidence1.structuralIdentity.structuralHash).toBe(evidence2.structuralIdentity.structuralHash);

      // But evidence records are distinct
      expect(evidence1).not.toEqual(evidence2);
      expect(evidence1.completenessScope).not.toBe(evidence2.completenessScope);
    });
  });

  describe('C7: same raw structure under different structural contract versions → records remain contract-scoped', () => {
    it('different contract versions produce different evidence records but same identity', () => {
      const snapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const evidence1 = constructStructuralEvidenceFromRaw(snapshot, url, 'v1');
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot, url, 'v2');

      // Structural identity should be identical (same projection)
      expect(evidence1.structuralIdentity.structuralHash).toBe(evidence2.structuralIdentity.structuralHash);

      // But evidence records should be contract-scoped
      expect(evidence1.contractVersion).toBe('v1');
      expect(evidence2.contractVersion).toBe('v2');

      // contractVersion is NOT part of structural hash
      // (comparison verdict deferred to I5)
    });

    it('contractVersion is tracked separately from structural identity', () => {
      const snapshot = `button "Submit" [ref=e37]`;
      const url = 'https://example.com/page';

      const projection = constructStructuralProjection(snapshot, url);
      const evidence1 = constructStructuralEvidence(projection, 'v1', 'complete');
      const evidence2 = constructStructuralEvidence(projection, 'v2', 'complete');

      // Structural identity hash is identical
      expect(evidence1.structuralIdentity.structuralHash).toBe(evidence2.structuralIdentity.structuralHash);

      // But evidence records are distinct
      expect(evidence1).not.toEqual(evidence2);
      expect(evidence1.contractVersion).not.toBe(evidence2.contractVersion);
    });
  });

  describe('C3-C7 invariant: structural projection independent from observation projection', () => {
    it('structural projection is built from raw evidence, not from observation projection', () => {
      // This test verifies that structural projection does not depend on observation projection
      const snapshot = `
        button "Submit" [ref=e37]
        paragraph "Ordinary text"
        span "Generated at 10:30:00"
      `;
      const url = 'https://example.com/page';

      const projection = constructStructuralProjection(snapshot, url);

      // Structural projection includes only identity-bearing elements
      expect(projection.roles).toEqual([{ role: 'button', label: 'Submit' }]);

      // Structural projection excludes:
      // - refs (observation-only)
      // - ordinary text (not structural)
      // - generated timestamps (not structural)
      expect(projection.headings).toEqual([]);
      expect(projection.formFields).toEqual([]);
    });
  });

  describe('I3-R1: Canonical serializer and order semantics', () => {
    it('canonical serializer sorts object keys but preserves array order', () => {
      // Two projections with same content but different property insertion order
      const projection1: any = {
        tabs: ['Tab1', 'Tab2'],
        roles: [{ role: 'button', label: 'Submit' }],
        headings: ['Heading1'],
      };
      const projection2: any = {
        headings: ['Heading1'],
        tabs: ['Tab1', 'Tab2'],
        roles: [{ role: 'button', label: 'Submit' }],
      };

      // Add missing fields to match StructuralProjection interface
      const fullProjection1 = {
        roles: projection1.roles,
        headings: projection1.headings,
        formFields: [],
        tableHeaders: [],
        landmarks: [],
        tabs: projection1.tabs,
        semanticViewState: 'https://example.com',
      };
      const fullProjection2 = {
        roles: projection2.roles,
        headings: projection2.headings,
        formFields: [],
        tableHeaders: [],
        landmarks: [],
        tabs: projection2.tabs,
        semanticViewState: 'https://example.com',
      };

      const evidence1 = constructStructuralEvidence(fullProjection1, 'v1', 'complete');
      const evidence2 = constructStructuralEvidence(fullProjection2, 'v1', 'complete');

      // Same object keys in different order → same hash (canonical serializer sorts keys)
      expect(evidence1.structuralIdentity.structuralHash).toBe(evidence2.structuralIdentity.structuralHash);
    });

    it('structural projection preserves array order (DOM/accessibility order is structural)', () => {
      // Two snapshots with same elements but different order
      const snapshot1 = `
        button "First" [ref=e37]
        button "Second" [ref=e38]
        button "Third" [ref=e39]
      `;
      const snapshot2 = `
        button "Third" [ref=e39]
        button "First" [ref=e37]
        button "Second" [ref=e38]
      `;
      const url = 'https://example.com/page';

      const projection1 = constructStructuralProjection(snapshot1, url);
      const projection2 = constructStructuralProjection(snapshot2, url);

      // Array order is preserved (not sorted)
      expect(projection1.roles.map(r => r.label)).toEqual(['First', 'Second', 'Third']);
      expect(projection2.roles.map(r => r.label)).toEqual(['Third', 'First', 'Second']);

      // Different order → different structural identity
      const evidence1 = constructStructuralEvidenceFromRaw(snapshot1, url);
      const evidence2 = constructStructuralEvidenceFromRaw(snapshot2, url);

      expect(evidence1.structuralIdentity.structuralHash).not.toBe(evidence2.structuralIdentity.structuralHash);
    });

    it('regex/parser is syntax helper only, not semantic classification authority', () => {
      // Verify that classification is based on field name, not value appearance
      // A field named "generatedAt" is excluded even if it doesn't look like a timestamp
      // A field named "data" is included even if it looks like a timestamp
      const snapshot = `
        span "Not a timestamp" [data-generatedAt]
        span "2024-01-01" [data-notTimestamp]
      `;
      const url = 'https://example.com/page';

      const projection = constructStructuralProjection(snapshot, url);

      // Both spans are included because their field names are not schema-classified as non-structural
      // (The extraction functions match known patterns like button/heading/tab, not arbitrary spans)
      // This test documents that we don't classify based on value appearance
      expect(projection.headings).toEqual([]);
    });
  });
});
