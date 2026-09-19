import {
  applyExplicitSiteProfileOriginResolutions,
  mapLegacySiteProfileOrigins,
  type ExplicitSiteProfileOriginResolution,
  type SiteProfileOriginMappingReport,
} from '@test-harness/th-core';
import {
  mapLegacyCognitionRows,
  type CognitionLegacyMapping,
  type CognitionLegacyMappingReport,
} from '@test-harness/th-cognition';
import type {
  CognitionEpisodeRow,
  CognitionKnowledgeRow,
  CognitionPatternRow,
  CognitionProcedureRow,
  CognitionProvenanceRecord,
  IdempotencyRecordRow,
  SiteProfileRow,
} from './schema.js';
import fs from 'node:fs';
import { JsonFileDatabase } from './providers/json-file.js';
import { assertUniqueCanonicalValues } from './uniqueness.js';
import { assertUniqueIdempotencyRecords } from './idempotency.js';

export interface CanonicalBackfillInput {
  readonly sites: readonly SiteProfileRow[];
  readonly cognition: {
    readonly episodes: readonly CognitionEpisodeRow[];
    readonly knowledge: readonly CognitionKnowledgeRow[];
    readonly procedures: readonly CognitionProcedureRow[];
    readonly patterns: readonly CognitionPatternRow[];
  };
  readonly idempotencyRecords?: readonly IdempotencyRecordRow[];
  readonly originResolutions?: readonly ExplicitSiteProfileOriginResolution[];
}

export interface CanonicalBackfillOutput {
  readonly sites: readonly SiteProfileRow[];
  readonly cognition: {
    readonly episodes: readonly CognitionEpisodeRow[];
    readonly knowledge: readonly CognitionKnowledgeRow[];
    readonly procedures: readonly CognitionProcedureRow[];
    readonly patterns: readonly CognitionPatternRow[];
  };
  readonly idempotencyRecords: readonly IdempotencyRecordRow[];
}

export interface CanonicalBackfillReport {
  readonly sites: SiteProfileOriginMappingReport;
  readonly cognition: {
    readonly episodes: CognitionLegacyMappingReport;
    readonly knowledge: CognitionLegacyMappingReport;
    readonly procedures: CognitionLegacyMappingReport;
    readonly patterns: CognitionLegacyMappingReport;
  };
}

export interface JsonCanonicalBackfillOptions {
  readonly originResolutions?: readonly ExplicitSiteProfileOriginResolution[];
}

export interface JsonCanonicalBackfillResult {
  readonly output: CanonicalBackfillOutput;
  readonly report: CanonicalBackfillReport;
  readonly backfilledRows: number;
}

interface JsonCanonicalBackfillDocument {
  readonly [key: string]: unknown;
  sites?: Record<string, SiteProfileRow>;
  cognition_episodes?: Record<string, CognitionEpisodeRow>;
  cognition_knowledge?: Record<string, CognitionKnowledgeRow>;
  cognition_procedures?: Record<string, CognitionProcedureRow>;
  cognition_patterns?: Record<string, CognitionPatternRow>;
  idempotency_records?: Record<string, IdempotencyRecordRow>;
}

function assignExistingBackfillRow<T extends { readonly id: string }>(
  table: Record<string, T>,
  row: T,
): void {
  const target = table[row.id];
  if (!target) throw new Error(`Backfill output references missing JSON row ${row.id}`);
  Object.assign(target, row);
}

export class CanonicalBackfillBlockedError extends Error {
  readonly report: CanonicalBackfillReport;

  constructor(report: CanonicalBackfillReport) {
    super('Canonical backfill blocked by unresolved mapping or collision');
    this.name = 'CanonicalBackfillBlockedError';
    this.report = report;
  }
}

function provenanceRecord(mapping: CognitionLegacyMapping): CognitionProvenanceRecord {
  if (!mapping.provenance) throw new Error(`Missing provenance for ${mapping.legacyId}`);
  return {
    sourceOccurrenceId: mapping.provenance.occurrence.sourceOccurrenceId,
    producerIdentity: mapping.provenance.occurrence.producerIdentity,
    sessionId: mapping.provenance.occurrence.sessionId,
    legacyId: mapping.provenance.legacyId?.value ?? null,
  };
}

function sameProvenance(a: CognitionProvenanceRecord, b: CognitionProvenanceRecord): boolean {
  return a.sourceOccurrenceId === b.sourceOccurrenceId
    && a.producerIdentity === b.producerIdentity
    && a.sessionId === b.sessionId
    && a.legacyId === b.legacyId;
}

