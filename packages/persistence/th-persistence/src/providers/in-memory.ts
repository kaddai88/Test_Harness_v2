/**
 * In-memory repository implementations — no native dependencies.
 *
 * Stores everything in Maps. Data is lost when the process exits.
 * Perfect for development, testing, and demo mode.
 */
import type {
  SessionRepository,
  CreateSessionInput,
  SessionFilter,
  TransitionStatusOptions,
  TransitionStatusResult,
  PostProcessingTransitionOptions,
  PostProcessingTransitionResult,
  ReportRepository,
  CreateReportInput,
  SiteProfileRepository,
  CreateSiteProfileInput,
  CognitionRepository,
} from "../repositories/interfaces.js";
import type { SessionRow, ReportRow, SiteProfileRow, CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow, IdempotencyRecordRow } from "../schema.js";
import type { AuthorityData } from '../authority/storage.js';
import { assertValidTransition, canonicalSessionStatus, TERMINAL_SESSION_STATES } from "../repositories/transition.js";
import type { PostProcessingStatus } from "@test-harness/th-protocol";
import { assertValidPostProcessingTransition } from "../repositories/post-processing.js";
import { assertUniqueCanonicalValues } from "../uniqueness.js";

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }
  );
}

function now(): string {
  return new Date().toISOString();
}

export interface InMemoryProviderData extends AuthorityData {
  reports: Record<string, ReportRow>;
}

export function createInMemoryProviderData(): InMemoryProviderData {
  return {
    sessions: {}, reports: {}, sites: {}, cognition_episodes: {}, cognition_knowledge: {},
    cognition_procedures: {}, cognition_patterns: {}, idempotency_records: {} as Record<string, IdempotencyRecordRow>,
  };
}

// ── In-memory Session Repository ──

export class InMemorySessionRepository implements SessionRepository {
  constructor(private readonly data: InMemoryProviderData = createInMemoryProviderData()) {}

  async create(input: CreateSessionInput): Promise<SessionRow> {
    const row: SessionRow = {
      id: input.id ?? uuid(),
      targetUrl: input.targetUrl,
      targetConfig: input.targetConfig,
      scanConfig: input.scanConfig,
      status: "queued",
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      cancelRequestedAt: null,
      terminalAt: null,
      statusReason: null,
      postProcessingStatus: "not_started",
      postProcessingError: null,
      createdBy: input.createdBy ?? null,
      metadata: input.metadata ?? {},
      ...(input.requestMetadata
        ? { metadataByOwner: { request: structuredClone(input.requestMetadata) } }
        : {}),
    };
    this.data.sessions[row.id] = row;
    return { ...row };
  }

  async findById(id: string): Promise<SessionRow | null> {
    const row = this.data.sessions[id];
    return row ? { ...row } : null;
  }

  async findAll(filter?: SessionFilter): Promise<SessionRow[]> {
    let rows = Object.values(this.data.sessions);
    if (filter?.status) {
      rows = rows.filter((r) => r.status === filter.status);
    }
    const dir = filter?.orderDir === "asc" ? 1 : -1;
    const key = filter?.orderBy === "status" ? "status" : "createdAt";
    rows.sort((a, b) => dir * (a[key] as string).localeCompare(b[key] as string));
    if (filter?.offset) rows = rows.slice(filter.offset);
    if (filter?.limit) rows = rows.slice(0, filter.limit);
    return rows.map((r) => ({ ...r }));
  }

