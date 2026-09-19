import { describe, expect, it, vi } from 'vitest';
import { mapLegacyCognitionRows, type LegacyCognitionInput } from '@test-harness/th-cognition';
import { createAuthorityServices } from './composition.js';
import { emptyAuthorityData, InMemoryAuthorityStorage, SnapshotAuthorityStorage } from './storage.js';
import { IdempotencyConflictError } from '../idempotency.js';
import type { SessionRow, SiteProfileRow } from '../schema.js';
import type { CognitionAuthorityCreateInput, CognitionAuthorityTarget } from './cognition.js';
import { DefaultMetadataFieldOwnerService } from './metadata.js';

const now = '2026-09-17T00:00:00.000Z';
const site: SiteProfileRow = { id: 'site-1', name: 'Example', baseUrl: 'example.com',
  canonicalOriginKey: 'https://example.com', testCount: 0, lastTestedAt: null, updatedAt: now, elementCache: '[]' };
const session: SessionRow = {
  id: 'session-1', targetUrl: 'https://example.com/path', targetConfig: {}, scanConfig: {},
  status: 'completed', createdAt: now, completedAt: now, startedAt: now, createdBy: null,
  cancelRequestedAt: null, terminalAt: now, statusReason: null, postProcessingStatus: 'not_started',
  postProcessingError: null, metadata: { legacyExtension: { retain: true } },
};
function seed() {
  return { ...emptyAuthorityData(), sites: { [site.id]: structuredClone(site) },
    sessions: { [session.id]: structuredClone(session) } };
}
function setup(storage = new InMemoryAuthorityStorage(seed())) {
  const policy = { authorize: vi.fn(async () => true), verifyScope: vi.fn(async () => true), audit: vi.fn(async () => {}) };
  return { services: createAuthorityServices(storage, policy), storage, policy };
}
function knowledge(): CognitionAuthorityCreateInput & { kind: 'knowledge' } {
  return { kind: 'knowledge', scope: { kind: 'site', siteId: site.id },
    row: { id: 'knowledge-1', siteId: site.id, type: 'fact', title: 'Login', content: 'Password required',
      confidence: 0.8, useCount: 0, lastUsed: null, tags: '[]', createdAt: now },
    provenance: { occurrence: { producerIdentity: 'worker', sessionId: session.id, sourceOccurrenceId: 'source-1' },
      legacyId: { kind: 'legacy-cognition-id', value: 'original-id' } },
    idempotency: { idempotencyKey: 'create-1' } };
}
function allKinds(): CognitionAuthorityCreateInput[] {
  const common = knowledge();
  return [
    common,
    { ...common, kind: 'episode', row: { id: 'episode-1', siteId: site.id, sessionId: session.id,
      type: 'summary', outcome: 'success', description: 'Logged in', data: '{}', timestamp: 1 } },
    { ...common, kind: 'procedure', row: { id: 'procedure-1', siteId: site.id,
      name: 'Login', steps: '["fill", "submit"]', successRate: 1, useCount: 0, lastUsed: null } },
    { ...common, kind: 'pattern', row: { id: 'pattern-1', siteId: site.id,
      type: 'success', description: 'Login works', tags: '["auth"]', frequency: 1, confidence: 0.9, lastSeen: null } },
  ];
}

