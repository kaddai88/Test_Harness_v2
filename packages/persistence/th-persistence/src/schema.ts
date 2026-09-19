/**
 * Database schema — table definitions and SQL schemas.
 *
 * These tables form the persistent storage layer for session data.
 * The schema is provider-neutral — works with both PostgreSQL and SQLite.
 *
 * Data model:
 * - sessions/reports: test execution records
 * - site_profiles: per-site knowledge hub (keyed by normalized hostname)
 * - cognition_*: cognitive data linked to sites via site_id FK
 */

/**
 * Session record — represents a single AI-driven test session.
 *
 * Status flow: pending → planning → running → completed | failed | cancelled
 *   pending:   session created, AgentLoop has not started
 *   planning:  initializing execution context (tool registry, browser)
 *   running:   AgentLoop is executing actual test actions
 *   ("executing" is a legacy synonym for "running" — treat both as active)
 */
export interface SessionRow {
  id: string;
  targetUrl: string;
  targetConfig: Record<string, unknown>;
  scanConfig: Record<string, unknown>;
  status: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelRequestedAt: string | null;
  terminalAt: string | null;
  statusReason: string | null;
  postProcessingStatus: string;
  postProcessingError: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  /** Additive owner-partitioned representation; legacy metadata remains readable. */
  metadataByOwner?: SessionMetadataByOwner | null;
}

export interface SessionMetadataByOwner {
  request?: { instructions?: unknown; uploadedImages?: unknown };
  workerResult?: {
    summary?: unknown;
    executionSummary?: unknown;
    findings?: unknown;
    activities?: unknown;
    turns?: unknown;
    score?: unknown;
  };
  p2e?: { persistedSessionState?: unknown | null };
  cognition?: { references?: unknown };
  siteProfile?: { references?: unknown };
}

/**
 * Report — generated report for a session.
 */
