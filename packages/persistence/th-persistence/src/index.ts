/**
 * @test-harness/th-persistence
 *
 * Data persistence layer — repositories for sessions, reports, sites, and cognition.
 *
 * Two storage backends:
 * - In-memory (default): pure JS, no native deps, data lost on restart
 * - JSON File: persistent file storage, pure JS
 */

// Schema
export {
  POSTGRES_SCHEMA,
  SQLITE_SCHEMA,
  POSTGRES_A2_UNIQUENESS_SCHEMA,
  SQLITE_A2_UNIQUENESS_SCHEMA,
} from "./schema.js";
export type {
  SessionRow,
  SessionMetadataByOwner,
  ReportRow,
  SiteProfileRow,
  CognitionProvenanceRecord,
  CognitionEpisodeRow,
  CognitionKnowledgeRow,
  CognitionProcedureRow,
  CognitionPatternRow,
  IdempotencyRecordRow,
} from "./schema.js";

export {
  CanonicalBackfillBlockedError,
  assertCanonicalUniqueness,
  prepareCanonicalBackfill,
  applyJsonFileCanonicalBackfill,
  applyJsonFileCanonicalBackfillFile,
} from "./canonical-backfill.js";
export type {
  CanonicalBackfillInput,
  CanonicalBackfillOutput,
  CanonicalBackfillReport,
  JsonCanonicalBackfillOptions,
} from "./canonical-backfill.js";
export {
  IdempotencyConflictError,
  assertUniqueIdempotencyRecords,
  JsonFileIdempotencyStore,
} from "./idempotency.js";
export {
  CanonicalUniquenessError,
  assertUniqueCanonicalValues,
} from "./uniqueness.js";
export type { IdempotencyUpsertInput } from "./idempotency.js";
export { projectSessionMetadata } from './session-metadata.js';

// Phase 2-B authority boundaries (additive; existing callers remain on adapters)
export * from './authority/index.js';

// Repository interfaces
export type {
  SessionRepository,
  CreateSessionInput,
  SessionFilter,
  TransitionSideEffects,
  TransitionStatusOptions,
  TransitionStatusResult,
  PostProcessingTransitionOptions,
  PostProcessingTransitionResult,
  ReportRepository,
  CreateReportInput,
  SiteProfileRepository,
  CreateSiteProfileInput,
  CognitionRepository,
} from "./repositories/interfaces.js";

export { assertValidTransition, canonicalSessionStatus, TERMINAL_SESSION_STATES } from "./repositories/transition.js";

// In-memory implementations (no native deps)
export {
  InMemorySessionRepository,
  InMemoryReportRepository,
  InMemorySiteProfileRepository,
  InMemoryCognitionRepository,
} from "./providers/in-memory.js";

// JSON File implementations (pure JS, persistent)
let _JsonFileSessionRepository: any;
let _JsonFileReportRepository: any;
let _JsonFileSiteProfileRepository: any;
let _JsonFileCognitionRepository: any;
let _JsonFileDatabase: any;

try {
  const jsonFile = await import("./providers/json-file.js");
  _JsonFileSessionRepository = jsonFile.JsonFileSessionRepository;
  _JsonFileReportRepository = jsonFile.JsonFileReportRepository;
  _JsonFileSiteProfileRepository = jsonFile.JsonFileSiteProfileRepository;
  _JsonFileCognitionRepository = jsonFile.JsonFileCognitionRepository;
  _JsonFileDatabase = jsonFile.JsonFileDatabase;
  console.log("[Persistence] JSON file database loaded successfully");
} catch (e) {
  console.error("[Persistence] JSON file database failed to load:", e);
}

// ── Database Factory ──

import {
  InMemorySessionRepository,
  InMemoryReportRepository,
  InMemorySiteProfileRepository,
  InMemoryCognitionRepository,
  createInMemoryProviderData,
} from "./providers/in-memory.js";
import { createInMemoryAuthorityRuntime, createJsonAuthorityRuntime } from './providers/authority.js';
import type { AuthorityServices } from './authority/index.js';
import type {
  SessionRepository,
  ReportRepository,
  SiteProfileRepository,
  CognitionRepository,
} from "./repositories/interfaces.js";

/** All repositories bundled together */
export interface DatabaseRepositories {
  sessions: SessionRepository;
  reports: ReportRepository;
  sites: SiteProfileRepository;
  cognition: CognitionRepository;
}

export interface DatabaseRuntime extends DatabaseRepositories {
  authority: AuthorityServices;
}

/**
 * Create an in-memory database (no native deps).
 * Data is lost when the process exits.
 * This is the default — works everywhere.
 */
export function createInMemoryDatabase(): DatabaseRuntime {
  const data = createInMemoryProviderData();
  return {
    sessions: new InMemorySessionRepository(data),
    reports: new InMemoryReportRepository(data),
    sites: new InMemorySiteProfileRepository(data),
    cognition: new InMemoryCognitionRepository(data),
    authority: createInMemoryAuthorityRuntime(data).services,
  };
}

/**
 * Create a persistent database.
 * Priority: JSON File > In-Memory
 */
export function createDatabase(
  dbPath?: string
): DatabaseRuntime & { close?: () => void } {
  if (!dbPath) {
    return createInMemoryDatabase();
  }

  // Fallback to JSON file database
  if (_JsonFileDatabase) {
    const db = new _JsonFileDatabase(dbPath);
    const authority = createJsonAuthorityRuntime(db).services;
    return {
      sessions: new _JsonFileSessionRepository(db),
      reports: new _JsonFileReportRepository(db),
      sites: new _JsonFileSiteProfileRepository(db),
      cognition: new _JsonFileCognitionRepository(db),
      authority,
      close: () => db.close(),
    };
  }

  // Last resort: in-memory
  console.warn("[Persistence] No persistent storage available. Using in-memory.");
  return createInMemoryDatabase();
}