  async transitionStatus(id: string, options: TransitionStatusOptions): Promise<TransitionStatusResult> {
    const row = this.data.sessions[id];
    if (!row) return { applied: false, currentState: "queued" };

    const currentState = canonicalSessionStatus(row.status);
    if (!options.expected.includes(currentState) || TERMINAL_SESSION_STATES.includes(currentState)) {
      return { applied: false, currentState };
    }
    if (options.target === currentState) {
      return { applied: false, currentState };
    }

    assertValidTransition(currentState, options);

    const effects = options.sideEffects ?? {};
    if (effects.cancelRequestedAt !== undefined && row.cancelRequestedAt !== null) {
      throw new Error("cancelRequestedAt is write-once");
    }
    if (effects.terminalAt !== undefined && row.terminalAt !== null) {
      throw new Error("terminalAt is write-once");
    }

    row.status = options.target;
    row.statusReason = options.reason;
    if (effects.cancelRequestedAt !== undefined) row.cancelRequestedAt = effects.cancelRequestedAt;
    if (effects.terminalAt !== undefined) {
      row.terminalAt = effects.terminalAt;
      row.completedAt = effects.terminalAt;
    }
    if (effects.postProcessingStatus !== undefined) {
      row.postProcessingStatus = effects.postProcessingStatus;
    }
    return { applied: true, currentState: options.target, previousState: currentState };
  }

  async transitionPostProcessingStatus(id: string, options: PostProcessingTransitionOptions): Promise<PostProcessingTransitionResult> {
    const row = this.data.sessions[id];
    if (!row) return { applied: false, currentState: "not_started" };
    const currentState = row.postProcessingStatus as PostProcessingStatus;
    if (currentState === options.target && options.expected.includes(currentState)) {
      return { applied: false, currentState };
    }
    if (!options.expected.includes(currentState)) return { applied: false, currentState };
    assertValidPostProcessingTransition(row.status, currentState, options);
    row.postProcessingStatus = options.target;
    row.postProcessingError = options.target === "failed" ? options.error ?? null : null;
    return { applied: true, currentState: options.target, previousState: currentState };
  }
  async updateStartedAt(id: string): Promise<void> {
    const row = this.data.sessions[id];
    if (row) row.startedAt = now();
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.data.sessions[id];
    if (row) row.completedAt = now();
  }

  async delete(id: string): Promise<void> {
    delete this.data.sessions[id];
  }

  async count(filter?: SessionFilter): Promise<number> {
    const rows = Object.values(this.data.sessions);
    return filter?.status ? rows.filter(row => row.status === filter.status).length : rows.length;
  }
}

// ── In-memory Report Repository ──

export class InMemoryReportRepository implements ReportRepository {
  constructor(private readonly data: InMemoryProviderData = createInMemoryProviderData()) {}

  async create(input: CreateReportInput): Promise<ReportRow> {
    const row: ReportRow = {
      id: input.id ?? uuid(),
      sessionId: input.sessionId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now(),
    };
    this.data.reports[row.id] = row;
    return { ...row };
  }

  async findBySessionId(sessionId: string): Promise<ReportRow[]> {
    return Object.values(this.data.reports)
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r }));
  }

  async findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null> {
    for (const row of Object.values(this.data.reports)) {
      if (row.sessionId === sessionId && row.format === format) return { ...row };
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    delete this.data.reports[id];
  }
}

// ── In-memory Site Profile Repository ──

export class InMemorySiteProfileRepository implements SiteProfileRepository {
  constructor(private readonly data: InMemoryProviderData = createInMemoryProviderData()) {}

  async findAll(): Promise<SiteProfileRow[]> {
    return Object.values(this.data.sites).map((r) => ({ ...r }));
  }

  async findById(id: string): Promise<SiteProfileRow | null> {
    const row = this.data.sites[id];
    return row ? { ...row } : null;
  }

  async findByBaseUrl(baseUrl: string): Promise<SiteProfileRow | null> {
    for (const row of Object.values(this.data.sites)) {
      if (row.baseUrl === baseUrl) return { ...row };
    }
    return null;
  }

  async create(input: CreateSiteProfileInput): Promise<SiteProfileRow> {
    const row: SiteProfileRow = {
      id: input.id ?? uuid(),
      name: input.name,
      baseUrl: input.baseUrl,
      canonicalOriginKey: input.canonicalOriginKey ?? null,
      elementCache: JSON.stringify(input.elementCache ?? []),
      testCount: 0,
      lastTestedAt: null,
      updatedAt: now(),
    };
    assertUniqueCanonicalValues(
      [...Object.values(this.data.sites), row],
      (candidate) => candidate.canonicalOriginKey,
      (candidate) => candidate.id,
    );
    this.data.sites[row.id] = row;
    return { ...row };
  }

