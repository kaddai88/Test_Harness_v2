import { describe, expect, it, vi } from "vitest";
import { handleCreateSession } from "./sessions.js";
import { InMemorySessionRepository } from "@test-harness/th-persistence";

function request(body: unknown) {
  const listeners = new Map<string, (chunk?: Buffer) => void>();
  const req = {
    on(event: string, listener: (chunk?: Buffer) => void) {
      listeners.set(event, listener);
      if (event === "data") listener(Buffer.from(JSON.stringify(body)));
      if (event === "end") listener();
      return req;
    },
  };
  return req as any;
}

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

describe("Gate G create-route lifecycle writer regression", () => {
  it("initializes queued before enqueue without a late status rewrite", async () => {
    const sessions = new InMemorySessionRepository();
    const added: unknown[] = [];
    const out = response();

    await handleCreateSession(request({ targetUrl: "https://example.com", scanConfig: {
      instructions: "test login", images: ["data:image/png;base64,abc"],
    } }), out.res, {
      repos: { sessions },
      queue: { add: vi.fn(async (...args: unknown[]) => { added.push(args); }) },
    } as any);

    expect(out.state.status).toBe(201);
    expect((out.state.body as any).status).toBe("queued");
    expect(added).toHaveLength(1);
    await expect(sessions.findById((out.state.body as any).id)).resolves.toMatchObject({
      status: "queued",
      metadata: {},
      metadataByOwner: { request: {
        instructions: "test login", uploadedImages: ["data:image/png;base64,abc"],
      } },
    });
  });
});
