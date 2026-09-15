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
import type { SessionRow, ReportRow, SiteProfileRow, CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow } from "../schema.js";
import { assertValidTransition, canonicalSessionStatus, TERMINAL_SESSION_STATES } from "../repositories/transition.js";
import type { PostProcessingStatus } from "@test-harness/th-protocol";
import { assertValidPostProcessingTransition } from "../repositories/post-processing.js";

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

// ── In-memory Session Repository ──

export class InMemorySessionRepository implements SessionRepository {
  private store = new Map<string, SessionRow>();

  async create(input: CreateSessionInput): Promise<SessionRow> {
    const row: SessionRow = {
      id: input.id ?? uuid(),
      targetUrl: input.targetUrl,
      targetConfig: input.targetConfig,
      scanConfig: input.scanConfig,
      status: "pending",
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
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findById(id: string): Promise<SessionRow | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async findAll(filter?: SessionFilter): Promise<SessionRow[]> {
    let rows = Array.from(this.store.values());
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
    const row = this.store.get(id);
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
    const row = this.store.get(id);
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
    const row = this.store.get(id);
    if (row) row.startedAt = now();
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.store.get(id);
    if (row) row.completedAt = now();
  }

  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    const row = this.store.get(id);
    if (row) {
      row.metadata = { ...row.metadata, ...metadata };
    }
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }

  async count(filter?: SessionFilter): Promise<number> {
    if (!filter?.status) return this.store.size;
    let count = 0;
    this.store.forEach((r) => { if (r.status === filter.status) count++; });
    return count;
  }
}

// ── In-memory Report Repository ──

export class InMemoryReportRepository implements ReportRepository {
  private store = new Map<string, ReportRow>();

  async create(input: CreateReportInput): Promise<ReportRow> {
    const row: ReportRow = {
      id: input.id ?? uuid(),
      sessionId: input.sessionId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now(),
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async findBySessionId(sessionId: string): Promise<ReportRow[]> {
    return Array.from(this.store.values())
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ ...r }));
  }

