import type { SessionMetadataByOwner, SessionRow } from './schema.js';

export type SessionMetadataOwner = keyof SessionMetadataByOwner;

export const SESSION_METADATA_OWNER_FIELDS: Readonly<Record<SessionMetadataOwner, readonly string[]>> = {
  request: ['instructions', 'uploadedImages'],
  workerResult: ['summary', 'executionSummary', 'findings', 'activities', 'turns', 'score'],
  p2e: ['persistedSessionState'],
  cognition: ['references'],
  siteProfile: ['references'],
};

function legacyFields(session: SessionRow, owner: SessionMetadataOwner): Record<string, unknown> {
  const legacy: Record<string, unknown> = {};
  for (const key of SESSION_METADATA_OWNER_FIELDS[owner]) {
    if (Object.hasOwn(session.metadata, key)) legacy[key] = session.metadata[key];
    else if (owner === 'request' && Object.hasOwn(session.scanConfig, key)) legacy[key] = session.scanConfig[key];
  }
  return legacy;
}

/** Pure compatibility projection. It never initializes or writes an owner partition. */
export function projectSessionMetadata(session: SessionRow): Record<string, unknown> {
  const projected = structuredClone(session.metadata);
  for (const owner of Object.keys(SESSION_METADATA_OWNER_FIELDS) as SessionMetadataOwner[]) {
    const hasPartition = session.metadataByOwner !== null
      && session.metadataByOwner !== undefined
      && Object.hasOwn(session.metadataByOwner, owner);
    const fields = hasPartition
      ? (session.metadataByOwner?.[owner] ?? {}) as Record<string, unknown>
      : legacyFields(session, owner);
    for (const [key, value] of Object.entries(fields)) {
      if (owner === 'p2e' && key === 'persistedSessionState' && value === null) {
        delete projected.persistedSessionState;
      } else {
        projected[key] = structuredClone(value);
      }
    }
  }
  return projected;
}

export function readLegacySessionMetadataOwner(
  session: SessionRow,
  owner: SessionMetadataOwner,
): Record<string, unknown> {
  return legacyFields(session, owner);
}
