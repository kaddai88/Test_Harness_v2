import fs from 'node:fs';
import path from 'node:path';
import {
  assertSnapshotArtifactBindingUnchanged, captureFinalLiveSourceVerification,
  capturePonrAuditBinding, captureSnapshotArtifactBinding, verifyFinalLiveSourcesNow,
  verifyRehearsalEvidenceBindings,
} from './evidence-bindings.js';
import { readCutoverResolutionManifest, runCutoverPreflight } from './preflight.js';
import { runPrePonrRollbackRehearsal, runSuccessPathRehearsal } from './rehearsal.js';
import { captureRehearsalSnapshot, restoreRehearsalSnapshot } from './snapshot.js';

function argumentsByName(values: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || !value) throw new TypeError('Arguments must be --name value pairs');
    result[name.slice(2)] = value;
  }
  return result;
}

function required(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (!value) throw new TypeError(`Missing --${name}`);
  return path.resolve(value);
}

function requiredIdentity(values: Record<string, string>, name: string): string {
  const value = values[name]?.trim();
  if (!value) throw new TypeError(`A GO rehearsal requires --${name}`);
  return value;
}

async function main(): Promise<void> {
  const args = argumentsByName(process.argv.slice(2));
  const datastore = required(args, 'datastore');
  const cognition = required(args, 'cognition');
  const profiles = required(args, 'profiles');
  const output = required(args, 'output');
  const resolutionPath = args.resolutions ? path.resolve(args.resolutions) : null;
  const snapshotRoot = path.join(output, 'snapshot');
  const liveSources = [datastore, cognition, profiles, ...(resolutionPath ? [resolutionPath] : [])];
  const snapshotSources = [
    { id: 'datastore', kind: 'datastore', sourcePath: datastore },
    { id: 'legacy-cognition', kind: 'legacy-cognition', sourcePath: cognition },
    { id: 'legacy-site-profiles', kind: 'legacy-site-profiles', sourcePath: profiles },
    ...(resolutionPath ? [{ id: 'resolution-manifest', kind: 'resolution-manifest' as const, sourcePath: resolutionPath }] : []),
  ] as const;
  const manifest = captureRehearsalSnapshot(snapshotSources, snapshotRoot);
  const initialSnapshotArtifact = captureSnapshotArtifactBinding(snapshotRoot);
  if (initialSnapshotArtifact.manifest.snapshotId !== manifest.snapshotId) {
    throw new Error('Snapshot identity changed immediately after capture');
  }
  const successClone = restoreRehearsalSnapshot(snapshotRoot, path.join(output, 'success-clone'), liveSources);
  const rollbackClone = restoreRehearsalSnapshot(snapshotRoot, path.join(output, 'rollback-clone'), liveSources);
  const resolutions = resolutionPath
    ? readCutoverResolutionManifest(successClone.pathsBySourceId['resolution-manifest']!)
    : { format: 'p6-cutover-resolution-v1' as const, legacyFileResolutions: [], explicitSiteProfiles: [] };
  const preflight = runCutoverPreflight({
    datastorePath: successClone.pathsBySourceId.datastore!,
    cognitionRoot: successClone.pathsBySourceId['legacy-cognition']!,
    siteProfileRoot: successClone.pathsBySourceId['legacy-site-profiles']!,
  }, resolutions.legacyFileResolutions, resolutions.explicitSiteProfiles,
  resolutions.format === 'p6-cutover-resolution-v2' ? resolutions.cognitionCollisionResolutions : []);
  let rehearsal: {
    successPath: Awaited<ReturnType<typeof runSuccessPathRehearsal>>;
    prePonrRollback: Awaited<ReturnType<typeof runPrePonrRollbackRehearsal>>;
  } | null = null;
  let identities: { artifact: string; configuration: string; operator: string } | null = null;
  if (preflight.status === 'go') {
    identities = {
      artifact: requiredIdentity(args, 'artifact-id'),
      configuration: requiredIdentity(args, 'configuration-id'),
      operator: requiredIdentity(args, 'operator'),
    };
    const shared = {
      liveSourcePaths: liveSources,
      datastoreSourceId: 'datastore',
      datastoreFileName: path.basename(datastore),
      legacySourceIds: ['legacy-cognition', 'legacy-site-profiles'],
      preflight,
    } as const;
    rehearsal = {
      successPath: await runSuccessPathRehearsal({ ...shared, cloneRoot: successClone.cloneRoot }),
      prePonrRollback: await runPrePonrRollbackRehearsal({
        ...shared, snapshotRoot, cloneRoot: rollbackClone.cloneRoot,
      }),
    };
  }
  const finalSnapshotArtifact = captureSnapshotArtifactBinding(snapshotRoot);
  assertSnapshotArtifactBindingUnchanged(initialSnapshotArtifact.binding, finalSnapshotArtifact.binding);
  const finalLiveSourceVerification = captureFinalLiveSourceVerification(initialSnapshotArtifact.manifest);
  const ponrAudit = rehearsal
    ? capturePonrAuditBinding(rehearsal.successPath.ponr.auditPath)
    : null;
  const bindings = {
    snapshot: initialSnapshotArtifact.binding,
    finalLiveSourceVerification,
    ponrAudit,
  };
  verifyRehearsalEvidenceBindings(bindings, rehearsal !== null);
  verifyFinalLiveSourcesNow(initialSnapshotArtifact.manifest, finalLiveSourceVerification);
  const evidence = {
    format: 'p6-rehearsal-evidence-v2',
    generatedAt: new Date().toISOString(),
    liveMutation: finalLiveSourceVerification.allMatchSnapshotBefore ? 'none' : 'detected',
    snapshot: {
      snapshotId: initialSnapshotArtifact.binding.snapshotId,
      manifestPath: initialSnapshotArtifact.binding.manifestPath,
      manifestSha256: initialSnapshotArtifact.binding.manifestSha256,
      manifestFormat: initialSnapshotArtifact.manifest.format,
      files: initialSnapshotArtifact.manifest.files.length,
      allBeforeCopyAfterHashesMatch: initialSnapshotArtifact.manifest.files.every(file => file.sourceSha256Before === file.copySha256
        && file.copySha256 === file.sourceSha256After),
      datastoreSemanticSha256: initialSnapshotArtifact.manifest.datastoreSemanticSha256,
    },
    restores: [successClone, rollbackClone].map(clone => ({
      cloneRoot: clone.cloneRoot,
      rawHashesVerified: clone.rawHashesVerified,
      datastoreSemanticSha256: clone.datastoreSemanticSha256,
      restoreMode: clone.restoreMode,
    })),
    preflight,
    identities,
    rehearsal: rehearsal ? {
      ...rehearsal,
      successPath: {
        ...rehearsal.successPath,
        ponr: { ...rehearsal.successPath.ponr, auditSha256: ponrAudit!.auditSha256 },
      },
    } : null,
    finalLiveSourceVerification,
    authorization: {
      liveCutover: 'not-authorized',
      phase2G: 'not-authorized',
    },
  };
  fs.writeFileSync(path.join(output, 'preflight-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ status: preflight.status === 'go' ? 'rehearsal-pass' : 'no-go', counts: preflight.counts,
    diagnostics: preflight.diagnostics.map(({ affectedSourceIds, ...diagnostic }) => ({ ...diagnostic,
      affectedRows: affectedSourceIds?.length ?? 1 })), evidence: path.join(output, 'preflight-evidence.json') }, null, 2)}\n`);
  if (preflight.status !== 'go') process.exitCode = 2;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
