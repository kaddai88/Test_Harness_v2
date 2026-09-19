import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyJsonFileCanonicalBackfill,
  applyJsonFileCanonicalBackfillFile,
  CanonicalBackfillBlockedError,
  prepareCanonicalBackfill,
} from './canonical-backfill.js';
import {
  POSTGRES_A2_UNIQUENESS_SCHEMA,
  POSTGRES_SCHEMA,
  SQLITE_A2_UNIQUENESS_SCHEMA,
  SQLITE_SCHEMA,
} from './schema.js';
import { JsonFileDatabase, JsonFileCognitionRepository, JsonFileSiteProfileRepository } from './providers/json-file.js';
import { IdempotencyConflictError, JsonFileIdempotencyStore } from './idempotency.js';

function site(id: string, baseUrl = 'https://example.com') {
  return {
    id,
    name: id,
    baseUrl,
    elementCache: '[]',
    testCount: 0,
    lastTestedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function cognitionRows() {
  return {
    episodes: [{
      id: 'episode-1', siteId: 'site-1', sessionId: null, type: 'summary', outcome: 'success',
      description: 'episode', data: '{}', timestamp: 1,
    }],
    knowledge: [{
      id: 'knowledge-1', siteId: 'site-1', type: 'fact', title: 'login', content: 'password',
      confidence: 0.5, useCount: 0, lastUsed: null, tags: '[]', createdAt: '2026-01-01T00:00:00.000Z',
    }],
    procedures: [{
      id: 'procedure-1', siteId: 'site-1', name: 'login', steps: '["fill", "submit"]',
      successRate: 1, useCount: 0, lastUsed: null,
    }],
    patterns: [{
      id: 'pattern-1', siteId: 'site-1', type: 'success_pattern', description: 'login works',
      frequency: 1, confidence: 0.9, tags: '[]', lastSeen: null,
    }],
  };
}

describe('P6 2-A2 canonical backfill', () => {
  it('backfills all four Cognition kinds and SiteProfile origin without changing legacy fields', () => {
    const input = { sites: [site('site-1')], cognition: cognitionRows() };
    const { output, report } = prepareCanonicalBackfill(input);

    expect(report.sites.analysis.blocked).toBe(false);
    expect(output.sites[0]?.canonicalOriginKey).toBe('https://example.com');
    expect(output.cognition.episodes[0]?.canonicalId).toMatch(/^cognition:v1:episode:/);
    expect(output.cognition.knowledge[0]?.canonicalId).toMatch(/^cognition:v1:knowledge:/);
    expect(output.cognition.procedures[0]?.canonicalId).toMatch(/^cognition:v1:procedure:/);
    expect(output.cognition.patterns[0]?.canonicalId).toMatch(/^cognition:v1:pattern:/);
    expect(output.cognition.knowledge[0]?.title).toBe('login');
    expect(output.cognition.knowledge[0]?.provenance).toEqual([{
      sourceOccurrenceId: 'knowledge-1',
      producerIdentity: 'legacy-cognition',
      sessionId: null,
      legacyId: 'knowledge-1',
    }]);
  });

  it('blocks unresolved mappings before any output can be applied', () => {
    const input = {
      sites: [site('site-1', 'example.com')],
      cognition: cognitionRows(),
    };

    expect(() => prepareCanonicalBackfill(input)).toThrow(CanonicalBackfillBlockedError);
    expect(input.sites[0]?.canonicalOriginKey).toBeUndefined();
    expect(input.cognition.knowledge[0]?.canonicalId).toBeUndefined();
  });

  it('blocks a true collision and preserves the pre-backfill representation', () => {
    const rows = cognitionRows();
    rows.knowledge.push({
      ...rows.knowledge[0], id: 'knowledge-2',
    });
    const input = { sites: [site('site-1')], cognition: rows };

    expect(() => prepareCanonicalBackfill(input)).toThrow(CanonicalBackfillBlockedError);
    expect(input.cognition.knowledge.every((row) => row.canonicalId === undefined)).toBe(true);
  });

  it('blocks duplicate existing idempotency keys before canonical backfill', () => {
    const input = {
      sites: [site('site-1')],
      cognition: cognitionRows(),
      idempotencyRecords: [
        {
          recordId: 'record-1', domain: 'metrics', idempotencyKey: 'site-1/session-1',
          entityKind: null, canonicalEntityId: null, requestHash: 'hash', resultReference: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          recordId: 'record-2', domain: 'metrics', idempotencyKey: 'site-1/session-1',
          entityKind: null, canonicalEntityId: null, requestHash: 'hash', resultReference: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };

    expect(() => prepareCanonicalBackfill(input)).toThrow('not unique');
  });

  it('executes JSON backfill idempotently when an explicit bare-host resolution is supplied', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'p6-a2-backfill-'));
    const db = new JsonFileDatabase(join(directory, 'db.json'));
    try {
      db.getData().sites['site-1'] = site('site-1', 'example.com');
      const rows = cognitionRows();
      db.getData().cognition_episodes['episode-1'] = rows.episodes[0]!;
      db.getData().cognition_knowledge['knowledge-1'] = rows.knowledge[0]!;
      db.getData().cognition_procedures['procedure-1'] = rows.procedures[0]!;
      db.getData().cognition_patterns['pattern-1'] = rows.patterns[0]!;
      const first = await applyJsonFileCanonicalBackfill(db, {
        originResolutions: [{ legacyId: 'site-1', canonicalOrigin: 'https://example.com' }],
      });
      const firstProvenance = first.output.cognition.knowledge[0]?.provenance;
      expect(db.getData().sites['site-1']?.canonicalOriginKey).toBe('https://example.com');
      expect(db.getData().cognition_knowledge['knowledge-1']?.canonicalId).toMatch(/^cognition:v1:knowledge:/);
      expect(firstProvenance).toHaveLength(1);
      expect(first.backfilledRows).toBe(5);

      const second = await applyJsonFileCanonicalBackfill(db, {
        originResolutions: [{ legacyId: 'site-1', canonicalOrigin: 'https://example.com' }],
      });
      expect(second.backfilledRows).toBe(0);
      expect(second.output.cognition.knowledge[0]?.provenance).toEqual(firstProvenance);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('preserves unrelated legacy JSON sections during file backfill', () => {
    const directory = mkdtempSync(join(tmpdir(), 'p6-a2-file-backfill-'));
    const filePath = join(directory, 'db.json');
    const rows = cognitionRows();
    const legacySession = {
      id: 'session-1',
      targetUrl: 'https://example.com',
      metadata: { legacy: true },
    };
    const document = {
      sessions: { 'session-1': legacySession },
      reports: {},
      sites: { 'site-1': site('site-1', 'example.com') },
      cognition_episodes: { 'episode-1': rows.episodes[0] },
      cognition_knowledge: { 'knowledge-1': rows.knowledge[0] },
      cognition_procedures: { 'procedure-1': rows.procedures[0] },
      cognition_patterns: { 'pattern-1': rows.patterns[0] },
      legacy_extension: { keep: 'unchanged' },
    };
    try {
      writeFileSync(filePath, JSON.stringify(document, null, 2));
      const result = applyJsonFileCanonicalBackfillFile(filePath, {
        originResolutions: [{ legacyId: 'site-1', canonicalOrigin: 'https://www.example.com:8443' }],
      });
      const saved = JSON.parse(readFileSync(filePath, 'utf8'));

      expect(result.backfilledRows).toBe(5);
      expect(saved.sessions['session-1']).toEqual(legacySession);
      expect(saved.legacy_extension).toEqual({ keep: 'unchanged' });
      expect(saved.sites['site-1'].canonicalOriginKey).toBe('https://www.example.com:8443');
      expect(saved.cognition_knowledge['knowledge-1'].canonicalId).toMatch(/^cognition:v1:knowledge:/);
      expect(saved.cognition_knowledge['knowledge-1'].provenance).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('enforces canonical uniqueness on subsequent JSON provider writes', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'p6-a2-unique-'));
    const db = new JsonFileDatabase(join(directory, 'db.json'));
    try {
      const sites = new JsonFileSiteProfileRepository(db);
      await sites.create({ id: 'site-1', name: 'one', baseUrl: 'one.example', canonicalOriginKey: 'https://example.com' });
      await expect(sites.create({ id: 'site-2', name: 'two', baseUrl: 'two.example', canonicalOriginKey: 'https://example.com' }))
        .rejects.toThrow('not unique');

      const cognition = new JsonFileCognitionRepository(db);
      await cognition.createKnowledge({
        siteId: null, type: 'fact', title: 'one', content: 'one', confidence: 1, tags: '[]', canonicalId: 'cognition-key',
      });
      await expect(cognition.createKnowledge({
        siteId: null, type: 'fact', title: 'two', content: 'two', confidence: 1, tags: '[]', canonicalId: 'cognition-key',
      })).rejects.toThrow('not unique');
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('P6 2-A2 idempotency enforcement', () => {
  it('returns the original record for replay and blocks a different request hash', () => {
    const records: Record<string, never> = {};
    const db = { getData: () => ({ idempotency_records: records }), save: () => undefined };
    const store = new JsonFileIdempotencyStore(db);
    const first = store.upsert({ domain: 'site-metrics', idempotencyKey: 'site-1/session-1', requestHash: 'hash-a' });
    const replay = store.upsert({ domain: 'site-metrics', idempotencyKey: 'site-1/session-1', requestHash: 'hash-a' });

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.record.recordId).toBe(first.record.recordId);
    expect(() => store.upsert({
      domain: 'site-metrics', idempotencyKey: 'site-1/session-1', requestHash: 'hash-b',
    })).toThrow(IdempotencyConflictError);
  });
});

describe('P6 2-A2 uniqueness SQL boundary', () => {
  it.each([
    ['postgres', POSTGRES_SCHEMA, POSTGRES_A2_UNIQUENESS_SCHEMA],
    ['sqlite', SQLITE_SCHEMA, SQLITE_A2_UNIQUENESS_SCHEMA],
  ])('%s keeps enforcement after the backfill schema', (_name, baseSchema, a2Schema) => {
    expect(baseSchema).not.toMatch(/CREATE UNIQUE INDEX/i);
    expect(a2Schema).toMatch(/CREATE UNIQUE INDEX/i);
    expect(a2Schema).toContain('uq_site_profiles_canonical_origin');
    expect(a2Schema).toContain('uq_cog_episodes_canonical_id');
    expect(a2Schema).toContain('uq_idempotency_domain_key');
  });
});
