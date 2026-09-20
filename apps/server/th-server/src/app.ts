/**
 * TestHarnessServer — composes all services into a running application.
 *
 * Lifecycle:
 *   1. Create database (JSON file or in-memory)
 *   2. Create queue (in-memory)
 *   3. Create API server
 *   4. Create worker bootstrap
 *   5. Start everything
 *   6. Register graceful shutdown handlers
 */
import {
  createDatabase,
  createInMemoryDatabase,
  type DatabaseRuntime,
} from "@test-harness/th-persistence";
import { createInMemoryQueue, type TaskQueue } from "@test-harness/th-queue";
import { APIServer, CutoverControlPlane } from "@test-harness/th-api";
import { WorkerBootstrap } from "@test-harness/th-worker";
import { QwenProvider } from "@test-harness/th-llm-qwen";
import { OpenAIProvider } from "@test-harness/th-llm-openai";
import { OllamaProvider } from "@test-harness/th-llm-ollama";
import type {
  LLMProvider,
  CompletionParams,
  ModelResponse,
  StreamChunk,
  Message,
  ToolSchema,
  TokenUsage,
  ModelCapability,
} from "@test-harness/th-protocol";

export interface TestHarnessServerOptions {
  port?: number;
  dbPath?: string;
  llmProvider?: LLMProvider;
  /** Multiple LLM providers for failover (tried in order) */
  llmProviders?: LLMProvider[];
  /** Request rate limit (requests per minute per IP) */
  rateLimit?: number;
}

/**
 * Stub LLM provider — used when no real LLM is configured.
 * Returns a minimal response telling the agent to finish.
 */
class StubLLMProvider implements LLMProvider {
  readonly id = "stub";
  readonly name = "Stub LLM";
  readonly capabilities: ModelCapability[] = [
    "chat",
    "tool_use",
    "streaming",
  ];

  async complete(_params: CompletionParams): Promise<ModelResponse> {
    return {
      id: `stub_${Date.now()}`,
      content: "Session completed (stub LLM — no real model configured).",
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      finishReason: "stop",
      model: "stub",
    };
  }

  async *stream(_params: CompletionParams): AsyncIterable<StreamChunk> {
    yield {
      type: "content",
      data: "Session completed (stub LLM — no real model configured).",
    };
    yield {
      type: "done",
      data: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  async countTokens(): Promise<number> {
    return 0;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

/**
 * Failover LLM provider — tries multiple providers in order.
 * If the primary fails health check, falls back to the next.
 */
class FailoverLLMProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ModelCapability[];
  private providers: LLMProvider[];
  private currentIndex = 0;

  constructor(providers: LLMProvider[]) {
    this.providers = providers;
    this.id = providers[0]?.id ?? "failover";
    this.name = `Failover (${providers.map((p) => p.name).join(" → ")})`;
    this.capabilities = providers[0]?.capabilities ?? ["chat"];
  }

  private getActive(): LLMProvider {
    return this.providers[this.currentIndex] ?? this.providers[0]!;
  }

  private async tryWithFailover<T>(
    fn: (provider: LLMProvider) => Promise<T>
  ): Promise<T> {
    for (let i = 0; i < this.providers.length; i++) {
      const idx = (this.currentIndex + i) % this.providers.length;
      const provider = this.providers[idx]!;
      try {
        return await fn(provider);
      } catch (err) {
        console.warn(
          `[LLM] Provider "${provider.name}" failed: ${err instanceof Error ? err.message : String(err)}. Trying next...`
        );
      }
    }
    throw new Error("All LLM providers failed");
  }

  async complete(params: CompletionParams): Promise<ModelResponse> {
    return this.tryWithFailover((p) => p.complete(params));
  }

  async *stream(params: CompletionParams): AsyncIterable<StreamChunk> {
    // For streaming, we can't easily failover mid-stream,
    // so we pick the active provider and delegate
    const active = this.getActive();
    yield* active.stream(params);
  }

  async countTokens(
    messages: Message[],
    tools?: ToolSchema[]
  ): Promise<number> {
    return this.getActive().countTokens(messages, tools);
  }

  async healthCheck(): Promise<boolean> {
    // Check providers in order, return true if any is healthy
    for (const provider of this.providers) {
      try {
        if (await provider.healthCheck()) return true;
      } catch {
        continue;
      }
    }
    return false;
  }
}

/**
 * Simple in-memory rate limiter.
 * Tracks request counts per IP within a sliding window.
 */
export class RateLimiter {
  private requests = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Check if a request from this IP should be allowed */
  check(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.requests.get(ip);

    if (!entry || now > entry.resetAt) {
      this.requests.set(ip, { count: 1, resetAt: now + this.windowMs });
      return {
        allowed: true,
        remaining: this.limit - 1,
        resetAt: now + this.windowMs,
      };
    }

    entry.count++;
    const allowed = entry.count <= this.limit;
    return {
      allowed,
      remaining: Math.max(0, this.limit - entry.count),
      resetAt: entry.resetAt,
    };
  }

  /** Clean up expired entries */
  cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.requests) {
      if (now > entry.resetAt) this.requests.delete(ip);
    }
  }
}

export class TestHarnessServer {
  private db?: DatabaseRuntime & { close?: () => void };
  private queue?: TaskQueue;
  private api?: APIServer;
  private worker?: WorkerBootstrap;
  private rateLimiter?: RateLimiter;
  private shuttingDown = false;
  private shutdownHandlers: Array<() => void> = [];

