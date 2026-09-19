import { createHash, randomUUID } from 'node:crypto';
import type { IdempotencyRecordRow } from '../schema.js';
import { IdempotencyConflictError } from '../idempotency.js';

export interface AuthorityIdempotencyRequest {
  readonly idempotencyKey: string;
}

export function token(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
    || ['current-session', '__proto__', 'constructor', 'prototype'].includes(value)) {
    throw new TypeError(`${label} must be an explicit non-empty token`);
  }
  return value;
}

/** Stable JSON rejects values that would be silently lost when persisted. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new TypeError('Authority input must contain JSON values only');
}

/** Called inside the same storage transaction as the entity mutation. */
export async function mutateOnce<T>(
  records: Record<string, IdempotencyRecordRow>, domain: string, entityKind: string,
  canonicalEntityId: string, request: AuthorityIdempotencyRequest, payload: unknown,
  mutation: () => T | Promise<T>,
): Promise<{ readonly result: T; readonly replayed: boolean }> {
  const key = token(request?.idempotencyKey, 'idempotencyKey');
  const requestHash = createHash('sha256').update(stableJson({ entityKind, canonicalEntityId, payload })).digest('hex');
  const matches = Object.values(records).filter(row => row.domain === domain && row.idempotencyKey === key);
  if (matches.length > 1) throw new Error('Ambiguous idempotency records');
  const existing = matches[0];
  if (existing) {
    if (existing.requestHash !== requestHash || existing.entityKind !== entityKind
      || existing.canonicalEntityId !== canonicalEntityId || existing.resultReference === null) {
      throw new IdempotencyConflictError(domain, key);
    }
    return { result: JSON.parse(existing.resultReference) as T, replayed: true };
  }
  const result = await mutation();
  const resultReference = stableJson(result);
  const recordId = randomUUID();
  records[recordId] = { recordId, domain, idempotencyKey: key, entityKind, canonicalEntityId,
    requestHash, resultReference, createdAt: new Date().toISOString() };
  return { result, replayed: false };
}
