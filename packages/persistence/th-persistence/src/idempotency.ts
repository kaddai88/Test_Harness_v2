import { randomUUID } from 'node:crypto';
import type { IdempotencyRecordRow } from './schema.js';
import { CanonicalUniquenessError } from './uniqueness.js';

export interface IdempotencyUpsertInput {
  readonly domain: string;
  readonly idempotencyKey: string;
  readonly entityKind?: string | null;
  readonly canonicalEntityId?: string | null;
  readonly requestHash?: string | null;
  readonly resultReference?: string | null;
}

export class IdempotencyConflictError extends Error {
  constructor(domain: string, idempotencyKey: string) {
    super(`Idempotency key ${domain}/${idempotencyKey} was replayed with a different request`);
    this.name = 'IdempotencyConflictError';
  }
}

function now(): string {
  return new Date().toISOString();
}

function id(): string {
  return randomUUID();
}

/** JSON-backed lookup/upsert primitive used to validate A2 replay semantics. */
export class JsonFileIdempotencyStore {
  constructor(private readonly db: {
    getData(): { idempotency_records: Record<string, IdempotencyRecordRow> };
    save(): void;
  }) {}

  lookup(domain: string, idempotencyKey: string): IdempotencyRecordRow | null {
    const row = Object.values(this.db.getData().idempotency_records)
      .find((candidate) => candidate.domain === domain && candidate.idempotencyKey === idempotencyKey);
    return row ? { ...row } : null;
  }

  upsert(input: IdempotencyUpsertInput): { record: IdempotencyRecordRow; created: boolean } {
    if (!input.domain.trim() || !input.idempotencyKey.trim()) {
      throw new TypeError('Idempotency domain and key must be non-empty');
    }
    const existing = this.lookup(input.domain, input.idempotencyKey);
    if (existing) {
      if (existing.requestHash !== null && input.requestHash !== undefined
        && existing.requestHash !== input.requestHash) {
        throw new IdempotencyConflictError(input.domain, input.idempotencyKey);
      }
      return { record: existing, created: false };
    }

    const record: IdempotencyRecordRow = {
      recordId: id(),
      domain: input.domain,
      idempotencyKey: input.idempotencyKey,
      entityKind: input.entityKind ?? null,
      canonicalEntityId: input.canonicalEntityId ?? null,
      requestHash: input.requestHash ?? null,
      resultReference: input.resultReference ?? null,
      createdAt: now(),
    };
    this.db.getData().idempotency_records[record.recordId] = record;
    this.db.save();
    return { record: { ...record }, created: true };
  }
}

export function assertUniqueIdempotencyRecords(
  records: readonly IdempotencyRecordRow[],
): void {
  const domains = new Map<string, Map<string, string[]>>();
  for (const record of records) {
    const keys = domains.get(record.domain) ?? new Map<string, string[]>();
    const sourceIds = keys.get(record.idempotencyKey) ?? [];
    sourceIds.push(record.recordId);
    keys.set(record.idempotencyKey, sourceIds);
    domains.set(record.domain, keys);
  }
  for (const [domain, keys] of domains) {
    for (const [key, sourceIds] of keys) {
      if (sourceIds.length > 1) {
        throw new CanonicalUniquenessError(`${domain}/${key}`, [...sourceIds].sort());
      }
    }
  }
}
