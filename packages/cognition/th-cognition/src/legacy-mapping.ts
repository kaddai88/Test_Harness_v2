import {
  analyzeCanonicalMappings,
  type MappingAnalysis,
  type CanonicalMappingCandidate,
} from '@test-harness/th-core';
import {
  createCognitionEntityIdentity,
  createCognitionPatternIdentity,
  readLegacyCognitionId,
  validateCognitionProvenance,
  type CanonicalCognitionEntityIdentity,
  type CognitionEntityKind,
  type CognitionIdentityInput,
  type CognitionProvenance,
  type CognitionScope,
} from './identity.js';

export interface LegacyCognitionEpisodeInput {
  readonly kind: 'episode';
  readonly id: string;
  readonly siteId: string;
  readonly sessionId: string | null;
}

export interface LegacyCognitionKnowledgeInput {
  readonly kind: 'knowledge';
  readonly id: string;
  readonly siteId: string | null;
  readonly title: string;
  readonly content: string;
}

export interface LegacyCognitionProcedureInput {
  readonly kind: 'procedure';
  readonly id: string;
  readonly siteId: string | null;
  readonly name: string;
  readonly steps: string;
}

export interface LegacyCognitionPatternInput {
  readonly kind: 'pattern';
  readonly id: string;
  readonly siteId: string | null;
  readonly type: string;
  readonly description: string;
  readonly tags: string;
}

export type LegacyCognitionInput =
  | LegacyCognitionEpisodeInput
  | LegacyCognitionKnowledgeInput
  | LegacyCognitionProcedureInput
  | LegacyCognitionPatternInput;

export interface CognitionLegacyMapping extends CanonicalMappingCandidate {
  readonly kind: CognitionEntityKind;
  readonly legacyId: string;
  readonly canonicalIdentity: CanonicalCognitionEntityIdentity | null;
  readonly provenance: CognitionProvenance | null;
  readonly diagnostic?: string;
}

export interface CognitionLegacyMappingReport {
  readonly mappings: readonly CognitionLegacyMapping[];
  readonly analysis: MappingAnalysis;
}

function scopeFor(siteId: string | null): CognitionScope {
  return siteId === null
    ? { kind: 'global' }
    : { kind: 'site', siteId };
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} must be a non-empty string`);
  return normalized;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON key contains a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  throw new TypeError('Unsupported JSON identity key');
}

function normalizedJsonKey(value: string, label: string): string {
  const normalized = requiredText(value, label);
  try {
    return stableJson(JSON.parse(normalized));
  } catch {
    throw new TypeError(`${label} must contain valid JSON`);
  }
}

function mappingFor(row: LegacyCognitionInput): CognitionLegacyMapping {
  const legacyId = readLegacyCognitionId(row.id);
  if (!legacyId) {
    return {
      sourceId: row.id,
      kind: row.kind,
      legacyId: row.id,
      canonicalKey: null,
      canonicalIdentity: null,
      provenance: null,
      diagnostic: 'Legacy cognition ID is empty',
    };
  }

  try {
    let identityInput: CognitionIdentityInput | null = null;
    let canonicalIdentity: CanonicalCognitionEntityIdentity | null = null;
    let sessionId: string | null = null;

    switch (row.kind) {
      case 'episode':
        identityInput = {
          kind: row.kind,
          scope: scopeFor(row.siteId),
          occurrenceId: legacyId.value,
        } as const;
        sessionId = row.sessionId;
        break;
      case 'knowledge':
        identityInput = {
          kind: row.kind,
          scope: scopeFor(row.siteId),
          subject: row.title,
          contentKey: row.content,
        } as const;
        break;
      case 'procedure':
        identityInput = {
          kind: row.kind,
          scope: scopeFor(row.siteId),
          subject: requiredText(row.name, 'procedure name'),
          stepKey: normalizedJsonKey(row.steps, 'procedure steps'),
        } as const;
        break;
      case 'pattern':
        canonicalIdentity = createCognitionPatternIdentity({
          scope: scopeFor(row.siteId),
          type: row.type,
          description: row.description,
          tagsKey: normalizedJsonKey(row.tags, 'pattern tags'),
        });
        break;
    }

    if (canonicalIdentity === null) {
      if (identityInput === null) throw new TypeError('Legacy cognition kind has no identity input');
      canonicalIdentity = createCognitionEntityIdentity(identityInput);
    }
    const provenance = validateCognitionProvenance({
      occurrence: {
        sourceOccurrenceId: legacyId.value,
        producerIdentity: 'legacy-cognition',
        sessionId,
      },
      legacyId: legacyId.value,
    });
    return {
      sourceId: legacyId.value,
      kind: row.kind,
      legacyId: legacyId.value,
      canonicalKey: canonicalIdentity.canonicalId,
      canonicalIdentity,
      provenance,
    };
  } catch (error) {
    return {
      sourceId: legacyId.value,
      kind: row.kind,
      legacyId: legacyId.value,
      canonicalKey: null,
      canonicalIdentity: null,
      provenance: null,
      diagnostic: error instanceof Error ? error.message : 'Invalid legacy cognition row',
    };
  }
}

/** Map legacy rows to identities without persisting keys or resolving collisions. */
export function mapLegacyCognitionRows(
  rows: readonly LegacyCognitionInput[],
): CognitionLegacyMappingReport {
  const mappings = rows.map(mappingFor);
  return { mappings, analysis: analyzeCanonicalMappings(mappings) };
}
