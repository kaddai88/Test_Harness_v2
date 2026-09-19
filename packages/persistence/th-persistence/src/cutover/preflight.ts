import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { normalizeCanonicalOrigin, readLegacyHostname, readLegacySiteProfileFilename } from '@test-harness/th-core';
import { mapLegacyCognitionRows, type LegacyCognitionInput } from '@test-harness/th-cognition';
import type { CognitionAuthorityCreateInput } from '../authority/cognition.js';
import type { LegacySiteProfileImportRow } from '../authority/site-profile-importer.js';
import type {
  CognitionEpisodeRow, CognitionKnowledgeRow, CognitionPatternRow, CognitionProcedureRow, SiteProfileRow,
} from '../schema.js';
import { stableJson } from './snapshot.js';

export interface CutoverPreflightPaths {
  readonly datastorePath: string;
  readonly cognitionRoot: string;
  readonly siteProfileRoot: string;
}

export interface SiteProfileResolutionInput {
  readonly sourceFile: string;
  readonly profileId: string;
  readonly resolvedCanonicalOrigin: string;
  readonly resolutionBasis: string;
  readonly approvedBy: string;
}

export interface CognitionCollisionResolution {
  readonly canonicalKey: string;
  readonly strategy: 'equivalent-semantic-collapse';
  readonly sourceIds: readonly string[];
  readonly representativePolicy: 'latest-observation-v1';
  readonly resolutionBasis: string;
  readonly approvedBy: string;
}

export interface CutoverResolutionManifestV1 {
  readonly format: 'p6-cutover-resolution-v1';
  readonly legacyFileResolutions: readonly SiteProfileResolutionInput[];
  readonly explicitSiteProfiles: readonly LegacySiteProfileImportRow[];
}

export interface CutoverResolutionManifestV2 {
  readonly format: 'p6-cutover-resolution-v2';
  readonly legacyFileResolutions: readonly SiteProfileResolutionInput[];
  readonly explicitSiteProfiles: readonly LegacySiteProfileImportRow[];
  readonly cognitionCollisionResolutions: readonly CognitionCollisionResolution[];
}

export type CutoverResolutionManifest = CutoverResolutionManifestV1 | CutoverResolutionManifestV2;

export interface CutoverPreflightDiagnostic {
  readonly code: 'invalid-record' | 'duplicate' | 'collision' | 'orphan-site-scope' | 'semantic-mismatch';
  readonly domain: 'site-profile' | 'cognition' | 'idempotency';
  readonly sourceId: string;
  readonly detail: string;
  readonly affectedSourceIds?: readonly string[];
}

