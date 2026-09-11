/**
 * Event definitions — typed event channels for the system.
 *
 * All events are live (WebSocket / in-memory only). The agent loop
 * uses waterfall events (pre_step, request, pre_execute, post_execute)
 * for plugin middleware and serial events (turn_stopping) for lifecycle hooks.
 */

/** Base event definition */
export interface EventDefinition<T> {
  readonly id: symbol;
  readonly name: string;
  readonly durable: boolean;
}

/** Create a typed event definition */
export function defineEvent<T>(
  name: string,
  options?: { durable?: boolean }
): EventDefinition<T> {
  return {
    id: Symbol(name),
    name,
    durable: options?.durable ?? false,
  };
}

// ── Agent Loop Events ──

export interface AgentTurnStartedEventData {
  sessionId: string;
  turnNumber: number;
}

export const AgentTurnStartedEvent =
  defineEvent<AgentTurnStartedEventData>("agent:turn_started", {
    durable: false,
  });

export interface AgentToolCallEventData {
  sessionId: string;
  turnNumber: number;
  toolName: string;
  input: unknown;
}

export const AgentToolCallEvent = defineEvent<AgentToolCallEventData>(
  "agent:tool_call",
  { durable: false }
);

export interface AgentToolResultEventData {
  sessionId: string;
  turnNumber: number;
  toolName: string;
  success: boolean;
  duration: number;
  data?: unknown;
}

export const AgentToolResultEvent =
  defineEvent<AgentToolResultEventData>("agent:tool_result", {
    durable: false,
  });

export interface AgentStreamChunkEventData {
  sessionId: string;
  turnNumber: number;
  /** Partial text content accumulated so far */
  partialContent: string;
  /** Number of tool calls detected so far */
  toolCallCount: number;
  /** Whether the stream is complete */
  done: boolean;
}

export const AgentStreamChunkEvent = defineEvent<AgentStreamChunkEventData>(
  "agent:stream_chunk",
  { durable: false }
);

// ── P4 Streaming Contract v1 ──

export const STREAM_CONTRACT_VERSION = 1 as const;
export type StreamContractVersion = typeof STREAM_CONTRACT_VERSION;
export type StreamGenerationStatus = 'streaming' | 'completed' | 'errored' | 'cancelled';
export type StreamPayloadMode = 'accumulated';

/**
 * Complete P4 v1 stream envelope. Identity/order fields are producer-owned by
 * AgentLoop; worker, WebSocket, and Dashboard only transport/consume them.
 */
export interface StreamEnvelope {
  readonly streamContractVersion: StreamContractVersion;
  readonly sessionId: string;
  readonly logicalTurn: string;
  readonly generationId: string;
  readonly generationOrdinal: number;
  readonly seq: number;
  readonly payloadMode: StreamPayloadMode;
  readonly content: string;
  readonly status: StreamGenerationStatus;
}

/** Generation-bound final assistant commit. */
export interface FinalAssistantCommit {
  readonly streamContractVersion: StreamContractVersion;
  readonly sessionId: string;
  readonly logicalTurn: string;
  readonly generationId: string;
  readonly generationOrdinal: number;
  /** References the producer-owned terminal stream sequence. */
  readonly finalSeq: number;
  readonly content: string;
}

// ── Waterfall Events (around-middleware, used by Agent Loop) ──

/**
 * agent:pre_step — Fired before each step in the agent loop.
 * Waterfall listeners can modify or reject the messages before
 * they are sent to the LLM.
 */
export interface AgentPreStepEventData {
  sessionId: string;
  turnNumber: number;
  stepNumber: number;
  messages: Array<{ role: string; content: string }>;
  /** Set to 'reject' to skip this step */
  decision: "enter" | "reject";
}

export const AgentPreStepEvent = defineEvent<AgentPreStepEventData>(
  "agent:pre_step",
  { durable: false }
);

/**
 * agent:request — Fired before each LLM request.
 * Waterfall listeners can modify the request configuration
 * (model, temperature, maxTokens, etc.).
 */
export interface AgentRequestEventData {
  sessionId: string;
  turnNumber: number;
  stepNumber: number;
  model: string;
  temperature: number;
  maxTokens?: number;
}

export const AgentRequestEvent = defineEvent<AgentRequestEventData>(
  "agent:request",
  { durable: false }
);

/**
 * tools:pre_execute — Fired before each tool execution.
 * Waterfall listeners can modify tool input, deny execution,
 * or request user approval.
 */
export interface ToolsPreExecuteEventData {
  sessionId: string;
  toolName: string;
  input: unknown;
  /** Set to 'deny' to block execution, 'approve' to proceed */
  decision: "approve" | "deny" | "ask";
  denyReason?: string;
}

export const ToolsPreExecuteEvent = defineEvent<ToolsPreExecuteEventData>(
  "tools:pre_execute",
  { durable: false }
);

/**
 * tools:post_execute — Fired after each tool execution.
 * Waterfall listeners can modify the result, enrich it,
 * or replace it entirely.
 */
export interface ToolsPostExecuteEventData {
  sessionId: string;
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
  /** Set to true to replace the result */
  replaced: boolean;
}

export const ToolsPostExecuteEvent = defineEvent<ToolsPostExecuteEventData>(
  "tools:post_execute",
  { durable: false }
);

/**
 * agent:turn_stopping — Fired when the agent loop is about to end a turn.
 * Serial listeners can inject additional messages or work to continue the turn.
 */
export interface AgentTurnStoppingEventData {
  sessionId: string;
  turnNumber: number;
  /** Set to true to continue the turn instead of ending */
  shouldContinue: boolean;
  reason?: string;
}

export const AgentTurnStoppingEvent = defineEvent<AgentTurnStoppingEventData>(
  "agent:turn_stopping",
  { durable: false }
);
