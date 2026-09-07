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
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));

// Alias so tests can control the mock behavior
const AgentLoopMock = vi.mocked(
  (await import("@test-harness/th-agent")).AgentLoop as any,
  { partial: true }
) as any;

vi.mock("@test-harness/th-browser", () => ({
  BrowserDriverDefinition: {},
  PlaywrightBrowserProvider: class {
    async launch() { throw new Error("no browser in test"); }
  },
  loadSiteProfile: () => null,
  enrichSiteProfile: () => ({ summary: "no enrichment" }),
  saveSiteProfile: () => {},
  createDefaultSiteProfile: () => ({}),
}));

vi.mock("@test-harness/th-report", () => ({
  calculateScore: () => 100,
}));

vi.mock("@test-harness/th-core", () => ({
  THContainer: class {
    events = {
      on: () => ({ dispose: () => {} }),
    };
  },
  valueProvider: (v: any) => v,
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
    async updateMetadata(id: string, metadata: Record<string, unknown>) {
      session.metadata = { ...session.metadata, ...metadata };
    },
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
  beforeEach(() => {
    // Suppress console noise from the processor
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("transitions pending → planning → running → completed", async () => {
    const { TestSessionJobProcessor } = await import("./processors/test-session.js");
    const { repos, statusHistory } = makeRepos();

    const broadcasts: Array<{ type: string; data: any }> = [];
    const processor = new TestSessionJobProcessor({
      repos,
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
  });

  it("broadcasts session:update with running status before execution", async () => {
    const { TestSessionJobProcessor } = await import("./processors/test-session.js");
    const { repos } = makeRepos();

    const broadcasts: Array<{ type: string; status?: string; message?: string }> = [];
    const processor = new TestSessionJobProcessor({
      repos,
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
      llm: { id: "stub" } as any,
    });

    await expect(processor.process({
      id: "job-1",
      name: "test:execute",
      data: { sessionId: "test-session-1", targetUrl: "https://example.com" },
    } as any)).rejects.toThrow("simulated agent failure");

    // Status must have reached "running" before failing, then end at "failed"
    expect(statusHistory).toEqual(["planning", "running", "failed"]);
  });
});
