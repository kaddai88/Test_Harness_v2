import { describe, expect, it, vi } from "vitest";
import { InMemorySessionRepository } from "@test-harness/th-persistence";
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

async function runningRepository() {
  const sessions = new InMemorySessionRepository();
  await sessions.create({ id: "s", targetUrl: "https://example.com", targetConfig: {}, scanConfig: {} });
  await sessions.transitionStatus("s", { expected: ["queued"], target: "planning", reason: "lifecycle_start" });
  await sessions.transitionStatus("s", { expected: ["planning"], target: "running", reason: "lifecycle_start" });
  return sessions;
}

describe("Phase 2-G compositional cancel boundaries", () => {
  it("G1: real API route writes cancelling and repository preserves intent", async () => {
    const sessions = await runningRepository();
    const out = response();
    const deps = { repos: { sessions }, queue: { remove: vi.fn() } } as any;

    await handleCancelSession({} as any, out.res, deps, { id: "s" });

    expect(out.state.body).toEqual({ accepted: true });
    await expect(sessions.findById("s")).resolves.toMatchObject({
      status: "cancelling",
      statusReason: "user_cancel_requested",
    });
    expect(deps.queue.remove).not.toHaveBeenCalled();
  });

  it("G2: completed winner makes later real API cancel truthful", async () => {
    const sessions = await runningRepository();
    await sessions.transitionStatus("s", {
      expected: ["running"],
      target: "completed",
      reason: "completion_success",
      sideEffects: { terminalAt: "2026-09-14T00:00:00.000Z", postProcessingStatus: "pending" },
    });

    const out = response();
    await handleCancelSession({} as any, out.res, { repos: { sessions }, queue: { remove: vi.fn() } } as any, { id: "s" });

    expect(out.state.body).toEqual({
      accepted: false,
      alreadyTerminal: true,
      terminalStatus: "completed",
    });
    await expect(sessions.findById("s")).resolves.toMatchObject({ status: "completed" });
  });
});
