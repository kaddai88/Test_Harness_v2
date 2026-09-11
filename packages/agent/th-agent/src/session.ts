/**
 * Session Log — append-only event log for the agent loop.
 *
 * Inspired by DSH's session log architecture:
 * - The log is the single source of truth for all model-visible content
 * - Message history is DERIVED from the log via `deriveMessages()`
 * - Every event gets a monotonically increasing sequence number
 * - The log supports filtering, iteration, and replay
 *
 * Key invariant: "Model-visible ⟺ logged"
 * Anything that reaches a model request must be reconstructable from the log.
 */
import type { Message, ToolCall } from "@test-harness/th-protocol";

// ── Typed Visibility Contract ──

export type ModelVisibility = 'conversation' | 'context' | 'none';
export type ContextLifetime = 'next_turn' | 'until_superseded' | 'session_persistent';

export type SessionSemanticKind =
  | 'user_message'
  | 'assistant_message'
  | 'tool_result'
  | 'coverage_continuation'
  | 'recovery_guidance'
  | 'tool_failure_strategy'
  | 'workflow_guidance'
  | 'cognition_guidance'
  | 'audit_diagnostic'
  | 'execution_trace'
  | 'request_config'
  | 'workflow_transition'
  | 'unknown_custom';

export interface SessionVisibilityMetadata {
  readonly semanticKind: SessionSemanticKind;
  readonly modelVisibility: ModelVisibility;
  readonly contextLifetime?: ContextLifetime;
  readonly supersessionKey?: string;
  /** Logical model turn/generation for next_turn context. */
  readonly targetLogicalTurnId?: string;
  /** Model-safe projection; never fall back to audit payload. */
  readonly modelProjection?: Message;
}

const MODEL_CONTEXT_KINDS = new Set<SessionSemanticKind>([
  'coverage_continuation',
  'recovery_guidance',
  'tool_failure_strategy',
  'workflow_guidance',
  'cognition_guidance',
]);

export interface ContextAppendOptions {
  readonly semanticKind: Exclude<SessionSemanticKind, 'user_message' | 'assistant_message' | 'tool_result'>;
  readonly modelProjection?: Message;
  readonly contextLifetime: ContextLifetime;
  readonly supersessionKey?: string;
  readonly targetLogicalTurnId?: string;
}

/** Normalized typed entry consumed by the pure derivation projection. */
export interface SessionEntry {
  readonly event: SessionEvent;
  readonly visibility: SessionVisibilityMetadata;
}


// ── Session Event Types ──

export type SessionEventType =
  // Turn lifecycle
  | "turn/start"
  | "turn/end"
  // Step lifecycle
  | "step/start"
  | "step/end"
  // Messages (model-visible)
  | "user/message"
  | "assistant/message"
  | "tool/result"
  // Tool calls (model-visible)
  | "tool/call"
  // Request configuration
  | "request/config"
  // System
  | "system/note"
  // Custom events
  | "custom";

// ── Event Data Interfaces ──

export interface TurnStartEvent {
  turn: number;
}

export type TurnEndReason =
  | { kind: "completed" }
  | { kind: "aborted"; reason?: string }
  | { kind: "error"; error: string }
  | { kind: "max-tokens" }
  | { kind: "timeout" }
  | { kind: "blocked" };

export interface TurnEndEvent {
  turn: number;
  reason: TurnEndReason;
}

export interface StepStartEvent {
  turn: number;
  step: number;
}

export interface StepEndEvent {
  turn: number;
  step: number;
}

export interface UserMessageEvent {
  turn: number;
  content: string;
  /** Base64 data URLs for vision-capable models */
  images?: string[];
}

