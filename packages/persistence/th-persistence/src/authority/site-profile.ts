import { createHash } from 'node:crypto';
import { normalizeCanonicalOrigin } from '@test-harness/th-core';
import type { SiteProfileRow } from '../schema.js';
import type { AuthorityData, AuthorityStorage } from './storage.js';
import { mutateOnce, stableJson, token, type AuthorityIdempotencyRequest } from './idempotency.js';

export type SiteProfileAuthorityScope =
  | { readonly kind: 'profile'; readonly profileId: string }
  | { readonly kind: 'session'; readonly profileId: string; readonly sessionId: string };
export type SiteProfileAuthorityRecord = SiteProfileRow;
export interface SiteProfileAuthorityCreateInput {
  readonly scope: SiteProfileAuthorityScope;
  readonly canonicalOrigin: string;
  readonly name: string;
  readonly idempotency: AuthorityIdempotencyRequest;
}
export interface SiteProfileAuthorityUpdateInput {
  readonly scope: SiteProfileAuthorityScope;
  readonly name: string;
  readonly idempotency: AuthorityIdempotencyRequest;
}
export interface SiteProfileAuthorityEnsureInput {
  readonly canonicalOrigin: string;
  readonly name: string;
  readonly idempotency: AuthorityIdempotencyRequest;
}
export interface SiteProfileAuthorityImportInput {
  readonly profileId: string;
  readonly canonicalOrigin: string;
  readonly name: string;
  readonly elementCache?: readonly unknown[];
  readonly idempotency: AuthorityIdempotencyRequest;
}

function scopeFor(input: SiteProfileAuthorityScope, kind: 'profile' | 'session'): SiteProfileAuthorityScope {
  if (!input || input.kind !== kind) throw new TypeError('Expected explicit ' + kind + ' scope');
  token(input.profileId, 'profileId');
  if (input.kind === 'session') token(input.sessionId, 'sessionId');
  return input;
}
function profile(data: AuthorityData, id: string): SiteProfileRow {
  const row = data.sites[id];
  if (!row) throw new Error('SiteProfile not found: ' + id);
  return row;
}
function onlyKeys(input: object, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new TypeError('Unmodeled or wrong-owner SiteProfile field: ' + key);
  }
}
function idForOrigin(origin: string): string {
  return `site-${createHash('sha256').update(origin).digest('hex').slice(0, 24)}`;
}
function newRecord(id: string, origin: string, name: string, elementCache: readonly unknown[] = []): SiteProfileRow {
  return {
    id,
    name,
    baseUrl: new URL(origin).hostname,
    canonicalOriginKey: origin,
    elementCache: stableJson(elementCache),
    testCount: 0,
    lastTestedAt: null,
    updatedAt: new Date().toISOString(),
  };
}
export class DefaultSiteProfileAuthorityService {
  #storage: AuthorityStorage;
  constructor(storage: AuthorityStorage) { this.#storage = storage; }

  list(): Promise<SiteProfileAuthorityRecord[]> {
    return this.#storage.read(data => Object.values(data.sites)
      .sort((left, right) => (left.canonicalOriginKey ?? left.id).localeCompare(right.canonicalOriginKey ?? right.id)));
  }

  findById(profileId: string): Promise<SiteProfileAuthorityRecord | null> {
    const id = token(profileId, 'profileId');
    return this.#storage.read(data => data.sites[id] ?? null);
  }

