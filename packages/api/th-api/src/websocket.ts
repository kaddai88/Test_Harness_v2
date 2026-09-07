/**
 * WebSocket handler — using the `ws` library for robust WebSocket support.
 */
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

interface WebSocketClient {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>;
}

export class WebSocketHandler {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, WebSocketClient>();
  private nextId = 0;

  /** Initialize the WebSocket server and attach to an HTTP server. */
  attach(server: import("node:http").Server): void {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      this.handleUpgrade(req, socket as Duplex, head);
    });

    this.wss.on("connection", (ws, req) => {
      const id = `ws_${++this.nextId}`;
      console.log(`[WebSocket] Client connected: ${id}`);

      const client: WebSocketClient = {
        id,
        ws,
        subscriptions: new Set(["*"]),
      };
      this.clients.set(id, client);

      ws.on("close", () => {
        console.log(`[WebSocket] Client disconnected: ${id}`);
        this.clients.delete(id);
      });

      ws.on("error", (err) => {
        console.error(`[WebSocket] Client error (${id}):`, err.message);
        this.clients.delete(id);
      });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            type?: string;
            subscribe?: string;
          };
          if (msg.type === "subscribe" && msg.subscribe) {
            client.subscriptions.add(msg.subscribe);
          }
        } catch {
          // Ignore parse errors
        }
      });

      // Send welcome message
      this.sendToClient(client, {
        type: "connected",
        clientId: id,
        timestamp: new Date().toISOString(),
      });
    });
  }

  /** Try to upgrade an HTTP request to a WebSocket connection. */
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ): boolean {
    const upgradeHeader = (req.headers.upgrade ?? "").toLowerCase();
    if (upgradeHeader !== "websocket") return false;

    if (this.wss) {
      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss?.emit("connection", ws, req);
      });
    }

    return true;
  }

  /** Broadcast an event to all connected clients. */
  broadcast(event: { type: string; [key: string]: unknown }): void {
    const payload = JSON.stringify(event);
    // Per-event broadcast is debug-level noise; enable via TH_LOG_LEVEL=debug
    if ((process.env.TH_LOG_LEVEL ?? "").toLowerCase() === "debug") {
      console.log(`[WebSocket] Broadcasting ${event.type} to ${this.clients.size} clients`);
    }
    for (const client of this.clients.values()) {
      this.sendToClient(client, JSON.parse(payload));
    }
  }

  /** Broadcast a session progress event. */
  broadcastSessionProgress(
    sessionId: string,
    data: { status: string; progress?: number; message?: string }
  ): void {
    this.broadcast({ type: "session:progress", sessionId, ...data });
  }

  /** Broadcast an agent event. */
  broadcastAgentEvent(
    sessionId: string,
    data: { eventType: string; payload: unknown }
  ): void {
    this.broadcast({ type: "agent:event", sessionId, ...data });
  }

  /** Broadcast session completion. */
  broadcastSessionComplete(
    sessionId: string,
    data: { status: string; summary?: string }
  ): void {
    this.broadcast({ type: "session:completed", sessionId, ...data });
  }

  /** Get the number of connected clients. */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Close all connections. */
  closeAll(): void {
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.wss?.close();
  }

  private sendToClient(client: WebSocketClient, data: Record<string, unknown>): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }
}
