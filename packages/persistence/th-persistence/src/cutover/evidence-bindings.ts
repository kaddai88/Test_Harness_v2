import fs from 'node:fs';
import path from 'node:path';
import {
  rawFileSha256, readSnapshotManifest, type RehearsalSnapshotManifest,
} from './snapshot.js';

export interface FinalLiveSourceVerification {
  readonly checkedAt: string;
  readonly snapshotId: string;
  readonly allMatchSnapshotBefore: boolean;
  readonly files: readonly {
    readonly sourcePath: string;
    readonly snapshotBeforeSha256: string;
    readonly postRehearsalSha256: string;
    readonly matches: boolean;
  }[];
}

export interface SnapshotArtifactBinding {
  readonly snapshotId: string;
  readonly manifestPath: string;
  readonly manifestSha256: string;
}

export interface PonrAuditBinding {
  readonly auditPath: string;
  readonly auditSha256: string;
}

export interface RehearsalEvidenceBindings {
  readonly snapshot: SnapshotArtifactBinding;
  readonly finalLiveSourceVerification: FinalLiveSourceVerification;
  readonly ponrAudit: PonrAuditBinding | null;
}

export function assertSnapshotArtifactBindingUnchanged(
  initial: SnapshotArtifactBinding,
  final: SnapshotArtifactBinding,
): void {
  if (final.snapshotId !== initial.snapshotId
    || final.manifestPath !== initial.manifestPath
    || final.manifestSha256 !== initial.manifestSha256) {
    throw new Error('Snapshot manifest changed during rehearsal');
  }
}

function canonicalExistingFile(filePath: string): string {
  const absolute = path.resolve(filePath);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Final live source is not a regular file: ${absolute}`);
  const canonical = path.resolve(fs.realpathSync.native(absolute));
  if (process.platform === 'win32'
    ? canonical.toLowerCase() !== absolute.toLowerCase()
    : canonical !== absolute) {
    throw new Error(`Final live source path mismatch: expected=${absolute} actual=${canonical}`);
  }
  return canonical;
}

function currentSourceFiles(manifest: RehearsalSnapshotManifest): readonly string[] {
  const files: string[] = [];
  const visit = (entryPath: string): void => {
    const absolute = path.resolve(entryPath);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Final live source contains a symbolic link: ${absolute}`);
    if (stat.isFile()) {
      files.push(canonicalExistingFile(absolute));
      return;
    }
    if (!stat.isDirectory()) throw new Error(`Final live source contains an unsupported entry: ${absolute}`);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      visit(path.join(absolute, entry.name));
    }
  };
  for (const source of manifest.sources) visit(source.absolutePath);
  return files.sort();
}

function assertExactLiveSourceInventory(manifest: RehearsalSnapshotManifest): void {
  const expectedPaths = manifest.files.map(file => file.absoluteSourcePath).sort();
  const actualPaths = currentSourceFiles(manifest);
  if (actualPaths.length !== expectedPaths.length
    || actualPaths.some((filePath, index) => filePath !== expectedPaths[index])) {
    throw new Error('Final live-source file inventory does not match the snapshot manifest');
  }
}

export function captureFinalLiveSourceVerification(
  manifest: RehearsalSnapshotManifest,
): FinalLiveSourceVerification {
  assertExactLiveSourceInventory(manifest);
  const files = manifest.files.map(file => {
    const sourcePath = canonicalExistingFile(file.absoluteSourcePath);
    const postRehearsalSha256 = rawFileSha256(sourcePath);
    return {
      sourcePath,
      snapshotBeforeSha256: file.sourceSha256Before,
      postRehearsalSha256,
      matches: postRehearsalSha256 === file.sourceSha256Before,
    };
  });
  return {
    checkedAt: new Date().toISOString(),
    snapshotId: manifest.snapshotId,
    allMatchSnapshotBefore: files.every(file => file.matches),
    files,
  };
}

