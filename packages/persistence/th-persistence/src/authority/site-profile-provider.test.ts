import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProviderData, InMemorySiteProfileRepository } from '../providers/in-memory.js';
import { JsonFileDatabase, JsonFileSiteProfileRepository } from '../providers/json-file.js';
import { createInMemoryAuthorityRuntime, createJsonAuthorityRuntime } from '../providers/authority.js';

const directories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function ensureInput(key = 'ensure-example') {
  return {
    canonicalOrigin: 'https://www.example.com:8443/path',
    name: 'Example',
    idempotency: { idempotencyKey: key },
  };
}

function completedSession(id: string, targetUrl: string, completedAt: string) {
  return {
    id,
    targetUrl,
    targetConfig: {},
    scanConfig: {},
    status: 'completed',
    createdAt: '2026-09-17T00:00:00.000Z',
    startedAt: '2026-09-17T00:00:01.000Z',
    completedAt,
    cancelRequestedAt: null,
    terminalAt: completedAt,
    statusReason: 'completed',
    postProcessingStatus: 'success',
    postProcessingError: null,
    createdBy: null,
    metadata: {},
  } as const;
}

describe('2-D SiteProfile provider prerequisite', () => {
  it('shares in-memory repository state and publishes profile plus replay atomically', async () => {
    const data = createInMemoryProviderData();
    const repository = new InMemorySiteProfileRepository(data);
    const runtime = createInMemoryAuthorityRuntime(data);

    const first = await runtime.services.sites.ensure(ensureInput());
    const replay = await runtime.services.sites.ensure(ensureInput());
    expect(first.replayed).toBe(false);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(first.result.record.canonicalOriginKey).toBe('https://www.example.com:8443');
    expect(await repository.findById(first.result.record.id)).toEqual(first.result.record);
    expect(Object.values(data.idempotency_records)).toHaveLength(1);
  });

  it('persists JSON profile/cache/metric replay through close and reload', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-d-json-'));
    directories.push(directory);
    const file = path.join(directory, 'database.json');
    const database = new JsonFileDatabase(file);
    const runtime = createJsonAuthorityRuntime(database);
    const created = await runtime.services.sites.ensure(ensureInput());
    const profileId = created.result.record.id;
    const cacheInput = {
      scope: { kind: 'profile', profileId },
      entries: [{ hint: 'login', selector: '#login' }],
      idempotency: { idempotencyKey: 'cache-example' },
    } as const;
    const cache = await runtime.services.sites.replaceLocatorCache(cacheInput);
    database.getData().sessions['session-1'] = completedSession(
      'session-1', 'https://www.example.com:8443/login', '2026-09-17T01:00:00.000Z',
    );
    database.save();
    const metric = await runtime.services.sites.incrementMetric({
      scope: { kind: 'session', profileId, sessionId: 'session-1' },
    });

    const reloadedDatabase = new JsonFileDatabase(file);
    const reloaded = createJsonAuthorityRuntime(reloadedDatabase);
    expect(await reloaded.services.sites.ensure(ensureInput())).toEqual({ ...created, replayed: true });
    await expect(reloaded.services.sites.ensure({ ...ensureInput(), name: 'Conflicting replay' }))
      .rejects.toThrow('replayed with a different request');
    expect(await reloaded.services.sites.replaceLocatorCache(cacheInput)).toEqual({ ...cache, replayed: true });
    expect(await reloaded.services.sites.incrementMetric({
      scope: { kind: 'session', profileId, sessionId: 'session-1' },
    })).toEqual({ ...metric, replayed: true });
    const profile = await reloaded.services.sites.findByOrigin('https://www.example.com:8443/other');
    expect(profile).toMatchObject({ id: profileId, testCount: 1,
      lastTestedAt: '2026-09-17T01:00:00.000Z' });
    expect(JSON.parse(profile!.elementCache)).toEqual([{ hint: 'login', selector: '#login' }]);
  });

  it('publishes neither SiteProfile nor idempotency state after JSON commit failure', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-d-fail-'));
    directories.push(directory);
    const file = path.join(directory, 'database.json');
    const database = new JsonFileDatabase(file);
    database.save();
    const beforeDisk = fs.readFileSync(file, 'utf8');
    const runtime = createJsonAuthorityRuntime(database);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('injected SiteProfile commit failure'); });

    await expect(runtime.services.sites.ensure(ensureInput())).rejects.toThrow('injected SiteProfile commit failure');
    expect(database.getData().sites).toEqual({});
    expect(database.getData().idempotency_records).toEqual({});
    expect(fs.readFileSync(file, 'utf8')).toBe(beforeDisk);
  });

  it('fails closed when a legacy repository changes the same profile during authority commit', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-d-conflict-'));
    directories.push(directory);
    const file = path.join(directory, 'database.json');
    const database = new JsonFileDatabase(file);
    const repository = new JsonFileSiteProfileRepository(database);
    const seeded = await repository.create({ id: 'site-1', name: 'Before', baseUrl: 'example.com',
      canonicalOriginKey: 'https://example.com' });
    const runtime = createJsonAuthorityRuntime(database);
    const original = database.commitAuthority.bind(database);
    vi.spyOn(database, 'commitAuthority').mockImplementationOnce((next, before) => {
      database.getData().sites[seeded.id]!.name = 'Legacy concurrent update';
      original(next, before);
    });

    await expect(runtime.services.sites.update({
      scope: { kind: 'profile', profileId: seeded.id },
      name: 'Authority update',
      idempotency: { idempotencyKey: 'rename-conflict' },
    })).rejects.toThrow('Concurrent provider mutation conflict');
    expect((await repository.findById(seeded.id))?.name).toBe('Legacy concurrent update');
    expect(database.getData().idempotency_records).toEqual({});
  });
});