export interface CutoverPreflightReport {
  readonly status: 'go' | 'no-go';
  readonly diagnostics: readonly CutoverPreflightDiagnostic[];
  readonly resolvedCollisions: readonly {
    readonly canonicalKey: string;
    readonly sourceIds: readonly string[];
    readonly sourceCount: number;
    readonly outputRowCount: 1;
    readonly collapsedExcessRows: number;
    readonly representativeSourceId: string;
    readonly representativePolicy: 'latest-observation-v1';
    readonly semanticHash: string;
    readonly resolutionBasis: string;
    readonly approvedBy: string;
  }[];
  readonly counts: {
    readonly authoritySiteProfiles: number;
    readonly legacySiteProfiles: number;
    readonly siteProfileImports: number;
    readonly cognitionInputs: number;
    readonly cognitionImports: number;
    readonly resolvedCollisionGroups: number;
    readonly collapsedExcessRows: number;
    readonly excludedControlFiles: number;
  };
  readonly siteProfileRows: readonly LegacySiteProfileImportRow[];
  readonly cognitionRowsBySiteId: Readonly<Record<string, readonly CognitionAuthorityCreateInput[]>>;
  readonly excludedControlFiles: readonly string[];
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value as JsonRecord;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label} must be a finite number`);
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : text(value, label);
}

function jsonArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function isoFromEpoch(value: unknown, label: string): string {
  const epoch = numberValue(value, label);
  const result = new Date(epoch).toISOString();
  if (!Number.isFinite(Date.parse(result))) throw new TypeError(`${label} is outside the supported timestamp range`);
  return result;
}

function parseJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

function readAuthorityData(datastorePath: string): {
  sites: Record<string, SiteProfileRow>;
  cognition: Record<string, Record<string, unknown>>;
  idempotency: readonly JsonRecord[];
} {
  const root = record(parseJsonFile(datastorePath), 'datastore');
  const sites = record(root.sites ?? {}, 'datastore.sites') as Record<string, SiteProfileRow>;
  return {
    sites,
    cognition: {
      episode: record(root.cognition_episodes ?? {}, 'datastore.cognition_episodes'),
      knowledge: record(root.cognition_knowledge ?? {}, 'datastore.cognition_knowledge'),
      procedure: record(root.cognition_procedures ?? {}, 'datastore.cognition_procedures'),
      pattern: record(root.cognition_patterns ?? {}, 'datastore.cognition_patterns'),
    },
    idempotency: Object.values(record(root.idempotency_records ?? {}, 'datastore.idempotency_records')).map((value, index) =>
      record(value, `idempotency record ${index}`)),
  };
}

function duplicateValues(values: readonly { sourceId: string; key: string }[]): readonly { sourceId: string; key: string }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value.key, (counts.get(value.key) ?? 0) + 1);
  return values.filter(value => (counts.get(value.key) ?? 0) > 1);
}

function legacyFiles(root: string): readonly string[] {
  return fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map(entry => entry.name)
      .sort()
    : [];
}

function createProvenance(sourceId: string, sessionId: string | null) {
  return {
    occurrence: { sourceOccurrenceId: sourceId, producerIdentity: 'legacy-cognition', sessionId },
    legacyId: { kind: 'legacy-cognition-id' as const, value: sourceId },
  };
}

function cognitionInput(kind: 'episode' | 'knowledge' | 'procedure' | 'pattern', raw: JsonRecord, siteId: string): CognitionAuthorityCreateInput {
  const id = text(raw.id, `${kind}.id`);
  const targetUrl = text(raw.targetUrl, `${kind}.targetUrl`);
  void normalizeCanonicalOrigin(targetUrl);
  const common = {
    scope: { kind: 'site' as const, siteId },
    provenance: createProvenance(id, kind === 'episode' ? nullableText(raw.sessionId, 'episode.sessionId') : null),
    idempotency: { idempotencyKey: `legacy-cognition-import:${siteId}:${kind}:${id}` },
  };
  switch (kind) {
    case 'episode': {
      const row: Omit<CognitionEpisodeRow, 'canonicalId' | 'provenance'> = {
        id,
        siteId,
        sessionId: nullableText(raw.sessionId, 'episode.sessionId'),
        type: text(raw.type, 'episode.type'),
        outcome: text(raw.outcome, 'episode.outcome'),
        description: text(raw.description, 'episode.description'),
        data: stableJson({
          actions: jsonArray(raw.actions, 'episode.actions'),
          findings: raw.findings === undefined ? [] : jsonArray(raw.findings, 'episode.findings'),
          tags: jsonArray(raw.tags, 'episode.tags'),
          confidence: numberValue(raw.confidence, 'episode.confidence'),
        }),
        timestamp: numberValue(raw.timestamp, 'episode.timestamp'),
      };
      return { kind, row, ...common };
    }
    case 'knowledge': {
      const row: Omit<CognitionKnowledgeRow, 'canonicalId' | 'provenance'> = {
        id,
        siteId,
        type: text(raw.type, 'knowledge.type'),
        title: text(raw.title, 'knowledge.title'),
        content: stableJson(record(raw.content, 'knowledge.content')),
        confidence: numberValue(raw.confidence, 'knowledge.confidence'),
        useCount: numberValue(raw.useCount, 'knowledge.useCount'),
        lastUsed: raw.lastUsed === undefined || raw.lastUsed === null ? null : isoFromEpoch(raw.lastUsed, 'knowledge.lastUsed'),
        tags: stableJson(jsonArray(raw.tags, 'knowledge.tags')),
        createdAt: isoFromEpoch(raw.timestamp, 'knowledge.timestamp'),
      };
      return { kind, row, ...common };
    }
    case 'procedure': {
      const successRate = raw.successRate === undefined
        ? numberValue(raw.successCount, 'procedure.successCount')
          / Math.max(1, numberValue(raw.successCount, 'procedure.successCount') + numberValue(raw.failureCount, 'procedure.failureCount'))
        : numberValue(raw.successRate, 'procedure.successRate');
      const row: Omit<CognitionProcedureRow, 'canonicalId' | 'provenance'> = {
        id,
        siteId,
        name: text(raw.name, 'procedure.name'),
        steps: stableJson(jsonArray(raw.steps, 'procedure.steps')),
        successRate,
        useCount: numberValue(raw.useCount, 'procedure.useCount'),
        lastUsed: raw.lastUsed === undefined || raw.lastUsed === null ? null : isoFromEpoch(raw.lastUsed, 'procedure.lastUsed'),
      };
      return { kind, row, ...common };
    }
    case 'pattern': {
      const row: Omit<CognitionPatternRow, 'canonicalId' | 'provenance'> = {
        id,
        siteId,
        type: text(raw.type, 'pattern.type'),
        description: text(raw.description, 'pattern.description'),
        frequency: numberValue(raw.frequency, 'pattern.frequency'),
        confidence: numberValue(raw.confidence, 'pattern.confidence'),
        tags: stableJson(jsonArray(raw.tags, 'pattern.tags')),
        lastSeen: raw.lastDetected === undefined || raw.lastDetected === null ? null : isoFromEpoch(raw.lastDetected, 'pattern.lastDetected'),
      };
      return { kind, row, ...common };
    }
  }
}

function legacyCognitionRows(root: string): readonly { kind: 'episode' | 'knowledge' | 'procedure' | 'pattern'; raw: JsonRecord }[] {
  const definitions = [
    ['episodes.json', 'episode'],
    ['semantic.json', 'knowledge'],
    ['procedures.json', 'procedure'],
  ] as const;
  const rows: { kind: 'episode' | 'knowledge' | 'procedure' | 'pattern'; raw: JsonRecord }[] = [];
  for (const [fileName, kind] of definitions) {
    const filePath = path.join(root, fileName);
    if (!fs.existsSync(filePath)) continue;
    const parsed = parseJsonFile(filePath);
    if (!Array.isArray(parsed)) throw new TypeError(`${fileName} must contain an array`);
    parsed.forEach((value, index) => rows.push({ kind, raw: record(value, `${fileName}[${index}]`) }));
  }
  return rows;
}

function comparableCognitionRow(row: CognitionAuthorityCreateInput['row']): string {
  return stableJson(row);
}

type KnowledgeCreateInput = Extract<CognitionAuthorityCreateInput, { kind: 'knowledge' }>;

function canonicalKnowledgeHash(row: KnowledgeCreateInput['row']): string {
  return createHash('sha256').update(stableJson({
    siteId: row.siteId,
    type: row.type,
    title: row.title,
    content: row.content,
    tags: row.tags,
  })).digest('hex');
}

function latestObservationSorter(left: KnowledgeCreateInput, right: KnowledgeCreateInput): number {
  if (left.row.lastUsed !== right.row.lastUsed) {
    if (left.row.lastUsed === null) return 1;
    if (right.row.lastUsed === null) return -1;
    const lastUsedOrder = Date.parse(right.row.lastUsed) - Date.parse(left.row.lastUsed);
    if (lastUsedOrder !== 0) return lastUsedOrder;
  }
  const createdAtOrder = Date.parse(right.row.createdAt) - Date.parse(left.row.createdAt);
  if (createdAtOrder !== 0) return createdAtOrder;
  return right.row.id.localeCompare(left.row.id);
}

function collapseKnowledgeRows(rows: readonly KnowledgeCreateInput[]): KnowledgeCreateInput {
  if (rows.length < 2) throw new TypeError('Knowledge consolidation requires a collision group');
  const representative = [...rows].sort(latestObservationSorter)[0]!;
  const createdAt = rows.map(value => value.row.createdAt).sort()[0]!;
  const lastUsedValues = rows.flatMap(value => value.row.lastUsed === null ? [] : [value.row.lastUsed]).sort();
  return {
    ...representative,
    row: {
      ...representative.row,
      createdAt,
      lastUsed: lastUsedValues.at(-1) ?? null,
    },
  };
}

function parseSiteProfileResolutions(root: JsonRecord): readonly SiteProfileResolutionInput[] {
  return jsonArray(root.legacyFileResolutions, 'legacyFileResolutions').map((value, index) => {
    const row = record(value, `legacyFileResolutions[${index}]`);
    return {
      sourceFile: text(row.sourceFile, `legacyFileResolutions[${index}].sourceFile`),
      profileId: text(row.profileId, `legacyFileResolutions[${index}].profileId`),
      resolvedCanonicalOrigin: normalizeCanonicalOrigin(text(row.resolvedCanonicalOrigin,
        `legacyFileResolutions[${index}].resolvedCanonicalOrigin`)),
      resolutionBasis: text(row.resolutionBasis, `legacyFileResolutions[${index}].resolutionBasis`),
      approvedBy: text(row.approvedBy, `legacyFileResolutions[${index}].approvedBy`),
    };
  });
}

function parseExplicitSiteProfiles(root: JsonRecord): readonly LegacySiteProfileImportRow[] {
  return jsonArray(root.explicitSiteProfiles, 'explicitSiteProfiles').map((value, index) => {
    const row = record(value, `explicitSiteProfiles[${index}]`);
    return {
      sourceId: text(row.sourceId, `explicitSiteProfiles[${index}].sourceId`),
      profileId: text(row.profileId, `explicitSiteProfiles[${index}].profileId`),
      legacyHostname: text(row.legacyHostname, `explicitSiteProfiles[${index}].legacyHostname`),
      resolvedCanonicalOrigin: normalizeCanonicalOrigin(text(row.resolvedCanonicalOrigin,
        `explicitSiteProfiles[${index}].resolvedCanonicalOrigin`)),
      name: text(row.name, `explicitSiteProfiles[${index}].name`),
      elementCache: row.elementCache === undefined ? [] : jsonArray(row.elementCache,
        `explicitSiteProfiles[${index}].elementCache`),
      resolutionBasis: text(row.resolutionBasis, `explicitSiteProfiles[${index}].resolutionBasis`),
      approvedBy: text(row.approvedBy, `explicitSiteProfiles[${index}].approvedBy`),
    };
  });
}

export function readCutoverResolutionManifest(filePath: string): CutoverResolutionManifest {
  const root = record(parseJsonFile(filePath), 'resolution manifest');
  if (root.format !== 'p6-cutover-resolution-v1' && root.format !== 'p6-cutover-resolution-v2') {
    throw new TypeError('Unsupported cutover resolution manifest format');
  }
  const common = {
    legacyFileResolutions: parseSiteProfileResolutions(root),
    explicitSiteProfiles: parseExplicitSiteProfiles(root),
  };
  if (root.format === 'p6-cutover-resolution-v1') return { format: root.format, ...common };
  return {
    format: root.format,
    ...common,
    cognitionCollisionResolutions: jsonArray(root.cognitionCollisionResolutions,
      'cognitionCollisionResolutions').map((value, index) => {
      const row = record(value, `cognitionCollisionResolutions[${index}]`);
      const strategy = text(row.strategy, `cognitionCollisionResolutions[${index}].strategy`);
      const representativePolicy = text(row.representativePolicy,
        `cognitionCollisionResolutions[${index}].representativePolicy`);
      if (strategy !== 'equivalent-semantic-collapse') throw new TypeError('Unsupported cognition collision strategy');
      if (representativePolicy !== 'latest-observation-v1') {
        throw new TypeError('Unsupported cognition collision representative policy');
      }
      return {
        canonicalKey: text(row.canonicalKey, `cognitionCollisionResolutions[${index}].canonicalKey`),
        strategy,
        sourceIds: jsonArray(row.sourceIds, `cognitionCollisionResolutions[${index}].sourceIds`)
          .map((sourceId, sourceIndex) => text(sourceId,
            `cognitionCollisionResolutions[${index}].sourceIds[${sourceIndex}]`)),
        representativePolicy,
        resolutionBasis: text(row.resolutionBasis, `cognitionCollisionResolutions[${index}].resolutionBasis`),
        approvedBy: text(row.approvedBy, `cognitionCollisionResolutions[${index}].approvedBy`),
      };
    }),
  };
}

function legacyMappingInput(input: CognitionAuthorityCreateInput): LegacyCognitionInput {
  switch (input.kind) {
    case 'episode': return { kind: input.kind, id: input.row.id, siteId: input.row.siteId, sessionId: input.row.sessionId };
    case 'knowledge': return { kind: input.kind, id: input.row.id, siteId: input.row.siteId,
      title: input.row.title, content: input.row.content };
    case 'procedure': return { kind: input.kind, id: input.row.id, siteId: input.row.siteId,
      name: input.row.name, steps: input.row.steps };
    case 'pattern': return { kind: input.kind, id: input.row.id, siteId: input.row.siteId,
      type: input.row.type, description: input.row.description, tags: input.row.tags };
  }
}

export function runCutoverPreflight(
  paths: CutoverPreflightPaths,
  profileResolutions: readonly SiteProfileResolutionInput[] = [],
  explicitSiteProfiles: readonly LegacySiteProfileImportRow[] = [],
  cognitionCollisionResolutions: readonly CognitionCollisionResolution[] = [],
): CutoverPreflightReport {
  const diagnostics: CutoverPreflightDiagnostic[] = [];
  let authority: ReturnType<typeof readAuthorityData>;
  try {
    authority = readAuthorityData(paths.datastorePath);
  } catch (error) {
    return {
      status: 'no-go',
      diagnostics: [{ code: 'invalid-record', domain: 'site-profile', sourceId: 'datastore',
        detail: error instanceof Error ? error.message : 'Invalid datastore' }],
      resolvedCollisions: [],
      counts: { authoritySiteProfiles: 0, legacySiteProfiles: 0, siteProfileImports: 0,
        cognitionInputs: 0, cognitionImports: 0, resolvedCollisionGroups: 0,
        collapsedExcessRows: 0, excludedControlFiles: 0 },
      siteProfileRows: [], cognitionRowsBySiteId: {}, excludedControlFiles: [],
    };
  }

  const origins = Object.values(authority.sites).map(site => ({ sourceId: site.id, key: site.canonicalOriginKey ?? '' }));
  for (const duplicate of duplicateValues(origins.filter(value => value.key))) {
    diagnostics.push({ code: 'duplicate', domain: 'site-profile', sourceId: duplicate.sourceId,
      detail: `Duplicate authority canonical origin: ${duplicate.key}` });
  }
  for (const [kind, table] of Object.entries(authority.cognition)) {
    const canonicalValues = Object.values(table).map((value, index) => {
      const row = record(value, `authority cognition ${kind}[${index}]`);
      return { sourceId: typeof row.id === 'string' ? row.id : `${kind}:${index}`,
        key: typeof row.canonicalId === 'string' ? row.canonicalId : '' };
    });
    for (const duplicate of duplicateValues(canonicalValues.filter(value => value.key))) {
      diagnostics.push({ code: 'duplicate', domain: 'cognition', sourceId: duplicate.sourceId,
        detail: `Duplicate authority canonical identity: ${duplicate.key}` });
    }
  }
  try {
    const idempotencyKeys = authority.idempotency.map((row, index) => ({ sourceId: text(row.recordId, `idempotency[${index}].recordId`),
      key: stableJson([text(row.domain, `idempotency[${index}].domain`),
        text(row.idempotencyKey, `idempotency[${index}].idempotencyKey`)]) }));
    for (const duplicate of duplicateValues(idempotencyKeys)) {
      diagnostics.push({ code: 'duplicate', domain: 'idempotency', sourceId: duplicate.sourceId,
        detail: 'Duplicate authority idempotency domain/key' });
    }
  } catch (error) {
    diagnostics.push({ code: 'invalid-record', domain: 'idempotency', sourceId: 'authority-idempotency',
      detail: error instanceof Error ? error.message : 'Invalid authority idempotency record' });
  }

  const resolutionByFile = new Map(profileResolutions.map(value => [value.sourceFile, value]));
  if (resolutionByFile.size !== profileResolutions.length) {
    diagnostics.push({ code: 'duplicate', domain: 'site-profile', sourceId: 'legacy-file-resolutions',
      detail: 'Resolution manifest contains duplicate legacy SiteProfile filenames' });
  }
  const siteRows: LegacySiteProfileImportRow[] = [];
  const sitesByOrigin = new Map<string, SiteProfileRow>();
  for (const site of Object.values(authority.sites)) {
    if (site.canonicalOriginKey) sitesByOrigin.set(normalizeCanonicalOrigin(site.canonicalOriginKey), site);
  }
  const siteFiles = legacyFiles(paths.siteProfileRoot);
  for (const fileName of siteFiles) {
    try {
      const legacyHostname = readLegacySiteProfileFilename(fileName);
      if (!legacyHostname) throw new TypeError('Invalid legacy SiteProfile filename');
      const raw = record(parseJsonFile(path.join(paths.siteProfileRoot, fileName)), fileName);
      const canonicalOrigin = normalizeCanonicalOrigin(text(raw.baseUrl, `${fileName}.baseUrl`));
      const existing = sitesByOrigin.get(canonicalOrigin);
      const elementCache = raw.elementCache === undefined ? [] : jsonArray(raw.elementCache, `${fileName}.elementCache`);
      if (existing) {
        if (existing.name !== text(raw.name, `${fileName}.name`) || existing.elementCache !== stableJson(elementCache)) {
          diagnostics.push({ code: 'semantic-mismatch', domain: 'site-profile', sourceId: fileName,
            detail: `Existing authority differs from legacy profile at ${canonicalOrigin}` });
        }
        continue;
      }
      const resolution = resolutionByFile.get(fileName);
      if (!resolution || normalizeCanonicalOrigin(resolution.resolvedCanonicalOrigin) !== canonicalOrigin) {
        diagnostics.push({ code: 'orphan-site-scope', domain: 'site-profile', sourceId: fileName,
          detail: `No approved authority profile/resolution for ${canonicalOrigin}` });
        continue;
      }
      const row: LegacySiteProfileImportRow = {
        sourceId: fileName,
        profileId: text(resolution.profileId, `${fileName}.profileId`),
        legacyHostname: legacyHostname.hostname,
        resolvedCanonicalOrigin: canonicalOrigin,
        name: text(raw.name, `${fileName}.name`),
        elementCache,
        resolutionBasis: text(resolution.resolutionBasis, `${fileName}.resolutionBasis`),
        approvedBy: text(resolution.approvedBy, `${fileName}.approvedBy`),
      };
      siteRows.push(row);
      sitesByOrigin.set(canonicalOrigin, {
        id: row.profileId, name: row.name, baseUrl: legacyHostname.hostname, canonicalOriginKey: canonicalOrigin,
        elementCache: stableJson(elementCache), testCount: 0, lastTestedAt: null, updatedAt: 'preflight-only',
      });
    } catch (error) {
      diagnostics.push({ code: 'invalid-record', domain: 'site-profile', sourceId: fileName,
        detail: error instanceof Error ? error.message : 'Invalid legacy SiteProfile' });
    }
  }

  const duplicateExplicitSources = duplicateValues(explicitSiteProfiles.map(row => ({ sourceId: row.sourceId, key: row.sourceId })));
  const duplicateExplicitOrigins = duplicateValues(explicitSiteProfiles.map(row => ({ sourceId: row.sourceId,
    key: normalizeCanonicalOrigin(row.resolvedCanonicalOrigin) })));
  for (const duplicate of duplicateExplicitSources) {
    diagnostics.push({ code: 'duplicate', domain: 'site-profile', sourceId: duplicate.sourceId,
      detail: 'Explicit SiteProfile source appears more than once' });
  }
  for (const duplicate of duplicateExplicitOrigins) {
    diagnostics.push({ code: 'collision', domain: 'site-profile', sourceId: duplicate.sourceId,
      detail: `Multiple explicit SiteProfiles map to ${duplicate.key}` });
  }
  for (const explicit of explicitSiteProfiles) {
    try {
      if (!readLegacyHostname(explicit.legacyHostname)) throw new TypeError('Invalid explicit legacy hostname');
      const canonicalOrigin = normalizeCanonicalOrigin(explicit.resolvedCanonicalOrigin);
      text(explicit.sourceId, 'explicit SiteProfile sourceId');
      text(explicit.profileId, 'explicit SiteProfile profileId');
      text(explicit.name, 'explicit SiteProfile name');
      text(explicit.resolutionBasis, 'explicit SiteProfile resolutionBasis');
      text(explicit.approvedBy, 'explicit SiteProfile approvedBy');
      const elementCache = explicit.elementCache ?? [];
      if (!Array.isArray(elementCache)) throw new TypeError('Explicit SiteProfile elementCache must be an array');
      const existing = sitesByOrigin.get(canonicalOrigin);
      if (existing) {
        if (existing.id !== explicit.profileId || existing.name !== explicit.name
          || existing.elementCache !== stableJson(elementCache)) {
          diagnostics.push({ code: 'semantic-mismatch', domain: 'site-profile', sourceId: explicit.sourceId,
            detail: `Explicit SiteProfile resolution conflicts with authority at ${canonicalOrigin}` });
        }
        continue;
      }
      const idConflict = [...sitesByOrigin.values()].find(site => site.id === explicit.profileId);
      if (idConflict) throw new Error(`Explicit profile ID already belongs to ${idConflict.canonicalOriginKey}`);
      const row: LegacySiteProfileImportRow = {
        sourceId: explicit.sourceId,
        profileId: explicit.profileId,
        legacyHostname: explicit.legacyHostname,
        resolvedCanonicalOrigin: canonicalOrigin,
        name: explicit.name,
        elementCache,
        resolutionBasis: explicit.resolutionBasis,
        approvedBy: explicit.approvedBy,
      };
      siteRows.push(row);
      sitesByOrigin.set(canonicalOrigin, {
        id: row.profileId, name: row.name, baseUrl: row.legacyHostname, canonicalOriginKey: canonicalOrigin,
        elementCache: stableJson(elementCache), testCount: 0, lastTestedAt: null, updatedAt: 'preflight-only',
      });
    } catch (error) {
      diagnostics.push({ code: 'invalid-record', domain: 'site-profile', sourceId: explicit.sourceId,
        detail: error instanceof Error ? error.message : 'Invalid explicit SiteProfile resolution' });
    }
  }

  const cognitionRows: CognitionAuthorityCreateInput[] = [];
  const orphanCognitionByOrigin = new Map<string, string[]>();
  let cognitionInputCount = 0;
  try {
    const legacyRows = legacyCognitionRows(paths.cognitionRoot);
    cognitionInputCount = legacyRows.length;
    for (const { kind, raw } of legacyRows) {
      const sourceId = typeof raw.id === 'string' && raw.id ? raw.id : `${kind}:unknown`;
      try {
        const rawTarget = text(raw.targetUrl, `${kind}.targetUrl`);
        const origin = normalizeCanonicalOrigin(rawTarget);
        const site = sitesByOrigin.get(origin);
        if (!site) {
          const sourceIds = orphanCognitionByOrigin.get(origin) ?? [];
          sourceIds.push(sourceId);
          orphanCognitionByOrigin.set(origin, sourceIds);
          continue;
        }
        cognitionRows.push(cognitionInput(kind, raw, site.id));
      } catch (error) {
        diagnostics.push({ code: 'invalid-record', domain: 'cognition', sourceId,
          detail: error instanceof Error ? error.message : 'Invalid legacy cognition row' });
      }
    }
  } catch (error) {
    diagnostics.push({ code: 'invalid-record', domain: 'cognition', sourceId: 'legacy-cognition-root',
      detail: error instanceof Error ? error.message : 'Invalid legacy cognition root' });
  }
  for (const [origin, sourceIds] of [...orphanCognitionByOrigin].sort(([left], [right]) => left.localeCompare(right))) {
    diagnostics.push({ code: 'orphan-site-scope', domain: 'cognition', sourceId: sourceIds[0] ?? origin,
      detail: `No proven SiteProfile scope for ${origin} (${sourceIds.length} rows)`, affectedSourceIds: sourceIds.sort() });
  }

  const mapping = mapLegacyCognitionRows(cognitionRows.map(legacyMappingInput));
  const knowledgeCollisionGroups = new Map<string, KnowledgeCreateInput[]>();
  for (let index = 0; index < cognitionRows.length; index++) {
    const input = cognitionRows[index]!;
    const canonicalKey = mapping.mappings[index]?.canonicalKey;
    if (input.kind !== 'knowledge' || !canonicalKey) continue;
    const group = knowledgeCollisionGroups.get(canonicalKey) ?? [];
    group.push(input);
    knowledgeCollisionGroups.set(canonicalKey, group);
  }
  for (const [canonicalKey, group] of [...knowledgeCollisionGroups]) {
    if (group.length <= 1) knowledgeCollisionGroups.delete(canonicalKey);
  }

  const validResolutions = new Map<string, CognitionCollisionResolution>();
  const seenCanonicalKeys = new Set<string>();
  const seenSourceIdsInResolutions = new Set<string>();
  for (const resolution of cognitionCollisionResolutions) {
    let valid = true;
    if (typeof resolution.canonicalKey !== 'string' || !resolution.canonicalKey.trim()) valid = false;
    if (resolution.strategy !== 'equivalent-semantic-collapse') valid = false;
    if (resolution.representativePolicy !== 'latest-observation-v1') valid = false;
    if (!Array.isArray(resolution.sourceIds) || resolution.sourceIds.length === 0
      || resolution.sourceIds.some(sourceId => typeof sourceId !== 'string' || !sourceId.trim())) valid = false;
    if (typeof resolution.resolutionBasis !== 'string' || !resolution.resolutionBasis.trim()) valid = false;
    if (typeof resolution.approvedBy !== 'string' || !resolution.approvedBy.trim()) valid = false;
    if (!valid) {
      diagnostics.push({ code: 'collision', domain: 'cognition', sourceId: String(resolution.canonicalKey),
        detail: 'Invalid cognition collision resolution contract' });
      continue;
    }
    if (new Set(resolution.sourceIds).size !== resolution.sourceIds.length) {
      diagnostics.push({ code: 'collision', domain: 'cognition', sourceId: resolution.canonicalKey,
        detail: 'Cognition collision resolution contains duplicate source IDs' });
      continue;
    }
    if (seenCanonicalKeys.has(resolution.canonicalKey)) {
      diagnostics.push({ code: 'collision', domain: 'cognition', sourceId: resolution.canonicalKey,
        detail: 'Canonical key appears in multiple cognition collision resolutions' });
      continue;
    }
    const overlaps = resolution.sourceIds.filter(sourceId => seenSourceIdsInResolutions.has(sourceId));
    if (overlaps.length > 0) {
      diagnostics.push({ code: 'collision', domain: 'cognition', sourceId: overlaps.join(','),
        detail: 'Source ID appears in multiple cognition collision resolutions', affectedSourceIds: overlaps.sort() });
      continue;
    }
    seenCanonicalKeys.add(resolution.canonicalKey);
    for (const sourceId of resolution.sourceIds) seenSourceIdsInResolutions.add(sourceId);
    validResolutions.set(resolution.canonicalKey, resolution);
  }

  for (const [canonicalKey, resolution] of validResolutions) {
    const group = knowledgeCollisionGroups.get(canonicalKey);
    if (!group) {
      diagnostics.push({ code: 'collision', domain: 'cognition', sourceId: canonicalKey,
        detail: `Resolution does not match an actual knowledge collision: ${canonicalKey}`,
        affectedSourceIds: [...resolution.sourceIds].sort() });
    }
  }

  const resolvedCollisions: CutoverPreflightReport['resolvedCollisions'][number][] = [];
  const consolidatedByCanonicalKey = new Map<string, KnowledgeCreateInput>();
  for (const [canonicalKey, group] of knowledgeCollisionGroups) {
    const resolution = validResolutions.get(canonicalKey);
    if (!resolution) continue;
    const actualSourceIds = group.map(value => value.row.id).sort();
    const approvedSourceIds = [...resolution.sourceIds].sort();
    if (stableJson(actualSourceIds) !== stableJson(approvedSourceIds)) {
      diagnostics.push({ code: 'collision', domain: 'cognition', sourceId: canonicalKey,
        detail: `Resolution source set does not exactly match collision ${canonicalKey}`,
        affectedSourceIds: actualSourceIds });
      continue;
    }
    const semanticHashes = new Set(group.map(value => canonicalKnowledgeHash(value.row)));
    if (semanticHashes.size !== 1) {
      diagnostics.push({ code: 'collision', domain: 'cognition', sourceId: canonicalKey,
        detail: `Resolved collision contains materially different semantic fields: ${canonicalKey}`,
        affectedSourceIds: actualSourceIds });
      continue;
    }
    const consolidated = collapseKnowledgeRows(group);
    consolidatedByCanonicalKey.set(canonicalKey, consolidated);
    resolvedCollisions.push({
      canonicalKey,
      sourceIds: actualSourceIds,
      sourceCount: group.length,
      outputRowCount: 1,
      collapsedExcessRows: group.length - 1,
      representativeSourceId: consolidated.row.id,
      representativePolicy: 'latest-observation-v1',
      semanticHash: [...semanticHashes][0]!,
      resolutionBasis: resolution.resolutionBasis,
      approvedBy: resolution.approvedBy,
    });
  }

  const resolvedSourceSets = new Set(resolvedCollisions.map(value => stableJson([...value.sourceIds].sort())));
  for (const diagnostic of mapping.analysis.diagnostics) {
    if (diagnostic.code === 'collision'
      && resolvedSourceSets.has(stableJson([...diagnostic.sourceIds].sort()))) continue;
    diagnostics.push({ code: diagnostic.code === 'collision' ? 'collision' : 'invalid-record', domain: 'cognition',
      sourceId: diagnostic.sourceIds.join(','), detail: diagnostic.message,
      affectedSourceIds: diagnostic.sourceIds });
  }

  const resolvedByCanonicalKey = new Map(resolvedCollisions.map(value => [value.canonicalKey, value] as const));
  for (let index = 0; index < cognitionRows.length; index++) {
    const input = cognitionRows[index]!;
    const canonicalId = mapping.mappings[index]?.canonicalKey;
    if (!canonicalId) continue;
    let comparisonInput = input;
    const resolved = resolvedByCanonicalKey.get(canonicalId);
    if (resolved) {
      if (input.kind !== 'knowledge' || input.row.id !== resolved.representativeSourceId) continue;
      const consolidated = consolidatedByCanonicalKey.get(canonicalId);
      if (!consolidated) {
        diagnostics.push({ code: 'collision', domain: 'cognition', sourceId: canonicalId,
          detail: `Resolved collision group missing for ${canonicalId}` });
        continue;
      }
      comparisonInput = consolidated;
    }
    const existing = Object.values(authority.cognition[comparisonInput.kind]!)
      .map((row, rowIndex) => record(row, `authority cognition ${comparisonInput.kind}[${rowIndex}]`))
      .find(row => row.canonicalId === canonicalId);
    if (existing) {
      const { canonicalId: _canonicalId, provenance: _provenance, ...stored } = existing;
      if (stableJson(stored) !== comparableCognitionRow(comparisonInput.row)) {
        diagnostics.push({ code: 'semantic-mismatch', domain: 'cognition', sourceId: comparisonInput.row.id,
          detail: `Existing authority differs for canonical identity ${canonicalId}` });
      }
    }
  }

  const resolvedCanonicalKeys = new Set(resolvedCollisions.map(value => value.canonicalKey));
  const finalCognitionRows: CognitionAuthorityCreateInput[] = [];
  const emittedResolvedKeys = new Set<string>();
  for (let index = 0; index < cognitionRows.length; index++) {
    const input = cognitionRows[index]!;
    const canonicalKey = mapping.mappings[index]?.canonicalKey;
    if (!canonicalKey || !resolvedCanonicalKeys.has(canonicalKey)) {
      finalCognitionRows.push(input);
      continue;
    }
    if (emittedResolvedKeys.has(canonicalKey)) continue;
    const consolidated = consolidatedByCanonicalKey.get(canonicalKey);
    if (consolidated) finalCognitionRows.push(consolidated);
    emittedResolvedKeys.add(canonicalKey);
  }

  const grouped: Record<string, CognitionAuthorityCreateInput[]> = {};
  for (const row of finalCognitionRows) {
    if (row.scope.kind !== 'site') continue;
    (grouped[row.scope.siteId] ??= []).push(row);
  }
  const learnedNames = new Set(['episodes.json', 'semantic.json', 'procedures.json']);
  const excludedControlFiles = legacyFiles(paths.cognitionRoot).filter(file => !learnedNames.has(file));
  return {
    status: diagnostics.length === 0 ? 'go' : 'no-go',
    diagnostics: diagnostics.sort((left, right) => `${left.domain}:${left.sourceId}`.localeCompare(`${right.domain}:${right.sourceId}`)),
    resolvedCollisions: resolvedCollisions.sort((left, right) => left.canonicalKey.localeCompare(right.canonicalKey)),
    counts: {
      authoritySiteProfiles: Object.keys(authority.sites).length,
      legacySiteProfiles: siteFiles.length,
      siteProfileImports: siteRows.length,
      cognitionInputs: cognitionInputCount,
      cognitionImports: finalCognitionRows.length,
      resolvedCollisionGroups: resolvedCollisions.length,
      collapsedExcessRows: resolvedCollisions.reduce((total, value) => total + value.collapsedExcessRows, 0),
      excludedControlFiles: excludedControlFiles.length,
    },
    siteProfileRows: siteRows,
    cognitionRowsBySiteId: grouped,
    excludedControlFiles,
  };
}