export function captureSnapshotArtifactBinding(snapshotRoot: string): {
  readonly manifest: RehearsalSnapshotManifest;
  readonly binding: SnapshotArtifactBinding;
} {
  const root = path.resolve(fs.realpathSync.native(path.resolve(snapshotRoot)));
  const manifestPath = path.join(root, 'snapshot-manifest.json');
  const manifest = readSnapshotManifest(root);
  return {
    manifest,
    binding: {
      snapshotId: manifest.snapshotId,
      manifestPath,
      manifestSha256: rawFileSha256(manifestPath),
    },
  };
}

export function capturePonrAuditBinding(auditPath: string): PonrAuditBinding {
  const canonical = canonicalExistingFile(auditPath);
  return { auditPath: canonical, auditSha256: rawFileSha256(canonical) };
}

export function verifyRehearsalEvidenceBindings(
  bindings: RehearsalEvidenceBindings,
  requirePonrAudit = true,
): void {
  const manifestPath = canonicalExistingFile(bindings.snapshot.manifestPath);
  if (path.basename(manifestPath) !== 'snapshot-manifest.json') throw new Error('Unexpected snapshot manifest filename');
  if (rawFileSha256(manifestPath) !== bindings.snapshot.manifestSha256) {
    throw new Error('Snapshot manifest SHA-256 binding mismatch');
  }
  const manifest = readSnapshotManifest(path.dirname(manifestPath));
  if (manifest.snapshotId !== bindings.snapshot.snapshotId
    || bindings.finalLiveSourceVerification.snapshotId !== manifest.snapshotId) {
    throw new Error('Snapshot identity binding mismatch');
  }

  const verification = bindings.finalLiveSourceVerification;
  if (!verification.checkedAt || !Number.isFinite(Date.parse(verification.checkedAt))) {
    throw new Error('Final live-source verification timestamp is invalid');
  }
  if (!verification.allMatchSnapshotBefore || verification.files.some(file => !file.matches)) {
    throw new Error('Final live-source verification did not match snapshot-before hashes');
  }
  if (verification.files.length !== manifest.files.length) {
    throw new Error('Final live-source verification file count mismatch');
  }

  const verificationByPath = new Map(verification.files.map(file => [file.sourcePath, file] as const));
  if (verificationByPath.size !== verification.files.length) {
    throw new Error('Final live-source verification contains duplicate paths');
  }
  for (const snapshotFile of manifest.files) {
    const sourcePath = snapshotFile.absoluteSourcePath;
    const finalFile = verificationByPath.get(sourcePath);
    if (!finalFile || finalFile.snapshotBeforeSha256 !== snapshotFile.sourceSha256Before
      || finalFile.postRehearsalSha256 !== finalFile.snapshotBeforeSha256) {
      throw new Error(`Final live-source binding mismatch: ${sourcePath}`);
    }
  }

  if (requirePonrAudit && !bindings.ponrAudit) throw new Error('PONR audit binding is required');
  if (bindings.ponrAudit) {
    const auditPath = canonicalExistingFile(bindings.ponrAudit.auditPath);
    if (rawFileSha256(auditPath) !== bindings.ponrAudit.auditSha256) {
      throw new Error('PONR audit SHA-256 binding mismatch');
    }
  }
}

export function verifyFinalLiveSourcesNow(
  manifest: RehearsalSnapshotManifest,
  verification: FinalLiveSourceVerification,
): void {
  assertExactLiveSourceInventory(manifest);
  const verificationByPath = new Map(verification.files.map(file => [file.sourcePath, file] as const));
  if (verificationByPath.size !== verification.files.length) {
    throw new Error('Final live-source verification contains duplicate paths');
  }
  for (const snapshotFile of manifest.files) {
    const sourcePath = canonicalExistingFile(snapshotFile.absoluteSourcePath);
    const finalFile = verificationByPath.get(sourcePath);
    if (!finalFile || rawFileSha256(sourcePath) !== finalFile.postRehearsalSha256) {
      throw new Error(`Current live source differs from final verification: ${sourcePath}`);
    }
  }
}