  async findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null> {
    for (const row of this.store.values()) {
      if (row.sessionId === sessionId && row.format === format) return { ...row };
    }
    return null;
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// ── In-memory Site Profile Repository ──

export class InMemorySiteProfileRepository implements SiteProfileRepository {
  private store = new Map<string, SiteProfileRow>();

  async findAll(): Promise<SiteProfileRow[]> {
    return Array.from(this.store.values()).map((r) => ({ ...r }));
  }

  async findById(id: string): Promise<SiteProfileRow | null> {
    const row = this.store.get(id);
    return row ? { ...row } : null;
  }

  async findByBaseUrl(baseUrl: string): Promise<SiteProfileRow | null> {
    for (const row of this.store.values()) {
      if (row.baseUrl === baseUrl) return { ...row };
    }
    return null;
  }

  async create(input: CreateSiteProfileInput): Promise<SiteProfileRow> {
    const row: SiteProfileRow = {
      id: input.id ?? uuid(),
      name: input.name,
      baseUrl: input.baseUrl,
      elementCache: JSON.stringify(input.elementCache ?? []),
      testCount: 0,
      lastTestedAt: null,
      updatedAt: now(),
    };
    this.store.set(row.id, row);
    return { ...row };
  }

  async update(id: string, data: Partial<Pick<SiteProfileRow, 'name' | 'baseUrl' | 'elementCache' | 'testCount' | 'lastTestedAt'>>): Promise<void> {
    const row = this.store.get(id);
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
    const row = this.store.get(id);
    if (row) {
      row.testCount++;
      row.lastTestedAt = now();
      row.updatedAt = now();
    }
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}

// ── In-memory Cognition Repository ──
// All queries use `siteId` (FK to site_profiles) for categorization.

export class InMemoryCognitionRepository implements CognitionRepository {
  private episodes = new Map<string, CognitionEpisodeRow>();
  private knowledge = new Map<string, CognitionKnowledgeRow>();
  private procedures = new Map<string, CognitionProcedureRow>();
  private patterns = new Map<string, CognitionPatternRow>();

  // Episodes — linked to site via siteId
  async listEpisodesBySite(siteId: string): Promise<CognitionEpisodeRow[]> {
    return Array.from(this.episodes.values())
      .filter((r) => r.siteId === siteId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((r) => ({ ...r }));
  }

  async createEpisode(episode: Omit<CognitionEpisodeRow, 'id'>): Promise<CognitionEpisodeRow> {
    const row: CognitionEpisodeRow = { id: uuid(), ...episode };
    this.episodes.set(row.id, row);
    return { ...row };
  }

  async deleteEpisodesBySite(siteId: string): Promise<void> {
    for (const [id, row] of this.episodes) {
      if (row.siteId === siteId) this.episodes.delete(id);
    }
  }

  async countEpisodesBySite(siteId: string): Promise<number> {
    return Array.from(this.episodes.values()).filter((r) => r.siteId === siteId).length;
  }

  // Knowledge — linked to site via siteId (nullable for general knowledge)
  async listKnowledgeBySite(siteId: string): Promise<CognitionKnowledgeRow[]> {
    return Array.from(this.knowledge.values())
      .filter((r) => r.siteId === siteId)
      .sort((a, b) => b.confidence - a.confidence)
      .map((r) => ({ ...r }));
  }

  async listGeneralKnowledge(): Promise<CognitionKnowledgeRow[]> {
    return Array.from(this.knowledge.values())
      .filter((r) => r.siteId === null)
      .sort((a, b) => b.confidence - a.confidence)
      .map((r) => ({ ...r }));
  }

  async getKnowledge(id: string): Promise<CognitionKnowledgeRow | null> {
    const row = this.knowledge.get(id);
    return row ? { ...row } : null;
  }

  async createKnowledge(k: Omit<CognitionKnowledgeRow, 'id' | 'useCount' | 'lastUsed' | 'createdAt'>): Promise<CognitionKnowledgeRow> {
    const row: CognitionKnowledgeRow = { id: uuid(), ...k, useCount: 0, lastUsed: null, createdAt: now() };
    this.knowledge.set(row.id, row);
    return { ...row };
  }

  async updateKnowledge(id: string, data: Partial<Pick<CognitionKnowledgeRow, 'confidence' | 'useCount' | 'lastUsed'>>): Promise<void> {
    const row = this.knowledge.get(id);
    if (row) { Object.assign(row, data); }
  }

  async deleteKnowledge(id: string): Promise<void> {
    this.knowledge.delete(id);
  }

  async deleteKnowledgeBySite(siteId: string): Promise<void> {
    for (const [id, row] of this.knowledge) {
      if (row.siteId === siteId) this.knowledge.delete(id);
    }
  }

  async countKnowledgeBySite(siteId: string): Promise<number> {
    return Array.from(this.knowledge.values()).filter((r) => r.siteId === siteId).length;
  }

  // Procedures — linked to site via siteId
  async listProceduresBySite(siteId: string): Promise<CognitionProcedureRow[]> {
    return Array.from(this.procedures.values())
      .filter((r) => r.siteId === siteId)
      .map((r) => ({ ...r }));
  }

  async createProcedure(p: Omit<CognitionProcedureRow, 'id' | 'useCount' | 'lastUsed'>): Promise<CognitionProcedureRow> {
    const row: CognitionProcedureRow = { id: uuid(), ...p, useCount: 0, lastUsed: null };
    this.procedures.set(row.id, row);
    return { ...row };
  }

  async updateProcedure(id: string, data: Partial<Pick<CognitionProcedureRow, 'successRate' | 'useCount' | 'lastUsed' | 'steps'>>): Promise<void> {
    const row = this.procedures.get(id);
    if (row) { Object.assign(row, data); }
  }

  async deleteProceduresBySite(siteId: string): Promise<void> {
    for (const [id, row] of this.procedures) {
      if (row.siteId === siteId) this.procedures.delete(id);
    }
  }

  async countProceduresBySite(siteId: string): Promise<number> {
    return Array.from(this.procedures.values()).filter((r) => r.siteId === siteId).length;
  }

  // Patterns — linked to site via siteId
  async listPatternsBySite(siteId: string): Promise<CognitionPatternRow[]> {
    return Array.from(this.patterns.values())
      .filter((r) => r.siteId === siteId)
      .map((r) => ({ ...r }));
  }

  async createPattern(p: Omit<CognitionPatternRow, 'id' | 'lastSeen'>): Promise<CognitionPatternRow> {
    const row: CognitionPatternRow = { id: uuid(), ...p, lastSeen: null };
    this.patterns.set(row.id, row);
    return { ...row };
  }

  async updatePattern(id: string, data: Partial<Pick<CognitionPatternRow, 'frequency' | 'confidence' | 'lastSeen'>>): Promise<void> {
    const row = this.patterns.get(id);
    if (row) { Object.assign(row, data); }
  }

  async deletePatternsBySite(siteId: string): Promise<void> {
    for (const [id, row] of this.patterns) {
      if (row.siteId === siteId) this.patterns.delete(id);
    }
  }

  async countPatternsBySite(siteId: string): Promise<number> {
    return Array.from(this.patterns.values()).filter((r) => r.siteId === siteId).length;
  }

  // Bulk — delete all cognition data for a site
  async clearAllBySite(siteId: string): Promise<void> {
    await this.deleteEpisodesBySite(siteId);
    await this.deleteKnowledgeBySite(siteId);
    await this.deleteProceduresBySite(siteId);
    await this.deletePatternsBySite(siteId);
  }
}