export interface ReportRow {
  id: string;
  sessionId: string;
  format: string;
  content: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

/**
 * SiteProfile — the central hub for all site-specific knowledge.
 *
 * Key design: `baseUrl` is a NORMALIZED hostname (e.g., "bing.com").
 * All cognition data links here via `siteId` foreign key.
 * Same hostname = same site profile, regardless of URL path/query.
 */
export interface SiteProfileRow {
  id: string;
  name: string;
  baseUrl: string;       // Normalized hostname: "bing.com", NOT "https://www.bing.com/search?q=test"
  elementCache: string;  // JSON-serialized CachedElement[]
  testCount: number;     // How many test sessions have been run against this site
  lastTestedAt: string | null;
  updatedAt: string;
  /** Nullable until the approved canonical-origin backfill phase. */
  canonicalOriginKey?: string | null;
}

export interface CognitionProvenanceRecord {
  sourceOccurrenceId: string;
  producerIdentity: string;
  sessionId: string | null;
  legacyId?: string | null;
}

/**
 * CognitionEpisode — a single cognitive experience/event.
 * Linked to a site via siteId (FK → site_profiles.id).
 */
export interface CognitionEpisodeRow {
  id: string;
  /** Nullable until canonical-key backfill is explicitly authorized. */
  canonicalId?: string | null;
  /** Separate source/provenance representation; not part of canonical identity. */
  provenance?: CognitionProvenanceRecord[];
  siteId: string;         // FK → site_profiles.id
  sessionId: string | null; // Optional link to the session that produced this
  type: string;
  outcome: string;
  description: string;
  data: string;           // JSON-serialized episode details
  timestamp: number;
}

/**
 * CognitionKnowledge — learned semantic knowledge.
 * Linked to a site via siteId (FK → site_profiles.id).
 * siteId can be null for general/universal knowledge.
 */
export interface CognitionKnowledgeRow {
  id: string;
  canonicalId?: string | null;
  provenance?: CognitionProvenanceRecord[];
  siteId: string | null;  // FK → site_profiles.id (null = general knowledge)
  type: string;
  title: string;
  content: string;
  confidence: number;
  useCount: number;
  lastUsed: string | null;
  tags: string;           // JSON-serialized string[]
  createdAt: string;
}

/**
 * CognitionProcedure — learned procedural knowledge.
 * Linked to a site via siteId (FK → site_profiles.id).
 */
export interface CognitionProcedureRow {
  id: string;
  canonicalId?: string | null;
  provenance?: CognitionProvenanceRecord[];
  siteId: string | null;  // FK → site_profiles.id
  name: string;
  steps: string;          // JSON-serialized step array
  successRate: number;
  useCount: number;
  lastUsed: string | null;
}

/**
 * CognitionPattern — recognized pattern from learning.
 * Linked to a site via siteId (FK → site_profiles.id).
 */
export interface CognitionPatternRow {
  id: string;
  canonicalId?: string | null;
  provenance?: CognitionProvenanceRecord[];
  siteId: string | null;  // FK → site_profiles.id
  type: string;
  description: string;
  frequency: number;
  confidence: number;
  tags: string;           // JSON-serialized string[]
  lastSeen: string | null;
}

export interface IdempotencyRecordRow {
  recordId: string;
  domain: string;
  idempotencyKey: string;
  entityKind: string | null;
  canonicalEntityId: string | null;
  requestHash: string | null;
  resultReference: string | null;
  createdAt: string;
}

// ── SQL Schema (PostgreSQL) ──

export const POSTGRES_SCHEMA = `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_url    TEXT NOT NULL,
  target_config JSONB NOT NULL DEFAULT '{}',
  scan_config   JSONB NOT NULL DEFAULT '{}',
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_by    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  metadata_by_owner JSONB NOT NULL DEFAULT '{}',
  cancel_requested_at TIMESTAMPTZ,
  terminal_at   TIMESTAMPTZ,
  status_reason TEXT,
  post_processing_status VARCHAR(20) NOT NULL DEFAULT 'not_started',
  post_processing_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  format        TEXT NOT NULL,
  content       TEXT,
  data          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_session_id ON reports(session_id);

-- Site profiles: keyed by normalized hostname
CREATE TABLE IF NOT EXISTS site_profiles (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  base_url       TEXT NOT NULL UNIQUE,  -- normalized hostname: "bing.com"
  canonical_origin_key TEXT,
  element_cache  TEXT NOT NULL DEFAULT '[]',
  test_count     INTEGER NOT NULL DEFAULT 0,
  last_tested_at TIMESTAMPTZ,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cognition episodes: linked to site via FK
CREATE TABLE IF NOT EXISTS cognition_episodes (
  id          TEXT PRIMARY KEY,
  canonical_id TEXT,
  provenance  JSONB NOT NULL DEFAULT '[]',
  site_id     TEXT NOT NULL REFERENCES site_profiles(id) ON DELETE CASCADE,
  session_id  TEXT,
  type        TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL DEFAULT '{}',
  timestamp   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cog_episodes_site ON cognition_episodes(site_id);

-- Cognition knowledge: linked to site via FK (site_id nullable for general knowledge)
CREATE TABLE IF NOT EXISTS cognition_knowledge (
  id          TEXT PRIMARY KEY,
  canonical_id TEXT,
  provenance  JSONB NOT NULL DEFAULT '[]',
  site_id     TEXT REFERENCES site_profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  confidence  REAL NOT NULL DEFAULT 0.5,
  use_count   INTEGER NOT NULL DEFAULT 0,
  last_used   TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cog_knowledge_site ON cognition_knowledge(site_id);

-- Cognition procedures: linked to site via FK
CREATE TABLE IF NOT EXISTS cognition_procedures (
  id           TEXT PRIMARY KEY,
  canonical_id TEXT,
  provenance   JSONB NOT NULL DEFAULT '[]',
  site_id      TEXT REFERENCES site_profiles(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  steps        TEXT NOT NULL DEFAULT '[]',
  success_rate REAL NOT NULL DEFAULT 0.0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used    TEXT
);

CREATE INDEX IF NOT EXISTS idx_cog_procedures_site ON cognition_procedures(site_id);

-- Cognition patterns: linked to site via FK
CREATE TABLE IF NOT EXISTS cognition_patterns (
  id          TEXT PRIMARY KEY,
  canonical_id TEXT,
  provenance  JSONB NOT NULL DEFAULT '[]',
  site_id     TEXT REFERENCES site_profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency   INTEGER NOT NULL DEFAULT 0,
  confidence  REAL NOT NULL DEFAULT 0.5,
  tags        TEXT NOT NULL DEFAULT '[]',
  last_seen   TEXT
);

CREATE INDEX IF NOT EXISTS idx_cog_patterns_site ON cognition_patterns(site_id);
CREATE INDEX IF NOT EXISTS idx_site_profiles_canonical_origin
  ON site_profiles(canonical_origin_key);

-- Idempotency representation only; key uniqueness is deferred to 2-A2.
CREATE TABLE IF NOT EXISTS idempotency_records (
  record_id            TEXT PRIMARY KEY,
  domain               TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL,
  entity_kind          TEXT,
  canonical_entity_id  TEXT,
  request_hash         TEXT,
  result_reference     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup
  ON idempotency_records(domain, idempotency_key);
`;

// ── SQL Schema (SQLite for development) ──

export const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  target_url    TEXT NOT NULL,
  target_config TEXT NOT NULL DEFAULT '{}',
  scan_config   TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at    TEXT,
  completed_at  TEXT,
  created_by    TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}',
  metadata_by_owner TEXT NOT NULL DEFAULT '{}',
  cancel_requested_at TEXT,
  terminal_at   TEXT,
  status_reason  TEXT,
  post_processing_status TEXT NOT NULL DEFAULT 'not_started',
  post_processing_error TEXT
);

