/**
 * Session routes — CRUD + enqueue.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import type { TaskQueue } from "@test-harness/th-queue";
import type { Finding } from "@test-harness/th-protocol";
import {
  sendJson,
  readJsonBody,
  parseQuery,
  matchRoute,
} from "../http.js";

export interface SessionRouteDeps {
  repos: DatabaseRepositories;
  queue: TaskQueue;
}

interface CreateSessionRequest {
  targetUrl: string;
  targetConfig?: Record<string, unknown>;
  scanConfig?: Record<string, unknown>;
  /** Test type preset: smoke | confirmation | acceptance | full */
  testType?: "smoke" | "confirmation" | "acceptance" | "full";
}

/** POST /api/v1/sessions — create a new session and enqueue it. */
export async function handleCreateSession(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SessionRouteDeps
): Promise<void> {
  let body: CreateSessionRequest;
  try {
    body = await readJsonBody<CreateSessionRequest>(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!body.targetUrl) {
    sendJson(res, 400, { error: "targetUrl is required" });
    return;
  }

  // Extract images from scanConfig for vision-capable LLMs
  const scanConfig = (body.scanConfig ?? {}) as Record<string, unknown>;
  const uploadedImages = Array.isArray(scanConfig.images) 
    ? scanConfig.images.filter((img): img is string => typeof img === "string")
    : [];

  // Add testType to scanConfig if provided
  if (body.testType) {
    scanConfig.testType = body.testType;
  }

  const session = await deps.repos.sessions.create({
    targetUrl: body.targetUrl,
    targetConfig: body.targetConfig ?? {},
    scanConfig: body.scanConfig ?? {},
    metadata: uploadedImages.length > 0 ? { uploadedImages } : {},
  });

  // Enqueue a test:execute job
  await deps.queue.add(
    "test:execute",
    {
      sessionId: session.id,
      targetUrl: body.targetUrl,
      instructions:
        typeof scanConfig.instructions === "string"
          ? scanConfig.instructions
          : undefined,
    },
    { priority: 0 }
  );

  await deps.repos.sessions.updateStatus(session.id, "pending");

  sendJson(res, 201, session);
}

/** GET /api/v1/sessions — list sessions (paginated). */
export async function handleListSessions(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SessionRouteDeps
): Promise<void> {
  const query = parseQuery(req.url);
  const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);
  const offset = parseInt(query.offset ?? "0", 10);
  const status = query.status;

  const filter = {
    limit,
    offset,
    status,
    orderBy: "created_at" as const,
    orderDir: "desc" as const,
  };

  const [sessions, total] = await Promise.all([
    deps.repos.sessions.findAll(filter),
    deps.repos.sessions.count(status ? { status } : undefined),
  ]);

  sendJson(res, 200, {
    sessions: sessions.map((s) => ({
      ...s,
      score: s.metadata?.score,
      summary: s.metadata?.summary,
      findings: (s.metadata?.findings as Finding[] | undefined) ?? [],
    })),
    total,
    limit,
    offset,
  });
}

/** GET /api/v1/sessions/:id — get session detail with results. */
export async function handleGetSession(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SessionRouteDeps,
  params: Record<string, string>
): Promise<void> {
  const id = params.id;
  if (!id) {
    sendJson(res, 400, { error: "Missing session id" });
    return;
  }
  const session = await deps.repos.sessions.findById(id);
  if (!session) {
    sendJson(res, 404, { error: "Session not found" });
    return;
  }

  // Flatten findings from metadata so the frontend can consume them directly
  const findings =
    (session.metadata?.findings as Finding[] | undefined) ?? [];

  sendJson(res, 200, { ...session, findings, summary: session.metadata?.summary, score: session.metadata?.score });
}

/** DELETE /api/v1/sessions/:id — delete a session. */
export async function handleDeleteSession(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: SessionRouteDeps,
  params: Record<string, string>
): Promise<void> {
  const id = params.id;
  if (!id) {
    sendJson(res, 400, { error: "Missing session id" });
    return;
  }
  const session = await deps.repos.sessions.findById(id);
  if (!session) {
    sendJson(res, 404, { error: "Session not found" });
    return;
  }

  await deps.repos.sessions.delete(id);
  sendJson(res, 200, { deleted: true });
}

/** POST /api/v1/sessions/:id/cancel — cancel a running session. */
export async function handleCancelSession(
  _req: IncomingMessage,
  res: ServerResponse,
  deps: SessionRouteDeps,
  params: Record<string, string>
): Promise<void> {
  const id = params.id;
  if (!id) {
    sendJson(res, 400, { error: "Missing session id" });
    return;
  }
  const session = await deps.repos.sessions.findById(id);
  if (!session) {
    sendJson(res, 404, { error: "Session not found" });
    return;
  }

  if (session.status === "completed" || session.status === "failed") {
    sendJson(res, 409, {
      error: `Cannot cancel session in "${session.status}" status`,
    });
    return;
  }

  await deps.repos.sessions.updateStatus(id, "cancelled");
  await deps.repos.sessions.updateCompletedAt(id);
  sendJson(res, 200, { cancelled: true });
}

/** Route dispatcher for session endpoints. */
export async function dispatchSessionRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: SessionRouteDeps,
  pathname: string
): Promise<boolean> {
  const method = req.method ?? "GET";

  if (method === "POST" && pathname === "/api/v1/sessions") {
    await handleCreateSession(req, res, deps);
    return true;
  }

  if (method === "GET" && pathname === "/api/v1/sessions") {
    await handleListSessions(req, res, deps);
    return true;
  }

  const cancelMatch = matchRoute(
    "/api/v1/sessions/:id/cancel",
    pathname
  );
  if (method === "POST" && cancelMatch) {
    await handleCancelSession(req, res, deps, cancelMatch);
    return true;
  }

  const sessionMatch = matchRoute("/api/v1/sessions/:id", pathname);
  if (sessionMatch) {
    if (method === "GET") {
      await handleGetSession(req, res, deps, sessionMatch);
      return true;
    }
    if (method === "DELETE") {
      await handleDeleteSession(req, res, deps, sessionMatch);
      return true;
    }
  }

  return false;
}
