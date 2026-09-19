import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultSiteProfileAuthorityService } from '../authority/site-profile.js';
import {
  readCutoverResolutionManifest, runCutoverPreflight, type CognitionCollisionResolution,
  type CutoverPreflightReport,
} from './preflight.js';
import { PostPonrRehearsalError, runPrePonrRollbackRehearsal, runSuccessPathRehearsal } from './rehearsal.js';
import {
  captureRehearsalSnapshot, resetIsolatedCloneFromSnapshot, restoreRehearsalSnapshot, semanticJsonSha256,
} from './snapshot.js';

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'th-p6-f-'));
  directories.push(directory);
  return directory;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function emptyDatabase() {
  return {
    sessions: {}, reports: {}, sites: {}, cognition_episodes: {}, cognition_knowledge: {},
    cognition_procedures: {}, cognition_patterns: {}, idempotency_records: {},
  };
}

function fixture() {
  const root = temporaryDirectory();
  const live = path.join(root, 'live');
  const datastore = path.join(live, 'data', 'database.json');
  const cognition = path.join(live, '.cognition');
  const profiles = path.join(live, '.site-profiles');
  writeJson(datastore, emptyDatabase());
  writeJson(path.join(profiles, 'example.com.json'), {
    name: 'Example', baseUrl: 'https://example.com/path', elementCache: [], updatedAt: 1,
  });
  writeJson(path.join(cognition, 'episodes.json'), []);
  writeJson(path.join(cognition, 'semantic.json'), [{
    id: 'knowledge-1', type: 'site_characteristic', timestamp: 1_700_000_000_000,
    title: 'Login', description: 'Login behavior', targetUrl: 'https://example.com/path',
    content: { required: true }, sourceEpisodes: [], confidence: 0.9, verificationCount: 1,
    useCount: 0, lastUsed: 1_700_000_000_000, tags: ['login'],
  }]);
  writeJson(path.join(cognition, 'patterns.json'), [{
    id: 'control-pattern-1', type: 'success_pattern', description: 'control only',
    targetUrl: 'https://example.com', frequency: 1, confidence: 1, tags: [], lastDetected: 1,
  }]);
  writeJson(path.join(cognition, 'q-values.json'), { retained: true });
  return { root, datastore, cognition, profiles, liveSources: [datastore, cognition, profiles] };
}

function captureAndRestore(target: ReturnType<typeof fixture>, name: string) {
  const snapshot = path.join(target.root, 'isolated', 'snapshot');
  if (!fs.existsSync(snapshot)) {
    captureRehearsalSnapshot([
      { id: 'datastore', kind: 'datastore', sourcePath: target.datastore },
      { id: 'legacy-cognition', kind: 'legacy-cognition', sourcePath: target.cognition },
      { id: 'legacy-site-profiles', kind: 'legacy-site-profiles', sourcePath: target.profiles },
    ], snapshot);
  }
  const clone = restoreRehearsalSnapshot(snapshot, path.join(target.root, 'isolated', name), target.liveSources);
  return { snapshot, clone };
}

function preflightFor(clone: ReturnType<typeof restoreRehearsalSnapshot>) {
  return runCutoverPreflight({
    datastorePath: clone.pathsBySourceId.datastore!,
    cognitionRoot: clone.pathsBySourceId['legacy-cognition']!,
    siteProfileRoot: clone.pathsBySourceId['legacy-site-profiles']!,
  }, [{
    sourceFile: 'example.com.json', profileId: 'site-example', resolvedCanonicalOrigin: 'https://example.com',
    resolutionBasis: 'fixture operator decision', approvedBy: 'fixture-review',
  }]);
}

function semanticKnowledge(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, type: 'site_characteristic', timestamp: 1_700_000_000_000,
    title: 'Login', description: 'Login behavior', targetUrl: 'https://example.com/path',
    content: { required: true }, sourceEpisodes: [], confidence: 0.5, verificationCount: 1,
    useCount: 1, lastUsed: 1_700_000_000_000, tags: ['login'],
    ...overrides,
  };
}

function collisionKey(report: CutoverPreflightReport): string {
  const diagnostic = report.diagnostics.find(value => value.code === 'collision'
    && value.detail.startsWith('Multiple source records map to canonical key '));
  if (!diagnostic) throw new Error('Fixture did not produce a canonical collision');
  return diagnostic.detail.slice('Multiple source records map to canonical key '.length);
}

