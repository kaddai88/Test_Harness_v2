import type { CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow,
  SessionRow, SiteProfileRow, IdempotencyRecordRow } from '../schema.js';
import { assertUniqueCanonicalValues } from '../uniqueness.js';
import { assertUniqueIdempotencyRecords } from '../idempotency.js';
import { stableJson } from './idempotency.js';

/** Storage-only port. Composition code owns it; application callers receive services. */
export interface AuthorityData {
  sites: Record<string, SiteProfileRow>;
  sessions: Record<string, SessionRow>;
  cognition_episodes: Record<string, CognitionEpisodeRow>;
  cognition_knowledge: Record<string, CognitionKnowledgeRow>;
  cognition_procedures: Record<string, CognitionProcedureRow>;
  cognition_patterns: Record<string, CognitionPatternRow>;
  idempotency_records: Record<string, IdempotencyRecordRow>;
}

export interface AuthorityStorage {
  read<T>(query: (data: AuthorityData) => T): Promise<T>;
  transaction<T>(operation: (data: AuthorityData) => Promise<T> | T): Promise<T>;
}

const TABLE_NAMES = [
  'sites', 'sessions', 'cognition_episodes', 'cognition_knowledge',
  'cognition_procedures', 'cognition_patterns', 'idempotency_records',
] as const satisfies readonly (keyof AuthorityData)[];

export function emptyAuthorityData(): AuthorityData {
  return { sites: {}, sessions: {}, cognition_episodes: {}, cognition_knowledge: {},
    cognition_procedures: {}, cognition_patterns: {}, idempotency_records: {} };
}

export function authorityDataFrom(source: AuthorityData): AuthorityData {
  return Object.fromEntries(TABLE_NAMES.map(name => [name, structuredClone(source[name])])) as unknown as AuthorityData;
}

/**
 * Apply only records changed by an authority transaction. Unrelated provider
 * writes are retained; a concurrent change to the same record fails closed.
 */
export function mergeAuthorityChanges(current: AuthorityData, before: AuthorityData, next: AuthorityData): AuthorityData {
  const encoded = (value: unknown) => value === undefined ? undefined : stableJson(value);
  const merged = authorityDataFrom(current);
  for (const name of TABLE_NAMES) {
    const oldTable = before[name] as Record<string, unknown>;
    const nextTable = next[name] as Record<string, unknown>;
    const currentTable = current[name] as Record<string, unknown>;
    const mergedTable = merged[name] as Record<string, unknown>;
    for (const key of new Set([...Object.keys(oldTable), ...Object.keys(nextTable)])) {
      if (encoded(oldTable[key]) === encoded(nextTable[key])) continue;
      if (encoded(currentTable[key]) !== encoded(oldTable[key])) {
        throw new Error(`Concurrent provider mutation conflict: ${name}.${key}`);
      }
      if (Object.hasOwn(nextTable, key)) mergedTable[key] = structuredClone(nextTable[key]);
      else delete mergedTable[key];
    }
  }
  return merged;
}

export function assertAuthorityData(data: AuthorityData): void {
  assertUniqueCanonicalValues(Object.values(data.sites), row => row.canonicalOriginKey, row => row.id);
  for (const table of [data.cognition_episodes, data.cognition_knowledge, data.cognition_procedures, data.cognition_patterns]) {
    assertUniqueCanonicalValues(Object.values(table), row => row.canonicalId, row => row.id);
  }
  assertUniqueIdempotencyRecords(Object.values(data.idempotency_records));
}

/**
 * One instance per datastore in the supported single-process topology.
 * load returns the current snapshot; commit must atomically publish it or throw
 * without publishing. The pair is privileged adapter composition, not a writer API.
 * No runtime database factory instantiates this adapter in 2-B.
 */
export class SnapshotAuthorityStorage implements AuthorityStorage {
  #tail: Promise<void> = Promise.resolve();
  constructor(
    private readonly load: () => AuthorityData | Promise<AuthorityData>,
    private readonly commit: (data: AuthorityData, before: AuthorityData) => void | Promise<void>,
  ) {}

  private async serialized<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await run(); } finally { release(); }
  }

  read<T>(query: (data: AuthorityData) => T): Promise<T> {
    return this.serialized(async () => structuredClone(query(structuredClone(await this.load()))));
  }

  transaction<T>(operation: (data: AuthorityData) => Promise<T> | T): Promise<T> {
    return this.serialized(async () => {
      const before = await this.load();
      const draft = structuredClone(before);
      const result = structuredClone(await operation(draft));
      assertAuthorityData(draft);
      if (stableJson(before) !== stableJson(draft)) await this.commit(structuredClone(draft), structuredClone(before));
      return result;
    });
  }
}

/** Concrete reference adapter using the existing row representations. */
export class InMemoryAuthorityStorage extends SnapshotAuthorityStorage {
  constructor(seed: Partial<AuthorityData> = {}) {
    let state = structuredClone({ ...emptyAuthorityData(), ...seed });
    super(() => state, next => { state = next; });
  }
}
