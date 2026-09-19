import { describe, expect, it, vi } from "vitest";
import { InMemorySessionRepository } from "@test-harness/th-persistence";
import { handleCancelSession } from "../../../../packages/api/th-api/src/routes/sessions.js";

const profile = { id: 'site-1', name: 'Example', baseUrl: 'example.com',
  canonicalOriginKey: 'https://example.com', elementCache: '[]', testCount: 0,
  lastTestedAt: null, updatedAt: '2026-09-17T00:00:00.000Z' };
const authority = { cognition: {
  retrieveForSession: async () => ({ relevantEpisodes: [], relevantKnowledge: [], relevantProcedures: [], summary: '' }),
  recordSession: async () => {},
}, sites: {
  ensure: async () => ({ result: { record: profile, created: false }, replayed: false }),
  findById: async () => profile,
  update: async () => ({ result: profile, replayed: false }),
  replaceLocatorCache: async () => ({ result: profile, replayed: false }),
  incrementMetric: async () => ({ result: { incremented: true, testCount: 1 }, replayed: false }),
}, metadata: {
  request: { read: async () => ({}) },
  workerResult: { replace: async ({ fields }: any) => fields },
  p2e: { read: async () => ({}), replace: async ({ fields }: any) => fields, clear: async () => {} },
} } as any;

vi.mock("@test-harness/th-tools", () => ({
  ToolRegistry: class {
    register() {}
  },
  createAllTools: () => [],
  createMCPModeTools: async () => [],
  createReportFindingTool: () => ({ id: "report_finding" }),
  closeBrowser: async () => {},
}));

vi.mock("@test-harness/th-agent", () => ({
  AgentLoop: class {
    async run(options: any) {
      return { sessionId: options.sessionId, status: "completed", turns: 1, summary: "done" };
    }
  },
  createDurableSessionPersistenceStore: () => ({ capabilities: { p2eAtomicSessionPublication: "supported" } }),
}));

vi.mock("@test-harness/th-browser", () => ({
  BrowserDriverDefinition: {},
  SiteProfileCapabilityDefinition: {},
  PlaywrightBrowserProvider: class { async launch() { throw new Error("no browser"); } },
  loadSiteProfile: () => null,
  enrichSiteProfile: () => ({ summary: "none" }),
  saveSiteProfile: () => {},
  createDefaultSiteProfile: (name: string, baseUrl: string) => ({ name, baseUrl, forms: [], navigations: [],
    constraints: {}, elementCache: [], updatedAt: Date.now() }),
}));

vi.mock("@test-harness/th-report", () => ({ calculateScore: () => 0 }));

vi.mock("@test-harness/th-core", () => ({
  THContainer: class {
    events = { on: () => ({ dispose: () => {} }) };
    register() {}
  },
  valueProvider: (value: unknown) => value,
  normalizeCanonicalOrigin: (value: string) => new URL(value).origin,
}));

function response() {
  const state: { status?: number; body?: unknown } = {};
  return {
    state,
    res: {
      writeHead(status: number) { state.status = status; },
      end(body: string) { state.body = JSON.parse(body); },
    } as any,
  };
}

async function createSession(sessions: InMemorySessionRepository) {
  return sessions.create({
    id: "s",
    targetUrl: "https://example.com",
    targetConfig: {},
    scanConfig: { maxTurns: 1 },
  });
}

describe("Gate G-R2 production-boundary compositional proof", () => {
  it("G1 backend: real cancel route intent reaches real worker queued short-circuit", async () => {
    const sessions = new InMemorySessionRepository();
    await createSession(sessions);
    const queue = { remove: vi.fn() };
    const deps = { repos: { sessions }, queue } as any;
    const cancel = response();

    await handleCancelSession({} as any, cancel.res, deps, { id: "s" });
    expect(cancel.state.body).toEqual({ accepted: true });
    await expect(sessions.findById("s")).resolves.toMatchObject({ status: "cancelling" });

    const { TestSessionJobProcessor } = await import("./processors/test-session.js");
    const processor = new TestSessionJobProcessor({ repos: {
      sessions,
      sites: {
        findByBaseUrl: async () => null,
        create: async (input: any) => ({ id: "site-1", name: input.name, baseUrl: input.baseUrl }),
        incrementTestCount: async () => {},
      },
    } as any, authority, llm: { id: "stub" } as any });

    await processor.process({ id: "job-1", name: "test:execute", data: {
      sessionId: "s", targetUrl: "https://example.com",
    } } as any);

    await expect(sessions.findById("s")).resolves.toMatchObject({
      status: "cancelled",
      statusReason: "user_cancel_quiesced",
      postProcessingStatus: "not_applicable",
    });
  });

  it("G2 backend: real worker completion then real cancel route preserves completed", async () => {
    const sessions = new InMemorySessionRepository();
    await createSession(sessions);
    const { TestSessionJobProcessor } = await import("./processors/test-session.js");
    const processor = new TestSessionJobProcessor({ repos: {
      sessions,
      sites: {
        findByBaseUrl: async () => null,
        create: async (input: any) => ({ id: "site-1", name: input.name, baseUrl: input.baseUrl }),
        incrementTestCount: async () => {},
      },
    } as any, authority, llm: { id: "stub" } as any });

    await processor.process({ id: "job-1", name: "test:execute", data: {
      sessionId: "s", targetUrl: "https://example.com",
    } } as any);
    await expect(sessions.findById("s")).resolves.toMatchObject({ status: "completed" });

    const cancel = response();
    await handleCancelSession({} as any, cancel.res, {
      repos: { sessions }, queue: { remove: vi.fn() },
    } as any, { id: "s" });

    expect(cancel.state.body).toEqual({
      accepted: false,
      alreadyTerminal: true,
      terminalStatus: "completed",
    });
    await expect(sessions.findById("s")).resolves.toMatchObject({ status: "completed" });
  });
});