CREATE TABLE IF NOT EXISTS reports (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  format        TEXT NOT NULL,
  content       TEXT,
  data          TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site_profiles (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  base_url       TEXT NOT NULL UNIQUE,
  canonical_origin_key TEXT,
  element_cache  TEXT NOT NULL DEFAULT '[]',
  test_count     INTEGER NOT NULL DEFAULT 0,
  last_tested_at TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cognition_episodes (
  id          TEXT PRIMARY KEY,
  canonical_id TEXT,
  provenance  TEXT NOT NULL DEFAULT '[]',
  site_id     TEXT NOT NULL REFERENCES site_profiles(id) ON DELETE CASCADE,
  session_id  TEXT,
  type        TEXT NOT NULL,
  outcome     TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  data        TEXT NOT NULL DEFAULT '{}',
  timestamp   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cognition_knowledge (
  id          TEXT PRIMARY KEY,
  canonical_id TEXT,
  provenance  TEXT NOT NULL DEFAULT '[]',
  site_id     TEXT REFERENCES site_profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL DEFAULT '',
  confidence  REAL NOT NULL DEFAULT 0.5,
  use_count   INTEGER NOT NULL DEFAULT 0,
  last_used   TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cognition_procedures (
  id           TEXT PRIMARY KEY,
  canonical_id TEXT,
  provenance   TEXT NOT NULL DEFAULT '[]',
  site_id      TEXT REFERENCES site_profiles(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  steps        TEXT NOT NULL DEFAULT '[]',
  success_rate REAL NOT NULL DEFAULT 0.0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used    TEXT
);

CREATE TABLE IF NOT EXISTS cognition_patterns (
  id          TEXT PRIMARY KEY,
  canonical_id TEXT,
  provenance  TEXT NOT NULL DEFAULT '[]',
  site_id     TEXT REFERENCES site_profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency   INTEGER NOT NULL DEFAULT 0,
  confidence  REAL NOT NULL DEFAULT 0.5,
  tags        TEXT NOT NULL DEFAULT '[]',
  last_seen   TEXT
);

CREATE INDEX IF NOT EXISTS idx_site_profiles_canonical_origin
  ON site_profiles(canonical_origin_key);

-- Idempotency representation only; key uniqueness is deferred to 2-A2.
CREATE TABLE IF NOT EXISTS idempotency_records (
  record_id            TEXT PRIMARY KEY,
  domain               TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL,
  entity_kind          TEXT,
  canonical_entity_id  TEXT,
  request_hash         TEXT,
  result_reference     TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup
  ON idempotency_records(domain, idempotency_key);
`;

/**
 * Post-backfill uniqueness enforcement. Run only after canonical backfill and
 * duplicate verification have completed successfully.
 */
export const POSTGRES_A2_UNIQUENESS_SCHEMA = `
CREATE UNIQUE INDEX IF NOT EXISTS uq_site_profiles_canonical_origin
  ON site_profiles(canonical_origin_key)
  WHERE canonical_origin_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cog_episodes_canonical_id
  ON cognition_episodes(canonical_id)
  WHERE canonical_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cog_knowledge_canonical_id
  ON cognition_knowledge(canonical_id)
  WHERE canonical_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cog_procedures_canonical_id
  ON cognition_procedures(canonical_id)
  WHERE canonical_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cog_patterns_canonical_id
  ON cognition_patterns(canonical_id)
  WHERE canonical_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_idempotency_domain_key
  ON idempotency_records(domain, idempotency_key);
`;

/** SQLite equivalent of the post-backfill uniqueness enforcement. */
export const SQLITE_A2_UNIQUENESS_SCHEMA = POSTGRES_A2_UNIQUENESS_SCHEMA;
