/**
 * JSON file-based database — simple persistent storage without native dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { SessionRow, ReportRow, SiteProfileRow, CognitionEpisodeRow, CognitionKnowledgeRow, CognitionProcedureRow, CognitionPatternRow, IdempotencyRecordRow } from '../schema.js';
import { assertValidTransition, canonicalSessionStatus, TERMINAL_SESSION_STATES } from "../repositories/transition.js";
import type { PostProcessingStatus } from "@test-harness/th-protocol";
import { assertValidPostProcessingTransition } from "../repositories/post-processing.js";
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
} from '../repositories/interfaces.js';
import { assertUniqueCanonicalValues } from '../uniqueness.js';
import type { AuthorityData } from '../authority/storage.js';
import { authorityDataFrom, mergeAuthorityChanges } from '../authority/storage.js';

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
    /[xy]/g,
    (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }
  );
}

function now(): string {
  return new Date().toISOString();
}

function normalizeSessionRow(row: Partial<SessionRow> & Pick<SessionRow, 'id' | 'targetUrl' | 'targetConfig' | 'scanConfig' | 'createdAt' | 'createdBy' | 'metadata'>): SessionRow {
  return {
    ...row,
    status: row.status ?? 'pending',
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    cancelRequestedAt: row.cancelRequestedAt ?? null,
    terminalAt: row.terminalAt ?? null,
    statusReason: row.statusReason ?? null,
    postProcessingStatus: row.postProcessingStatus ?? 'not_started',
    postProcessingError: row.postProcessingError ?? null,
  };
}

/** Ensure parent directory exists */
function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** JSON file database */
export class JsonFileDatabase {
  private filePath: string;
  private data: {
    sessions: Record<string, SessionRow>;
    reports: Record<string, ReportRow>;
    sites: Record<string, SiteProfileRow>;
    cognition_episodes: Record<string, CognitionEpisodeRow>;
    cognition_knowledge: Record<string, CognitionKnowledgeRow>;
    cognition_procedures: Record<string, CognitionProcedureRow>;
    cognition_patterns: Record<string, CognitionPatternRow>;
    idempotency_records: Record<string, IdempotencyRecordRow>;
  };
  private lock: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.data = {
      sessions: {},
      reports: {},
      sites: {},
      cognition_episodes: {},
      cognition_knowledge: {},
      cognition_procedures: {},
      cognition_patterns: {},
      idempotency_records: {},
    };

    // Ensure parent directory exists
    ensureDir(filePath);

