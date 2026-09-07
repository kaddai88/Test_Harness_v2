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
  createdBy: string | null;
  metadata: Record<string, unknown>;
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
}

/**
 * CognitionEpisode — a single cognitive experience/event.
 * Linked to a site via siteId (FK → site_profiles.id).
 */
export interface CognitionEpisodeRow {
  id: string;
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
  siteId: string | null;  // FK → site_profiles.id
  type: string;
  description: string;
  frequency: number;
  confidence: number;
  tags: string;           // JSON-serialized string[]
  lastSeen: string | null;
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
  metadata      JSONB NOT NULL DEFAULT '{}'
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
  element_cache  TEXT NOT NULL DEFAULT '[]',
  test_count     INTEGER NOT NULL DEFAULT 0,
  last_tested_at TIMESTAMPTZ,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cognition episodes: linked to site via FK
CREATE TABLE IF NOT EXISTS cognition_episodes (
  id          TEXT PRIMARY KEY,
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
  site_id     TEXT REFERENCES site_profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency   INTEGER NOT NULL DEFAULT 0,
  confidence  REAL NOT NULL DEFAULT 0.5,
  tags        TEXT NOT NULL DEFAULT '[]',
  last_seen   TEXT
);

CREATE INDEX IF NOT EXISTS idx_cog_patterns_site ON cognition_patterns(site_id);
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
  metadata      TEXT NOT NULL DEFAULT '{}'
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
  element_cache  TEXT NOT NULL DEFAULT '[]',
  test_count     INTEGER NOT NULL DEFAULT 0,
  last_tested_at TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cognition_episodes (
  id          TEXT PRIMARY KEY,
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
  site_id      TEXT REFERENCES site_profiles(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  steps        TEXT NOT NULL DEFAULT '[]',
  success_rate REAL NOT NULL DEFAULT 0.0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used    TEXT
);

CREATE TABLE IF NOT EXISTS cognition_patterns (
  id          TEXT PRIMARY KEY,
  site_id     TEXT REFERENCES site_profiles(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  frequency   INTEGER NOT NULL DEFAULT 0,
  confidence  REAL NOT NULL DEFAULT 0.5,
  tags        TEXT NOT NULL DEFAULT '[]',
  last_seen   TEXT
);
`;