  /** Auto-detect and create LLM provider from environment variables */
  private createLLMProvider(): LLMProvider {
    // Priority: Qwen (DashScope) > OpenAI > Ollama > Stub
    const dashscopeKey = process.env.DASHSCOPE_API_KEY;
    if (dashscopeKey) {
      return new QwenProvider({
        defaultModel: process.env.QWEN_MODEL ?? "qwen-plus",
        baseUrl: process.env.DASHSCOPE_BASE_URL,
      });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      return new OpenAIProvider({
        baseUrl: process.env.OPENAI_BASE_URL,
        defaultModel: process.env.OPENAI_MODEL ?? "gpt-4o",
      });
    }

    // Try Ollama (local)
    const ollamaUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
    const ollama = new OllamaProvider({
      baseUrl: ollamaUrl,
      defaultModel: process.env.OLLAMA_MODEL ?? "llama3.1",
    });

    // Return Ollama (will be stub if not available — worker handles fallback)
    return ollama;
  }

  async start(options: TestHarnessServerOptions = {}): Promise<void> {
    const port = options.port ?? parseInt(process.env.PORT ?? "3000", 10);
    const dbPath = options.dbPath ?? process.env.DB_PATH;

    // 1. Database (auto-detect: SQLite > JSON File > In-Memory)
    this.db = createDatabase(dbPath);
    if (dbPath) {
      console.log(`[Server] Persistent database at ${dbPath}`);
    } else {
      console.log("[Server] In-memory database (data lost on restart)");
    }

    // 2. Queue
    this.queue = createInMemoryQueue({ concurrency: 4 });

    // 3. LLM provider — auto-detect from environment
    const llm = this.createLLMProvider();
    console.log(`[Server] LLM: ${llm.name}`);

    // 4. Rate limiter
    if (options.rateLimit) {
      this.rateLimiter = new RateLimiter(options.rateLimit);
      console.log(`[Server] Rate limit: ${options.rateLimit} req/min`);
    }

    // 5. API server (must start before worker so WS handler is available)
    this.api = new APIServer({
      port,
      repos: this.db,
      authority: this.db.authority,
      queue: this.queue,
      envPath: process.env.ENV_PATH ?? ".env",
      cutoverControl: new CutoverControlPlane({
        token: process.env.CUTOVER_CONTROL_TOKEN,
        auditPath: process.env.CUTOVER_CONTROL_AUDIT_PATH,
      }),
    });
    await this.api.start();

    // 7. Worker — with WebSocket handler from API server
    this.worker = new WorkerBootstrap({
      queue: this.queue,
      repos: this.db,
      authority: this.db.authority,
      llm,
      wsHandler: this.api.getWebSocketHandler(),
    });
    this.worker.start();

    // 8. Graceful shutdown
    this.registerShutdownHandlers();

    console.log(`[Server] Test-Harness 2.0 is running on port ${port}`);
    console.log(`[Server] API: http://localhost:${port}/api/v1`);
    console.log(`[Server] Health: http://localhost:${port}/api/v1/health`);
    console.log(`[Server] Mode: AI-driven testing (DSH-style)`);
  }

  async stop(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    console.log("\n[Server] Graceful shutdown initiated...");

    // Stop accepting new requests
    if (this.api) {
      console.log("[Server] Stopping API server...");
      await this.api.stop();
    }

    // Wait for active jobs to complete
    if (this.worker) {
      console.log("[Server] Stopping worker (waiting for active jobs)...");
      await this.worker.stop();
    }

    // Close database
    if (this.db) {
      console.log("[Server] Closing database...");
      this.db.close?.();
    }

    // Clean up shutdown handlers
    for (const handler of this.shutdownHandlers) {
      handler();
    }
    this.shutdownHandlers = [];

    console.log("[Server] Stopped gracefully.");
  }

  /** Register process signal handlers for graceful shutdown */
  private registerShutdownHandlers(): void {
    const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

    for (const signal of signals) {
      const handler = () => {
        console.log(`\n[Server] Received ${signal}`);
        this.stop()
          .then(() => process.exit(0))
          .catch((err) => {
            console.error("[Server] Shutdown error:", err);
            process.exit(1);
          });
      };
      process.on(signal, handler);
      this.shutdownHandlers.push(() =>
        process.removeListener(signal, handler)
      );
    }

    // Periodic rate limiter cleanup (every 5 minutes)
    if (this.rateLimiter) {
      const interval = setInterval(
        () => this.rateLimiter?.cleanup(),
        300_000
      );
      this.shutdownHandlers.push(() => clearInterval(interval));
    }
  }
}
