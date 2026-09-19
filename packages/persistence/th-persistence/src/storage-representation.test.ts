import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POSTGRES_SCHEMA, SQLITE_SCHEMA } from './schema.js';
import { JsonFileDatabase } from './providers/json-file.js';

const schemas = [
  ['postgres', POSTGRES_SCHEMA],
  ['sqlite', SQLITE_SCHEMA],
] as const;

describe('P6 2-A0 storage representation readiness', () => {
  it.each(schemas)('%s represents canonical identity separately from provenance', (_name, schema) => {
    for (const table of [
      'cognition_episodes',
      'cognition_knowledge',
      'cognition_procedures',
      'cognition_patterns',
    ]) {
      const tableStart = schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
      const tableEnd = schema.indexOf('\n);', tableStart);
      const tableDefinition = schema.slice(tableStart, tableEnd);
      expect(tableDefinition).toContain('canonical_id');
      expect(tableDefinition).toContain('provenance');
    }
  });

  it.each(schemas)('%s represents origin, owner metadata, and idempotency', (_name, schema) => {
    expect(schema).toContain('canonical_origin_key');
    expect(schema).toContain('metadata_by_owner');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS idempotency_records');
    expect(schema).toContain('idempotency_key');
    expect(schema).toContain('idx_idempotency_lookup');
  });

  it.each(schemas)('%s does not backfill or enforce new canonical uniqueness', (_name, schema) => {
    expect(schema).not.toMatch(/ALTER\s+TABLE/i);
    expect(schema).not.toMatch(/UPDATE\s+/i);
    expect(schema).not.toMatch(/CREATE\s+UNIQUE\s+INDEX/i);
    expect(schema).toContain('key uniqueness is deferred to 2-A2');
  });

  it('reads legacy JSON rows without requiring readiness fields', () => {
    const directory = mkdtempSync(join(tmpdir(), 'p6-a0-legacy-'));
    const filePath = join(directory, 'db.json');
    writeFileSync(filePath, JSON.stringify({
      sites: {
        legacySite: {
          id: 'site-1',
          name: 'Example',
          baseUrl: 'example.com',
          elementCache: '[]',
          testCount: 1,
          lastTestedAt: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      cognition_episodes: {
        legacyEpisode: {
          id: 'legacyEpisode',
          siteId: 'site-1',
          sessionId: null,
          type: 'session_summary',
          outcome: 'success',
          description: 'legacy',
          data: '{}',
          timestamp: 1,
        },
      },
    }));

    const db = new JsonFileDatabase(filePath);
    try {
      expect(db.getData().sites.legacySite.baseUrl).toBe('example.com');
      expect(db.getData().cognition_episodes.legacyEpisode.id).toBe('legacyEpisode');
      expect(db.getData().sites.legacySite.canonicalOriginKey).toBeUndefined();
      expect(db.getData().cognition_episodes.legacyEpisode.canonicalId).toBeUndefined();
      expect(JSON.parse(readFileSync(filePath, 'utf8')).sites.legacySite.baseUrl).toBe('example.com');
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