describe('2-B Cognition boundary', () => {
  it.each(allKinds())('uses the closed identity contract for $kind and replays without writes', async input => {
    const { services, storage } = setup();
    const first = await services.cognition.create(input);
    const expected = mapLegacyCognitionRows([{ ...input.row, kind: input.kind } as LegacyCognitionInput]).mappings[0]?.canonicalKey;
    expect(first.result.record.canonicalId).toBe(expected);
    expect(first.result.record.provenance?.[0]?.legacyId).toBe('original-id');
    const before = await storage.read(data => data);
    expect((await services.cognition.create(input)).replayed).toBe(true);
    expect(await storage.read(data => data)).toEqual(before);
  });

  it('serializes simultaneous replays and additional observations without replacing existing content', async () => {
    const { services, storage } = setup();
    const input = knowledge();
    const results = await Promise.all([services.cognition.create(input), services.cognition.create(input)]);
    expect(results.map(value => value.replayed)).toEqual([false, true]);
    const next = { ...input, row: { ...input.row, id: 'observation-b', confidence: 0.1 },
      provenance: { occurrence: { producerIdentity: 'api', sessionId: null, sourceOccurrenceId: 'source-b' } },
      idempotency: { idempotencyKey: 'create-b' } };
    const result = await services.cognition.create(next);
    expect(result.result.created).toBe(false);
    expect(result.result.record).toMatchObject({ confidence: 0.8 });
    expect(result.result.record.provenance).toHaveLength(2);
    expect(await storage.read(data => Object.keys(data.cognition_knowledge))).toHaveLength(1);
  });

  it('hashes the actual request, preserves provenance on update, and rejects identity/telemetry changes', async () => {
    const { services } = setup();
    const input = knowledge();
    const first = await services.cognition.create(input);
    await expect(services.cognition.create({ ...input, row: { ...input.row, confidence: 0.2 } })).rejects.toBeInstanceOf(IdempotencyConflictError);
    const target: CognitionAuthorityTarget = { kind: input.kind, scope: input.scope, canonicalId: first.result.record.canonicalId! };
    const update = { ...target, changes: { confidence: 0.95 }, idempotency: { idempotencyKey: 'update-1' } };
    const changed = await services.cognition.update(update);
    expect(changed.result).toMatchObject({ confidence: 0.95, provenance: first.result.record.provenance });
    expect((await services.cognition.update(update)).replayed).toBe(true);
    for (const key of ['title', 'content', 'useCount', 'lastUsed', 'canonicalId', 'siteId']) {
      await expect(services.cognition.update({ ...update, changes: { [key]: 'forbidden' } })).rejects.toThrow('not mutable');
    }
    const deletion = { ...target, idempotency: { idempotencyKey: 'delete-1' } };
    expect((await services.cognition.delete(deletion)).result.deleted).toBe(true);
    expect((await services.cognition.delete(deletion)).replayed).toBe(true);
    expect(await services.cognition.find(target)).toBeNull();
    // Replay returns the original response but cannot resurrect the deleted entity.
    expect((await services.cognition.create(input)).replayed).toBe(true);
    expect(await services.cognition.find(target)).toBeNull();
  });

  it('rejects unproven site/session scope before commit; supports explicit global/session knowledge', async () => {
    const { services, storage } = setup();
    const before = await storage.read(data => data);
    const input = knowledge();
    await expect(services.cognition.create({ ...input, scope: { kind: 'site', siteId: 'unknown' } })).rejects.toThrow('scope');
    await expect(services.cognition.create({ ...input, scope: { kind: 'global' } })).rejects.toThrow('Global');
    const scoped = { ...input, row: { ...input.row, siteId: null }, scope: { kind: 'session' as const, sessionId: 'unknown' } };
    await expect(services.cognition.create(scoped)).rejects.toThrow('session');
    expect(await storage.read(data => data)).toEqual(before);
    const global = await services.cognition.create({ ...scoped, scope: { kind: 'global' } });
    expect(global.result.record.siteId).toBeNull();
    const sessionScoped = { ...scoped, scope: { kind: 'session' as const, sessionId: session.id },
      row: { ...scoped.row, id: 'session-knowledge' }, idempotency: { idempotencyKey: 'session-key' } };
    const result = await services.cognition.create(sessionScoped);
    expect(result.result.record.canonicalId).not.toBe(global.result.record.canonicalId);
  });

  it('rolls back entity and replay record on commit failure and permits retry', async () => {
    let state = seed();
    let fail = true;
    const store = new SnapshotAuthorityStorage(() => state, next => {
      if (fail) throw new Error('commit failed');
      state = next;
    });
    const { services } = setup(store);
    await expect(services.cognition.create(knowledge())).rejects.toThrow('commit failed');
    expect(state.cognition_knowledge).toEqual({});
    expect(state.idempotency_records).toEqual({});
    fail = false;
    expect((await services.cognition.create(knowledge())).replayed).toBe(false);
    expect(Object.keys(state.cognition_knowledge)).toHaveLength(1);
  });

  it('does not let caller mutations of inputs or returned rows bypass the service', async () => {
    const { services } = setup();
    const input = knowledge();
    const promise = services.cognition.create(input);
    input.row.title = 'tampered';
    const result = await promise;
    result.result.record.provenance![0]!.producerIdentity = 'tampered';
    const loaded = await services.cognition.find({ kind: 'knowledge', scope: input.scope,
      canonicalId: result.result.record.canonicalId! });
    expect(loaded).toMatchObject({ title: 'Login' });
    expect(loaded?.provenance?.[0]?.producerIdentity).toBe('worker');
  });

  it('replays derived manual episodes and relative confidence adjustments exactly once', async () => {
    const { services } = setup();
    const manual = { siteId: site.id, type: 'manual', outcome: 'neutral', description: 'Operator note',
      data: { finding: 'x' }, idempotency: { idempotencyKey: 'manual-1' } };
    const firstEpisode = await services.cognition.createManualEpisode(manual);
    const replayEpisode = await services.cognition.createManualEpisode(manual);
    expect(replayEpisode).toEqual({ ...firstEpisode, replayed: true });

    const created = await services.cognition.create(knowledge());
    const adjustment = { siteId: site.id, rowId: created.result.record.id, delta: -0.3,
      idempotency: { idempotencyKey: 'adjust-1' } };
    const first = await services.cognition.adjustKnowledgeConfidence(adjustment);
    const replay = await services.cognition.adjustKnowledgeConfidence(adjustment);
    expect(first.result).toMatchObject({ previousConfidence: 0.8, confidence: 0.5 });
    expect(replay).toEqual({ ...first, replayed: true });
    expect((await services.cognition.find({ kind: 'knowledge', scope: knowledge().scope,
      canonicalId: created.result.record.canonicalId! }))?.confidence).toBe(0.5);
  });
});

