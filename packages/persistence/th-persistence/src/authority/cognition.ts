import {
  createCognitionEntityIdentity, createCognitionPatternIdentity, mapLegacyCognitionRows,
  validateCognitionScope, validateCognitionProvenance,
  KnowledgeDistiller,
  type CognitionEntityKind, type CognitionScope, type CognitionProvenance,
  type CognitionLearnedEntityPort, type CognitionSessionLookup, type CognitionSessionRecord,
  type Episode, type SemanticKnowledge, type Procedure, type RetrievedExperience,
} from '@test-harness/th-cognition';
import { createHash } from 'node:crypto';
import type {
  CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow,
  CognitionProvenanceRecord,
} from '../schema.js';
import type { AuthorityData, AuthorityStorage } from './storage.js';
import { mutateOnce, stableJson, token, type AuthorityIdempotencyRequest } from './idempotency.js';

type Rows = { episode: CognitionEpisodeRow; knowledge: CognitionKnowledgeRow;
  procedure: CognitionProcedureRow; pattern: CognitionPatternRow };
export type CognitionAuthorityRecord = Rows[CognitionEntityKind];
export type CognitionAuthorityCreateInput = {
  [K in CognitionEntityKind]: {
    readonly kind: K;
    readonly row: Omit<Rows[K], 'canonicalId' | 'provenance'>;
    readonly scope: CognitionScope;
    readonly provenance: CognitionProvenance;
    readonly idempotency: AuthorityIdempotencyRequest;
  }
}[CognitionEntityKind];

export interface CognitionAuthorityTarget {
  readonly kind: CognitionEntityKind;
  readonly canonicalId: string;
  readonly scope: CognitionScope;
}
export interface CognitionAuthorityUpdateInput extends CognitionAuthorityTarget {
  readonly changes: Readonly<Record<string, unknown>>;
  readonly idempotency: AuthorityIdempotencyRequest;
}
export interface CognitionSiteSnapshot {
  readonly episodes: readonly CognitionEpisodeRow[];
  readonly knowledge: readonly CognitionKnowledgeRow[];
  readonly procedures: readonly CognitionProcedureRow[];
  readonly patterns: readonly CognitionPatternRow[];
}
export interface ManualEpisodeInput {
  readonly siteId: string;
  readonly type: string;
  readonly outcome: string;
  readonly description: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly idempotency: AuthorityIdempotencyRequest;
}
export interface KnowledgeConfidenceAdjustment {
  readonly siteId: string;
  readonly rowId: string;
  readonly delta: number;
  readonly idempotency: AuthorityIdempotencyRequest;
}
const TABLES = { episode: 'cognition_episodes', knowledge: 'cognition_knowledge',
  procedure: 'cognition_procedures', pattern: 'cognition_patterns' } as const;
const MUTABLE = { episode: ['outcome', 'description', 'data'], knowledge: ['confidence'],
  procedure: ['successRate'], pattern: ['confidence', 'frequency'] } as const;
const FIELDS = {
  episode: ['id', 'siteId', 'sessionId', 'type', 'outcome', 'description', 'data', 'timestamp'],
  knowledge: ['id', 'siteId', 'type', 'title', 'content', 'confidence', 'useCount', 'lastUsed', 'tags', 'createdAt'],
  procedure: ['id', 'siteId', 'name', 'steps', 'successRate', 'useCount', 'lastUsed'],
  pattern: ['id', 'siteId', 'type', 'description', 'frequency', 'confidence', 'tags', 'lastSeen'],
} as const;

function table(data: AuthorityData, kind: CognitionEntityKind): Record<string, CognitionAuthorityRecord> {
  if (!Object.hasOwn(TABLES, kind)) throw new TypeError('Unsupported cognition kind');
  return data[TABLES[kind]];
}

function canonical(kind: CognitionEntityKind, row: CognitionAuthorityRecord, scope: CognitionScope): string {
  // Reuse the frozen A1 normalization for site/global records.
  if (scope.kind !== 'session') {
    const report = mapLegacyCognitionRows([{ ...row, kind } as Parameters<typeof mapLegacyCognitionRows>[0][number]]);
    const mapping = report.mappings[0];
    if (!mapping?.canonicalKey) throw new TypeError(mapping?.diagnostic ?? 'Invalid cognition identity');
    return mapping.canonicalKey;
  }
  switch (kind) {
    case 'episode': return createCognitionEntityIdentity({ kind, scope, occurrenceId: row.id }).canonicalId;
    case 'knowledge': {
      const value = row as CognitionKnowledgeRow;
      return createCognitionEntityIdentity({ kind, scope, subject: value.title, contentKey: value.content }).canonicalId;
    }
    case 'procedure': {
      const value = row as CognitionProcedureRow;
      return createCognitionEntityIdentity({ kind, scope, subject: value.name, stepKey: stableJson(JSON.parse(value.steps)) }).canonicalId;
    }
    case 'pattern': {
      const value = row as CognitionPatternRow;
      return createCognitionPatternIdentity({ scope, type: value.type, description: value.description,
        tagsKey: stableJson(JSON.parse(value.tags)) }).canonicalId;
    }
  }
}

