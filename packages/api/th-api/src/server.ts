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
import { CutoverControlPlane, type CutoverControlAction } from "./cutover-control.js";

export interface APIServerOptions {
  port?: number;
  repos: DatabaseRepositories;
  authority: AuthorityServices;
  queue: TaskQueue;
  envPath?: string;
  cutoverControl?: CutoverControlPlane;
}

export class APIServer {
  private server: ReturnType<typeof createServer>;
  private ws: WebSocketHandler;
  private readonly port: number;
  private readonly repos: DatabaseRepositories;
  private readonly authority: AuthorityServices;
  private readonly queue: TaskQueue;
  private readonly envPath: string;
  private readonly cutoverControl: CutoverControlPlane;

  constructor(opts: APIServerOptions) {
    this.port = opts.port ?? 3000;
    this.repos = opts.repos;
    this.authority = opts.authority;
    this.queue = opts.queue;
    this.envPath = opts.envPath ?? ".env";
    this.cutoverControl = opts.cutoverControl ?? new CutoverControlPlane();
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
    const address = this.server.address();
    return address && typeof address === "object" ? address.port : this.port;
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

    if (pathname === "/api/v1/cutover/status" && req.method === "GET") {
      sendJson(res, 200, { status: "ok", control: this.cutoverControl.status(), queue: await this.queue.inventory() });
      return;
    }

    const controlMatch = /^\/api\/v1\/cutover\/controls\/(freeze-entry|confirm-frozen|release-read-only|enable-mutation|abort-restore-normal)$/.exec(pathname);
    if (controlMatch && req.method === "POST") {
      const token = req.headers["x-cutover-control-token"];
      const actor = req.headers["x-cutover-actor"];
      try {
        const control = this.cutoverControl.transition(
          controlMatch[1] as CutoverControlAction,
          Array.isArray(token) ? token[0] : token,
          Array.isArray(actor) ? actor[0] : actor,
        );
        sendJson(res, 200, { status: "ok", control, queue: await this.queue.inventory() });
      } catch (error) {
        sendJson(res, 403, { error: error instanceof Error ? error.message : "Cutover control rejected" });
      }
      return;
    }

    const queueControlMatch = /^\/api\/v1\/cutover\/queue\/(pause|resume)$/.exec(pathname);
    if (queueControlMatch && req.method === "POST") {
      const token = req.headers["x-cutover-control-token"];
      const actor = req.headers["x-cutover-actor"];
      const operation = queueControlMatch[1] === "pause" ? "queue-pause" : "queue-resume";
      try {
        const queue = await this.cutoverControl.performOperation(
          operation,
          Array.isArray(token) ? token[0] : token,
          Array.isArray(actor) ? actor[0] : actor,
          async () => {
            if (operation === "queue-pause") await this.queue.pause();
            else await this.queue.resume();
            return this.queue.inventory();
          },
          (inventory) => inventory,
        );
        sendJson(res, 200, { status: "ok", control: this.cutoverControl.status(), queue });
      } catch (error) {
        sendJson(res, 403, { error: error instanceof Error ? error.message : "Queue control rejected" });
      }
      return;
    }

    if (!this.cutoverControl.permitsMutationRequest(req.method)) {
      sendJson(res, 503, { error: "mutation_capable_traffic_blocked", control: this.cutoverControl.status() });
      return;
    }

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
      readOnly: !this.cutoverControl.permitsMutationRequest("POST"),
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