describe('2-B SiteProfile boundary', () => {
  it.each(['http://185.200.65.4:82', 'https://www.baidu.com'])('preserves canonical origin %s and enforces uniqueness', async origin => {
    const { services } = setup();
    const input = { scope: { kind: 'profile' as const, profileId: 'new-profile' }, canonicalOrigin: origin,
      name: 'New', idempotency: { idempotencyKey: 'new' } };
    const created = await services.sites.create(input);
    expect(created.result.record.canonicalOriginKey).toBe(origin);
    await expect(services.sites.create({ ...input, scope: { kind: 'profile', profileId: 'other' },
      idempotency: { idempotencyKey: 'other' } })).rejects.toThrow('another profile');
    expect(await services.sites.findByOrigin(origin + '/path')).toEqual(created.result.record);
    expect((await services.sites.create(input)).replayed).toBe(true);
  });

  it('keeps cache replacement separate from semantic mutation; rejects unmodeled fields', async () => {
    const { services } = setup();
    const scope = { kind: 'profile' as const, profileId: site.id };
    await services.sites.update({ scope, name: 'Renamed', idempotency: { idempotencyKey: 'rename' } });
    await services.sites.replaceLocatorCache({ scope, entries: [{ selector: '#login' }], idempotency: { idempotencyKey: 'cache' } });
    const row = await services.sites.findByOrigin('https://example.com');
    expect(row).toMatchObject({ name: 'Renamed', canonicalOriginKey: site.canonicalOriginKey, testCount: 0 });
    expect(JSON.parse(row!.elementCache)).toEqual([{ selector: '#login' }]);
    await expect(services.sites.update({ scope, name: 'X', modeledMetadata: { auth: 'secret' },
      idempotency: { idempotencyKey: 'bad' } } as never)).rejects.toThrow('Unmodeled');
    await expect(services.sites.update({ scope: { kind: 'current-session', profileId: site.id },
      name: 'X', idempotency: { idempotencyKey: 'bad' } } as never)).rejects.toThrow('scope');
  });

  it('counts completed sessions once, keeps max completion time, and rejects ineligible sessions', async () => {
    const { services, storage } = setup();
    const input = { scope: { kind: 'session' as const, profileId: site.id, sessionId: session.id } };
    const results = await Promise.all([services.sites.incrementMetric(input), services.sites.incrementMetric(input)]);
    expect(results.map(value => value.replayed)).toEqual([false, true]);
    expect((await services.sites.findByOrigin(site.canonicalOriginKey!))?.testCount).toBe(1);
    await storage.transaction(data => {
      data.sessions.other = { ...session, id: 'other', targetUrl: 'https://other.example', status: 'completed' };
      data.sessions.running = { ...session, id: 'running', status: 'running' };
      data.sessions.failed = { ...session, id: 'failed', status: 'failed' };
      data.sessions.cancelled = { ...session, id: 'cancelled', status: 'cancelled' };
      data.sessions.newer = { ...session, id: 'newer', completedAt: '2026-09-17T02:00:00.000Z' };
      data.sessions.older = { ...session, id: 'older', completedAt: '2026-09-17T01:00:00.000Z' };
    });
    for (const id of ['other', 'running', 'failed', 'cancelled']) {
      await expect(services.sites.incrementMetric({ scope: { ...input.scope, sessionId: id } })).rejects.toThrow();
    }
    expect((await services.sites.findByOrigin(site.canonicalOriginKey!))?.testCount).toBe(1);
    await services.sites.incrementMetric({ scope: { ...input.scope, sessionId: 'newer' } });
    await services.sites.incrementMetric({ scope: { ...input.scope, sessionId: 'older' } });
    expect(await services.sites.findByOrigin(site.canonicalOriginKey!)).toMatchObject({
      testCount: 3,
      lastTestedAt: '2026-09-17T02:00:00.000Z',
    });
  });

  it('validates bad origins before mutation and deletes idempotently', async () => {
    const { services } = setup();
    for (const origin of ['https://_example.com', 'https://example..com', 'ftp://example.com']) {
      await expect(services.sites.create({ scope: { kind: 'profile', profileId: 'new' }, canonicalOrigin: origin,
        name: 'bad', idempotency: { idempotencyKey: 'new' } })).rejects.toThrow();
    }
    const input = { scope: { kind: 'profile' as const, profileId: site.id }, idempotency: { idempotencyKey: 'delete-site' } };
    expect((await services.sites.delete(input)).result.deleted).toBe(true);
    expect((await services.sites.delete(input)).replayed).toBe(true);
    expect(await services.sites.findByOrigin(site.canonicalOriginKey!)).toBeNull();
  });
});