function withCognitionBackfill<T extends CognitionEpisodeRow | CognitionKnowledgeRow | CognitionProcedureRow | CognitionPatternRow>(
  row: T,
  mapping: CognitionLegacyMapping,
): T {
  if (row.canonicalId !== undefined && row.canonicalId !== null
    && row.canonicalId !== mapping.canonicalKey) {
    throw new Error(`Existing canonical ID conflicts for ${row.id}`);
  }
  const existing = row.provenance;
  if (existing !== undefined && !Array.isArray(existing)) {
    throw new Error(`Existing provenance is not an array for ${row.id}`);
  }
  const record = provenanceRecord(mapping);
  const provenance = [...(existing ?? [])];
  if (!provenance.some((candidate) => sameProvenance(candidate, record))) provenance.push(record);
  return { ...row, canonicalId: mapping.canonicalKey, provenance };
}

function cognitionMappingReport(input: CanonicalBackfillInput): CanonicalBackfillReport['cognition'] {
  return {
    episodes: mapLegacyCognitionRows(input.cognition.episodes.map((row) => ({ kind: 'episode' as const, ...row }))),
    knowledge: mapLegacyCognitionRows(input.cognition.knowledge.map((row) => ({ kind: 'knowledge' as const, ...row }))),
    procedures: mapLegacyCognitionRows(input.cognition.procedures.map((row) => ({ kind: 'procedure' as const, ...row }))),
    patterns: mapLegacyCognitionRows(input.cognition.patterns.map((row) => ({ kind: 'pattern' as const, ...row }))),
  };
}

function blocked(report: CanonicalBackfillReport): boolean {
  return report.sites.analysis.blocked
    || report.cognition.episodes.analysis.blocked
    || report.cognition.knowledge.analysis.blocked
    || report.cognition.procedures.analysis.blocked
    || report.cognition.patterns.analysis.blocked;
}

/** Prepare and validate every backfill before returning any changed representation. */
export function prepareCanonicalBackfill(input: CanonicalBackfillInput): {
  readonly output: CanonicalBackfillOutput;
  readonly report: CanonicalBackfillReport;
} {
  const siteRows = input.sites.map((row) => ({ legacyId: row.id, rawOrigin: row.baseUrl }));
  const siteReport = input.originResolutions && input.originResolutions.length > 0
    ? applyExplicitSiteProfileOriginResolutions(
      mapLegacySiteProfileOrigins(siteRows), input.originResolutions,
    )
    : mapLegacySiteProfileOrigins(siteRows);
  const report: CanonicalBackfillReport = {
    sites: siteReport,
    cognition: cognitionMappingReport(input),
  };
  if (blocked(report)) throw new CanonicalBackfillBlockedError(report);

  const output: CanonicalBackfillOutput = {
    sites: input.sites.map((row, index) => {
      const mapping = report.sites.mappings[index];
      if (!mapping?.canonicalOrigin) throw new Error(`Missing canonical origin for ${row.id}`);
      if (row.canonicalOriginKey !== undefined && row.canonicalOriginKey !== null
        && row.canonicalOriginKey !== mapping.canonicalOrigin) {
        throw new Error(`Existing canonical origin conflicts for ${row.id}`);
      }
      return { ...row, canonicalOriginKey: mapping.canonicalOrigin };
    }),
    cognition: {
      episodes: input.cognition.episodes.map((row, index) => withCognitionBackfill(row, report.cognition.episodes.mappings[index]!)),
      knowledge: input.cognition.knowledge.map((row, index) => withCognitionBackfill(row, report.cognition.knowledge.mappings[index]!)),
      procedures: input.cognition.procedures.map((row, index) => withCognitionBackfill(row, report.cognition.procedures.mappings[index]!)),
      patterns: input.cognition.patterns.map((row, index) => withCognitionBackfill(row, report.cognition.patterns.mappings[index]!)),
    },
    idempotencyRecords: input.idempotencyRecords ?? [],
  };
  assertCanonicalUniqueness(output);
  return { output, report };
}