function validateScope(data: AuthorityData, scope: CognitionScope, row: CognitionAuthorityRecord): void {
  if (row.siteId !== null && !data.sites[token(row.siteId, 'siteId')]) throw new TypeError('Unproven site scope');
  if (scope.kind === 'site' && scope.siteId !== row.siteId) throw new TypeError('Cognition site scope mismatch');
  if (scope.kind === 'global' && row.siteId !== null) throw new TypeError('Global scope cannot have a siteId');
  if (scope.kind === 'session') {
    if (!data.sessions[token(scope.sessionId, 'sessionId')]) throw new TypeError('Unknown session scope');
    // Session-scoped knowledge has no implicit site association.
    if (row.siteId !== null) throw new TypeError('Session scope must not infer a siteId');
  }
}

function provenance(input: CognitionProvenance): CognitionProvenanceRecord {
  const valid = validateCognitionProvenance({
    occurrence: input?.occurrence,
    ...(input?.legacyId === undefined ? {} : { legacyId: input.legacyId.value }),
  });
  return { ...valid.occurrence, ...(valid.legacyId ? { legacyId: valid.legacyId.value } : {}) };
}

function find(data: AuthorityData, target: CognitionAuthorityTarget): CognitionAuthorityRecord | null {
  token(target.canonicalId, 'canonicalId');
  const scope = validateCognitionScope(target.scope);
  const matches = Object.values(table(data, target.kind)).filter(row => row.canonicalId === target.canonicalId);
  if (matches.length > 1) throw new Error('Ambiguous canonical identity');
  const row = matches[0];
  if (!row) return null;
  validateScope(data, scope, row);
  if (canonical(target.kind, row, scope) !== target.canonicalId) throw new TypeError('Canonical identity/scope mismatch');
  return row;
}

