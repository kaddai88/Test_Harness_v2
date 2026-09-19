import fs from 'node:fs';
import path from 'node:path';
import { createAuthorityServices } from '../authority/composition.js';
import type {
  AuthorityCommandPolicy, ExplicitAuthorityCommand, LegacyImportCommand,
} from '../authority/commands.js';
import { ExplicitAuthorityCommandBoundary } from '../authority/commands.js';
import { CognitionLegacyImporter, type CognitionImportReport } from '../authority/cognition-importer.js';
import {
  SiteProfileAuthorityExporter, SiteProfileLegacyImporter, type SiteProfileImportReport,
} from '../authority/site-profile-importer.js';
import { SnapshotAuthorityStorage, authorityDataFrom } from '../authority/storage.js';
import { JsonFileDatabase } from '../providers/json-file.js';
import type { CutoverPreflightReport } from './preflight.js';
import {
  assertIsolatedClone, rawFileSha256, rawTreeSha256, resetIsolatedCloneFromSnapshot,
  semanticJsonSha256, snapshotRoleSha256,
} from './snapshot.js';

export type RehearsalState =
  | 'PREPARED'
  | 'FROZEN'
  | 'IMPORTING_SITE_PROFILES'
  | 'IMPORTING_COGNITION'
  | 'VERIFYING'
  | 'WRITERS_ENABLED_TRAFFIC_FROZEN'
  | 'LIVE_PRE_PONR'
  | 'LIVE_POST_PONR'
  | 'ROLLED_BACK_PRE_PONR';

export interface RehearsalAuditEvent {
  readonly state: RehearsalState;
  readonly detail: string;
}

interface PonrIdentity {
  readonly domain: 'site-profile';
  readonly operation: 'update';
  readonly profileId: string;
  readonly canonicalIdentity: string;
  readonly idempotencyKey: string;
  readonly auditPath: string;
}

export type PonrEvidence = PonrIdentity & { readonly attemptedAt: string } & (
  | { readonly outcome: 'accepted'; readonly acceptedAt: string }
  | { readonly outcome: 'ambiguous'; readonly acceptedAt?: never }
);

export interface SuccessPathRehearsalResult {
  readonly status: 'pass';
  readonly states: readonly RehearsalAuditEvent[];
  readonly siteProfileImport: SiteProfileImportReport;
  readonly cognitionImports: readonly CognitionImportReport[];
  readonly replayInserted: 0;
  readonly replaySemanticDiff: 'empty';
  readonly importerAfterRevoke: 'rejected';
  readonly restartRead: 'pass';
  readonly projectionAuthorityDiff: 'empty';
  readonly legacyInputMutation: 'zero';
  readonly idempotentReplay: 'pass';
  readonly payloadConflict: 'rejected';
  readonly ponr: Extract<PonrEvidence, { outcome: 'accepted' }> & { readonly semanticSha256: string };
}

export interface RollbackRehearsalResult {
  readonly status: 'pass';
  readonly states: readonly RehearsalAuditEvent[];
  readonly baselineRawSha256: string;
  readonly baselineSemanticSha256: string;
  readonly restoredRawSha256: string;
  readonly restoredSemanticSha256: string;
  readonly controlStatePreserved: true;
  readonly exactBaselineRestored: true;
}

export class PostPonrRehearsalError extends Error {
  readonly postPonr = true;
  constructor(
    message: string,
    readonly states: readonly RehearsalAuditEvent[],
    readonly ponr: PonrEvidence,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'PostPonrRehearsalError';
  }
}

class RehearsalCommandPolicy implements AuthorityCommandPolicy {
  #importsEnabled = true;
  readonly auditEvents: ExplicitAuthorityCommand[] = [];