  findByOrigin(rawOrigin: string): Promise<SiteProfileAuthorityRecord | null> {
    const canonical = normalizeCanonicalOrigin(rawOrigin);
    return this.#storage.read(data => {
      const matches = Object.values(data.sites).filter(row => row.canonicalOriginKey === canonical);
      if (matches.length > 1) throw new Error('Ambiguous canonical origin');
      return matches[0] ?? null;
    });
  }

  async create(input: SiteProfileAuthorityCreateInput) {
    const copy = structuredClone(input);
    onlyKeys(copy, ['scope', 'canonicalOrigin', 'name', 'idempotency']);
    const scope = scopeFor(copy.scope, 'profile');
    const origin = normalizeCanonicalOrigin(copy.canonicalOrigin);
    const name = token(copy.name, 'name');
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'site-profile', 'site-profile',
      scope.profileId, copy.idempotency, { operation: 'create', scope, origin, name }, () => {
        const existing = Object.values(data.sites).find(row => row.canonicalOriginKey === origin);
        if (existing) {
          if (existing.id !== scope.profileId) throw new Error('Canonical origin already belongs to another profile');
          return { record: existing, created: false };
        }
        if (Object.hasOwn(data.sites, scope.profileId)) throw new Error('Profile ID already belongs to another origin');
        const record = newRecord(scope.profileId, origin, name);
        data.sites[record.id] = record;
        return { record, created: true };
      }));
  }

  async ensure(input: SiteProfileAuthorityEnsureInput) {
    const copy = structuredClone(input);
    onlyKeys(copy, ['canonicalOrigin', 'name', 'idempotency']);
    const origin = normalizeCanonicalOrigin(copy.canonicalOrigin);
    const name = token(copy.name, 'name');
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'site-profile', 'site-profile',
      origin, copy.idempotency, { operation: 'ensure', origin, name }, () => {
        const matches = Object.values(data.sites).filter(row => row.canonicalOriginKey === origin);
        if (matches.length > 1) throw new Error('Ambiguous canonical origin');
        if (matches[0]) return { record: matches[0], created: false };
        const id = idForOrigin(origin);
        if (Object.hasOwn(data.sites, id)) throw new Error('Derived profile ID already belongs to another origin');
        const record = newRecord(id, origin, name);
        data.sites[id] = record;
        return { record, created: true };
      }));
  }

  /** Import-only atomic insert. Existing authority is retained unchanged. */
  async importInsertOnly(input: SiteProfileAuthorityImportInput) {
    const copy = structuredClone(input);
    onlyKeys(copy, ['profileId', 'canonicalOrigin', 'name', 'elementCache', 'idempotency']);
    const profileId = token(copy.profileId, 'profileId');
    const origin = normalizeCanonicalOrigin(copy.canonicalOrigin);
    const name = token(copy.name, 'name');
    const elementCache = copy.elementCache ?? [];
    if (!Array.isArray(elementCache)) throw new TypeError('Locator cache must be an array');
    return this.#storage.transaction(data => {
      const matches = Object.values(data.sites).filter(row => row.canonicalOriginKey === origin);
      if (matches.length > 1) throw new Error('Ambiguous canonical origin');
      if (matches[0]) return { result: { record: matches[0], inserted: false }, replayed: false };
      return mutateOnce(data.idempotency_records, 'site-profile-import', 'site-profile', origin,
        copy.idempotency, { operation: 'insert-only', profileId, origin, name, elementCache }, () => {
          if (Object.hasOwn(data.sites, profileId)) throw new Error('Profile ID already belongs to another origin');
          const record = newRecord(profileId, origin, name, elementCache);
          data.sites[profileId] = record;
          return { record, inserted: true };
        });
    });
  }

  async update(input: SiteProfileAuthorityUpdateInput) {
    const copy = structuredClone(input);
    onlyKeys(copy, ['scope', 'name', 'idempotency']);
    const scope = scopeFor(copy.scope, 'profile');
    const name = token(copy.name, 'name');
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'site-profile', 'site-profile',
      scope.profileId, copy.idempotency, { operation: 'update', scope, name }, () => {
        const row = profile(data, scope.profileId);
        row.name = name;
        row.updatedAt = new Date().toISOString();
        return row;
      }));
  }

  /** Cache replacement has no semantic-field input and preserves profile authority. */
  async replaceLocatorCache(input: {
    readonly scope: SiteProfileAuthorityScope; readonly entries: readonly unknown[];
    readonly idempotency: AuthorityIdempotencyRequest;
  }) {
    const copy = structuredClone(input);
    onlyKeys(copy, ['scope', 'entries', 'idempotency']);
    const scope = scopeFor(copy.scope, 'profile');
    if (!Array.isArray(copy.entries)) throw new TypeError('Locator cache must be an array');
    const cache = stableJson(copy.entries);
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'site-profile-cache', 'site-profile',
      scope.profileId, copy.idempotency, { scope, cache }, () => {
        const row = profile(data, scope.profileId);
        row.elementCache = cache;
        return row;
      }));
  }

  async delete(input: { readonly scope: SiteProfileAuthorityScope; readonly idempotency: AuthorityIdempotencyRequest }) {
    const copy = structuredClone(input);
    const scope = scopeFor(copy.scope, 'profile');
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'site-profile', 'site-profile',
      scope.profileId, copy.idempotency, { operation: 'delete', scope }, () => {
        // Cross-domain deletion requires the later coordinated writer migration.
        for (const rows of [data.cognition_episodes, data.cognition_knowledge, data.cognition_procedures, data.cognition_patterns]) {
          if (Object.values(rows).some(row => row.siteId === scope.profileId)) throw new Error('Profile still owns cognition records');
        }
        const exists = Object.hasOwn(data.sites, scope.profileId);
        delete data.sites[scope.profileId];
        return { deleted: exists };
      }));
  }

  /** The key is derived here; changing a caller request key cannot double-count a session. */
  async incrementMetric(input: { readonly scope: SiteProfileAuthorityScope }) {
    const copy = structuredClone(input);
    onlyKeys(copy, ['scope']);
    const scope = scopeFor(copy.scope, 'session');
    if (scope.kind !== 'session') throw new TypeError('Expected session scope');
    const identity = JSON.stringify([scope.profileId, scope.sessionId]);
    return this.#storage.transaction(data => mutateOnce(data.idempotency_records, 'site-metric', 'site-metric',
      identity, { idempotencyKey: identity }, { scope }, () => {
        const row = profile(data, scope.profileId);
        const session = data.sessions[scope.sessionId];
        if (!session || session.status !== 'completed' || !session.completedAt
          || !Number.isFinite(Date.parse(session.completedAt))) throw new TypeError('Metric requires a completed core session');
        if (normalizeCanonicalOrigin(session.targetUrl) !== row.canonicalOriginKey) throw new TypeError('Session origin does not match profile');
        row.testCount++;
        if (!row.lastTestedAt || Date.parse(session.completedAt) > Date.parse(row.lastTestedAt)) row.lastTestedAt = session.completedAt;
        row.updatedAt = new Date().toISOString();
        return { incremented: true, testCount: row.testCount };
      }));
  }
}
export type SiteProfileAuthorityService = Pick<DefaultSiteProfileAuthorityService,
  'list' | 'findById' | 'findByOrigin' | 'create' | 'ensure' | 'importInsertOnly'
  | 'update' | 'replaceLocatorCache' | 'delete' | 'incrementMetric'>;
