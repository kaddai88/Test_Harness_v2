import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProviderData, InMemoryCognitionRepository, InMemorySiteProfileRepository } from '../providers/in-memory.js';
import { JsonFileCognitionRepository, JsonFileDatabase, JsonFileSiteProfileRepository } from '../providers/json-file.js';
import { createInMemoryAuthorityRuntime, createJsonAuthorityRuntime } from '../providers/authority.js';
import type { CognitionAuthorityCreateInput } from './cognition.js';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function knowledge(): CognitionAuthorityCreateInput & { kind: 'knowledge' } {
  return {
    kind: 'knowledge',
    scope: { kind: 'site', siteId: 'site-1' },
    row: {
      id: 'knowledge-1', siteId: 'site-1', type: 'fact', title: 'Login', content: 'Password required',
      confidence: 0.8, useCount: 0, lastUsed: null, tags: '[]', createdAt: '2026-09-17T00:00:00.000Z',
    },
    provenance: { occurrence: { producerIdentity: 'provider-test', sessionId: null, sourceOccurrenceId: 'source-1' } },
    idempotency: { idempotencyKey: 'create-knowledge-1' },
  };
}

async function seedSite(repository: InMemorySiteProfileRepository | JsonFileSiteProfileRepository) {
  return repository.create({
    id: 'site-1', name: 'Example', baseUrl: 'example.com', canonicalOriginKey: 'https://example.com',
  });
}

describe('2-C provider prerequisite', () => {
  it('shares one in-memory datastore between repositories and authority services', async () => {
    const data = createInMemoryProviderData();
    const sites = new InMemorySiteProfileRepository(data);
    const cognition = new InMemoryCognitionRepository(data);
    const runtime = createInMemoryAuthorityRuntime(data);
    await seedSite(sites);

    const created = await runtime.services.cognition.create(knowledge());
    expect(created.replayed).toBe(false);
    expect(await cognition.getKnowledge(created.result.record.id)).toEqual(created.result.record);
    expect(Object.values(data.idempotency_records)).toHaveLength(1);
    expect((await runtime.services.cognition.create(knowledge())).replayed).toBe(true);
  });

  it('preserves a concurrent legacy update to another record', async () => {
    const data = createInMemoryProviderData();
    const sites = new InMemorySiteProfileRepository(data);
    const runtime = createInMemoryAuthorityRuntime(data);
    await seedSite(sites);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });

    const transaction = runtime.storage.transaction(async draft => {
      entered();
      await wait;
      draft.idempotency_records.record = {
        recordId: 'record', domain: 'test', idempotencyKey: 'key', entityKind: null,
        canonicalEntityId: null, requestHash: null, resultReference: '{}', createdAt: 'now',
      };
    });
    await started;
    await sites.update('site-1', { name: 'Legacy update' });
    release();
    await transaction;

    expect((await sites.findById('site-1'))?.name).toBe('Legacy update');
    expect(data.idempotency_records.record).toBeDefined();
  });

  it('fails closed when authority and legacy code concurrently change the same record', async () => {
    const data = createInMemoryProviderData();
    const sites = new InMemorySiteProfileRepository(data);
    const runtime = createInMemoryAuthorityRuntime(data);
    await seedSite(sites);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const wait = new Promise<void>(resolve => { release = resolve; });
    const transaction = runtime.storage.transaction(async draft => {
      entered();
      await wait;
      draft.sites['site-1']!.name = 'Authority update';
    });
    await started;
    await sites.update('site-1', { name: 'Legacy update' });
    release();
    await expect(transaction).rejects.toThrow('Concurrent provider mutation conflict');
    expect((await sites.findById('site-1'))?.name).toBe('Legacy update');
  });

  it('persists JSON entity and idempotency state and replays after reload', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-c-json-'));
    directories.push(directory);
    const file = path.join(directory, 'database.json');
    const firstDb = new JsonFileDatabase(file);
    const firstSites = new JsonFileSiteProfileRepository(firstDb);
    await seedSite(firstSites);
    const first = createJsonAuthorityRuntime(firstDb);
    expect((await first.services.cognition.create(knowledge())).replayed).toBe(false);

    const reloadedDb = new JsonFileDatabase(file);
    const reloaded = createJsonAuthorityRuntime(reloadedDb);
    expect((await reloaded.services.cognition.create(knowledge())).replayed).toBe(true);
    expect(await new JsonFileCognitionRepository(reloadedDb).getKnowledge('knowledge-1')).not.toBeNull();
  });

  it('records and retrieves an authority-backed session without writes on the read path', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-c-session-'));
    directories.push(directory);
    const file = path.join(directory, 'database.json');
    const db = new JsonFileDatabase(file);
    await seedSite(new JsonFileSiteProfileRepository(db));
    const runtime = createJsonAuthorityRuntime(db);
    const record = { siteId: 'site-1', sessionId: 'session-1', targetUrl: 'https://example.com', timestamp: 1,
      outcome: 'success' as const, findings: [], actions: [{ tool: 'click', input: {}, success: true }] };
    await runtime.services.cognition.recordSession(record);
    await runtime.services.cognition.recordSession(record);
    expect((await runtime.services.cognition.listBySite('site-1')).episodes).toHaveLength(1);
    const beforeRead = fs.readFileSync(file, 'utf8');
    const experience = await runtime.services.cognition.retrieveForSession({
      siteId: 'site-1', sessionId: 'next-session', targetUrl: 'https://example.com',
    });
    expect(experience.relevantEpisodes).toHaveLength(1);
    expect(fs.readFileSync(file, 'utf8')).toBe(beforeRead);
  });

  it('publishes neither entity nor replay record when JSON commit fails', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-c-json-fail-'));
    directories.push(directory);
    const file = path.join(directory, 'database.json');
    const db = new JsonFileDatabase(file);
    await seedSite(new JsonFileSiteProfileRepository(db));
    const beforeDisk = fs.readFileSync(file, 'utf8');
    const runtime = createJsonAuthorityRuntime(db);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('injected commit failure'); });

    await expect(runtime.services.cognition.create(knowledge())).rejects.toThrow('injected commit failure');
    expect(db.getData().cognition_knowledge).toEqual({});
    expect(db.getData().idempotency_records).toEqual({});
    expect(fs.readFileSync(file, 'utf8')).toBe(beforeDisk);
  });
});
