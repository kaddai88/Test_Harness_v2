/**
 * APIServer — HTTP + WebSocket server built on Node.js `http`.
 *
 * No external framework dependencies. Routes are dispatched manually.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { DatabaseRepositories } from "@test-harness/th-persistence";
import type { AuthorityServices } from '@test-harness/th-persistence/authority';
import type { TaskQueue } from "@test-harness/th-queue";
import { applyCors, getPathname, sendJson } from "./http.js";
import { dispatchSessionRoute } from "./routes/sessions.js";
import { dispatchReportRoute } from "./routes/reports.js";
import { dispatchSettingsRoute } from "./routes/settings.js";
import { dispatchSiteRoute } from "./routes/sites.js";
import { handleHealth, handleStatus } from "./routes/health.js";
import { WebSocketHandler } from "./websocket.js";

export interface APIServerOptions {
  port?: number;
  repos: DatabaseRepositories;
  authority: AuthorityServices;
  queue: TaskQueue;
  envPath?: string;
}

export class APIServer {
  private server: ReturnType<typeof createServer>;
  private ws: WebSocketHandler;
  private readonly port: number;
  private readonly repos: DatabaseRepositories;
  private readonly authority: AuthorityServices;
  private readonly queue: TaskQueue;
  private readonly envPath: string;

  constructor(opts: APIServerOptions) {
    this.port = opts.port ?? 3000;
    this.repos = opts.repos;
    this.authority = opts.authority;
    this.queue = opts.queue;
    this.envPath = opts.envPath ?? ".env";
    this.ws = new WebSocketHandler();

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error("[APIServer] Unhandled error:", err);
        if (!res.headersSent) {
          sendJson(res, 500, { error: "Internal server error" });
        }
      });
    });

    // Attach WebSocket handler to the HTTP server
    this.ws.attach(this.server);
  }

  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[APIServer] Listening on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.ws.closeAll();
    return new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Access the WebSocket handler for broadcasting events. */
  getWebSocketHandler(): WebSocketHandler {
    return this.ws;
  }

  /** The underlying port. */
  getPort(): number {
    return this.port;
  }

  // ── Internal ──

  private async handleRequest(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    applyCors(res);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const pathname = getPathname(req.url);

    // Health / status
    if (pathname === "/api/v1/health" && req.method === "GET") {
      await handleHealth(req, res, {
        repos: this.repos,
        queue: this.queue,
      });
      return;
    }
    if (pathname === "/api/v1/status" && req.method === "GET") {
      await handleStatus(req, res, {
        repos: this.repos,
        queue: this.queue,
      });
      return;
    }

    // Session routes
    const handled1 = await dispatchSessionRoute(req, res, {
      repos: this.repos,
      queue: this.queue,
    }, pathname);
    if (handled1) return;

    // Report routes
    const handled3 = await dispatchReportRoute(req, res, {
      repos: this.repos,
    }, pathname);
    if (handled3) return;

    // Settings routes
    const handled4 = await dispatchSettingsRoute(req, res, {
      envPath: this.envPath,
    }, pathname);
    if (handled4) return;

    // Site profile routes
    const handled5 = await dispatchSiteRoute(req, res, {
      cognition: this.authority.cognition,
      sites: this.authority.sites,
    }, pathname);
    if (handled5) return;

    // 404
    sendJson(res, 404, { error: "Not found" });
  }
}
