import type { SessionMetadataByOwner } from '../schema.js';
import {
  readLegacySessionMetadataOwner,
  SESSION_METADATA_OWNER_FIELDS,
} from '../session-metadata.js';
import type { AuthorityStorage } from './storage.js';
import { stableJson, token } from './idempotency.js';

export type MetadataOwner = keyof SessionMetadataByOwner;
const OWNER_FIELDS = SESSION_METADATA_OWNER_FIELDS;
export interface MetadataOwnerMutation<O extends MetadataOwner> {
  readonly sessionId: string;
  readonly fields: NonNullable<SessionMetadataByOwner[O]>;
}
export interface MetadataFieldOwnerService<O extends MetadataOwner> {
  read(sessionId: string): Promise<NonNullable<SessionMetadataByOwner[O]> | null>;
  replace(input: MetadataOwnerMutation<O>): Promise<NonNullable<SessionMetadataByOwner[O]>>;
}
export interface P2EMetadataFieldOwnerService extends MetadataFieldOwnerService<'p2e'> {
  clear(sessionId: string): Promise<void>;
}

/** Owner is bound by composition, never selected by mutation input. */
export class DefaultMetadataFieldOwnerService<O extends MetadataOwner> implements MetadataFieldOwnerService<O> {
  #storage: AuthorityStorage;
  #owner: O;
  constructor(storage: AuthorityStorage, owner: O) {
    if (!Object.hasOwn(OWNER_FIELDS, owner)) throw new TypeError('Unsupported metadata owner');
    this.#storage = storage;
    this.#owner = owner;
  }

  read(sessionId: string): Promise<NonNullable<SessionMetadataByOwner[O]> | null> {
    token(sessionId, 'sessionId');
    return this.#storage.read(data => {
      const session = data.sessions[sessionId];
      if (!session) return null;
      const hasPartition = session.metadataByOwner !== null
        && session.metadataByOwner !== undefined
        && Object.hasOwn(session.metadataByOwner, this.#owner);
      if (hasPartition) return (session.metadataByOwner?.[this.#owner] ?? {}) as NonNullable<SessionMetadataByOwner[O]>;
      return readLegacySessionMetadataOwner(session, this.#owner) as NonNullable<SessionMetadataByOwner[O]>;
    });
  }

  async replace(input: MetadataOwnerMutation<O>): Promise<NonNullable<SessionMetadataByOwner[O]>> {
    if (this.#owner === 'request') throw new TypeError('Request fields are immutable after session creation');
    const copy = structuredClone(input);
    token(copy.sessionId, 'sessionId');
    if (Object.keys(copy).some(key => !['sessionId', 'fields'].includes(key))) throw new TypeError('Owner and mutation mode are fixed by the boundary');
    if (!copy.fields || Array.isArray(copy.fields) || typeof copy.fields !== 'object') throw new TypeError('Metadata fields must be an object');
    for (const field of Object.keys(copy.fields)) {
      if (!OWNER_FIELDS[this.#owner].includes(field)) throw new TypeError('Cross-owner metadata field: ' + field);
    }
    stableJson(copy.fields);
    const fields = copy.fields as Record<string, unknown>;
    if (this.#owner === 'workerResult') {
      if (Object.hasOwn(fields, 'findings') !== Object.hasOwn(fields, 'activities')) {
        throw new TypeError('findings and activities must replace one result snapshot');
      }
      if ('findings' in fields && (!Array.isArray(fields.findings) || !Array.isArray(fields.activities))) {
        throw new TypeError('findings and activities must be arrays');
      }
    }
    return this.#storage.transaction(data => {
      const session = data.sessions[copy.sessionId];
      if (!session) throw new Error('Session not found');
      const owners = session.metadataByOwner ?? {};
      const previous = owners[this.#owner];
      const next = { ...previous, ...copy.fields } as NonNullable<SessionMetadataByOwner[O]>;
      // This merges only named fields within a validated, bound owner partition.
      session.metadataByOwner = { ...owners, [this.#owner]: next };
      return next;
    });
  }

  async clear(sessionId: string): Promise<void> {
    if (this.#owner !== 'p2e') throw new TypeError('Clear is supported only by the P2E metadata owner');
    token(sessionId, 'sessionId');
    await this.#storage.transaction(data => {
      const session = data.sessions[sessionId];
      if (!session) throw new Error('Session not found');
      session.metadataByOwner = {
        ...(session.metadataByOwner ?? {}),
        p2e: { persistedSessionState: null },
      };
    });
  }
}
