/**
 * Agent Context — per-session state carried through the agent loop.
 */
import type {
  LLMProvider,
  Message,
  SessionConfig,
  SessionTarget,
  SessionStatusReason,
} from "@test-harness/th-protocol";
import type { THContainer, EventBusImpl } from "@test-harness/th-core";
import type { ToolRegistry } from "@test-harness/th-tools";
import type { SessionLog } from "./session.js";
import type { CognitiveEngine } from "@test-harness/th-cognition";

/** Per-session agent context */
export interface AgentContext {
  readonly sessionId: string;
  readonly target: SessionTarget;
  readonly config: SessionConfig;
  readonly llm: LLMProvider;
  readonly toolRegistry: ToolRegistry;
  readonly eventBus: EventBusImpl;
  readonly container: THContainer;

  /**
   * Session log — the single source of truth.
   * All model-visible content is appended here.
   * Message history is derived from the log via `deriveMessages()`.
   */
  readonly sessionLog: SessionLog;

  /** Shared state across turns (for inter-tool communication) */
  state: Map<string, unknown>;

  /** Current turn count */
  turnCount: number;

  /** Current step count (within the current turn) */
  stepCount: number;

  /** Maximum allowed turns */
  maxTurns: number;

  /** Max consecutive failures per tool before forcing strategy change */
  maxRetriesPerAction: number;

  /** Consecutive failure count per tool name */
  toolFailureCounts: Map<string, number>;

  /** Abort signal for cancellation */
  abortSignal: AbortSignal;

  /** Cognitive engine for memory, learning, and self-healing */
  cognition?: CognitiveEngine;
}

/** Result from a complete agent loop run */
export interface AgentResult {
  sessionId: string;
  status: "completed" | "failed" | "cancelled" | "timeout";
  turns: number;
  reason: SessionStatusReason;
  summary?: string;
  error?: Error;
}

/** Result from a single turn */
export interface TurnResult {
  /** Whether the agent loop should stop (no tool calls = done) */
  complete: boolean;
  aborted?: boolean;
  abortReason?: import("@test-harness/th-protocol").AbortReason;
  /** The model response for this turn */
  response: {
    content: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>;
  };
  /** Tool results (if tools were called) */
  toolResults?: Array<{
    toolCallId: string;
    name: string;
    success: boolean;
    data?: unknown;
    error?: string;
    aborted?: boolean;
    abortReason?: import("@test-harness/th-protocol").AbortReason;
  }>;
}
