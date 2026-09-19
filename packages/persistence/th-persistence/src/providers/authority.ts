import { createAuthorityServices } from '../authority/composition.js';
import type { AuthorityCommandPolicy } from '../authority/commands.js';
import {
  SnapshotAuthorityStorage, authorityDataFrom, mergeAuthorityChanges,
  type AuthorityData,
} from '../authority/storage.js';
import type { InMemoryProviderData } from './in-memory.js';
import type { JsonFileDatabase } from './json-file.js';

const denyCommands: AuthorityCommandPolicy = {
  authorize: async () => false,
  verifyScope: async () => false,
  audit: async () => {},
};

function publish(target: AuthorityData, source: AuthorityData): void {
  target.sites = source.sites;
  target.sessions = source.sessions;
  target.cognition_episodes = source.cognition_episodes;
  target.cognition_knowledge = source.cognition_knowledge;
  target.cognition_procedures = source.cognition_procedures;
  target.cognition_patterns = source.cognition_patterns;
  target.idempotency_records = source.idempotency_records;
}

export function createInMemoryAuthorityRuntime(data: InMemoryProviderData) {
  const storage = new SnapshotAuthorityStorage(
    () => authorityDataFrom(data),
    (next, before) => publish(data, mergeAuthorityChanges(authorityDataFrom(data), before, next)),
  );
  return { storage, services: createAuthorityServices(storage, denyCommands) };
}

export function createJsonAuthorityRuntime(database: JsonFileDatabase) {
  const storage = new SnapshotAuthorityStorage(
    () => authorityDataFrom(database.getData()),
    (next, before) => database.commitAuthority(next, before),
  );
  return { storage, services: createAuthorityServices(storage, denyCommands) };
}
