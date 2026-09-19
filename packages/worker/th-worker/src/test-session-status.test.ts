/**
 * Regression tests for P1-E: session status flow.
 *
 * Status semantics:
 *   pending   — session created, AgentLoop has not started
 *   planning  — initializing execution context (tool registry, browser)
 *   running   — AgentLoop is executing actual test actions
 *   completed — AgentLoop finished normally
 *   failed    — execution error
 *
 * Key invariant: the processor must transition planning → running AFTER the
 * tool registry is ready and BEFORE AgentLoop.run() is invoked. The status
 * must never go straight from planning → completed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock the heavy dependencies of TestSessionJobProcessor so we can observe
// the sequence of updateStatus calls without launching browsers or LLMs.
vi.mock("@test-harness/th-tools", () => ({
  ToolRegistry: class {
    private tools: any[] = [];
    register(t: any) { this.tools.push(t); }
    getAll() { return this.tools; }
  },
  createAllTools: () => [],
  createMCPModeTools: async () => [],
  createReportFindingTool: () => ({ id: "report_finding" }),
  closeBrowser: async () => {},
}));

vi.mock("@test-harness/th-agent", () => ({
  AgentLoop: class {
    // Mutable behavior — tests can override what run() does via this hook
    static runBehavior: "complete" | "throw" = "complete";
    async run(_opts: any) {
      if (AgentLoopMock.runBehavior === "throw") {
        throw new Error("simulated agent failure");
      }
      return { sessionId: _opts.sessionId, status: "completed", turns: 1, summary: "ok" };
    }
  },
  createDurableSessionPersistenceStore: () => ({ capabilities: { p2eAtomicSessionPublication: "supported" } }),
}));

// Alias so tests can control the mock behavior
const AgentLoopMock = vi.mocked(
  (await import("@test-harness/th-agent")).AgentLoop as any,
  { partial: true }
) as any;
const profile = { id: 'site-1', name: 'Example', baseUrl: 'example.com',
  canonicalOriginKey: 'https://example.com', elementCache: '[]', testCount: 0,
  lastTestedAt: null, updatedAt: '2026-09-17T00:00:00.000Z' };
const authority = { cognition: {
  retrieveForSession: async () => ({ relevantEpisodes: [], relevantKnowledge: [], relevantProcedures: [], summary: '' }),
  recordSession: async () => {},
}, sites: {
  ensure: vi.fn(async () => ({ result: { record: profile, created: false }, replayed: false })),
  findById: vi.fn(async () => profile),
  update: vi.fn(async () => ({ result: profile, replayed: false })),
  replaceLocatorCache: vi.fn(async () => ({ result: profile, replayed: false })),
  incrementMetric: vi.fn(async () => ({ result: { incremented: true, testCount: 1 }, replayed: false })),
}, metadata: {
  request: { read: vi.fn(async () => ({})) },
  workerResult: { replace: vi.fn(async ({ fields }: any) => fields) },
  p2e: { read: vi.fn(async () => ({})), replace: vi.fn(async ({ fields }: any) => fields), clear: vi.fn(async () => {}) },
} } as any;

vi.mock("@test-harness/th-browser", () => ({
  BrowserDriverDefinition: {},
  SiteProfileCapabilityDefinition: {},
  PlaywrightBrowserProvider: class {
    async launch() { throw new Error("no browser in test"); }
  },
  loadSiteProfile: () => null,
  enrichSiteProfile: () => ({ summary: "no enrichment" }),
  saveSiteProfile: () => {},
  createDefaultSiteProfile: (name: string, baseUrl: string) => ({ name, baseUrl, forms: [], navigations: [],
    constraints: {}, elementCache: [], updatedAt: Date.now() }),
}));

vi.mock("@test-harness/th-report", () => ({
  calculateScore: () => 100,
}));

vi.mock("@test-harness/th-core", () => ({
  THContainer: class {
    events = {
      on: () => ({ dispose: () => {} }),
    };
    register() {}
  },
  valueProvider: (v: any) => v,
  normalizeCanonicalOrigin: (value: string) => new URL(value).origin,
}));

// ─── In-memory session repository with status history ───────────────────────

import type { DatabaseRepositories } from "@test-harness/th-persistence";

function makeRepos() {
  const statusHistory: string[] = [];
  const session = {
    id: "test-session-1",
    targetUrl: "https://example.com",
    targetConfig: {},
    scanConfig: { maxTurns: 5 },
    status: "pending",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    createdBy: null,
    metadata: {},
  };

  const sessions = {
    async findById(id: string) {
      return id === session.id ? { ...session, metadata: { ...session.metadata } } : null;
    },
    async transitionStatus(id: string, options: any) {
      if (id !== session.id) return { applied: false, currentState: session.status };
      const current = session.status === "pending" ? "queued" : session.status;
      if (!options.expected.includes(current)) return { applied: false, currentState: current };
      session.status = options.target;
      statusHistory.push(options.target);
      if (options.sideEffects?.terminalAt) {
        session.completedAt = options.sideEffects.terminalAt;
      }
      return { applied: true, currentState: options.target, previousState: current };
    },
    async transitionPostProcessingStatus() { return { applied: true, currentState: "success" }; },
    async updateStatus(id: string, status: string) {
      if (id !== session.id) return;
      // Record only actual transitions (skip duplicate same-status calls)
      if (statusHistory[statusHistory.length - 1] !== status) {
        statusHistory.push(status);
      }
      session.status = status;
    },
    async updateStartedAt() { session.startedAt = new Date().toISOString(); },
    async updateCompletedAt() { session.completedAt = new Date().toISOString(); },
    async count() { return 1; },
  };

  const sites = {
    async findByBaseUrl() { return null; },
    async create(input: any) {
      return { id: "site-1", name: input.name, baseUrl: input.baseUrl, testCount: 0 };
    },
    async incrementTestCount() {},
  };

  const repos = { sessions, sites } as unknown as DatabaseRepositories & {
    sessions: typeof sessions;
  };
  return { repos, statusHistory, session };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("P1-E: session status flow", () => {
  let activeIntervals = 0;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  beforeEach(() => {
    vi.clearAllMocks();
    activeIntervals = 0;
    globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
      activeIntervals += 1;
      return originalSetInterval(handler, timeout, ...args);
    }) as typeof setInterval;
    globalThis.clearInterval = ((id: number | NodeJS.Timeout) => {
      activeIntervals = Math.max(0, activeIntervals - 1);
      return originalClearInterval(id);
    }) as typeof clearInterval;
    // Suppress console noise from the processor
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    vi.restoreAllMocks();
  });

  it("transitions pending → planning → running → completed", async () => {
    const { TestSessionJobProcessor } = await import("./processors/test-session.js");
    const { repos, statusHistory } = makeRepos();

    const broadcasts: Array<{ type: string; data: any }> = [];
    const processor = new TestSessionJobProcessor({
      repos,
      authority,
      llm: { id: "stub" } as any,
      wsHandler: {
        broadcast(event: any) { broadcasts.push({ type: event.type, data: event }); },
      },
    });

    await processor.process({
      id: "job-1",
      name: "test:execute",
      data: { sessionId: "test-session-1", targetUrl: "https://example.com" },
    } as any);

    // The full lifecycle must be: planning → running → completed
    // (pending is set by the API layer before the job is enqueued)
    expect(statusHistory).toEqual(["planning", "running", "completed"]);
    expect(authority.sites.incrementMetric).toHaveBeenCalledWith({
      scope: { kind: 'session', profileId: 'site-1', sessionId: 'test-session-1' },
    });
    expect(activeIntervals).toBe(0);
  });

  it("broadcasts session:update with running status before execution", async () => {
    const { TestSessionJobProcessor } = await import("./processors/test-session.js");
    const { repos } = makeRepos();

    const broadcasts: Array<{ type: string; status?: string; message?: string }> = [];
    const processor = new TestSessionJobProcessor({
      repos,
      authority,
      llm: { id: "stub" } as any,
      wsHandler: {
        broadcast(event: any) {
          broadcasts.push({ type: event.type, status: event.status, message: event.message });
        },
      },
    });

    await processor.process({
      id: "job-1",
      name: "test:execute",
      data: { sessionId: "test-session-1", targetUrl: "https://example.com" },
    } as any);

    const updates = broadcasts.filter(b => b.type === "session:update");
    const statuses = updates.map(u => u.status);

    // Must include planning then running (in order), no "executing"
    expect(statuses).toContain("planning");
    expect(statuses).toContain("running");
    expect(statuses.indexOf("planning")).toBeLessThan(statuses.indexOf("running"));
    expect(statuses).not.toContain("executing");
  });

  it("marks failed status on processor error", async () => {
    // Make the mocked AgentLoop throw
    AgentLoopMock.runBehavior = "throw";

    const { TestSessionJobProcessor } = await import("./processors/test-session.js");
    const { repos, statusHistory } = makeRepos();

    const processor = new TestSessionJobProcessor({
      repos,
      authority,
      llm: { id: "stub" } as any,
    });

    await expect(processor.process({
      id: "job-1",
      name: "test:execute",
      data: { sessionId: "test-session-1", targetUrl: "https://example.com" },
    } as any)).rejects.toThrow("simulated agent failure");

    // Status must have reached "running" before failing, then end at "failed"
    expect(statusHistory).toEqual(["planning", "running", "failed"]);
    expect(activeIntervals).toBe(0);
  });
});
