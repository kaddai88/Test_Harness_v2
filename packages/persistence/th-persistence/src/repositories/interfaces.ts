/**
 * Repository interfaces — the data access abstraction layer.
 *
 * These interfaces are provider-neutral. Implementations exist for
 * both PostgreSQL (production) and SQLite (development).
 *
 * Key design: All cognition data is linked to sites via `siteId` (FK).
 * No more free-text `targetUrl` matching — data is categorized by site.
 */
import type { SessionRow, ReportRow, SiteProfileRow, CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow } from "../schema.js";
import type {
  TransitionSideEffects,
  TransitionStatusOptions,
  TransitionStatusResult,
} from "./transition.js";

export type {
  TransitionSideEffects,
  TransitionStatusOptions,
  TransitionStatusResult,
} from "./transition.js";

import type {
  PostProcessingTransitionOptions,
  PostProcessingTransitionResult,
} from "./post-processing.js";

export type {
  PostProcessingTransitionOptions,
  PostProcessingTransitionResult,
} from "./post-processing.js";


export interface CreateSessionInput {
  id?: string;
  targetUrl: string;
  targetConfig: Record<string, unknown>;
  scanConfig: Record<string, unknown>;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionFilter {
  status?: string;
  limit?: number;
  offset?: number;
  orderBy?: "created_at" | "status";
  orderDir?: "asc" | "desc";
}

export interface SessionRepository {
  create(input: CreateSessionInput): Promise<SessionRow>;
  findById(id: string): Promise<SessionRow | null>;
  findAll(filter?: SessionFilter): Promise<SessionRow[]>;
  transitionStatus(id: string, options: TransitionStatusOptions): Promise<TransitionStatusResult>;
  transitionPostProcessingStatus(id: string, options: PostProcessingTransitionOptions): Promise<PostProcessingTransitionResult>;
  updateStartedAt(id: string): Promise<void>;
  updateCompletedAt(id: string): Promise<void>;
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  delete(id: string): Promise<void>;
  count(filter?: SessionFilter): Promise<number>;
}

// ── Report Repository ──

export interface CreateReportInput {
  id?: string;
  sessionId: string;
  format: string;
  content?: string;
  data?: Record<string, unknown>;
}

export interface ReportRepository {
  create(input: CreateReportInput): Promise<ReportRow>;
  findBySessionId(sessionId: string): Promise<ReportRow[]>;
  findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null>;
  delete(id: string): Promise<void>;
}

// ── Site Profile Repository ──

export interface CreateSiteProfileInput {
  id?: string;
  name: string;
  baseUrl: string;       // Normalized hostname
  elementCache?: unknown[];
}

export interface SiteProfileRepository {
  findAll(): Promise<SiteProfileRow[]>;
  findById(id: string): Promise<SiteProfileRow | null>;
  findByBaseUrl(baseUrl: string): Promise<SiteProfileRow | null>;
  create(input: CreateSiteProfileInput): Promise<SiteProfileRow>;
  update(id: string, data: Partial<Pick<SiteProfileRow, 'name' | 'baseUrl' | 'elementCache' | 'testCount' | 'lastTestedAt'>>): Promise<void>;
  incrementTestCount(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}

// ── Cognition Repository ──
// All queries use `siteId` (FK to site_profiles) for categorization.

export interface CognitionRepository {
  // Episodes — linked to site via siteId
  listEpisodesBySite(siteId: string): Promise<CognitionEpisodeRow[]>;
  createEpisode(episode: Omit<CognitionEpisodeRow, 'id'>): Promise<CognitionEpisodeRow>;
  deleteEpisodesBySite(siteId: string): Promise<void>;
  countEpisodesBySite(siteId: string): Promise<number>;

  // Knowledge — linked to site via siteId (nullable for general knowledge)
  listKnowledgeBySite(siteId: string): Promise<CognitionKnowledgeRow[]>;
  listGeneralKnowledge(): Promise<CognitionKnowledgeRow[]>;
  getKnowledge(id: string): Promise<CognitionKnowledgeRow | null>;
  createKnowledge(knowledge: Omit<CognitionKnowledgeRow, 'id' | 'useCount' | 'lastUsed' | 'createdAt'>): Promise<CognitionKnowledgeRow>;
  updateKnowledge(id: string, data: Partial<Pick<CognitionKnowledgeRow, 'confidence' | 'useCount' | 'lastUsed'>>): Promise<void>;
  deleteKnowledge(id: string): Promise<void>;
  deleteKnowledgeBySite(siteId: string): Promise<void>;
  countKnowledgeBySite(siteId: string): Promise<number>;

  // Procedures — linked to site via siteId
  listProceduresBySite(siteId: string): Promise<CognitionProcedureRow[]>;
  createProcedure(procedure: Omit<CognitionProcedureRow, 'id' | 'useCount' | 'lastUsed'>): Promise<CognitionProcedureRow>;
  updateProcedure(id: string, data: Partial<Pick<CognitionProcedureRow, 'successRate' | 'useCount' | 'lastUsed' | 'steps'>>): Promise<void>;
  deleteProceduresBySite(siteId: string): Promise<void>;
  countProceduresBySite(siteId: string): Promise<number>;

  // Patterns — linked to site via siteId
  listPatternsBySite(siteId: string): Promise<CognitionPatternRow[]>;
  createPattern(pattern: Omit<CognitionPatternRow, 'id' | 'lastSeen'>): Promise<CognitionPatternRow>;
  updatePattern(id: string, data: Partial<Pick<CognitionPatternRow, 'frequency' | 'confidence' | 'lastSeen'>>): Promise<void>;
  deletePatternsBySite(siteId: string): Promise<void>;
  countPatternsBySite(siteId: string): Promise<number>;

  // Bulk — delete all cognition data for a site
  clearAllBySite(siteId: string): Promise<void>;
}
