import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type SnapshotSourceKind =
  | 'datastore'
  | 'legacy-cognition'
  | 'legacy-site-profiles'
  | 'resolution-manifest';

export interface RehearsalSnapshotSource {
  readonly id: string;
  readonly kind: SnapshotSourceKind;
  readonly sourcePath: string;
}

export type SnapshotFileRole = 'semantic-restore' | 'evidence-only-control-state';

export interface SnapshotFileEvidence {
  readonly sourceId: string;
  readonly sourceKind: SnapshotSourceKind;
  readonly role: SnapshotFileRole;
  readonly absoluteSourcePath: string;
  readonly relativeManifestPath: string;
  readonly byteLength: number;
  readonly sourceSha256Before: string;
  readonly copySha256: string;
  readonly sourceSha256After: string;
}

export interface RehearsalSnapshotManifest {
  readonly format: 'p6-rehearsal-snapshot-v2';
  readonly snapshotId: string;
  readonly capturedAt: string;
  readonly sources: readonly {
    id: string;
    kind: SnapshotSourceKind;
    absolutePath: string;
    rootType: 'file' | 'directory';
  }[];
  readonly files: readonly SnapshotFileEvidence[];
  readonly datastoreSemanticSha256: string;
}

export interface RestoredRehearsalClone {
  readonly cloneRoot: string;
  readonly pathsBySourceId: Readonly<Record<string, string>>;
  readonly rawHashesVerified: true;
  readonly datastoreSemanticSha256: string;
  readonly restoreMode: 'full' | 'semantic-only';
}

const SNAPSHOT_MANIFEST = 'snapshot-manifest.json';
const CLONE_MARKER = '.p6-isolated-clone.json';

export function rawFileSha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function rawTreeSha256(rootInput: string): string {
  const root = resolvedExisting(rootInput);
  const discovered = sourceFiles(root);
  const entries = discovered.files.map(filePath => ({
    path: discovered.rootType === 'file'
      ? path.basename(filePath)
      : path.relative(root, filePath).replaceAll('\\', '/'),
    sha256: rawFileSha256(filePath),
  }));
  return createHash('sha256').update(stableJson(entries)).digest('hex');
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Semantic snapshot contains a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  throw new TypeError('Semantic snapshot contains an unsupported value');
}

export function semanticJsonSha256(filePath: string): string {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  return createHash('sha256').update(stableJson(parsed)).digest('hex');
}

function resolvedExisting(input: string): string {
  return path.resolve(fs.realpathSync.native(path.resolve(input)));
}

function resolvedFuture(input: string): string {
  let candidate = path.resolve(input);
  const suffix: string[] = [];
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) throw new Error(`Cannot resolve destination ancestor: ${input}`);
    suffix.unshift(path.basename(candidate));
    candidate = parent;
  }
  return path.resolve(fs.realpathSync.native(candidate), ...suffix);
}

function isWithin(candidate: string, boundary: string): boolean {
  const relative = path.relative(boundary, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertSeparated(left: string, right: string, label: string): void {
  if (isWithin(left, right) || isWithin(right, left)) throw new Error(`${label} paths overlap: ${left} / ${right}`);
}

function sourceFiles(sourcePath: string): { rootType: 'file' | 'directory'; files: readonly string[] } {
  const stat = fs.lstatSync(sourcePath);
  if (stat.isSymbolicLink()) throw new Error(`Snapshot source must not be a symbolic link: ${sourcePath}`);
  if (stat.isFile()) return { rootType: 'file', files: [sourcePath] };
  if (!stat.isDirectory()) throw new Error(`Unsupported snapshot source: ${sourcePath}`);
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Snapshot source tree contains a symbolic link: ${entryPath}`);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
      else throw new Error(`Snapshot source tree contains an unsupported entry: ${entryPath}`);
    }
  };
  visit(sourcePath);
  return { rootType: 'directory', files };
}

function inventory(source: RehearsalSnapshotSource): {
  rootType: 'file' | 'directory';
  root: string;
  entries: readonly { absolutePath: string; relativePath: string; byteLength: number; sha256: string }[];
} {
  const root = resolvedExisting(source.sourcePath);
  const discovered = sourceFiles(root);
  return {
    rootType: discovered.rootType,
    root,
    entries: discovered.files.map(filePath => ({
      absolutePath: filePath,
      relativePath: discovered.rootType === 'file' ? path.basename(filePath) : path.relative(root, filePath),
      byteLength: fs.statSync(filePath).size,
      sha256: rawFileSha256(filePath),
    })),
  };
}

function sameInventory(
  before: readonly { relativePath: string; byteLength: number; sha256: string }[],
  after: readonly { relativePath: string; byteLength: number; sha256: string }[],
): boolean {
  return stableJson(before.map(({ relativePath, byteLength, sha256 }) => ({ relativePath, byteLength, sha256 })))
    === stableJson(after.map(({ relativePath, byteLength, sha256 }) => ({ relativePath, byteLength, sha256 })));
}

function validateSourceId(value: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) throw new TypeError(`Invalid snapshot source id: ${value}`);
  return value;
}

function safeRelativeParts(value: string, expectedSourceId: string): readonly string[] {
  const normalized = value.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.length < 3 || parts[0] !== 'payload' || parts[1] !== expectedSourceId
    || parts.some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe snapshot manifest path: ${value}`);
  }
  return parts;
}