describe('2-B owner metadata and command boundaries', () => {
  it('serializes concurrent owners and same-owner snapshots, preserving legacy metadata', async () => {
    const { services, storage } = setup();
    const metadata = services.metadata;
    await Promise.all([
      metadata.workerResult.replace({ sessionId: session.id, fields: {
        summary: 'first', findings: [1], activities: [1], turns: 2, score: 50,
      } }),
      metadata.p2e.replace({ sessionId: session.id, fields: { persistedSessionState: { step: 1 } } }),
      metadata.workerResult.replace({ sessionId: session.id, fields: {
        summary: 'last', findings: [2], activities: [2], turns: 3, score: 90,
      } }),
      metadata.cognition.replace({ sessionId: session.id, fields: { references: ['entity'] } }),
      metadata.siteProfile.replace({ sessionId: session.id, fields: { references: [site.id] } }),
    ]);
    expect(await metadata.workerResult.read(session.id)).toEqual({
      summary: 'last', findings: [2], activities: [2], turns: 3, score: 90,
    });
    expect(await metadata.p2e.read(session.id)).toEqual({ persistedSessionState: { step: 1 } });
    expect(await metadata.cognition.read(session.id)).toEqual({ references: ['entity'] });
    expect(await metadata.siteProfile.read(session.id)).toEqual({ references: [site.id] });
    expect(await storage.read(data => data.sessions[session.id]!.metadata)).toEqual(session.metadata);
  });

  it('reads legacy owner fields without writes and prevents P2E resurrection after clear', async () => {
    let state = seed();
    state.sessions[session.id]!.metadata = {
      ...state.sessions[session.id]!.metadata,
      summary: 'legacy result', score: 42, persistedSessionState: { occurrenceCounter: 4 },
    };
    const commit = vi.fn((next: typeof state) => { state = next; });
    const storage = new SnapshotAuthorityStorage(() => state, commit);
    const { services } = setup(storage);
    expect(await services.metadata.workerResult.read(session.id)).toEqual({ summary: 'legacy result', score: 42 });
    expect(await services.metadata.p2e.read(session.id)).toEqual({ persistedSessionState: { occurrenceCounter: 4 } });
    expect(commit).not.toHaveBeenCalled();
    await services.metadata.p2e.clear(session.id);
    expect(await services.metadata.p2e.read(session.id)).toEqual({ persistedSessionState: null });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-owner fields, append, incomplete result snapshots, and request mutation', async () => {
    const { services, storage } = setup();
    const metadata = services.metadata;
    await expect(metadata.p2e.replace({ sessionId: session.id, fields: { summary: 'wrong' } } as never)).rejects.toThrow('Cross-owner');
    await expect(metadata.workerResult.replace({ sessionId: session.id, fields: { findings: [] } })).rejects.toThrow('snapshot');
    await expect(metadata.workerResult.replace({ sessionId: session.id, mode: 'append', fields: { summary: 'wrong' } } as never)).rejects.toThrow('fixed');
    const request = new DefaultMetadataFieldOwnerService(storage, 'request');
    await expect(request.replace({ sessionId: session.id, fields: { instructions: 'changed' } })).rejects.toThrow('immutable');
    expect(await metadata.request.read(session.id)).toEqual({});
  });

  it('keeps reads and replay free of saves and refuses to implicitly migrate legacy request fields', async () => {
    const state = seed();
    state.sessions[session.id]!.scanConfig.instructions = 'legacy request';
    const commit = vi.fn();
    const storage = new SnapshotAuthorityStorage(() => state, commit);
    const { services } = setup(storage);
    await services.sites.findByOrigin(site.canonicalOriginKey!);
    expect(await services.metadata.request.read(session.id)).toEqual({ instructions: 'legacy request' });
    await expect(new DefaultMetadataFieldOwnerService(storage, 'request').replace({ sessionId: session.id, fields: { instructions: 'new' } })).rejects.toThrow('immutable');
    expect(commit).not.toHaveBeenCalled();
  });

  it('requires authorization, verified scope and successful audit; never executes import/export', async () => {
    const { services, policy, storage } = setup();
    const input = { command: 'legacy-import', domain: 'cognition', mode: 'insert-only',
      sourceReference: 'legacy-file', scopeReference: site.id, scopeProofReference: 'session-metadata',
      allowExistingAuthorityUpdate: false, actor: { actorId: 'operator', reason: 'approved window' } };
    const before = await storage.read(data => data);
    policy.authorize.mockResolvedValueOnce(false);
    await expect(services.commands.prepare(input)).rejects.toThrow('not authorized');
    expect(policy.verifyScope).not.toHaveBeenCalled();
    policy.verifyScope.mockResolvedValueOnce(false);
    await expect(services.commands.prepare(input)).rejects.toThrow('Unproven');
    expect(policy.audit).not.toHaveBeenCalled();
    await expect(services.commands.prepare({ ...input, allowExistingAuthorityUpdate: true })).rejects.toThrow('must not update');
    await expect(services.commands.prepare({ ...input, scopeProofReference: '' })).rejects.toThrow('scopeProofReference');
    expect(await services.commands.prepare(input)).toEqual(input);
    policy.audit.mockRejectedValueOnce(new Error('audit failed'));
    await expect(services.commands.prepare(input)).rejects.toThrow('audit failed');
    await services.commands.prepare({ command: 'authority-export', domain: 'site-profile',
      destinationReference: 'projection', actor: input.actor });
    expect(await storage.read(data => data)).toEqual(before);
    expect(Object.keys(services.commands)).toEqual([]);
  });
});
