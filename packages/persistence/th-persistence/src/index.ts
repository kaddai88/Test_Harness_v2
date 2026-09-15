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
export { POSTGRES_SCHEMA, SQLITE_SCHEMA } from "./schema.js";
export type { SessionRow, ReportRow, SiteProfileRow, CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow } from "./schema.js";

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
} from "./providers/in-memory.js";
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

/**
 * Create an in-memory database (no native deps).
 * Data is lost when the process exits.
 * This is the default — works everywhere.
 */
export function createInMemoryDatabase(): DatabaseRepositories {
  return {
    sessions: new InMemorySessionRepository(),
    reports: new InMemoryReportRepository(),
    sites: new InMemorySiteProfileRepository(),
    cognition: new InMemoryCognitionRepository(),
  };
}

/**
 * Create a persistent database.
 * Priority: JSON File > In-Memory
 */
export function createDatabase(
  dbPath?: string
): DatabaseRepositories & { close?: () => void } {
  if (!dbPath) {
    return createInMemoryDatabase();
  }

  // Fallback to JSON file database
  if (_JsonFileDatabase) {
    const db = new _JsonFileDatabase(dbPath);
    return {
      sessions: new _JsonFileSessionRepository(db),
      reports: new _JsonFileReportRepository(db),
      sites: new _JsonFileSiteProfileRepository(db),
      cognition: new _JsonFileCognitionRepository(db),
      close: () => db.close(),
    };
  }

  // Last resort: in-memory
  console.warn("[Persistence] No persistent storage available. Using in-memory.");
  return createInMemoryDatabase();
}