const LEARNED_COGNITION_FILES = new Set(['episodes.json', 'semantic.json', 'procedures.json']);

function fileRole(source: RehearsalSnapshotSource, relativePath: string): SnapshotFileRole {
  if (source.kind !== 'legacy-cognition') return 'semantic-restore';
  return LEARNED_COGNITION_FILES.has(relativePath.replaceAll('\\', '/').toLowerCase())
    ? 'semantic-restore'
    : 'evidence-only-control-state';
}

function manifestIdentity(input: Omit<RehearsalSnapshotManifest, 'snapshotId'>): string {
  return createHash('sha256').update(stableJson(input)).digest('hex');
}

function cloneFilePath(cloneRoot: string, file: SnapshotFileEvidence): string {
  return path.join(cloneRoot, file.sourceId, ...safeRelativeParts(file.relativeManifestPath, file.sourceId).slice(2));
}

export function captureRehearsalSnapshot(
  sources: readonly RehearsalSnapshotSource[],
  snapshotRootInput: string,
): RehearsalSnapshotManifest {
  if (sources.length === 0) throw new TypeError('At least one snapshot source is required');
  const ids = sources.map(source => validateSourceId(source.id));
  if (new Set(ids).size !== ids.length) throw new TypeError('Snapshot source ids must be unique');
  if (sources.filter(source => source.kind === 'datastore').length !== 1) {
    throw new TypeError('Exactly one datastore source is required');
  }

  const before = sources.map(source => ({ source, inventory: inventory(source) }));
  const snapshotRoot = resolvedFuture(snapshotRootInput);
  for (const entry of before) assertSeparated(snapshotRoot, entry.inventory.root, 'Snapshot/live source');
  for (let left = 0; left < before.length; left++) {
    for (let right = left + 1; right < before.length; right++) {
      assertSeparated(before[left]!.inventory.root, before[right]!.inventory.root, 'Live source');
    }
  }
  if (fs.existsSync(snapshotRoot) && fs.readdirSync(snapshotRoot).length > 0) {
    throw new Error(`Snapshot destination must be absent or empty: ${snapshotRoot}`);
  }
  fs.mkdirSync(path.join(snapshotRoot, 'payload'), { recursive: true });

  const evidence: SnapshotFileEvidence[] = [];
  for (const entry of before) {
    for (const file of entry.inventory.entries) {
      const relativeManifestPath = path.join('payload', entry.source.id, file.relativePath).replaceAll('\\', '/');
      const destination = path.join(snapshotRoot, ...relativeManifestPath.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file.absolutePath, destination, fs.constants.COPYFILE_EXCL);
      evidence.push({
        sourceId: entry.source.id,
        sourceKind: entry.source.kind,
        role: fileRole(entry.source, file.relativePath),
        absoluteSourcePath: file.absolutePath,
        relativeManifestPath,
        byteLength: file.byteLength,
        sourceSha256Before: file.sha256,
        copySha256: rawFileSha256(destination),
        sourceSha256After: rawFileSha256(file.absolutePath),
      });
    }
  }

  const after = sources.map(source => inventory(source));
  for (let index = 0; index < before.length; index++) {
    if (!sameInventory(before[index]!.inventory.entries, after[index]!.entries)) {
      throw new Error(`Snapshot source changed during capture: ${before[index]!.inventory.root}`);
    }
  }
  if (evidence.some(file => file.sourceSha256Before !== file.copySha256
    || file.sourceSha256Before !== file.sourceSha256After)) {
    throw new Error('Snapshot hash verification failed');
  }
  const datastore = before.find(entry => entry.source.kind === 'datastore')!;
  const datastoreFile = datastore.inventory.entries[0];
  if (datastore.inventory.rootType !== 'file' || !datastoreFile) throw new TypeError('JSON datastore source must be one file');
  const copiedDatastore = path.join(snapshotRoot, 'payload', datastore.source.id, datastoreFile.relativePath);
  const manifestBase: Omit<RehearsalSnapshotManifest, 'snapshotId'> = {
    format: 'p6-rehearsal-snapshot-v2',
    capturedAt: new Date().toISOString(),
    sources: before.map(entry => ({ id: entry.source.id, kind: entry.source.kind,
      absolutePath: entry.inventory.root, rootType: entry.inventory.rootType })),
    files: evidence.sort((left, right) => left.relativeManifestPath.localeCompare(right.relativeManifestPath)),
    datastoreSemanticSha256: semanticJsonSha256(copiedDatastore),
  };
  const manifest: RehearsalSnapshotManifest = { ...manifestBase, snapshotId: manifestIdentity(manifestBase) };
  fs.writeFileSync(path.join(snapshotRoot, SNAPSHOT_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

export function readSnapshotManifest(snapshotRootInput: string): RehearsalSnapshotManifest {
  const snapshotRoot = resolvedExisting(snapshotRootInput);
  const parsed = JSON.parse(fs.readFileSync(path.join(snapshotRoot, SNAPSHOT_MANIFEST), 'utf8')) as RehearsalSnapshotManifest;
  if (parsed.format !== 'p6-rehearsal-snapshot-v2') throw new TypeError('Unsupported rehearsal snapshot format');
  const { snapshotId, ...manifestBase } = parsed;
  if (snapshotId !== manifestIdentity(manifestBase)) throw new Error('Snapshot manifest identity mismatch');
  const sourceIds = new Set(parsed.sources.map(source => validateSourceId(source.id)));
  if (sourceIds.size !== parsed.sources.length || parsed.sources.filter(source => source.kind === 'datastore').length !== 1) {
    throw new TypeError('Invalid rehearsal snapshot source inventory');
  }
  for (const file of parsed.files) {
    if (!sourceIds.has(file.sourceId)) throw new TypeError(`Unknown snapshot source id: ${file.sourceId}`);
    safeRelativeParts(file.relativeManifestPath, file.sourceId);
    if (file.role !== 'semantic-restore' && file.role !== 'evidence-only-control-state') {
      throw new TypeError(`Invalid snapshot file role: ${String(file.role)}`);
    }
  }
  return parsed;
}

export function restoreRehearsalSnapshot(
  snapshotRootInput: string,
  cloneRootInput: string,
  additionalLiveSourcePaths: readonly string[] = [],
): RestoredRehearsalClone {
  const snapshotRoot = resolvedExisting(snapshotRootInput);
  const manifest = readSnapshotManifest(snapshotRoot);
  const cloneRoot = resolvedFuture(cloneRootInput);
  assertSeparated(cloneRoot, snapshotRoot, 'Clone/snapshot');
  for (const source of manifest.sources) assertSeparated(cloneRoot, resolvedExisting(source.absolutePath), 'Clone/manifest source');
  for (const sourcePath of additionalLiveSourcePaths) assertSeparated(cloneRoot, resolvedExisting(sourcePath), 'Clone/additional live source');
  if (fs.existsSync(cloneRoot) && fs.readdirSync(cloneRoot).length > 0) {
    throw new Error(`Clone destination must be absent or empty: ${cloneRoot}`);
  }
  fs.mkdirSync(cloneRoot, { recursive: true });
  const pathsBySourceId: Record<string, string> = {};
  for (const source of manifest.sources) {
    const destinationRoot = path.join(cloneRoot, source.id);
    pathsBySourceId[source.id] = source.rootType === 'file'
      ? path.join(destinationRoot, path.basename(source.absolutePath))
      : destinationRoot;
  }
  for (const file of manifest.files) {
    const manifestParts = safeRelativeParts(file.relativeManifestPath, file.sourceId);
    const source = path.join(snapshotRoot, ...manifestParts);
    if (rawFileSha256(source) !== file.copySha256) throw new Error(`Snapshot payload hash mismatch: ${file.relativeManifestPath}`);
    const relativeWithinSource = manifestParts.slice(2);
    const destination = path.join(cloneRoot, file.sourceId, ...relativeWithinSource);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
    if (rawFileSha256(destination) !== file.copySha256) throw new Error(`Restored payload hash mismatch: ${file.relativeManifestPath}`);
  }
  const datastore = manifest.sources.find(source => source.kind === 'datastore')!;
  const datastorePath = pathsBySourceId[datastore.id]!;
  const semanticHash = semanticJsonSha256(datastorePath);
  if (semanticHash !== manifest.datastoreSemanticSha256) throw new Error('Restored datastore semantic hash mismatch');
  fs.writeFileSync(path.join(cloneRoot, CLONE_MARKER), `${JSON.stringify({
    format: 'p6-isolated-clone-v2', snapshotRoot, snapshotId: manifest.snapshotId,
    sourcePaths: manifest.sources.map(source => source.absolutePath).sort(), restoredAt: new Date().toISOString(),
  }, null, 2)}\n`, { flag: 'wx' });
  return { cloneRoot, pathsBySourceId, rawHashesVerified: true,
    datastoreSemanticSha256: semanticHash, restoreMode: 'full' };
}

export function assertIsolatedClone(cloneRootInput: string, additionalLiveSourcePaths: readonly string[] = []): string {
  const cloneRoot = resolvedExisting(cloneRootInput);
  const marker = JSON.parse(fs.readFileSync(path.join(cloneRoot, CLONE_MARKER), 'utf8')) as {
    format?: string; snapshotRoot?: string; snapshotId?: string; sourcePaths?: string[];
  };
  if (marker.format !== 'p6-isolated-clone-v2' || typeof marker.snapshotRoot !== 'string'
    || typeof marker.snapshotId !== 'string' || !Array.isArray(marker.sourcePaths)) {
    throw new Error('Rehearsal target lacks a bound isolated-clone marker');
  }
  const snapshotRoot = resolvedExisting(marker.snapshotRoot);
  const manifest = readSnapshotManifest(snapshotRoot);
  const sourcePaths = manifest.sources.map(source => resolvedExisting(source.absolutePath)).sort();
  if (marker.snapshotId !== manifest.snapshotId || stableJson(marker.sourcePaths) !== stableJson(sourcePaths)) {
    throw new Error('Isolated-clone marker does not match its snapshot/source identity');
  }
  assertSeparated(cloneRoot, snapshotRoot, 'Clone/snapshot');
  for (const sourcePath of sourcePaths) assertSeparated(cloneRoot, sourcePath, 'Clone/manifest source');
  for (const sourcePath of additionalLiveSourcePaths) assertSeparated(cloneRoot, resolvedExisting(sourcePath), 'Clone/additional live source');
  return cloneRoot;
}

export function snapshotRoleSha256(
  snapshotRootInput: string,
  cloneRootInput: string,
  role: SnapshotFileRole,
): string {
  const snapshotRoot = resolvedExisting(snapshotRootInput);
  const cloneRoot = assertIsolatedClone(cloneRootInput);
  const manifest = readSnapshotManifest(snapshotRoot);
  const entries = manifest.files.filter(file => file.role === role).map(file => ({
    path: file.relativeManifestPath,
    sha256: rawFileSha256(cloneFilePath(cloneRoot, file)),
  }));
  return createHash('sha256').update(stableJson(entries)).digest('hex');
}

export function resetIsolatedCloneFromSnapshot(
  snapshotRootInput: string,
  cloneRootInput: string,
  additionalLiveSourcePaths: readonly string[] = [],
): RestoredRehearsalClone {
  const snapshotRoot = resolvedExisting(snapshotRootInput);
  const cloneRoot = assertIsolatedClone(cloneRootInput, additionalLiveSourcePaths);
  const manifest = readSnapshotManifest(snapshotRoot);
  const marker = JSON.parse(fs.readFileSync(path.join(cloneRoot, CLONE_MARKER), 'utf8')) as { snapshotId?: string };
  if (marker.snapshotId !== manifest.snapshotId) throw new Error('Rollback snapshot does not own this clone');
  for (const file of manifest.files.filter(candidate => candidate.role === 'semantic-restore')) {
    const source = path.join(snapshotRoot, ...safeRelativeParts(file.relativeManifestPath, file.sourceId));
    if (rawFileSha256(source) !== file.copySha256) throw new Error(`Snapshot payload hash mismatch: ${file.relativeManifestPath}`);
    const destination = cloneFilePath(cloneRoot, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    if (rawFileSha256(destination) !== file.copySha256) {
      throw new Error(`Semantic rollback hash mismatch: ${file.relativeManifestPath}`);
    }
  }
  const datastore = manifest.sources.find(source => source.kind === 'datastore')!;
  const datastorePath = datastore.rootType === 'file'
    ? path.join(cloneRoot, datastore.id, path.basename(datastore.absolutePath))
    : path.join(cloneRoot, datastore.id);
  const semanticHash = semanticJsonSha256(datastorePath);
  if (semanticHash !== manifest.datastoreSemanticSha256) throw new Error('Rollback datastore semantic hash mismatch');
  return { cloneRoot, pathsBySourceId: Object.fromEntries(manifest.sources.map(source => [source.id,
    source.rootType === 'file' ? path.join(cloneRoot, source.id, path.basename(source.absolutePath)) : path.join(cloneRoot, source.id)])),
    rawHashesVerified: true, datastoreSemanticSha256: semanticHash, restoreMode: 'semantic-only' };
}