export interface AssistantMessageEvent {
  turn: number;
  step: number;
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ToolCallEvent {
  turn: number;
  step: number;
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEvent {
  turn: number;
  step: number;
  callId: string;
  name: string;
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
}

export interface RequestConfigEvent {
  turn: number;
  step: number;
  model: string;
  provider: string;
  temperature: number;
  maxTokens?: number;
  toolCount: number;
}

export interface SystemNoteEvent {
  note: string;
}

export interface CustomEventData {
  type: string;
  data: unknown;
}

// ── Union of all event data types ──

export type SessionEventData =
  | TurnStartEvent
  | TurnEndEvent
  | StepStartEvent
  | StepEndEvent
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallEvent
  | ToolResultEvent
  | RequestConfigEvent
  | SystemNoteEvent
  | CustomEventData;

// ── Session Event ──

/** A single event in the session log */
export interface SessionEvent {
  /** Monotonically increasing sequence number */
  readonly seq: number;
  /** Event type discriminator */
  readonly type: SessionEventType;
  /** Event payload (varies by type) */
  readonly data: SessionEventData;
  /** Unix timestamp in milliseconds */
  readonly timestamp: number;
}

// ── Session Log ──

/**
 * Append-only session event log.
 *
 * The log is the authoritative record of everything that happened during
 * a test session. Model-visible content (messages, tool calls, results)
 * is always derived from the log, never stored separately.
 */
export class SessionLog {
  private events: SessionEvent[] = [];
  private nextSeq = 1;

  /** Append an event to the log and return it */
  append<T extends SessionEventType>(
    type: T,
    data: SessionEventData
  ): SessionEvent {
    const event: SessionEvent = {
      seq: this.nextSeq++,
      type,
      data,
      timestamp: Date.now(),
    };
    this.events.push(event);
    return event;
  }

  /**
   * Append an explicitly classified model-context entry.
   * SessionLog owns append sequence allocation; producers cannot provide it.
   */
  appendContext(
    data: { content: unknown },
    options: ContextAppendOptions,
  ): SessionEvent {
    const event = this.append('custom', {
      type: options.semanticKind,
      data: {
        auditPayload: data.content,
        visibility: {
          semanticKind: options.semanticKind,
          modelVisibility: 'context',
          contextLifetime: options.contextLifetime,
          supersessionKey: options.supersessionKey,
          targetLogicalTurnId: options.targetLogicalTurnId,
          modelProjection: options.modelProjection,
        } satisfies SessionVisibilityMetadata,
      },
    });
    return event;
  }

  /** Get all events */
  getEvents(): ReadonlyArray<SessionEvent> {
    return this.events;
  }

  /** Get events of a specific type */
  getEventsByType(type: SessionEventType): SessionEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /** Get the latest event of a specific type */
  getLastEvent(type: SessionEventType): SessionEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i]!;
      if (event.type === type) return event;
    }
    return undefined;
  }

  /** Get total event count */
  get length(): number {
    return this.events.length;
  }

  /**
   * Append a validated model-context entry.
   *
   * Producer boundary contract: invalid context metadata is rejected rather
   * than silently converted into an unscoped or globally visible entry.
   */
  appendModelContext(
    auditPayload: unknown,
    options: ContextAppendOptions,
  ): SessionEvent {
    if (!MODEL_CONTEXT_KINDS.has(options.semanticKind)) {
      throw new Error(`Semantic kind '${options.semanticKind}' is not an approved MODEL_CONTEXT kind`);
    }
    if (!options.modelProjection) {
      throw new Error(`Model context '${options.semanticKind}' requires modelProjection`);
    }
    if (options.contextLifetime === 'next_turn' && !options.targetLogicalTurnId) {
      throw new Error(`Model context '${options.semanticKind}' requires targetLogicalTurnId`);
    }
    if ((options.contextLifetime === 'until_superseded' || options.contextLifetime === 'session_persistent') && !options.supersessionKey) {
      throw new Error(`Model context '${options.semanticKind}' requires supersessionKey`);
    }

    return this.appendContext({ content: auditPayload }, options);
  }

  /**
   * Normalize a legacy event at the ingestion boundary.
   *
   * Only the approved legacy conversation/protocol event types receive
   * compatibility metadata. Legacy system/custom events remain invisible.
   */
  normalizeEntry(event: SessionEvent): SessionEntry {
    let visibility: SessionVisibilityMetadata;
    switch (event.type) {
      case 'user/message':
        visibility = { semanticKind: 'user_message', modelVisibility: 'conversation' };
        break;
      case 'assistant/message':
        visibility = { semanticKind: 'assistant_message', modelVisibility: 'conversation' };
        break;
      case 'tool/result':
        visibility = { semanticKind: 'tool_result', modelVisibility: 'conversation' };
        break;
      case 'custom': {
        const data = event.data as { data?: { visibility?: SessionVisibilityMetadata }; visibility?: SessionVisibilityMetadata };
        const explicit = data.data?.visibility ?? data.visibility;
        if (explicit && this.isValidVisibilityMetadata(explicit)) {
          visibility = explicit;
        } else {
          visibility = { semanticKind: 'unknown_custom', modelVisibility: 'none' };
        }
        break;
      }
      default:
        visibility = { semanticKind: 'unknown_custom', modelVisibility: 'none' };
    }
    return { event, visibility };
  }

  private isValidVisibilityMetadata(metadata: SessionVisibilityMetadata): boolean {
    if (!['conversation', 'context', 'none'].includes(metadata.modelVisibility)) return false;
    // unknown_custom is an explicit fail-closed kind and can never self-promote
    // into conversation or context visibility.
    if (metadata.semanticKind === 'unknown_custom' && metadata.modelVisibility !== 'none') return false;
    if (metadata.modelVisibility === 'context') {
      if (!metadata.contextLifetime) return false;
      if (metadata.contextLifetime === 'next_turn' && !metadata.targetLogicalTurnId) return false;
      if ((metadata.contextLifetime === 'until_superseded' || metadata.contextLifetime === 'session_persistent') && !metadata.supersessionKey) return false;
      if (!metadata.modelProjection) return false;
    }
    return true;
  }

  /**
   * Derive model messages from the explicit visibility contract.
   *
   * `logicalTurnId` is used only for typed context entries. This function is
   * pure/read-only: it never consumes context or mutates the append-only log.
   */
  deriveMessages(systemPrompt?: string, logicalTurnId?: string): Message[] {
    const messages: Message[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    const entries = this.events.map(event => this.normalizeEntry(event));
    const contextEntries = entries
      .filter(entry => entry.visibility.modelVisibility === 'context')
      .filter(entry => this.isContextActive(entry, logicalTurnId))
      .filter(entry => entry.visibility.modelProjection !== undefined)
      .filter((entry, index, all) => {
        const key = entry.visibility.supersessionKey;
        if (!key || entry.visibility.contextLifetime === 'next_turn') return true;
        return !all.some(other =>
          other.visibility.supersessionKey === key &&
          other.visibility.contextLifetime !== 'next_turn' &&
          other.event.seq > entry.event.seq
        );
      })
      .sort((a, b) => a.event.seq - b.event.seq);

    for (const entry of entries) {
      const { event, visibility } = entry;
      if (visibility.modelVisibility === 'none' || visibility.modelVisibility === 'context') continue;
      switch (event.type) {
        case "user/message": {
          const data = event.data as UserMessageEvent;
          messages.push({ role: "user", content: data.content, images: data.images });
          break;
        }
        case "assistant/message": {
          const data = event.data as AssistantMessageEvent;
          messages.push({
            role: "assistant", content: data.content,
            toolCalls: data.toolCalls?.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments })),
          });
          break;
        }
        case "tool/result": {
          const data = event.data as ToolResultEvent;
          messages.push({
            role: "tool",
            content: data.success ? JSON.stringify(data.data, null, 2) : `Error: ${data.error}`,
            toolCallId: data.callId, name: data.name,
          });
          break;
        }
      }
    }

    // Context follows chronological conversation/protocol history and is sorted
    // by SessionLog sequence. Only explicit modelProjection is serialized.
    for (const entry of contextEntries) {
      messages.push(entry.visibility.modelProjection!);
    }
    return messages;
  }

  private isContextActive(entry: SessionEntry, logicalTurnId?: string): boolean {
    const visibility = entry.visibility;
    if (visibility.contextLifetime === 'next_turn') {
      return visibility.targetLogicalTurnId !== undefined && visibility.targetLogicalTurnId === logicalTurnId;
    }
    if (visibility.contextLifetime === 'until_superseded' || visibility.contextLifetime === 'session_persistent') {
      // Supersession is handled by selecting the latest sequence per key.
      // Entries without a key fail closed.
      return visibility.supersessionKey !== undefined;
    }
    return false;
  }

  /**
   * Get a summary of the session for diagnostics.
   */
  getSummary(): {
    totalEvents: number;
    turns: number;
    steps: number;
    toolCalls: number;
    duration: number;
  } {
    const turns = this.getEventsByType("turn/start").length;
    const steps = this.getEventsByType("step/start").length;
    const toolCalls = this.getEventsByType("tool/call").length;
    const firstEvent = this.events[0];
    const lastEvent = this.events[this.events.length - 1];
    const duration =
      firstEvent && lastEvent
        ? lastEvent.timestamp - firstEvent.timestamp
        : 0;

    return { totalEvents: this.events.length, turns, steps, toolCalls, duration };
  }

  /**
   * Export the log as a JSON-serializable array.
   */
  toJSON(): SessionEvent[] {
    return [...this.events];
  }

  /**
   * Clear the log (for testing only).
   */
  clear(): void {
    this.events = [];
    this.nextSeq = 1;
  }
}