    // Load existing data
    if (fs.existsSync(filePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // Backward compat: rename old `scans` key → `sessions`
        if (raw.scans && !raw.sessions) {
          raw.sessions = raw.scans;
          delete raw.scans;
        }
        // Drop legacy keys
        delete raw.detectionResults;
        delete raw.scanEvents;
        this.data = {
          sessions: Object.fromEntries(
            Object.entries(raw.sessions ?? {}).map(([id, row]) => [id, normalizeSessionRow(row as SessionRow)]),
          ),
          reports: raw.reports ?? {},
          sites: raw.sites ?? {},
          cognition_episodes: raw.cognition_episodes ?? {},
          cognition_knowledge: raw.cognition_knowledge ?? {},
          cognition_procedures: raw.cognition_procedures ?? {},
          cognition_patterns: raw.cognition_patterns ?? {},
          idempotency_records: raw.idempotency_records ?? {},
        };
      } catch (err) {
        console.warn('[JsonDB] Failed to load existing data, starting fresh:', err);
      }
    }

  }

  save(): void {
    this.writeAtomically(this.data);
  }

  private writeAtomically(data: typeof this.data): void {
    const temporaryPath = `${this.filePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2));
      fs.renameSync(temporaryPath, this.filePath);
    } catch (err) {
      try {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      } catch {
        // Preserve the original commit failure.
      }
      throw err;
    }
  }

  /** Privileged authority commit. Publish memory only after durable file replacement succeeds. */
  commitAuthority(next: AuthorityData, before: AuthorityData): void {
    const mergedAuthority = mergeAuthorityChanges(authorityDataFrom(this.data), before, next);
    const merged = { ...this.data, ...mergedAuthority };
    this.writeAtomically(merged);
    this.data = merged;
  }

  async withTransitionLock<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  close(): void {
    this.save();
  }

  getData() {
    return this.data;
  }
}

// ── JSON File Session Repository ──

export class JsonFileSessionRepository implements SessionRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateSessionInput): Promise<SessionRow> {
    const id = input.id ?? uuid();
    const row: SessionRow = {
      id,
      targetUrl: input.targetUrl,
      targetConfig: input.targetConfig ?? {},
      scanConfig: input.scanConfig ?? {},
      status: 'queued',
      createdAt: now(),
      startedAt: null,
      completedAt: null,
      cancelRequestedAt: null,
      terminalAt: null,
      statusReason: null,
      postProcessingStatus: 'not_started',
      postProcessingError: null,
      createdBy: input.createdBy ?? null,
      metadata: input.metadata ?? {},
      ...(input.requestMetadata
        ? { metadataByOwner: { request: structuredClone(input.requestMetadata) } }
        : {}),
    };
    this.db.getData().sessions[id] = row;
    this.db.save();
    return { ...row };
  }

  async findById(id: string): Promise<SessionRow | null> {
    const row = this.db.getData().sessions[id];
    return row ? { ...row } : null;
  }

  async findAll(filter?: SessionFilter): Promise<SessionRow[]> {
    let rows = Object.values(this.db.getData().sessions);
    if (filter?.status) {
      rows = rows.filter((r) => r.status === filter.status);
    }
    const dir = filter?.orderDir === 'asc' ? 1 : -1;
    const key = filter?.orderBy === 'status' ? 'status' : 'createdAt';
    rows.sort((a, b) => dir * (a[key] as string).localeCompare(b[key] as string));
    if (filter?.offset) rows = rows.slice(filter.offset);
    if (filter?.limit) rows = rows.slice(0, filter.limit);
    return rows.map((r) => ({ ...r }));
  }

  async transitionStatus(id: string, options: TransitionStatusOptions): Promise<TransitionStatusResult> {
    return this.db.withTransitionLock(() => {
      const row = this.db.getData().sessions[id];
      if (!row) return { applied: false, currentState: 'queued' };

      const currentState = canonicalSessionStatus(row.status);
      if (!options.expected.includes(currentState) || TERMINAL_SESSION_STATES.includes(currentState)) {
        return { applied: false, currentState };
      }
      if (options.target === currentState) return { applied: false, currentState };

      assertValidTransition(currentState, options);
      const effects = options.sideEffects ?? {};
      if (effects.cancelRequestedAt !== undefined && row.cancelRequestedAt !== null) {
        throw new Error('cancelRequestedAt is write-once');
      }
      if (effects.terminalAt !== undefined && row.terminalAt !== null) {
        throw new Error('terminalAt is write-once');
      }

      row.status = options.target;
      row.statusReason = options.reason;
      if (effects.cancelRequestedAt !== undefined) row.cancelRequestedAt = effects.cancelRequestedAt;
      if (effects.terminalAt !== undefined) {
        row.terminalAt = effects.terminalAt;
        row.completedAt = effects.terminalAt;
      }
      if (effects.postProcessingStatus !== undefined) row.postProcessingStatus = effects.postProcessingStatus;
      this.db.save();
      return { applied: true, currentState: options.target, previousState: currentState };
    });
  }

  async transitionPostProcessingStatus(id: string, options: PostProcessingTransitionOptions): Promise<PostProcessingTransitionResult> {
    return this.db.withTransitionLock(() => {
      const row = this.db.getData().sessions[id];
      if (!row) return { applied: false, currentState: "not_started" };
      const currentState = row.postProcessingStatus as PostProcessingStatus;
      if (currentState === options.target && options.expected.includes(currentState)) {
        return { applied: false, currentState };
      }
      if (!options.expected.includes(currentState)) return { applied: false, currentState };
      assertValidPostProcessingTransition(row.status, currentState, options);
      row.postProcessingStatus = options.target;
      row.postProcessingError = options.target === "failed" ? options.error ?? null : null;
      this.db.save();
      return { applied: true, currentState: options.target, previousState: currentState };
    });
  }
  async updateStartedAt(id: string): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.startedAt = now();
      this.db.save();
    }
  }

  async updateCompletedAt(id: string): Promise<void> {
    const row = this.db.getData().sessions[id];
    if (row) {
      row.completedAt = now();
      this.db.save();
    }
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().sessions[id];
    this.db.save();
  }

  async count(filter?: SessionFilter): Promise<number> {
    const rows = Object.values(this.db.getData().sessions);
    if (filter?.status) {
      return rows.filter((r) => r.status === filter.status).length;
    }
    return rows.length;
  }
}

// ── JSON File Report Repository ──

export class JsonFileReportRepository implements ReportRepository {
  constructor(private db: JsonFileDatabase) {}

  async create(input: CreateReportInput): Promise<ReportRow> {
    const id = input.id ?? uuid();
    const row: ReportRow = {
      id,
      sessionId: input.sessionId,
      format: input.format,
      content: input.content ?? null,
      data: input.data ?? {},
      createdAt: now(),
    };
    this.db.getData().reports[id] = row;
    this.db.save();
    return { ...row };
  }

  async findBySessionId(sessionId: string): Promise<ReportRow[]> {
    return Object.values(this.db.getData().reports)
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findBySessionIdAndFormat(sessionId: string, format: string): Promise<ReportRow | null> {
    const row = Object.values(this.db.getData().reports).find(
      (r) => r.sessionId === sessionId && r.format === format
    );
    return row ? { ...row } : null;
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().reports[id];
    this.db.save();
  }
}

// ── JSON File Site Profile Repository ──

export class JsonFileSiteProfileRepository implements SiteProfileRepository {
  constructor(private db: JsonFileDatabase) {}

  async findAll(): Promise<SiteProfileRow[]> {
    return Object.values(this.db.getData().sites).map((r) => ({ ...r }));
  }

  async findById(id: string): Promise<SiteProfileRow | null> {
    const row = this.db.getData().sites[id];
    return row ? { ...row } : null;
  }

  async findByBaseUrl(baseUrl: string): Promise<SiteProfileRow | null> {
    const row = Object.values(this.db.getData().sites).find(
      (r) => r.baseUrl === baseUrl
    );
    return row ? { ...row } : null;
  }

  async create(input: CreateSiteProfileInput): Promise<SiteProfileRow> {
    const id = input.id ?? uuid();
    const row: SiteProfileRow = {
      id,
      name: input.name,
      baseUrl: input.baseUrl,
      canonicalOriginKey: input.canonicalOriginKey ?? null,
      elementCache: JSON.stringify(input.elementCache ?? []),
      testCount: 0,
      lastTestedAt: null,
      updatedAt: now(),
    };
    assertUniqueCanonicalValues(
      [...Object.values(this.db.getData().sites), row],
      (candidate) => candidate.canonicalOriginKey,
      (candidate) => candidate.id,
    );
    this.db.getData().sites[id] = row;
    this.db.save();
    return { ...row };
  }

  async update(id: string, data: Partial<Pick<SiteProfileRow, 'name' | 'baseUrl' | 'elementCache' | 'testCount' | 'lastTestedAt'>>): Promise<void> {
    const row = this.db.getData().sites[id];
    if (row) {
      if (data.name !== undefined) row.name = data.name;
      if (data.baseUrl !== undefined) row.baseUrl = data.baseUrl;
      if (data.elementCache !== undefined) row.elementCache = data.elementCache;
      if (data.testCount !== undefined) row.testCount = data.testCount;
      if (data.lastTestedAt !== undefined) row.lastTestedAt = data.lastTestedAt;
      row.updatedAt = now();
      this.db.save();
    }
  }

  async incrementTestCount(id: string): Promise<void> {
    const row = this.db.getData().sites[id];
    if (row) {
      row.testCount++;
      row.lastTestedAt = now();
      row.updatedAt = now();
      this.db.save();
    }
  }

  async delete(id: string): Promise<void> {
    delete this.db.getData().sites[id];
    this.db.save();
  }
}

// ── JSON File Cognition Repository ──
// All queries use `siteId` (FK to site_profiles) for categorization.

export class JsonFileCognitionRepository implements CognitionRepository {
  constructor(private db: JsonFileDatabase) {}

  // Episodes — linked to site via siteId
  async listEpisodesBySite(siteId: string): Promise<CognitionEpisodeRow[]> {
    return Object.values(this.db.getData().cognition_episodes)
      .filter((r) => r.siteId === siteId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((r) => ({ ...r }));
  }

  async createEpisode(episode: Omit<CognitionEpisodeRow, 'id'>): Promise<CognitionEpisodeRow> {
    const id = uuid();
    const row: CognitionEpisodeRow = { id, ...episode };
    assertUniqueCanonicalValues(
      [...Object.values(this.db.getData().cognition_episodes), row],
      (candidate) => candidate.canonicalId,
      (candidate) => candidate.id,
    );
    this.db.getData().cognition_episodes[id] = row;
    this.db.save();
    return { ...row };
  }

  async deleteEpisodesBySite(siteId: string): Promise<void> {
    const data = this.db.getData().cognition_episodes;
    for (const [id, row] of Object.entries(data)) {
      if (row.siteId === siteId) delete data[id];
    }
    this.db.save();
  }

  async countEpisodesBySite(siteId: string): Promise<number> {
    return Object.values(this.db.getData().cognition_episodes)
      .filter((r) => r.siteId === siteId).length;
  }

  // Knowledge — linked to site via siteId (nullable for general knowledge)
  async listKnowledgeBySite(siteId: string): Promise<CognitionKnowledgeRow[]> {
    return Object.values(this.db.getData().cognition_knowledge)
      .filter((r) => r.siteId === siteId)
      .sort((a, b) => b.confidence - a.confidence)
      .map((r) => ({ ...r }));
  }

  async listGeneralKnowledge(): Promise<CognitionKnowledgeRow[]> {
    return Object.values(this.db.getData().cognition_knowledge)
      .filter((r) => r.siteId === null)
      .sort((a, b) => b.confidence - a.confidence)
      .map((r) => ({ ...r }));
  }

  async getKnowledge(id: string): Promise<CognitionKnowledgeRow | null> {
    const row = this.db.getData().cognition_knowledge[id];
    return row ? { ...row } : null;
  }

  async createKnowledge(knowledge: Omit<CognitionKnowledgeRow, 'id' | 'useCount' | 'lastUsed' | 'createdAt'>): Promise<CognitionKnowledgeRow> {
    const id = uuid();
    const row: CognitionKnowledgeRow = {
      id,
      ...knowledge,
      useCount: 0,
      lastUsed: null,
      createdAt: now(),
    };
    assertUniqueCanonicalValues(
      [...Object.values(this.db.getData().cognition_knowledge), row],
      (candidate) => candidate.canonicalId,
      (candidate) => candidate.id,
    );
    this.db.getData().cognition_knowledge[id] = row;
    this.db.save();
    return { ...row };
  }

  async updateKnowledge(id: string, data: Partial<Pick<CognitionKnowledgeRow, 'confidence' | 'useCount' | 'lastUsed'>>): Promise<void> {
    const row = this.db.getData().cognition_knowledge[id];
    if (row) {
      if (data.confidence !== undefined) row.confidence = data.confidence;
      if (data.useCount !== undefined) row.useCount = data.useCount;
      if (data.lastUsed !== undefined) row.lastUsed = data.lastUsed;
      this.db.save();
    }
  }

  async deleteKnowledge(id: string): Promise<void> {
    delete this.db.getData().cognition_knowledge[id];
    this.db.save();
  }

  async deleteKnowledgeBySite(siteId: string): Promise<void> {
    const data = this.db.getData().cognition_knowledge;
    for (const [id, row] of Object.entries(data)) {
      if (row.siteId === siteId) delete data[id];
    }
    this.db.save();
  }

  async countKnowledgeBySite(siteId: string): Promise<number> {
    return Object.values(this.db.getData().cognition_knowledge)
      .filter((r) => r.siteId === siteId).length;
  }

  // Procedures — linked to site via siteId
  async listProceduresBySite(siteId: string): Promise<CognitionProcedureRow[]> {
    return Object.values(this.db.getData().cognition_procedures)
      .filter((r) => r.siteId === siteId)
      .map((r) => ({ ...r }));
  }

  async createProcedure(procedure: Omit<CognitionProcedureRow, 'id' | 'useCount' | 'lastUsed'>): Promise<CognitionProcedureRow> {
    const id = uuid();
    const row: CognitionProcedureRow = {
      id,
      ...procedure,
      useCount: 0,
      lastUsed: null,
    };
    assertUniqueCanonicalValues(
      [...Object.values(this.db.getData().cognition_procedures), row],
      (candidate) => candidate.canonicalId,
      (candidate) => candidate.id,
    );
    this.db.getData().cognition_procedures[id] = row;
    this.db.save();
    return { ...row };
  }

  async updateProcedure(id: string, data: Partial<Pick<CognitionProcedureRow, 'successRate' | 'useCount' | 'lastUsed' | 'steps'>>): Promise<void> {
    const row = this.db.getData().cognition_procedures[id];
    if (row) {
      if (data.successRate !== undefined) row.successRate = data.successRate;
      if (data.useCount !== undefined) row.useCount = data.useCount;
      if (data.lastUsed !== undefined) row.lastUsed = data.lastUsed;
      if (data.steps !== undefined) row.steps = data.steps;
      this.db.save();
    }
  }

  async deleteProceduresBySite(siteId: string): Promise<void> {
    const data = this.db.getData().cognition_procedures;
    for (const [id, row] of Object.entries(data)) {
      if (row.siteId === siteId) delete data[id];
    }
    this.db.save();
  }

  async countProceduresBySite(siteId: string): Promise<number> {
    return Object.values(this.db.getData().cognition_procedures)
      .filter((r) => r.siteId === siteId).length;
  }

  // Patterns — linked to site via siteId
  async listPatternsBySite(siteId: string): Promise<CognitionPatternRow[]> {
    return Object.values(this.db.getData().cognition_patterns)
      .filter((r) => r.siteId === siteId)
      .map((r) => ({ ...r }));
  }

  async createPattern(pattern: Omit<CognitionPatternRow, 'id' | 'lastSeen'>): Promise<CognitionPatternRow> {
    const id = uuid();
    const row: CognitionPatternRow = {
      id,
      ...pattern,
      lastSeen: null,
    };
    assertUniqueCanonicalValues(
      [...Object.values(this.db.getData().cognition_patterns), row],
      (candidate) => candidate.canonicalId,
      (candidate) => candidate.id,
    );
    this.db.getData().cognition_patterns[id] = row;
    this.db.save();
    return { ...row };
  }

  async updatePattern(id: string, data: Partial<Pick<CognitionPatternRow, 'frequency' | 'confidence' | 'lastSeen'>>): Promise<void> {
    const row = this.db.getData().cognition_patterns[id];
    if (row) {
      if (data.frequency !== undefined) row.frequency = data.frequency;
      if (data.confidence !== undefined) row.confidence = data.confidence;
      if (data.lastSeen !== undefined) row.lastSeen = data.lastSeen;
      this.db.save();
    }
  }

  async deletePatternsBySite(siteId: string): Promise<void> {
    const data = this.db.getData().cognition_patterns;
    for (const [id, row] of Object.entries(data)) {
      if (row.siteId === siteId) delete data[id];
    }
    this.db.save();
  }

  async countPatternsBySite(siteId: string): Promise<number> {
    return Object.values(this.db.getData().cognition_patterns)
      .filter((r) => r.siteId === siteId).length;
  }

  // Bulk — delete all cognition data for a site
  async clearAllBySite(siteId: string): Promise<void> {
    await this.deleteEpisodesBySite(siteId);
    await this.deleteKnowledgeBySite(siteId);
    await this.deleteProceduresBySite(siteId);
    await this.deletePatternsBySite(siteId);
    this.db.save();
  }
}
