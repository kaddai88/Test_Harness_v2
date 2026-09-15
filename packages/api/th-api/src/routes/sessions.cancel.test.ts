import { describe, expect, it, vi } from "vitest";
import { handleCancelSession } from "./sessions.js";

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

function deps(status: string, transitionResult: any, cancelRequestedAt: string | null = null) {
  const session = {
    id: "s",
    status,
    targetUrl: "https://example.com",
    targetConfig: {},
    scanConfig: {},
    createdAt: "2026-09-14T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    cancelRequestedAt,
    terminalAt: null,
    statusReason: null,
    postProcessingStatus: "not_started",
    postProcessingError: null,
    createdBy: null,
    metadata: {},
  };
  return {
    session,
    repos: {
      sessions: {
        findById: vi.fn(async () => session),
        transitionStatus: vi.fn(async () => transitionResult),
      },
    },
    queue: { remove: vi.fn() },
  } as any;
}

describe("Phase 2-E cancellation intent", () => {
  it("accepts cancellation intent from every active canonical state", async () => {
    for (const current of ["queued", "planning", "running"] as const) {
      const d = deps(current, { applied: true, currentState: "cancelling" });
      const out = response();
      await handleCancelSession({} as any, out.res, d, { id: "s" });
      expect(out.state.body).toEqual({ accepted: true });
      expect(d.repos.sessions.transitionStatus).toHaveBeenCalledWith("s", expect.objectContaining({
        expected: ["queued", "planning", "running"],
        target: "cancelling",
        reason: "user_cancel_requested",
        sideEffects: { cancelRequestedAt: expect.any(String) },
      }));
    }
  });

  it("preserves the original cancellation timestamp for repeated intent", async () => {
    const original = "2026-09-14T00:00:00.000Z";
    const d = deps("cancelling", { applied: false, currentState: "cancelling" }, original);
    const out = response();
    await handleCancelSession({} as any, out.res, d, { id: "s" });
    expect(out.state.body).toEqual({ accepted: true, alreadyCancelling: true });
    expect(d.session.cancelRequestedAt).toBe(original);
    expect(d.repos.sessions.transitionStatus).toHaveBeenCalledTimes(1);
  });

  it("does not mutate an already terminal session", async () => {
    for (const current of ["cancelled", "completed", "failed"] as const) {
      const d = deps(current, { applied: false, currentState: current });
      const out = response();
      await handleCancelSession({} as any, out.res, d, { id: "s" });
      expect(d.session.status).toBe(current);
      expect(d.session.cancelRequestedAt).toBeNull();
    }
  });

  it("fails closed for an unknown lifecycle state", async () => {
    const d = deps("mystery", { applied: false, currentState: "mystery" });
    const out = response();
    await handleCancelSession({} as any, out.res, d, { id: "s" });
    expect(out.state).toEqual({ status: 500, body: { error: "unknown_session_state" } });
    expect(d.session.status).toBe("mystery");
    expect(d.session.cancelRequestedAt).toBeNull();
  });

  it("accepts legacy pending/executing records through the canonical expected set", async () => {
    for (const legacy of ["pending", "executing"] as const) {
      const d = deps(legacy, { applied: true, currentState: "cancelling" });
      const out = response();
      await handleCancelSession({} as any, out.res, d, { id: "s" });
      expect(out.state.body).toEqual({ accepted: true });
      expect(d.session.status).toBe(legacy);
      expect(d.repos.sessions.transitionStatus).toHaveBeenCalledWith("s", expect.objectContaining({
        target: "cancelling",
        reason: "user_cancel_requested",
      }));
    }
  });


  it("is idempotent for cancelling/cancelled and truthful for terminal states", async () => {
    for (const [current, result, body] of [
      ["cancelling", { applied: false, currentState: "cancelling" }, { accepted: true, alreadyCancelling: true }],
      ["cancelled", { applied: false, currentState: "cancelled" }, { accepted: true, alreadyCancelled: true }],
      ["completed", { applied: false, currentState: "completed" }, { accepted: false, alreadyTerminal: true, terminalStatus: "completed" }],
      ["failed", { applied: false, currentState: "failed" }, { accepted: false, alreadyTerminal: true, terminalStatus: "failed" }],
    ] as const) {
      const d = deps(current, result);
      const out = response();
      await handleCancelSession({} as any, out.res, d, { id: "s" });
      expect(out.state.body).toEqual(body);
    }
  });
});