  async update(id: string, data: Partial<Pick<SiteProfileRow, 'name' | 'baseUrl' | 'elementCache' | 'testCount' | 'lastTestedAt'>>): Promise<void> {
    const row = this.data.sites[id];
    if (row) {
      if (data.name !== undefined) row.name = data.name;
      if (data.baseUrl !== undefined) row.baseUrl = data.baseUrl;
      if (data.elementCache !== undefined) row.elementCache = data.elementCache;
      if (data.testCount !== undefined) row.testCount = data.testCount;
      if (data.lastTestedAt !== undefined) row.lastTestedAt = data.lastTestedAt;
      row.updatedAt = now();
    }
  }

  async incrementTestCount(id: string): Promise<void> {
    const row = this.data.sites[id];
    if (row) {
      row.testCount++;
      row.lastTestedAt = now();
      row.updatedAt = now();
    }
  }

  async delete(id: string): Promise<void> {
    delete this.data.sites[id];
  }
}

// ── In-memory Cognition Repository ──
// All queries use `siteId` (FK to site_profiles) for categorization.

export class InMemoryCognitionRepository implements CognitionRepository {
  constructor(private readonly data: InMemoryProviderData = createInMemoryProviderData()) {}

  // Episodes — linked to site via siteId
  async listEpisodesBySite(siteId: string): Promise<CognitionEpisodeRow[]> {
    return Object.values(this.data.cognition_episodes)
      .filter((r) => r.siteId === siteId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((r) => ({ ...r }));
  }

  async createEpisode(episode: Omit<CognitionEpisodeRow, 'id'>): Promise<CognitionEpisodeRow> {
    const row: CognitionEpisodeRow = { id: uuid(), ...episode };
    assertUniqueCanonicalValues(
      [...Object.values(this.data.cognition_episodes), row], (candidate) => candidate.canonicalId, (candidate) => candidate.id,
    );
    this.data.cognition_episodes[row.id] = row;
    return { ...row };
  }

  async deleteEpisodesBySite(siteId: string): Promise<void> {
    for (const [id, row] of Object.entries(this.data.cognition_episodes)) {
      if (row.siteId === siteId) delete this.data.cognition_episodes[id];
    }
  }

  async countEpisodesBySite(siteId: string): Promise<number> {
    return Object.values(this.data.cognition_episodes).filter((r) => r.siteId === siteId).length;
  }

  // Knowledge — linked to site via siteId (nullable for general knowledge)
  async listKnowledgeBySite(siteId: string): Promise<CognitionKnowledgeRow[]> {
    return Object.values(this.data.cognition_knowledge)
      .filter((r) => r.siteId === siteId)
      .sort((a, b) => b.confidence - a.confidence)
      .map((r) => ({ ...r }));
  }

  async listGeneralKnowledge(): Promise<CognitionKnowledgeRow[]> {
    return Object.values(this.data.cognition_knowledge)
      .filter((r) => r.siteId === null)
      .sort((a, b) => b.confidence - a.confidence)
      .map((r) => ({ ...r }));
  }

  async getKnowledge(id: string): Promise<CognitionKnowledgeRow | null> {
    const row = this.data.cognition_knowledge[id];
    return row ? { ...row } : null;
  }

  async createKnowledge(k: Omit<CognitionKnowledgeRow, 'id' | 'useCount' | 'lastUsed' | 'createdAt'>): Promise<CognitionKnowledgeRow> {
    const row: CognitionKnowledgeRow = { id: uuid(), ...k, useCount: 0, lastUsed: null, createdAt: now() };
    assertUniqueCanonicalValues(
      [...Object.values(this.data.cognition_knowledge), row], (candidate) => candidate.canonicalId, (candidate) => candidate.id,
    );
    this.data.cognition_knowledge[row.id] = row;
    return { ...row };
  }

  async updateKnowledge(id: string, data: Partial<Pick<CognitionKnowledgeRow, 'confidence' | 'useCount' | 'lastUsed'>>): Promise<void> {
    const row = this.data.cognition_knowledge[id];
    if (row) { Object.assign(row, data); }
  }

  async deleteKnowledge(id: string): Promise<void> {
    delete this.data.cognition_knowledge[id];
  }

  async deleteKnowledgeBySite(siteId: string): Promise<void> {
    for (const [id, row] of Object.entries(this.data.cognition_knowledge)) {
      if (row.siteId === siteId) delete this.data.cognition_knowledge[id];
    }
  }

  async countKnowledgeBySite(siteId: string): Promise<number> {
    return Object.values(this.data.cognition_knowledge).filter((r) => r.siteId === siteId).length;
  }

  // Procedures — linked to site via siteId
  async listProceduresBySite(siteId: string): Promise<CognitionProcedureRow[]> {
    return Object.values(this.data.cognition_procedures)
      .filter((r) => r.siteId === siteId)
      .map((r) => ({ ...r }));
  }

  async createProcedure(p: Omit<CognitionProcedureRow, 'id' | 'useCount' | 'lastUsed'>): Promise<CognitionProcedureRow> {
    const row: CognitionProcedureRow = { id: uuid(), ...p, useCount: 0, lastUsed: null };
    assertUniqueCanonicalValues(
      [...Object.values(this.data.cognition_procedures), row], (candidate) => candidate.canonicalId, (candidate) => candidate.id,
    );
    this.data.cognition_procedures[row.id] = row;
    return { ...row };
  }

  async updateProcedure(id: string, data: Partial<Pick<CognitionProcedureRow, 'successRate' | 'useCount' | 'lastUsed' | 'steps'>>): Promise<void> {
    const row = this.data.cognition_procedures[id];
    if (row) { Object.assign(row, data); }
  }

  async deleteProceduresBySite(siteId: string): Promise<void> {
    for (const [id, row] of Object.entries(this.data.cognition_procedures)) {
      if (row.siteId === siteId) delete this.data.cognition_procedures[id];
    }
  }

  async countProceduresBySite(siteId: string): Promise<number> {
    return Object.values(this.data.cognition_procedures).filter((r) => r.siteId === siteId).length;
  }

  // Patterns — linked to site via siteId
  async listPatternsBySite(siteId: string): Promise<CognitionPatternRow[]> {
    return Object.values(this.data.cognition_patterns)
      .filter((r) => r.siteId === siteId)
      .map((r) => ({ ...r }));
  }

  async createPattern(p: Omit<CognitionPatternRow, 'id' | 'lastSeen'>): Promise<CognitionPatternRow> {
    const row: CognitionPatternRow = { id: uuid(), ...p, lastSeen: null };
    assertUniqueCanonicalValues(
      [...Object.values(this.data.cognition_patterns), row], (candidate) => candidate.canonicalId, (candidate) => candidate.id,
    );
    this.data.cognition_patterns[row.id] = row;
    return { ...row };
  }

  async updatePattern(id: string, data: Partial<Pick<CognitionPatternRow, 'frequency' | 'confidence' | 'lastSeen'>>): Promise<void> {
    const row = this.data.cognition_patterns[id];
    if (row) { Object.assign(row, data); }
  }

  async deletePatternsBySite(siteId: string): Promise<void> {
    for (const [id, row] of Object.entries(this.data.cognition_patterns)) {
      if (row.siteId === siteId) delete this.data.cognition_patterns[id];
    }
  }

  async countPatternsBySite(siteId: string): Promise<number> {
    return Object.values(this.data.cognition_patterns).filter((r) => r.siteId === siteId).length;
  }

  // Bulk — delete all cognition data for a site
  async clearAllBySite(siteId: string): Promise<void> {
    await this.deleteEpisodesBySite(siteId);
    await this.deleteKnowledgeBySite(siteId);
    await this.deleteProceduresBySite(siteId);
    await this.deletePatternsBySite(siteId);
  }
}
