import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryProviderData, InMemorySessionRepository } from '../providers/in-memory.js';
import { JsonFileDatabase, JsonFileSessionRepository } from '../providers/json-file.js';
import { createInMemoryAuthorityRuntime, createJsonAuthorityRuntime } from '../providers/authority.js';
import { projectSessionMetadata } from '../session-metadata.js';

const directories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

const sessionInput = {
  id: 'session-1',
  targetUrl: 'https://example.com',
  targetConfig: {},
  scanConfig: { instructions: 'legacy instructions' },
  metadata: { legacyExtension: { retain: true }, persistedSessionState: { legacy: true } },
  requestMetadata: { instructions: 'owned instructions', uploadedImages: ['image'] },
};

describe('2-E metadata provider prerequisite', () => {
  it('serializes same-owner writes and preserves unrelated owners in memory', async () => {
    const data = createInMemoryProviderData();
    const sessions = new InMemorySessionRepository(data);
    await sessions.create(sessionInput);
    const metadata = createInMemoryAuthorityRuntime(data).services.metadata;

    await Promise.all([
      metadata.workerResult.replace({ sessionId: 'session-1', fields: {
        summary: 'first', findings: [1], activities: [1], turns: 1, score: 10,
      } }),
      metadata.p2e.replace({ sessionId: 'session-1', fields: {
        persistedSessionState: { sessionId: 'session-1', occurrenceCounter: 2 },
      } }),
      metadata.workerResult.replace({ sessionId: 'session-1', fields: {
        summary: 'last', findings: [2], activities: [2], turns: 2, score: 90,
      } }),
    ]);

    expect(await metadata.workerResult.read('session-1')).toEqual({
      summary: 'last', findings: [2], activities: [2], turns: 2, score: 90,
    });
    expect(await metadata.p2e.read('session-1')).toEqual({
      persistedSessionState: { sessionId: 'session-1', occurrenceCounter: 2 },
    });
    expect(await metadata.request.read('session-1')).toEqual(sessionInput.requestMetadata);
    expect(data.sessions['session-1']!.metadata).toEqual(sessionInput.metadata);
    await expect(metadata.workerResult.replace({
      sessionId: 'session-1', fields: { persistedSessionState: {} },
    } as never)).rejects.toThrow('Cross-owner');
  });

  it('persists owner state through JSON reload and keeps reads mutation-free', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-e-metadata-'));
    directories.push(directory);
    const file = path.join(directory, 'database.json');
    const database = new JsonFileDatabase(file);
    await new JsonFileSessionRepository(database).create(sessionInput);
    const runtime = createJsonAuthorityRuntime(database);
    await runtime.services.metadata.workerResult.replace({ sessionId: 'session-1', fields: {
      summary: 'complete', executionSummary: { overview: 'done' }, findings: [], activities: [], turns: 4, score: 100,
    } });
    await runtime.services.metadata.p2e.replace({ sessionId: 'session-1', fields: {
      persistedSessionState: { sessionId: 'session-1', occurrenceCounter: 3 },
    } });

    const reloadedDatabase = new JsonFileDatabase(file);
    const reloaded = createJsonAuthorityRuntime(reloadedDatabase);
    const beforeReads = fs.readFileSync(file, 'utf8');
    expect(await reloaded.services.metadata.workerResult.read('session-1')).toMatchObject({ score: 100, turns: 4 });
    expect(await reloaded.services.metadata.p2e.read('session-1')).toEqual({
      persistedSessionState: { sessionId: 'session-1', occurrenceCounter: 3 },
    });
    const projected = projectSessionMetadata(reloadedDatabase.getData().sessions['session-1']!);
    expect(projected).toMatchObject({
      legacyExtension: { retain: true }, summary: 'complete', score: 100,
      persistedSessionState: { sessionId: 'session-1', occurrenceCounter: 3 },
    });
    expect(fs.readFileSync(file, 'utf8')).toBe(beforeReads);

    await reloaded.services.metadata.p2e.clear('session-1');
    const afterClear = new JsonFileDatabase(file);
    expect(await createJsonAuthorityRuntime(afterClear).services.metadata.p2e.read('session-1'))
      .toEqual({ persistedSessionState: null });
    expect(projectSessionMetadata(afterClear.getData().sessions['session-1']!))
      .not.toHaveProperty('persistedSessionState');
  });

  it('publishes no owner mutation when a JSON commit fails', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-e-metadata-fail-'));
    directories.push(directory);
    const file = path.join(directory, 'database.json');
    const database = new JsonFileDatabase(file);
    await new JsonFileSessionRepository(database).create(sessionInput);
    const beforeDisk = fs.readFileSync(file, 'utf8');
    const beforeMemory = structuredClone(database.getData().sessions['session-1']);
    const runtime = createJsonAuthorityRuntime(database);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('injected metadata commit failure'); });

    await expect(runtime.services.metadata.workerResult.replace({
      sessionId: 'session-1', fields: { summary: 'must not publish' },
    })).rejects.toThrow('injected metadata commit failure');
    expect(database.getData().sessions['session-1']).toEqual(beforeMemory);
    expect(fs.readFileSync(file, 'utf8')).toBe(beforeDisk);
  });
});
