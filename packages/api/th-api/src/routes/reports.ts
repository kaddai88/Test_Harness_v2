/**
 * Report routes — generate and retrieve session reports.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import { ReportGenerator } from "@test-harness/th-report";
import type { Finding } from "@test-harness/th-protocol";
import { sendJson, sendText, parseQuery, matchRoute } from "../http.js";

export interface ReportRouteDeps {
  repos: DatabaseRepositories;
  /** Read-only cutover traffic may render but must not populate the cache. */
  readOnly?: boolean;
}

/** GET /api/v1/sessions/:id/report — get or generate a report. */
export async function handleGetReport(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ReportRouteDeps,
  params: Record<string, string>
): Promise<void> {
  const query = parseQuery(req.url);
  const rawFormat = query.format ?? "json";
  if (rawFormat !== "json" && rawFormat !== "markdown" && rawFormat !== "html") {
    sendJson(res, 400, {
      error: `Unsupported format "${rawFormat}". Use json, markdown, or html.`,
    });
    return;
  }
  const format: "json" | "markdown" | "html" = rawFormat;

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

  // Check if a cached report exists
  const cached = await deps.repos.reports.findBySessionIdAndFormat(
    id,
    format
  );
  if (cached?.content) {
    if (format === "json") {
      sendJson(res, 200, {
        sessionId: session.id,
        format,
        content: cached.content,
        data: cached.data,
      });
    } else {
      const ct = format === "html" ? "text/html" : "text/markdown";
      sendText(res, 200, cached.content, ct);
    }
    return;
  }

  // Generate on-the-fly from stored findings
  const findings =
    (session.metadata?.findings as Finding[] | undefined) ?? [];

  const generator = new ReportGenerator();
  const output = await generator.generate(
    {
      sessionId: session.id,
      targetUrl: session.targetUrl,
      findings,
      summary: session.metadata?.summary as string | undefined,
      startedAt: new Date(session.startedAt ?? session.createdAt),
      completedAt: new Date(session.completedAt ?? Date.now()),
    },
    format
  );

  // Persist for future requests
  if (!deps.readOnly) {
    await deps.repos.reports.create({
      sessionId: session.id,
      format: output.format,
      content: output.content,
      data: output.data,
    });
  }

  if (format === "json") {
    sendJson(res, 200, {
      sessionId: session.id,
      format: output.format,
      content: output.content,
      data: output.data,
    });
  } else {
    const ct = format === "html" ? "text/html" : "text/markdown";
    sendText(res, 200, output.content, ct);
  }
}

/** Route dispatcher for report endpoints. */
export async function dispatchReportRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ReportRouteDeps,
  pathname: string
): Promise<boolean> {
  const method = req.method ?? "GET";

  const reportMatch = matchRoute(
    "/api/v1/sessions/:id/report",
    pathname
  );
  if (method === "GET" && reportMatch) {
    await handleGetReport(req, res, deps, reportMatch);
    return true;
  }

  return false;
}