/** Verify the same uniqueness invariant enforced by the A2 SQL indexes. */
export function assertCanonicalUniqueness(output: CanonicalBackfillOutput): void {
  assertUniqueCanonicalValues(output.sites, (row) => row.canonicalOriginKey, (row) => row.id);
  assertUniqueCanonicalValues(output.cognition.episodes, (row) => row.canonicalId, (row) => row.id);
  assertUniqueCanonicalValues(output.cognition.knowledge, (row) => row.canonicalId, (row) => row.id);
  assertUniqueCanonicalValues(output.cognition.procedures, (row) => row.canonicalId, (row) => row.id);
  assertUniqueCanonicalValues(output.cognition.patterns, (row) => row.canonicalId, (row) => row.id);
  assertUniqueIdempotencyRecords(output.idempotencyRecords);
}

/** Execute the validated representation change atomically for the JSON provider. */
export async function applyJsonFileCanonicalBackfill(
  db: JsonFileDatabase,
  options: JsonCanonicalBackfillOptions = {},
): Promise<JsonCanonicalBackfillResult> {
  return db.withTransitionLock(() => {
    const data = db.getData();
    const sites = Object.values(data.sites);
    const cognition = {
      episodes: Object.values(data.cognition_episodes),
      knowledge: Object.values(data.cognition_knowledge),
      procedures: Object.values(data.cognition_procedures),
      patterns: Object.values(data.cognition_patterns),
    };
    const prepared = prepareCanonicalBackfill({
      ...options,
      sites,
      cognition,
      idempotencyRecords: Object.values(data.idempotency_records),
    });
    const before = [
      ...sites.map((row) => row.canonicalOriginKey == null),
      ...cognition.episodes.map((row) => row.canonicalId == null),
      ...cognition.knowledge.map((row) => row.canonicalId == null),
      ...cognition.procedures.map((row) => row.canonicalId == null),
      ...cognition.patterns.map((row) => row.canonicalId == null),
    ].filter(Boolean).length;

    sites.forEach((row, index) => Object.assign(row, prepared.output.sites[index]));
    cognition.episodes.forEach((row, index) => Object.assign(row, prepared.output.cognition.episodes[index]));
    cognition.knowledge.forEach((row, index) => Object.assign(row, prepared.output.cognition.knowledge[index]));
    cognition.procedures.forEach((row, index) => Object.assign(row, prepared.output.cognition.procedures[index]));
    cognition.patterns.forEach((row, index) => Object.assign(row, prepared.output.cognition.patterns[index]));
    db.save();
    return { ...prepared, backfilledRows: before };
  });
}

/**
 * Execute the A2 backfill against a JSON document while preserving unrelated
 * legacy sections byte-for-byte semantically. This avoids routing a one-off
 * migration through JsonFileDatabase's runtime session normalization.
 */
export function applyJsonFileCanonicalBackfillFile(
  filePath: string,
  options: JsonCanonicalBackfillOptions = {},
): JsonCanonicalBackfillResult {
  const document = JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonCanonicalBackfillDocument;
  const sites = document.sites ?? {};
  const cognition = {
    episodes: document.cognition_episodes ?? {},
    knowledge: document.cognition_knowledge ?? {},
    procedures: document.cognition_procedures ?? {},
    patterns: document.cognition_patterns ?? {},
  };
  const prepared = prepareCanonicalBackfill({
    ...options,
    sites: Object.values(sites),
    cognition: {
      episodes: Object.values(cognition.episodes),
      knowledge: Object.values(cognition.knowledge),
      procedures: Object.values(cognition.procedures),
      patterns: Object.values(cognition.patterns),
    },
    idempotencyRecords: Object.values(document.idempotency_records ?? {}),
  });
  const backfilledRows = [
    ...Object.values(sites).map((row) => row.canonicalOriginKey == null),
    ...Object.values(cognition.episodes).map((row) => row.canonicalId == null),
    ...Object.values(cognition.knowledge).map((row) => row.canonicalId == null),
    ...Object.values(cognition.procedures).map((row) => row.canonicalId == null),
    ...Object.values(cognition.patterns).map((row) => row.canonicalId == null),
  ].filter(Boolean).length;

  for (const row of prepared.output.sites) assignExistingBackfillRow(sites, row);
  for (const row of prepared.output.cognition.episodes) assignExistingBackfillRow(cognition.episodes, row);
  for (const row of prepared.output.cognition.knowledge) assignExistingBackfillRow(cognition.knowledge, row);
  for (const row of prepared.output.cognition.procedures) assignExistingBackfillRow(cognition.procedures, row);
  for (const row of prepared.output.cognition.patterns) assignExistingBackfillRow(cognition.patterns, row);

  fs.writeFileSync(filePath, JSON.stringify(document, null, 2));
  return { ...prepared, backfilledRows };
}