function collisionResolution(canonicalKey: string, sourceIds: readonly string[]): CognitionCollisionResolution {
  return {
    canonicalKey,
    strategy: 'equivalent-semantic-collapse',
    sourceIds,
    representativePolicy: 'latest-observation-v1',
    resolutionBasis: 'Repeated KnowledgeDistiller snapshots with identical semantic fields',
    approvedBy: 'fixture-review',
  };
}

function livePreflight(
  target: ReturnType<typeof fixture>,
  resolutions: readonly CognitionCollisionResolution[] = [],
): CutoverPreflightReport {
  return runCutoverPreflight({
    datastorePath: target.datastore,
    cognitionRoot: target.cognition,
    siteProfileRoot: target.profiles,
  }, [{
    sourceFile: 'example.com.json', profileId: 'site-example', resolvedCanonicalOrigin: 'https://example.com',
    resolutionBasis: 'fixture operator decision', approvedBy: 'fixture-review',
  }], [], resolutions);
}

describe('P6 Phase 2-F isolated rehearsal tooling', () => {
  it('rejects a snapshot destination nested under a live source', () => {
    const target = fixture();
    expect(() => captureRehearsalSnapshot([
      { id: 'datastore', kind: 'datastore', sourcePath: target.datastore },
      { id: 'legacy-cognition', kind: 'legacy-cognition', sourcePath: target.cognition },
      { id: 'legacy-site-profiles', kind: 'legacy-site-profiles', sourcePath: target.profiles },
    ], path.join(target.cognition, 'snapshot'))).toThrow('paths overlap');
  });

  it('captures immutable inputs and restores exact raw and semantic clones', () => {
    const target = fixture();
    const before = fs.readFileSync(target.datastore, 'utf8');
    const first = captureAndRestore(target, 'clone-one');
    const second = captureAndRestore(target, 'clone-two');
    expect(first.clone.rawHashesVerified).toBe(true);
    expect(second.clone.datastoreSemanticSha256).toBe(semanticJsonSha256(target.datastore));
    expect(fs.readFileSync(target.datastore, 'utf8')).toBe(before);
    const manifest = JSON.parse(fs.readFileSync(path.join(first.snapshot, 'snapshot-manifest.json'), 'utf8'));
    expect(manifest.files.find((file: { relativeManifestPath: string }) =>
      file.relativeManifestPath.endsWith('/patterns.json')).role).toBe('evidence-only-control-state');
  });

  it('binds clone isolation to manifest sources even when the caller supplies no live paths', () => {
    const target = fixture();
    const snapshot = path.join(target.root, 'isolated', 'snapshot-boundary');
    captureRehearsalSnapshot([
      { id: 'datastore', kind: 'datastore', sourcePath: target.datastore },
      { id: 'legacy-cognition', kind: 'legacy-cognition', sourcePath: target.cognition },
      { id: 'legacy-site-profiles', kind: 'legacy-site-profiles', sourcePath: target.profiles },
    ], snapshot);
    expect(() => restoreRehearsalSnapshot(snapshot, path.join(target.cognition, 'nested-clone')))
      .toThrow('Clone/manifest source paths overlap');
  });

  it('rejects a snapshot manifest path that could escape its payload root', () => {
    const target = fixture();
    const restored = captureAndRestore(target, 'valid-clone');
    const manifestPath = path.join(restored.snapshot, 'snapshot-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.files[0].relativeManifestPath = 'payload/datastore/../../outside.json';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => restoreRehearsalSnapshot(restored.snapshot, path.join(target.root, 'isolated', 'unsafe-clone'),
      target.liveSources)).toThrow('Snapshot manifest identity mismatch');
  });

  it('fails closed before import when cognition has no proven SiteProfile scope', () => {
    const target = fixture();
    const restored = captureAndRestore(target, 'orphan-clone');
    const profileFile = path.join(restored.clone.pathsBySourceId['legacy-site-profiles']!, 'example.com.json');
    writeJson(profileFile, { name: 'Other', baseUrl: 'https://other.example', elementCache: [] });
    const report = runCutoverPreflight({
      datastorePath: restored.clone.pathsBySourceId.datastore!,
      cognitionRoot: restored.clone.pathsBySourceId['legacy-cognition']!,
      siteProfileRoot: restored.clone.pathsBySourceId['legacy-site-profiles']!,
    }, [{ sourceFile: 'example.com.json', profileId: 'site-other', resolvedCanonicalOrigin: 'https://other.example',
      resolutionBasis: 'fixture', approvedBy: 'fixture-review' }]);
    expect(report.status).toBe('no-go');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      code: 'orphan-site-scope', domain: 'cognition', detail: 'No proven SiteProfile scope for https://example.com (1 rows)',
    }));
    expect(JSON.parse(fs.readFileSync(restored.clone.pathsBySourceId.datastore!, 'utf8')).cognition_knowledge).toEqual({});
  });

  it('accepts only an explicit approved SiteProfile input for a cognition-only origin', () => {
    const target = fixture();
    fs.rmSync(path.join(target.profiles, 'example.com.json'));
    const restored = captureAndRestore(target, 'explicit-profile-clone');
    const report = runCutoverPreflight({
      datastorePath: restored.clone.pathsBySourceId.datastore!,
      cognitionRoot: restored.clone.pathsBySourceId['legacy-cognition']!,
      siteProfileRoot: restored.clone.pathsBySourceId['legacy-site-profiles']!,
    }, [], [{
      sourceId: 'operator-resolution:example.com', profileId: 'site-example', legacyHostname: 'example.com',
      resolvedCanonicalOrigin: 'https://example.com', name: 'Example', elementCache: [],
      resolutionBasis: 'explicit fixture evidence', approvedBy: 'fixture-review',
    }]);
    expect(report).toMatchObject({ status: 'go', counts: { siteProfileImports: 1, cognitionImports: 1 } });
    expect(report.counts.excludedControlFiles).toBe(2);
    expect(report.excludedControlFiles).toContain('patterns.json');
    expect(report.cognitionRowsBySiteId['site-example']?.[0]?.idempotency.idempotencyKey)
      .toBe('legacy-cognition-import:site-example:knowledge:knowledge-1');
  });

  it('restores semantic files while preserving newer file-owned control state', () => {
    const target = fixture();
    const restored = captureAndRestore(target, 'control-preservation-clone');
    const datastore = restored.clone.pathsBySourceId.datastore!;
    const controlRoot = restored.clone.pathsBySourceId['legacy-cognition']!;
    const baselineDatastore = fs.readFileSync(datastore);
    writeJson(datastore, { changed: true });
    writeJson(path.join(controlRoot, 'q-values.json'), { retained: 'newer-q-value' });
    writeJson(path.join(controlRoot, 'patterns.json'), [{ retained: 'newer-pattern-control' }]);

    const result = resetIsolatedCloneFromSnapshot(restored.snapshot, restored.clone.cloneRoot, target.liveSources);
    expect(result.restoreMode).toBe('semantic-only');
    expect(fs.readFileSync(datastore)).toEqual(baselineDatastore);
    expect(JSON.parse(fs.readFileSync(path.join(controlRoot, 'q-values.json'), 'utf8'))).toEqual({ retained: 'newer-q-value' });
    expect(JSON.parse(fs.readFileSync(path.join(controlRoot, 'patterns.json'), 'utf8')))
      .toEqual([{ retained: 'newer-pattern-control' }]);
  });

  it('runs SiteProfile-first success and exact pre-PONR rollback rehearsals only on clones', async () => {
    const target = fixture();
    const success = captureAndRestore(target, 'success-clone');
    const rollback = captureAndRestore(target, 'rollback-clone');
    const successPreflight = preflightFor(success.clone);
    const rollbackPreflight = preflightFor(rollback.clone);
    expect(successPreflight).toMatchObject({ status: 'go', counts: { siteProfileImports: 1, cognitionImports: 1 } });

    const successResult = await runSuccessPathRehearsal({
      cloneRoot: success.clone.cloneRoot, liveSourcePaths: target.liveSources,
      datastoreSourceId: 'datastore', datastoreFileName: path.basename(target.datastore),
      legacySourceIds: ['legacy-cognition', 'legacy-site-profiles'], preflight: successPreflight,
    });
    expect(successResult).toMatchObject({ status: 'pass', replayInserted: 0, importerAfterRevoke: 'rejected',
      restartRead: 'pass', projectionAuthorityDiff: 'empty', idempotentReplay: 'pass', payloadConflict: 'rejected' });
    expect(successResult.states.map(event => event.state)).toEqual([
      'PREPARED', 'FROZEN', 'IMPORTING_SITE_PROFILES', 'IMPORTING_COGNITION', 'VERIFYING',
      'WRITERS_ENABLED_TRAFFIC_FROZEN', 'LIVE_PRE_PONR', 'LIVE_POST_PONR',
    ]);

    const rollbackResult = await runPrePonrRollbackRehearsal({
      snapshotRoot: rollback.snapshot, cloneRoot: rollback.clone.cloneRoot, liveSourcePaths: target.liveSources,
      datastoreSourceId: 'datastore', datastoreFileName: path.basename(target.datastore),
      legacySourceIds: ['legacy-cognition', 'legacy-site-profiles'], preflight: rollbackPreflight,
    });
    expect(rollbackResult).toMatchObject({ status: 'pass', exactBaselineRestored: true });
    expect(rollbackResult.restoredRawSha256).toBe(rollbackResult.baselineRawSha256);
    expect(rollbackResult.restoredSemanticSha256).toBe(rollbackResult.baselineSemanticSha256);
    expect(fs.readFileSync(target.datastore, 'utf8')).toBe(`${JSON.stringify(emptyDatabase(), null, 2)}\n`);
  });

  it('surfaces post-PONR state when durable audit recording fails after the first mutation', async () => {
    const target = fixture();
    const success = captureAndRestore(target, 'post-ponr-failure-clone');
    const preflight = preflightFor(success.clone);
    const append = fs.appendFileSync.bind(fs);
    let appendCount = 0;
    vi.spyOn(fs, 'appendFileSync').mockImplementation(((...args: Parameters<typeof fs.appendFileSync>) => {
      appendCount++;
      if (appendCount === 2) throw new Error('injected post-PONR audit failure');
      return append(...args);
    }) as typeof fs.appendFileSync);
    let failure: unknown;
    try {
      await runSuccessPathRehearsal({
        cloneRoot: success.clone.cloneRoot, liveSourcePaths: target.liveSources,
        datastoreSourceId: 'datastore', datastoreFileName: path.basename(target.datastore),
        legacySourceIds: ['legacy-cognition', 'legacy-site-profiles'], preflight,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PostPonrRehearsalError);
    expect(failure).toMatchObject({
      postPonr: true,
      ponr: { outcome: 'accepted', attemptedAt: expect.any(String), acceptedAt: expect.any(String) },
      states: expect.arrayContaining([expect.objectContaining({ state: 'LIVE_POST_PONR' })]),
    });
    expect(fs.readFileSync(path.join(success.clone.cloneRoot, 'p6-ponr-audit.jsonl'), 'utf8'))
      .toContain('LIVE_PRE_PONR');
    const data = JSON.parse(fs.readFileSync(success.clone.pathsBySourceId.datastore!, 'utf8'));
    expect(data.sites['site-example'].name).toContain('[P6 rehearsal]');
  });

  it('treats an unproven first authority update completion as ambiguous post-PONR', async () => {
    const target = fixture();
    const success = captureAndRestore(target, 'ambiguous-ponr-clone');
    const preflight = preflightFor(success.clone);
    vi.spyOn(DefaultSiteProfileAuthorityService.prototype, 'update')
      .mockRejectedValueOnce(new Error('injected update completion ambiguity'));

    let failure: unknown;
    try {
      await runSuccessPathRehearsal({
        cloneRoot: success.clone.cloneRoot, liveSourcePaths: target.liveSources,
        datastoreSourceId: 'datastore', datastoreFileName: path.basename(target.datastore),
        legacySourceIds: ['legacy-cognition', 'legacy-site-profiles'], preflight,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(PostPonrRehearsalError);
    expect(failure).toMatchObject({
      postPonr: true,
      ponr: { outcome: 'ambiguous', attemptedAt: expect.any(String) },
      states: expect.arrayContaining([expect.objectContaining({ state: 'LIVE_POST_PONR' })]),
    });
    expect((failure as PostPonrRehearsalError).ponr).not.toHaveProperty('acceptedAt');
    expect((failure as PostPonrRehearsalError).states.map(event => event.state))
      .not.toContain('ROLLED_BACK_PRE_PONR');
    const audit = fs.readFileSync(path.join(success.clone.cloneRoot, 'p6-ponr-audit.jsonl'), 'utf8');
    expect(audit).toContain('"outcome":"ambiguous"');
  });
});

describe('P6 Phase 2-F cognition collision consolidation', () => {
  it('keeps an unapproved knowledge collision as NO-GO', () => {
    const target = fixture();
    writeJson(path.join(target.cognition, 'semantic.json'), [semanticKnowledge('source-a'), semanticKnowledge('source-b')]);
    const report = livePreflight(target);
    expect(report.status).toBe('no-go');
    expect(report.resolvedCollisions).toEqual([]);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'collision', domain: 'cognition' }));
  });

  it('collapses an exactly approved equivalent group and preserves immutable source data', () => {
    const target = fixture();
    const semanticPath = path.join(target.cognition, 'semantic.json');
    writeJson(semanticPath, [
      semanticKnowledge('source-a', { timestamp: 1_700_000_000_000, lastUsed: null, confidence: 0.2, useCount: 2 }),
      semanticKnowledge('source-b', { timestamp: 1_700_000_001_000, lastUsed: 1_700_000_002_000,
        confidence: 0.8, useCount: 8 }),
    ]);
    const before = fs.readFileSync(semanticPath);
    const key = collisionKey(livePreflight(target));
    const report = livePreflight(target, [collisionResolution(key, ['source-a', 'source-b'])]);
    const row = report.cognitionRowsBySiteId['site-example']?.[0];
    expect(report).toMatchObject({
      status: 'go',
      counts: { cognitionInputs: 2, cognitionImports: 1, resolvedCollisionGroups: 1, collapsedExcessRows: 1 },
      resolvedCollisions: [{
        canonicalKey: key, sourceCount: 2, outputRowCount: 1, collapsedExcessRows: 1,
        representativeSourceId: 'source-b', representativePolicy: 'latest-observation-v1',
        resolutionBasis: expect.any(String), approvedBy: 'fixture-review', semanticHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }],
    });
    expect(row?.kind).toBe('knowledge');
    if (row?.kind !== 'knowledge') throw new Error('Expected consolidated knowledge row');
    expect(row.row).toMatchObject({
      id: 'source-b', createdAt: new Date(1_700_000_000_000).toISOString(),
      lastUsed: new Date(1_700_000_002_000).toISOString(), confidence: 0.8, useCount: 8,
    });
    expect(fs.readFileSync(semanticPath)).toEqual(before);
  });

  it('collapses an approved 182-row group to one deterministic import', () => {
    const target = fixture();
    const rows = Array.from({ length: 182 }, (_, index) => semanticKnowledge(`source-${String(index).padStart(3, '0')}`, {
      timestamp: 1_700_000_000_000 + index,
      lastUsed: 1_700_000_000_000 + index,
      confidence: index / 182,
      useCount: index,
    }));
    writeJson(path.join(target.cognition, 'semantic.json'), rows);
    const key = collisionKey(livePreflight(target));
    const report = livePreflight(target, [collisionResolution(key, rows.map(row => row.id))]);
    expect(report).toMatchObject({ status: 'go', counts: {
      cognitionInputs: 182, cognitionImports: 1, resolvedCollisionGroups: 1, collapsedExcessRows: 181,
    } });
    expect(report.resolvedCollisions[0]).toMatchObject({ sourceCount: 182, representativeSourceId: 'source-181' });
  });

  it.each([
    ['omitted source', (key: string) => collisionResolution(key, ['source-a'])],
    ['unknown extra source', (key: string) => collisionResolution(key, ['source-a', 'source-b', 'source-x'])],
    ['canonical key mismatch', () => collisionResolution('cognition:v1:knowledge:missing', ['source-a', 'source-b'])],
  ])('rejects a resolution with %s', (_label, resolutionFor) => {
    const target = fixture();
    writeJson(path.join(target.cognition, 'semantic.json'), [semanticKnowledge('source-a'), semanticKnowledge('source-b')]);
    const key = collisionKey(livePreflight(target));
    const report = livePreflight(target, [resolutionFor(key)]);
    expect(report.status).toBe('no-go');
    expect(report.resolvedCollisions).toEqual([]);
  });

  it('rejects semantic differences that canonical identity does not include', () => {
    const target = fixture();
    writeJson(path.join(target.cognition, 'semantic.json'), [
      semanticKnowledge('source-a', { tags: ['login'] }),
      semanticKnowledge('source-b', { tags: ['login', 'different'] }),
    ]);
    const key = collisionKey(livePreflight(target));
    const report = livePreflight(target, [collisionResolution(key, ['source-a', 'source-b'])]);
    expect(report.status).toBe('no-go');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      detail: `Resolved collision contains materially different semantic fields: ${key}`,
    }));
  });

  it('rejects a source ID used in two resolutions without polluting a valid resolution', () => {
    const target = fixture();
    writeJson(path.join(target.cognition, 'semantic.json'), [semanticKnowledge('source-a'), semanticKnowledge('source-b')]);
    const key = collisionKey(livePreflight(target));
    const report = livePreflight(target, [
      collisionResolution(key, ['source-a', 'source-b']),
      collisionResolution('cognition:v1:knowledge:other', ['source-b', 'source-c']),
    ]);
    expect(report.status).toBe('no-go');
    expect(report.resolvedCollisions).toHaveLength(1);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({
      detail: 'Source ID appears in multiple cognition collision resolutions',
    }));
  });

  it('uses lexical max source ID for an exact latest-observation tie', () => {
    const target = fixture();
    writeJson(path.join(target.cognition, 'semantic.json'), [
      semanticKnowledge('source-a', { confidence: 0.1, useCount: 1 }),
      semanticKnowledge('source-z', { confidence: 0.9, useCount: 9 }),
    ]);
    const key = collisionKey(livePreflight(target));
    const report = livePreflight(target, [collisionResolution(key, ['source-a', 'source-z'])]);
    expect(report.status).toBe('go');
    expect(report.resolvedCollisions[0]?.representativeSourceId).toBe('source-z');
    const row = report.cognitionRowsBySiteId['site-example']?.[0];
    expect(row?.row).toMatchObject({ id: 'source-z', confidence: 0.9, useCount: 9 });
  });

  it('compares an existing authority row with the consolidated candidate and remains GO when equal', () => {
    const target = fixture();
    writeJson(path.join(target.cognition, 'semantic.json'), [
      semanticKnowledge('source-a', { timestamp: 1_700_000_000_000, lastUsed: null, confidence: 0.2, useCount: 2 }),
      semanticKnowledge('source-b', { timestamp: 1_700_000_001_000, lastUsed: 1_700_000_002_000,
        confidence: 0.8, useCount: 8 }),
    ]);
    const key = collisionKey(livePreflight(target));
    const resolution = collisionResolution(key, ['source-a', 'source-b']);
    const candidate = livePreflight(target, [resolution]).cognitionRowsBySiteId['site-example']?.[0];
    if (candidate?.kind !== 'knowledge') throw new Error('Expected consolidated knowledge candidate');
    writeJson(target.datastore, {
      ...emptyDatabase(),
      cognition_knowledge: {
        [candidate.row.id]: { ...candidate.row, canonicalId: key, provenance: [] },
      },
    });

    const report = livePreflight(target, [resolution]);
    expect(report.status).toBe('go');
    expect(report.diagnostics.filter(value => value.code === 'semantic-mismatch')).toEqual([]);
  });

  it('emits exactly one semantic mismatch when existing authority differs from the consolidated candidate', () => {
    const target = fixture();
    writeJson(path.join(target.cognition, 'semantic.json'), [
      semanticKnowledge('source-a', { timestamp: 1_700_000_000_000, lastUsed: null, confidence: 0.2, useCount: 2 }),
      semanticKnowledge('source-b', { timestamp: 1_700_000_001_000, lastUsed: 1_700_000_002_000,
        confidence: 0.8, useCount: 8 }),
    ]);
    const key = collisionKey(livePreflight(target));
    const resolution = collisionResolution(key, ['source-a', 'source-b']);
    const candidate = livePreflight(target, [resolution]).cognitionRowsBySiteId['site-example']?.[0];
    if (candidate?.kind !== 'knowledge') throw new Error('Expected consolidated knowledge candidate');
    writeJson(target.datastore, {
      ...emptyDatabase(),
      cognition_knowledge: {
        [candidate.row.id]: { ...candidate.row, confidence: 0.7, canonicalId: key, provenance: [] },
      },
    });

    const report = livePreflight(target, [resolution]);
    const mismatches = report.diagnostics.filter(value => value.code === 'semantic-mismatch');
    expect(report.status).toBe('no-go');
    expect(mismatches).toEqual([expect.objectContaining({
      domain: 'cognition',
      sourceId: 'source-b',
      detail: `Existing authority differs for canonical identity ${key}`,
    })]);
  });

  it.each([
    ['invalid strategy', (value: CognitionCollisionResolution) => [{ ...value, strategy: 'unknown-strategy' }],
      'Invalid cognition collision resolution contract'],
    ['invalid representative policy', (value: CognitionCollisionResolution) => [
      { ...value, representativePolicy: 'unknown-policy' },
    ], 'Invalid cognition collision resolution contract'],
    ['duplicate source IDs', (value: CognitionCollisionResolution) => [
      { ...value, sourceIds: ['source-a', 'source-a'] },
    ], 'Cognition collision resolution contains duplicate source IDs'],
    ['duplicate canonical key', (value: CognitionCollisionResolution) => [value, { ...value }],
      'Canonical key appears in multiple cognition collision resolutions'],
    ['empty resolution basis', (value: CognitionCollisionResolution) => [{ ...value, resolutionBasis: '' }],
      'Invalid cognition collision resolution contract'],
    ['empty approver', (value: CognitionCollisionResolution) => [{ ...value, approvedBy: '' }],
      'Invalid cognition collision resolution contract'],
  ])('fails closed for direct-caller malformed resolution: %s', (_label, resolutionsFor, expectedDetail) => {
    const target = fixture();
    writeJson(path.join(target.cognition, 'semantic.json'), [semanticKnowledge('source-a'), semanticKnowledge('source-b')]);
    const key = collisionKey(livePreflight(target));
    const valid = collisionResolution(key, ['source-a', 'source-b']);
    const malformed = resolutionsFor(valid) as unknown as readonly CognitionCollisionResolution[];

    const report = livePreflight(target, malformed);
    expect(report.status).toBe('no-go');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ detail: expectedDetail }));
  });

  it('rejects an invalid strategy while parsing a raw v2 manifest', () => {
    const root = temporaryDirectory();
    const manifestPath = path.join(root, 'invalid-v2.json');
    writeJson(manifestPath, {
      format: 'p6-cutover-resolution-v2',
      legacyFileResolutions: [],
      explicitSiteProfiles: [],
      cognitionCollisionResolutions: [{
        ...collisionResolution('canonical-key', ['source-a', 'source-b']),
        strategy: 'unknown-strategy',
      }],
    });
    expect(() => readCutoverResolutionManifest(manifestPath)).toThrow('Unsupported cognition collision strategy');
  });

  it('produces identical evidence and rows across replay, source ordering, and manifest source ordering', () => {
    const target = fixture();
    const semanticPath = path.join(target.cognition, 'semantic.json');
    const sourceA = semanticKnowledge('source-a', { confidence: 0.1, useCount: 1 });
    const sourceZ = semanticKnowledge('source-z', { confidence: 0.9, useCount: 9 });
    writeJson(semanticPath, [sourceA, sourceZ]);
    const key = collisionKey(livePreflight(target));
    const first = livePreflight(target, [collisionResolution(key, ['source-z', 'source-a'])]);
    const replay = livePreflight(target, [collisionResolution(key, ['source-z', 'source-a'])]);

    writeJson(semanticPath, [sourceZ, sourceA]);
    const reordered = livePreflight(target, [collisionResolution(key, ['source-a', 'source-z'])]);

    expect(first.status).toBe('go');
    expect(first.resolvedCollisions[0]?.representativeSourceId).toBe('source-z');
    expect(replay.resolvedCollisions).toEqual(first.resolvedCollisions);
    expect(replay.cognitionRowsBySiteId).toEqual(first.cognitionRowsBySiteId);
    expect(reordered.resolvedCollisions).toEqual(first.resolvedCollisions);
    expect(reordered.cognitionRowsBySiteId).toEqual(first.cognitionRowsBySiteId);
  });

  it('parses v1 compatibly and validates all v2 fields without raw-object spreading', () => {
    const root = temporaryDirectory();
    const v1Path = path.join(root, 'v1.json');
    const v2Path = path.join(root, 'v2.json');
    const common = { legacyFileResolutions: [], explicitSiteProfiles: [] };
    writeJson(v1Path, { format: 'p6-cutover-resolution-v1', ...common });
    writeJson(v2Path, {
      format: 'p6-cutover-resolution-v2', ...common,
      cognitionCollisionResolutions: [collisionResolution('canonical-key', ['source-a', 'source-b'])],
    });
    expect(readCutoverResolutionManifest(v1Path)).toEqual({ format: 'p6-cutover-resolution-v1', ...common });
    expect(readCutoverResolutionManifest(v2Path)).toMatchObject({
      format: 'p6-cutover-resolution-v2', cognitionCollisionResolutions: [{ canonicalKey: 'canonical-key' }],
    });
  });
});
