import { describe, expect, it, vi } from 'vitest';
import { createAuthorityServices } from './composition.js';
import { ExplicitAuthorityCommandBoundary } from './commands.js';
import { CognitionLegacyImporter } from './cognition-importer.js';
import { InMemoryAuthorityStorage } from './storage.js';
import type { CognitionAuthorityCreateInput } from './cognition.js';

function input(): CognitionAuthorityCreateInput & { kind: 'knowledge' } {
  return {
    kind: 'knowledge', scope: { kind: 'site', siteId: 'site-1' },
    row: { id: 'legacy-1', siteId: 'site-1', type: 'fact', title: 'Login', content: '{}',
      confidence: 0.8, useCount: 0, lastUsed: null, tags: '[]', createdAt: '2026-09-17T00:00:00.000Z' },
    provenance: { occurrence: { producerIdentity: 'legacy-import', sessionId: null, sourceOccurrenceId: 'legacy-1' },
      legacyId: { kind: 'legacy-cognition-id', value: 'legacy-1' } },
    idempotency: { idempotencyKey: 'legacy-import:legacy-1' },
  };
}

describe('2-C bounded cognition importer', () => {
  it('is authorized explicitly, insert-only, repeatable, and never changes existing provenance', async () => {
    const storage = new InMemoryAuthorityStorage({ sites: { 'site-1': { id: 'site-1', name: 'Example',
      baseUrl: 'example.com', canonicalOriginKey: 'https://example.com', elementCache: '[]', testCount: 0,
      lastTestedAt: null, updatedAt: 'now' } } });
    const policy = { authorize: vi.fn(async () => true), verifyScope: vi.fn(async () => true), audit: vi.fn(async () => {}) };
    const services = createAuthorityServices(storage, policy);
    const importer = new CognitionLegacyImporter(services.cognition, new ExplicitAuthorityCommandBoundary(policy));
    const command = { command: 'legacy-import' as const, domain: 'cognition' as const, mode: 'insert-only' as const,
      sourceReference: 'fixture', scopeReference: 'site-1', scopeProofReference: 'approved-test',
      actor: { actorId: 'test-operator', reason: '2-C focused test' }, allowExistingAuthorityUpdate: false as const };

    expect(await importer.run(command, [input()])).toMatchObject({ inserted: 1, skipped: 0, blocked: 0 });
    const before = await storage.read(data => data);
    expect(await importer.run(command, [input()])).toMatchObject({ inserted: 0, skipped: 1, blocked: 0 });
    expect(await storage.read(data => data)).toEqual(before);
    expect(policy.authorize).toHaveBeenCalledTimes(2);
    expect(policy.verifyScope).toHaveBeenCalledTimes(2);
    expect(policy.audit).toHaveBeenCalledTimes(2);
  });

  it('does not run without authorization or accept another command domain', async () => {
    const storage = new InMemoryAuthorityStorage();
    const policy = { authorize: vi.fn(async () => false), verifyScope: vi.fn(async () => true), audit: vi.fn(async () => {}) };
    const services = createAuthorityServices(storage, policy);
    const importer = new CognitionLegacyImporter(services.cognition, new ExplicitAuthorityCommandBoundary(policy));
    const command = { command: 'legacy-import' as const, domain: 'cognition' as const, mode: 'insert-only' as const,
      sourceReference: 'fixture', scopeReference: 'site-1', scopeProofReference: 'proof',
      actor: { actorId: 'operator', reason: 'test' }, allowExistingAuthorityUpdate: false as const };
    await expect(importer.run(command, [input()])).rejects.toThrow('not authorized');
    expect((await storage.read(data => Object.keys(data.cognition_knowledge)))).toEqual([]);
  });

  it('blocks rows outside the approved scope and batches above the explicit bound', async () => {
    const storage = new InMemoryAuthorityStorage({ sites: { 'site-1': { id: 'site-1', name: 'Example',
      baseUrl: 'example.com', canonicalOriginKey: 'https://example.com', elementCache: '[]', testCount: 0,
      lastTestedAt: null, updatedAt: 'now' } } });
    const policy = { authorize: vi.fn(async () => true), verifyScope: vi.fn(async () => true), audit: vi.fn(async () => {}) };
    const services = createAuthorityServices(storage, policy);
    const command = { command: 'legacy-import' as const, domain: 'cognition' as const, mode: 'insert-only' as const,
      sourceReference: 'fixture', scopeReference: 'site-1', scopeProofReference: 'proof',
      actor: { actorId: 'operator', reason: 'test' }, allowExistingAuthorityUpdate: false as const };
    const bounded = new CognitionLegacyImporter(services.cognition, new ExplicitAuthorityCommandBoundary(policy), 1);
    await expect(bounded.run(command, [input(), input()])).rejects.toThrow('bounded row limit');
    const outside = { ...input(), scope: { kind: 'site' as const, siteId: 'other' },
      row: { ...input().row, siteId: 'other' } };
    expect(await bounded.run(command, [outside])).toMatchObject({ inserted: 0, skipped: 0, blocked: 1 });
    expect((await storage.read(data => Object.keys(data.cognition_knowledge)))).toEqual([]);
  });
});
