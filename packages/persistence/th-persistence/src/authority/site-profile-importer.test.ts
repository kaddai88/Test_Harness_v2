import { describe, expect, it, vi } from 'vitest';
import { createAuthorityServices } from './composition.js';
import { ExplicitAuthorityCommandBoundary } from './commands.js';
import { SiteProfileAuthorityExporter, SiteProfileLegacyImporter } from './site-profile-importer.js';
import { InMemoryAuthorityStorage } from './storage.js';

function policy() {
  return { authorize: vi.fn(async () => true), verifyScope: vi.fn(async () => true), audit: vi.fn(async () => {}) };
}

function importCommand() {
  return {
    command: 'legacy-import' as const,
    domain: 'site-profile' as const,
    mode: 'insert-only' as const,
    sourceReference: 'approved-resolution-manifest',
    scopeReference: 'all-approved-site-profiles',
    scopeProofReference: 'P6-2-A2-resolution-review',
    actor: { actorId: 'test-operator', reason: '2-D focused importer test' },
    allowExistingAuthorityUpdate: false as const,
  };
}

function row() {
  return {
    sourceId: 'legacy-example',
    profileId: 'site-legacy',
    legacyHostname: 'example.com',
    resolvedCanonicalOrigin: 'https://www.example.com:8443/path',
    name: 'Legacy Example',
    elementCache: [{ selector: '#login' }],
    resolutionBasis: 'approved historical session evidence',
    approvedBy: 'P6 Phase 2-A2 review gate',
  };
}

describe('2-D bounded SiteProfile importer and exporter', () => {
  it('imports explicit resolved rows once and retains existing authority unchanged', async () => {
    const storage = new InMemoryAuthorityStorage();
    const commandPolicy = policy();
    const services = createAuthorityServices(storage, commandPolicy);
    const importer = new SiteProfileLegacyImporter(services.sites, new ExplicitAuthorityCommandBoundary(commandPolicy));

    expect(await importer.run(importCommand(), [row()])).toMatchObject({ inserted: 1, skipped: 0, blocked: 0 });
    const before = await storage.read(data => data);
    expect(await importer.run(importCommand(), [{ ...row(), name: 'Stale overwrite' }]))
      .toMatchObject({ inserted: 0, skipped: 1, blocked: 0 });
    expect(await storage.read(data => data)).toEqual(before);
  });

  it('rejects guessed, invalid, unapproved, and over-bound inputs without mutation', async () => {
    const storage = new InMemoryAuthorityStorage();
    const commandPolicy = policy();
    const services = createAuthorityServices(storage, commandPolicy);
    const importer = new SiteProfileLegacyImporter(services.sites, new ExplicitAuthorityCommandBoundary(commandPolicy), 1);

    for (const invalid of [
      { ...row(), resolvedCanonicalOrigin: 'example.com' },
      { ...row(), legacyHostname: 'https://example.com' },
      { ...row(), approvedBy: '' },
    ]) {
      expect(await importer.run(importCommand(), [invalid])).toMatchObject({ inserted: 0, blocked: 1 });
    }
    await expect(importer.run(importCommand(), [row(), row()])).rejects.toThrow('bounded row limit');
    expect(await storage.read(data => data.sites)).toEqual({});
  });

  it('prepares one-way cache projections without mutating authority', async () => {
    const storage = new InMemoryAuthorityStorage();
    const commandPolicy = policy();
    const services = createAuthorityServices(storage, commandPolicy);
    await services.sites.ensure({ canonicalOrigin: 'https://example.com', name: 'Example',
      idempotency: { idempotencyKey: 'ensure' } });
    const before = await storage.read(data => data);
    const exporter = new SiteProfileAuthorityExporter(services.sites, new ExplicitAuthorityCommandBoundary(commandPolicy));
    const projections = await exporter.prepare({
      command: 'authority-export', domain: 'site-profile', destinationReference: 'temporary-test-directory',
      actor: { actorId: 'test-operator', reason: '2-D focused export test' },
    }, '2026-09-17T02:00:00.000Z');
    expect(projections).toEqual([{
      canonicalOriginKey: 'https://example.com', name: 'Example', elementCache: [],
      projectedAt: '2026-09-17T02:00:00.000Z',
    }]);
    expect(await storage.read(data => data)).toEqual(before);
  });
});