function validateRow(kind: CognitionEntityKind, row: CognitionAuthorityRecord): void {
  if (!Object.hasOwn(FIELDS, kind)) throw new TypeError('Unsupported cognition kind');
  for (const key of Object.keys(row)) {
    if (!(FIELDS[kind] as readonly string[]).includes(key)) throw new TypeError('Unmodeled cognition field: ' + key);
  }
  for (const key of FIELDS[kind]) {
    if (!Object.hasOwn(row, key)) throw new TypeError('Missing cognition field: ' + key);
  }
  token(row.id, 'row.id');
  if (kind === 'episode' && row.siteId === null) throw new TypeError('Episode storage requires explicit site scope');
  stableJson(row);
  for (const [key, value] of Object.entries(row)) {
    if (['timestamp', 'confidence', 'frequency', 'successRate', 'useCount'].includes(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Invalid numeric field: ' + key);
    } else if (['lastUsed', 'lastSeen', 'siteId', 'sessionId'].includes(key)) {
      if (value !== null) token(value, key);
    } else if (typeof value !== 'string') throw new TypeError('Invalid text field: ' + key);
  }
  for (const key of ['tags', 'steps', 'data']) {
    if (key in row) {
      const parsed = JSON.parse((row as unknown as Record<string, string>)[key]!);
      if (key !== 'data' && !Array.isArray(parsed)) throw new TypeError(key + ' must be a JSON array');
    }
  }
}

function requireSite(data: AuthorityData, siteId: string): void {
  if (!data.sites[token(siteId, 'siteId')]) throw new TypeError('Unproven site scope');
}

function siteSnapshot(data: AuthorityData, siteId: string): CognitionSiteSnapshot {
  requireSite(data, siteId);
  return {
    episodes: Object.values(data.cognition_episodes).filter(row => row.siteId === siteId)
      .sort((a, b) => b.timestamp - a.timestamp),
    knowledge: Object.values(data.cognition_knowledge).filter(row => row.siteId === siteId)
      .sort((a, b) => b.confidence - a.confidence),
    procedures: Object.values(data.cognition_procedures).filter(row => row.siteId === siteId),
    patterns: Object.values(data.cognition_patterns).filter(row => row.siteId === siteId),
  };
}

function parsedRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parsedArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function asExperience(snapshot: CognitionSiteSnapshot, targetUrl: string): RetrievedExperience {
  const relevantEpisodes: Episode[] = snapshot.episodes.slice(0, 15).map(row => {
    const data = parsedRecord(row.data);
    return {
      id: row.id,
      type: row.type as Episode['type'],
      timestamp: row.timestamp,
      sessionId: row.sessionId ?? '',
      targetUrl,
      description: row.description,
      actions: Array.isArray(data.actions) ? data.actions as Episode['actions'] : [],
      outcome: row.outcome as Episode['outcome'],
      findings: Array.isArray(data.findings) ? data.findings as NonNullable<Episode['findings']> : [],
      tags: Array.isArray(data.tags) ? data.tags as string[] : [targetUrl],
      confidence: typeof data.confidence === 'number' ? data.confidence : 1,
      accessCount: 0,
      lastAccessed: row.timestamp,
    };
  });
  const relevantKnowledge: SemanticKnowledge[] = snapshot.knowledge.slice(0, 10).map(row => ({
    id: row.id,
    type: row.type as SemanticKnowledge['type'],
    timestamp: Date.parse(row.createdAt) || 0,
    title: row.title,
    description: row.content,
    targetUrl,
    content: parsedRecord(row.content),
    sourceEpisodes: [],
    confidence: row.confidence,
    verificationCount: 0,
    useCount: row.useCount,
    lastUsed: row.lastUsed ? Date.parse(row.lastUsed) || 0 : 0,
    tags: parsedArray<string>(row.tags),
  }));
  const relevantProcedures: Procedure[] = snapshot.procedures.slice(0, 10).map(row => ({
    id: row.id,
    type: 'testing_strategy',
    timestamp: 0,
    name: row.name,
    description: row.name,
    targetUrl,
    steps: parsedArray<Procedure['steps'][number]>(row.steps),
    successCount: 0,
    failureCount: 0,
    successRate: row.successRate,
    preconditions: [], triggers: [], tags: [], confidence: row.successRate,
    lastUsed: row.lastUsed ? Date.parse(row.lastUsed) || 0 : 0,
    useCount: row.useCount,
  }));
  const summary = [
    relevantEpisodes.length ? `**Historical sessions**: ${relevantEpisodes.length}` : '',
    relevantKnowledge.length ? `**Site knowledge**: ${relevantKnowledge.length}` : '',
    relevantProcedures.length ? `**Available procedures**: ${relevantProcedures.length}` : '',
  ].filter(Boolean).join('\n');
  return { relevantEpisodes, relevantKnowledge, relevantProcedures, summary };
}

function rowId(kind: string, value: unknown): string {
  return `${kind}-${createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 24)}`;
}

/** Additive service; the existing runtime factories do not instantiate it. */
export class DefaultCognitionAuthorityService implements CognitionLearnedEntityPort {
  #storage: AuthorityStorage;
  constructor(storage: AuthorityStorage) { this.#storage = storage; }

  find(target: CognitionAuthorityTarget): Promise<CognitionAuthorityRecord | null> {
    const copy = structuredClone(target);
    return this.#storage.read(data => find(data, copy));
  }

  listBySite(siteId: string): Promise<CognitionSiteSnapshot> {
    const key = token(siteId, 'siteId');
    return this.#storage.read(data => siteSnapshot(data, key));
  }

  findByRowId(kind: CognitionEntityKind, rowId: string, siteId: string): Promise<CognitionAuthorityRecord | null> {
    const id = token(rowId, 'rowId');
    const key = token(siteId, 'siteId');
    return this.#storage.read(data => {
      requireSite(data, key);
      const row = table(data, kind)[id];
      if (!row || row.siteId !== key) return null;
      return row;
    });
  }

  async create(input: CognitionAuthorityCreateInput) {
    const copy = structuredClone(input);
    validateRow(copy.kind, copy.row);
    const scope = validateCognitionScope(copy.scope);
    const source = provenance(copy.provenance);
    if (copy.kind === 'episode' && copy.row.sessionId !== source.sessionId) {
      throw new TypeError('Episode session must match its provenance');
    }
    const canonicalId = canonical(copy.kind, copy.row, scope);
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'cognition', copy.kind,
      canonicalId, copy.idempotency, { operation: 'create', scope, row: copy.row, provenance: source }, () => {
        validateScope(data, scope, copy.row);
        if (scope.kind === 'session' && source.sessionId !== scope.sessionId) throw new TypeError('Unproven session provenance');
        const rows = table(data, copy.kind);
        const existing = find(data, { kind: copy.kind, canonicalId, scope });
        if (existing) {
          const sources = existing.provenance ?? [];
          if (!sources.some(value => stableJson(value) === stableJson(source))) existing.provenance = [...sources, source];
          return { record: existing, created: false };
        }
        if (Object.hasOwn(rows, copy.row.id)) throw new Error('Row ID already belongs to another entity');
        const row = { ...copy.row, canonicalId, provenance: [source] };
        rows[row.id] = row;
        return { record: row, created: true };
      }));
  }

  /** Import-only atomic insert. Existing authority is returned without provenance mutation. */
  async importInsertOnly(input: CognitionAuthorityCreateInput) {
    const copy = structuredClone(input);
    validateRow(copy.kind, copy.row);
    const scope = validateCognitionScope(copy.scope);
    const source = provenance(copy.provenance);
    if (copy.kind === 'episode' && copy.row.sessionId !== source.sessionId) {
      throw new TypeError('Episode session must match its provenance');
    }
    const canonicalId = canonical(copy.kind, copy.row, scope);
    return this.#storage.transaction(data => {
      validateScope(data, scope, copy.row);
      const existing = find(data, { kind: copy.kind, canonicalId, scope });
      if (existing) return { result: { record: existing, inserted: false }, replayed: false };
      return mutateOnce(data.idempotency_records, 'cognition-import', copy.kind, canonicalId,
        copy.idempotency, { operation: 'insert-only', scope, row: copy.row, provenance: source }, () => {
          const rows = table(data, copy.kind);
          if (Object.hasOwn(rows, copy.row.id)) throw new Error('Row ID already belongs to another entity');
          const row = { ...copy.row, canonicalId, provenance: [source] };
          rows[row.id] = row;
          return { record: row, inserted: true };
        });
    });
  }

  async update(input: CognitionAuthorityUpdateInput) {
    const copy = structuredClone(input);
    const scope = validateCognitionScope(copy.scope);
    if (!Object.hasOwn(MUTABLE, copy.kind)) throw new TypeError('Unsupported cognition kind');
    for (const key of Object.keys(copy.changes)) {
      if (!(MUTABLE[copy.kind] as readonly string[]).includes(key)) throw new TypeError('Identity/derived field is not mutable: ' + key);
    }
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'cognition', copy.kind,
      token(copy.canonicalId, 'canonicalId'), copy.idempotency, { operation: 'update', scope, changes: copy.changes }, () => {
        const existing = find(data, copy);
        if (!existing) throw new Error('Cognition update target does not exist');
        const row = { ...existing, ...copy.changes } as CognitionAuthorityRecord;
        const { canonicalId: _key, provenance: _source, ...legacy } = row;
        validateRow(copy.kind, legacy as CognitionAuthorityRecord);
        table(data, copy.kind)[row.id] = row;
        return row;
      }));
  }

  async delete(input: CognitionAuthorityTarget & { readonly idempotency: AuthorityIdempotencyRequest }) {
    const copy = structuredClone(input);
    const scope = validateCognitionScope(copy.scope);
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'cognition', copy.kind,
      token(copy.canonicalId, 'canonicalId'), copy.idempotency, { operation: 'delete', scope }, () => {
        const existing = find(data, copy);
        if (existing) delete table(data, copy.kind)[existing.id];
        return { deleted: existing !== null };
      }));
  }

  async deleteBySite(input: { readonly siteId: string; readonly idempotency: AuthorityIdempotencyRequest }) {
    const siteId = token(input.siteId, 'siteId');
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'cognition', 'site',
      siteId, input.idempotency, { operation: 'delete-by-site', siteId }, () => {
        requireSite(data, siteId);
        let deleted = 0;
        for (const name of Object.values(TABLES)) {
          const rows = data[name] as Record<string, CognitionAuthorityRecord>;
          for (const [id, row] of Object.entries(rows)) {
            if (row.siteId === siteId) { delete rows[id]; deleted++; }
          }
        }
        return { deleted };
      }));
  }

  async createManualEpisode(input: ManualEpisodeInput) {
    const copy = structuredClone(input);
    const siteId = token(copy.siteId, 'siteId');
    const key = token(copy.idempotency?.idempotencyKey, 'idempotencyKey');
    const id = rowId('manual-episode', [siteId, key]);
    const scope = { kind: 'site' as const, siteId };
    const canonicalId = createCognitionEntityIdentity({ kind: 'episode', scope, occurrenceId: id }).canonicalId;
    const payload = { operation: 'manual-episode', siteId, type: token(copy.type, 'type'),
      outcome: token(copy.outcome, 'outcome'), description: token(copy.description, 'description'), data: copy.data };
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'cognition', 'episode',
      canonicalId, copy.idempotency, payload, () => {
        requireSite(data, siteId);
        const existing = find(data, { kind: 'episode', canonicalId, scope });
        if (existing) return existing;
        const timestamp = Date.now();
        const row: CognitionEpisodeRow = { id, canonicalId, siteId, sessionId: null,
          type: payload.type, outcome: payload.outcome, description: payload.description,
          data: stableJson(payload.data), timestamp,
          provenance: [{ producerIdentity: 'api-manual', sessionId: null, sourceOccurrenceId: id }] };
        data.cognition_episodes[id] = row;
        return row;
      }));
  }

  async adjustKnowledgeConfidence(input: KnowledgeConfidenceAdjustment) {
    const copy = structuredClone(input);
    const siteId = token(copy.siteId, 'siteId');
    const id = token(copy.rowId, 'rowId');
    if (typeof copy.delta !== 'number' || !Number.isFinite(copy.delta)) throw new TypeError('delta must be finite');
    return this.#storage.transaction(data => {
      requireSite(data, siteId);
      const row = data.cognition_knowledge[id];
      if (!row || row.siteId !== siteId || !row.canonicalId) throw new Error('Knowledge not found');
      return mutateOnce(data.idempotency_records, 'cognition', 'knowledge', row.canonicalId,
        copy.idempotency, { operation: 'adjust-confidence', siteId, rowId: id, delta: copy.delta }, () => {
          const previousConfidence = row.confidence;
          row.confidence = Math.min(1, Math.max(0, row.confidence + copy.delta));
          return { previousConfidence, confidence: row.confidence, record: row };
        });
    });
  }

  async retrieveForSession(input: CognitionSessionLookup): Promise<RetrievedExperience> {
    token(input.sessionId, 'sessionId');
    token(input.targetUrl, 'targetUrl');
    return asExperience(await this.listBySite(input.siteId), input.targetUrl);
  }

  async recordSession(input: CognitionSessionRecord): Promise<void> {
    const siteId = token(input.siteId, 'siteId');
    const sessionId = token(input.sessionId, 'sessionId');
    const targetUrl = token(input.targetUrl, 'targetUrl');
    const episodeId = `session-summary-${sessionId}`;
    await this.create({
      kind: 'episode', scope: { kind: 'site', siteId },
      row: {
        id: episodeId, siteId, sessionId, type: 'session_summary', outcome: input.outcome,
        description: `Session ${input.outcome}: ${input.findings.length} findings`,
        data: stableJson({ actions: input.actions, findings: input.findings, tags: [targetUrl], confidence: 1 }),
        timestamp: input.timestamp,
      },
      provenance: { occurrence: { producerIdentity: 'agent-loop', sessionId, sourceOccurrenceId: episodeId } },
      idempotency: { idempotencyKey: `session:${sessionId}:episode` },
    });

    const experiences = asExperience(await this.listBySite(siteId), targetUrl);
    const distilled = new KnowledgeDistiller().distill(experiences.relevantEpisodes.slice(0, 50));
    for (const item of distilled) {
      const content = stableJson(item.content);
      const id = rowId('knowledge', [item.type, item.title, content]);
      await this.create({
        kind: 'knowledge', scope: { kind: 'site', siteId },
        row: {
          id, siteId, type: item.type, title: item.title, content, confidence: item.confidence,
          useCount: 0, lastUsed: null, tags: '[]', createdAt: new Date(input.timestamp).toISOString(),
        },
        provenance: { occurrence: {
          producerIdentity: 'knowledge-distiller', sessionId, sourceOccurrenceId: `${sessionId}:${id}`,
        } },
        idempotency: { idempotencyKey: `session:${sessionId}:${id}` },
      });
    }
  }
}

export type CognitionAuthorityService = Pick<DefaultCognitionAuthorityService,
  'find' | 'listBySite' | 'findByRowId' | 'create' | 'update' | 'delete' | 'deleteBySite'
  | 'createManualEpisode' | 'adjustKnowledgeConfidence' | 'retrieveForSession' | 'recordSession'>;
