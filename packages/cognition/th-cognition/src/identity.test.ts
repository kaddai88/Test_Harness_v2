import { describe, expect, it } from 'vitest';
import {
  createCognitionEntityIdentity,
  createCognitionPatternIdentity,
  readLegacyCognitionId,
  validateCognitionProvenance,
  validateCognitionScope,
} from './identity.js';

describe('Cognition canonical identity', () => {
  it('is deterministic and excludes producer/session provenance', () => {
    const input = {
      kind: 'knowledge' as const,
      scope: { kind: 'site' as const, siteId: 'site-1' },
      subject: 'login form',
      contentKey: 'fields:user,password',
    };
    const provenanceA = validateCognitionProvenance({
      occurrence: {
        sourceOccurrenceId: 'O1',
        producerIdentity: 'agent-a',
        sessionId: 'session-1',
      },
    });
    const provenanceB = validateCognitionProvenance({
      occurrence: {
        sourceOccurrenceId: 'O2',
        producerIdentity: 'agent-b',
        sessionId: 'session-2',
      },
    });

    expect(provenanceA).not.toEqual(provenanceB);
    expect(createCognitionEntityIdentity(input))
      .toEqual(createCognitionEntityIdentity({ ...input }));
    expect(createCognitionEntityIdentity(input).canonicalId)
      .toBe(createCognitionEntityIdentity({ ...input, scope: { kind: 'site', siteId: 'site-1' } }).canonicalId);
  });

  it('uses occurrence identity for episodes and separates entity kinds', () => {
    const base = { scope: { kind: 'site' as const, siteId: 'site-1' } };
    const episode1 = createCognitionEntityIdentity({ ...base, kind: 'episode', occurrenceId: 'O1' });
    const episode2 = createCognitionEntityIdentity({ ...base, kind: 'episode', occurrenceId: 'O2' });
    const pattern = createCognitionEntityIdentity({ ...base, kind: 'pattern', patternKey: 'same-key' });

    expect(episode1.canonicalId).not.toBe(episode2.canonicalId);
    expect(episode1.canonicalId).not.toBe(pattern.canonicalId);
  });

  it('derives procedure identity from normalized subject and step key', () => {
    const scope = { kind: 'site' as const, siteId: 'site-1' };
    const first = createCognitionEntityIdentity({
      kind: 'procedure', scope, subject: 'login', stepKey: 'fill-user-submit',
    });
    const same = createCognitionEntityIdentity({
      kind: 'procedure', scope, subject: ' login ', stepKey: 'fill-user-submit',
    });
    const differentStep = createCognitionEntityIdentity({
      kind: 'procedure', scope, subject: 'login', stepKey: 'fill-password-submit',
    });

    expect(first.canonicalId).toBe(same.canonicalId);
    expect(first.canonicalId).not.toBe(differentStep.canonicalId);
  });

  it('encodes pattern fields as an unambiguous normalized tuple', () => {
    const scope = { kind: 'site' as const, siteId: 'site-1' };
    const first = createCognitionPatternIdentity({
      scope, type: 'error\u0000pattern', description: 'network', tagsKey: '[]',
    });
    const second = createCognitionPatternIdentity({
      scope, type: 'error', description: 'pattern\u0000network', tagsKey: '[]',
    });

    expect(first.canonicalId).not.toBe(second.canonicalId);
  });

  it('rejects missing or implicit scope', () => {
    expect(() => validateCognitionScope({ kind: 'site', siteId: ' ' })).toThrow(TypeError);
    expect(() => validateCognitionScope({ kind: 'current-session' })).toThrow(TypeError);
    expect(() => createCognitionEntityIdentity({
      kind: 'pattern',
      scope: { kind: 'global' },
      patternKey: '',
    })).toThrow(TypeError);
  });
});

describe('Cognition provenance and legacy IDs', () => {
  it('keeps legacy IDs readable without making them canonical identities', () => {
    expect(readLegacyCognitionId('legacy-episode-1')).toEqual({
      kind: 'legacy-cognition-id',
      value: 'legacy-episode-1',
    });
    expect(readLegacyCognitionId('')).toBeNull();
  });

  it('validates source occurrence separately from entity identity', () => {
    expect(validateCognitionProvenance({
      occurrence: {
        sourceOccurrenceId: 'O1',
        producerIdentity: 'agent',
        sessionId: 'session-1',
      },
      legacyId: 'legacy-episode-1',
    })).toEqual({
      occurrence: {
        sourceOccurrenceId: 'O1',
        producerIdentity: 'agent',
        sessionId: 'session-1',
      },
      legacyId: { kind: 'legacy-cognition-id', value: 'legacy-episode-1' },
    });
  });
});
