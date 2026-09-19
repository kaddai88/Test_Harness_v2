import { describe, expect, it } from 'vitest';
import { mapLegacyCognitionRows } from './legacy-mapping.js';

describe('P6 2-A1 Cognition legacy mapping', () => {
  it('classifies distinct existing rows as one-to-one', () => {
    const report = mapLegacyCognitionRows([
      {
        kind: 'knowledge', id: 'legacy-a', siteId: 'site-1',
        title: 'login', content: 'user-password',
      },
      {
        kind: 'procedure', id: 'legacy-b', siteId: 'site-1',
        name: 'submit form', steps: '["fill","submit"]',
      },
    ]);
    expect(report.analysis.classification).toBe('one-to-one');
    expect(report.analysis.blocked).toBe(false);
    expect(report.mappings.every((mapping) => mapping.canonicalIdentity !== null)).toBe(true);
  });

  it('surfaces N-to-1 logical collisions without selecting a winner', () => {
    const report = mapLegacyCognitionRows([
      {
        kind: 'knowledge', id: 'legacy-a', siteId: 'site-1',
        title: 'login', content: 'user-password',
      },
      {
        kind: 'knowledge', id: 'legacy-b', siteId: 'site-1',
        title: ' login ', content: 'user-password',
      },
    ]);
    expect(report.analysis.classification).toBe('many-to-one');
    expect(report.analysis.blocked).toBe(true);
    expect(report.analysis.collisionGroups[0]?.sourceIds).toEqual(['legacy-a', 'legacy-b']);
    expect(report.mappings[0]?.provenance?.legacyId?.value).toBe('legacy-a');
    expect(report.mappings[1]?.provenance?.legacyId?.value).toBe('legacy-b');
  });

  it('surfaces invalid scope/input as ambiguous instead of silently mapping it', () => {
    const report = mapLegacyCognitionRows([{
      kind: 'knowledge', id: 'legacy-invalid', siteId: ' ',
      title: 'login', content: 'user-password',
    }]);
    expect(report.analysis.classification).toBe('ambiguous');
    expect(report.analysis.unresolvedSourceIds).toEqual(['legacy-invalid']);
    expect(report.mappings[0]?.canonicalIdentity).toBeNull();
  });

  it('maps episode occurrence identity separately from source provenance', () => {
    const report = mapLegacyCognitionRows([{
      kind: 'episode', id: 'legacy-episode', siteId: 'site-1', sessionId: 'session-1',
    }]);
    const mapping = report.mappings[0];
    expect(report.analysis.classification).toBe('one-to-one');
    expect(mapping?.canonicalIdentity?.canonicalId).toContain('cognition:v1:episode:');
    expect(mapping?.provenance).toEqual({
      occurrence: {
        sourceOccurrenceId: 'legacy-episode',
        producerIdentity: 'legacy-cognition',
        sessionId: 'session-1',
      },
      legacyId: { kind: 'legacy-cognition-id', value: 'legacy-episode' },
    });
  });

  it('normalizes equivalent legacy procedure step JSON before mapping', () => {
    const report = mapLegacyCognitionRows([
      {
        kind: 'procedure', id: 'legacy-a', siteId: 'site-1',
        name: 'submit form', steps: '{"submit":true,"fields":["user"]}',
      },
      {
        kind: 'procedure', id: 'legacy-b', siteId: 'site-1',
        name: ' submit form ', steps: '{ "fields": ["user"], "submit": true }',
      },
    ]);
    expect(report.analysis.classification).toBe('many-to-one');
    expect(report.analysis.blocked).toBe(true);
  });

  it('maps equivalent patterns to one identity while keeping provenance distinct', () => {
    const first = mapLegacyCognitionRows([{
      kind: 'pattern', id: 'legacy-pattern-a', siteId: 'site-1',
      type: 'error_pattern', description: 'network failure', tags: '["network", "retry"]',
    }]).mappings[0];
    const second = mapLegacyCognitionRows([{
      kind: 'pattern', id: 'legacy-pattern-b', siteId: 'site-1',
      type: ' error_pattern ', description: ' network failure ', tags: '[ "network", "retry" ]',
    }]).mappings[0];

    expect(first?.canonicalIdentity?.canonicalId).toBe(second?.canonicalIdentity?.canonicalId);
    expect(first?.provenance).not.toEqual(second?.provenance);
  });

  it('keeps distinct pattern fields distinct even when legacy NUL encoding collided', () => {
    const report = mapLegacyCognitionRows([
      {
        kind: 'pattern', id: 'legacy-pattern-a', siteId: 'site-1',
        type: 'error\u0000pattern', description: 'network', tags: '[]',
      },
      {
        kind: 'pattern', id: 'legacy-pattern-b', siteId: 'site-1',
        type: 'error', description: 'pattern\u0000network', tags: '[]',
      },
    ]);

    expect(report.analysis.classification).toBe('one-to-one');
    expect(report.mappings[0]?.canonicalIdentity?.canonicalId)
      .not.toBe(report.mappings[1]?.canonicalIdentity?.canonicalId);
  });

  it('surfaces true pattern collisions and invalid pattern input', () => {
    const collision = mapLegacyCognitionRows([
      {
        kind: 'pattern', id: 'legacy-pattern-a', siteId: 'site-1',
        type: 'error_pattern', description: 'network failure', tags: '[]',
      },
      {
        kind: 'pattern', id: 'legacy-pattern-b', siteId: 'site-1',
        type: 'error_pattern', description: 'network failure', tags: '[]',
      },
    ]);
    expect(collision.analysis.classification).toBe('many-to-one');
    expect(collision.analysis.blocked).toBe(true);
    expect(collision.analysis.collisionGroups[0]?.sourceIds)
      .toEqual(['legacy-pattern-a', 'legacy-pattern-b']);

    const invalid = mapLegacyCognitionRows([{
      kind: 'pattern', id: 'legacy-pattern-invalid', siteId: 'site-1',
      type: 'error_pattern', description: 'network failure', tags: 'not-json',
    }]);
    expect(invalid.analysis.classification).toBe('ambiguous');
    expect(invalid.analysis.unresolvedSourceIds).toEqual(['legacy-pattern-invalid']);
    expect(invalid.mappings[0]?.canonicalIdentity).toBeNull();
  });
});