  revokeImports(): void { this.#importsEnabled = false; }

  async authorize(command: ExplicitAuthorityCommand): Promise<boolean> {
    return command.command === 'authority-export' || this.#importsEnabled;
  }

  async verifyScope(command: LegacyImportCommand): Promise<boolean> {
    return this.#importsEnabled && command.scopeProofReference.startsWith('p6-rehearsal:');
  }

  async audit(command: ExplicitAuthorityCommand): Promise<void> {
    this.auditEvents.push(structuredClone(command));
  }
}

function command(domain: 'site-profile' | 'cognition', scopeReference: string): LegacyImportCommand {
  return {
    command: 'legacy-import', domain, mode: 'insert-only', sourceReference: 'p6-rehearsal-snapshot',
    scopeReference, scopeProofReference: `p6-rehearsal:${scopeReference}`,
    actor: { actorId: 'p6-rehearsal-operator', reason: 'isolated clone rehearsal' },
    allowExistingAuthorityUpdate: false,
  };
}

function runtime(datastorePath: string, policy: AuthorityCommandPolicy) {
  const database = new JsonFileDatabase(datastorePath);
  const storage = new SnapshotAuthorityStorage(
    () => authorityDataFrom(database.getData()),
    (next, before) => database.commitAuthority(next, before),
  );
  return { database, storage, services: createAuthorityServices(storage, policy) };
}

function requireGo(preflight: CutoverPreflightReport): void {
  if (preflight.status !== 'go' || preflight.diagnostics.length > 0) {
    throw new Error('Rehearsal is blocked by cutover preflight');
  }
}

function cloneDatastorePath(cloneRoot: string, datastoreSourceId: string, originalName: string): string {
  return path.join(cloneRoot, datastoreSourceId, originalName);
}

async function importAll(
  datastorePath: string,
  preflight: CutoverPreflightReport,
  events: RehearsalAuditEvent[],
) {
  const policy = new RehearsalCommandPolicy();
  const active = runtime(datastorePath, policy);
  const boundary = new ExplicitAuthorityCommandBoundary(policy);
  events.push({ state: 'IMPORTING_SITE_PROFILES', detail: 'SiteProfile insert-only importer entered first' });
  const siteImporter = new SiteProfileLegacyImporter(active.services.sites, boundary);
  const siteProfileImport = await siteImporter.run(command('site-profile', 'all-approved-site-profiles'), preflight.siteProfileRows);
  if (siteProfileImport.blocked !== 0 || siteProfileImport.inserted + siteProfileImport.skipped !== preflight.siteProfileRows.length) {
    throw new Error('SiteProfile import count reconciliation failed');
  }

  events.push({ state: 'IMPORTING_COGNITION', detail: 'Cognition import entered after SiteProfile reconciliation' });
  const cognitionImporter = new CognitionLegacyImporter(active.services.cognition, boundary);
  const cognitionImports: CognitionImportReport[] = [];
  for (const [siteId, rows] of Object.entries(preflight.cognitionRowsBySiteId).sort(([left], [right]) => left.localeCompare(right))) {
    const report = await cognitionImporter.run(command('cognition', siteId), rows);
    if (report.blocked !== 0 || report.inserted + report.skipped !== rows.length) {
      throw new Error(`Cognition import count reconciliation failed for ${siteId}`);
    }
    cognitionImports.push(report);
  }
  return { active, policy, boundary, siteImporter, cognitionImporter, siteProfileImport, cognitionImports };
}

export async function runSuccessPathRehearsal(input: {
  readonly cloneRoot: string;
  readonly liveSourcePaths: readonly string[];
  readonly datastoreSourceId: string;
  readonly datastoreFileName: string;
  readonly legacySourceIds: readonly string[];
  readonly preflight: CutoverPreflightReport;
}): Promise<SuccessPathRehearsalResult> {
  const cloneRoot = assertIsolatedClone(input.cloneRoot, input.liveSourcePaths);
  requireGo(input.preflight);
  const datastorePath = cloneDatastorePath(cloneRoot, input.datastoreSourceId, input.datastoreFileName);
  const legacyHashesBefore = Object.fromEntries(input.legacySourceIds.map(sourceId =>
    [sourceId, rawTreeSha256(path.join(cloneRoot, sourceId))]));
  const states: RehearsalAuditEvent[] = [
    { state: 'PREPARED', detail: 'Isolated clone marker and preflight GO verified' },
    { state: 'FROZEN', detail: 'Clone-only mutation boundary established; no live traffic exists' },
  ];
  const imported = await importAll(datastorePath, input.preflight, states);
  states.push({ state: 'VERIFYING', detail: 'Import counts reconciled; replay and restart validation started' });

  const afterImport = semanticJsonSha256(datastorePath);
  const replaySite = await imported.siteImporter.run(command('site-profile', 'all-approved-site-profiles'), input.preflight.siteProfileRows);
  let replayInserted = replaySite.inserted;
  for (const [siteId, rows] of Object.entries(input.preflight.cognitionRowsBySiteId).sort(([left], [right]) => left.localeCompare(right))) {
    replayInserted += (await imported.cognitionImporter.run(command('cognition', siteId), rows)).inserted;
  }
  if (replayInserted !== 0 || semanticJsonSha256(datastorePath) !== afterImport) throw new Error('Importer replay changed authority');

  imported.policy.revokeImports();
  let rejected = false;
  try {
    await imported.siteImporter.run(command('site-profile', 'all-approved-site-profiles'), []);
  } catch {
    rejected = true;
  }
  if (!rejected || semanticJsonSha256(datastorePath) !== afterImport) throw new Error('Revoked importer remained available or mutated authority');

  const reloadedPolicy = new RehearsalCommandPolicy();
  reloadedPolicy.revokeImports();
  const reloaded = runtime(datastorePath, reloadedPolicy);
  await reloaded.services.sites.list();
  const afterRestartRead = semanticJsonSha256(datastorePath);
  if (afterRestartRead !== afterImport) throw new Error('Restart/read changed semantic authority');
  const exporter = new SiteProfileAuthorityExporter(reloaded.services.sites, new ExplicitAuthorityCommandBoundary(reloadedPolicy));
  await exporter.prepare({ command: 'authority-export', domain: 'site-profile', destinationReference: 'clone-projection-only',
    actor: { actorId: 'p6-rehearsal-operator', reason: 'projection rebuild rehearsal' } }, '2026-09-18T00:00:00.000Z');
  if (semanticJsonSha256(datastorePath) !== afterImport) throw new Error('Projection preparation mutated authority');

  states.push({ state: 'WRITERS_ENABLED_TRAFFIC_FROZEN', detail: 'Clone authority services reloaded; importer grant revoked' });
  states.push({ state: 'LIVE_PRE_PONR', detail: 'Clone-only pre-PONR semantic hash captured' });
  const profile = (await reloaded.services.sites.list())[0];
  if (!profile) throw new Error('Success rehearsal requires at least one SiteProfile authority record');
  const idempotencyKey = `p6-rehearsal-ponr:${profile.id}`;
  const update = {
    scope: { kind: 'profile' as const, profileId: profile.id },
    name: `${profile.name} [P6 rehearsal]`,
    idempotency: { idempotencyKey },
  };
  const auditPath = path.join(cloneRoot, 'p6-ponr-audit.jsonl');
  const ponrIdentity = { domain: 'site-profile' as const, operation: 'update' as const,
    profileId: profile.id, canonicalIdentity: profile.canonicalOriginKey ?? profile.id, idempotencyKey };
  const attemptedAt = new Date().toISOString();
  fs.appendFileSync(auditPath, `${JSON.stringify({ state: 'LIVE_PRE_PONR', ...ponrIdentity, attemptedAt })}\n`, 'utf8');
  let first: { readonly replayed: boolean };
  try {
    first = await reloaded.services.sites.update(update);
  } catch (error) {
    const ponr: PonrEvidence = { ...ponrIdentity, outcome: 'ambiguous', attemptedAt, auditPath };
    states.push({ state: 'LIVE_POST_PONR',
      detail: `Controlled clone-only mutation completion is ambiguous for SiteProfile ${profile.id} after ${attemptedAt}` });
    try {
      fs.appendFileSync(auditPath, `${JSON.stringify({ state: 'LIVE_POST_PONR', ...ponr })}\n`, 'utf8');
    } catch {
      // In-memory evidence still keeps the failure post-PONR when durable audit append also fails.
    }
    throw new PostPonrRehearsalError(
      'First authority mutation completion is ambiguous and must be treated as post-PONR',
      structuredClone(states), ponr, error,
    );
  }
  const acceptedAt = new Date().toISOString();
  const ponr: Extract<PonrEvidence, { outcome: 'accepted' }> = {
    ...ponrIdentity, outcome: 'accepted', attemptedAt, acceptedAt, auditPath,
  };
  states.push({ state: 'LIVE_POST_PONR',
    detail: `Controlled clone-only mutation accepted for SiteProfile ${profile.id} at ${acceptedAt}` });
  try {
    fs.appendFileSync(auditPath, `${JSON.stringify({ state: 'LIVE_POST_PONR', ...ponr })}\n`, 'utf8');
    if (first.replayed) throw new Error('Controlled PONR mutation unexpectedly replayed');
    const ponrHash = semanticJsonSha256(datastorePath);
    const replay = await reloaded.services.sites.update(update);
    if (!replay.replayed) throw new Error('Authority mutation replay semantics failed');
    let payloadConflict = false;
    try {
      await reloaded.services.sites.update({ ...update, name: `${profile.name} [conflict]` });
    } catch {
      payloadConflict = true;
    }
    if (!payloadConflict) throw new Error('Authority mutation payload conflict was accepted');
    for (const sourceId of input.legacySourceIds) {
      if (rawTreeSha256(path.join(cloneRoot, sourceId)) !== legacyHashesBefore[sourceId]) {
        throw new Error(`Legacy input mutated during rehearsal: ${sourceId}`);
      }
    }
    return {
      status: 'pass', states, siteProfileImport: imported.siteProfileImport,
      cognitionImports: imported.cognitionImports, replayInserted: 0, replaySemanticDiff: 'empty',
      importerAfterRevoke: 'rejected', restartRead: 'pass', projectionAuthorityDiff: 'empty',
      legacyInputMutation: 'zero', idempotentReplay: 'pass', payloadConflict: 'rejected',
      ponr: { ...ponr, semanticSha256: ponrHash },
    };
  } catch (error) {
    throw new PostPonrRehearsalError('Success-path rehearsal failed after PONR', structuredClone(states), ponr, error);
  }
}

export async function runPrePonrRollbackRehearsal(input: {
  readonly snapshotRoot: string;
  readonly cloneRoot: string;
  readonly liveSourcePaths: readonly string[];
  readonly datastoreSourceId: string;
  readonly datastoreFileName: string;
  readonly legacySourceIds: readonly string[];
  readonly preflight: CutoverPreflightReport;
}): Promise<RollbackRehearsalResult> {
  const cloneRoot = assertIsolatedClone(input.cloneRoot, input.liveSourcePaths);
  requireGo(input.preflight);
  const datastorePath = cloneDatastorePath(cloneRoot, input.datastoreSourceId, input.datastoreFileName);
  const baselineRawSha256 = rawFileSha256(datastorePath);
  const baselineSemanticSha256 = semanticJsonSha256(datastorePath);
  const controlStateBefore = snapshotRoleSha256(input.snapshotRoot, cloneRoot, 'evidence-only-control-state');
  const states: RehearsalAuditEvent[] = [
    { state: 'PREPARED', detail: 'Rollback clone baseline verified' },
    { state: 'FROZEN', detail: 'Clone-only mutation boundary established' },
  ];
  const imported = await importAll(datastorePath, input.preflight, states);
  imported.policy.revokeImports();
  states.push({ state: 'VERIFYING', detail: 'Import reports reconciled before writer preparation' });
  states.push({ state: 'WRITERS_ENABLED_TRAFFIC_FROZEN', detail: 'Rollback initiated before any authority-only mutation' });
  resetIsolatedCloneFromSnapshot(input.snapshotRoot, cloneRoot, input.liveSourcePaths);
  const restoredRawSha256 = rawFileSha256(datastorePath);
  const restoredSemanticSha256 = semanticJsonSha256(datastorePath);
  const controlStateAfter = snapshotRoleSha256(input.snapshotRoot, cloneRoot, 'evidence-only-control-state');
  if (restoredRawSha256 !== baselineRawSha256 || restoredSemanticSha256 !== baselineSemanticSha256) {
    throw new Error('Pre-PONR rollback did not restore exact raw and semantic datastore baseline');
  }
  if (controlStateAfter !== controlStateBefore) throw new Error('Pre-PONR rollback overwrote retained control state');
  states.push({ state: 'ROLLED_BACK_PRE_PONR', detail: 'Exact snapshot baseline restored before PONR' });
  return { status: 'pass', states, baselineRawSha256, baselineSemanticSha256,
    restoredRawSha256, restoredSemanticSha256, controlStatePreserved: true, exactBaselineRestored: true };
}
