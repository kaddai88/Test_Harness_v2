/**
 * Tests for SessionLog — append-only event log for the agent loop.
 */
import { describe, it, expect } from "vitest";
import { SessionLog } from "./session.js";
import type {
  UserMessageEvent,
  AssistantMessageEvent,
  ToolResultEvent,
  TurnStartEvent,
  StepStartEvent,
  ToolCallEvent,
} from "./session.js";

describe("SessionLog", () => {
  // ── append ──

  it("append creates events with incrementing seq numbers", () => {
    const log = new SessionLog();

    const e1 = log.append("turn/start", { turn: 1 } as TurnStartEvent);
    const e2 = log.append("step/start", { turn: 1, step: 1 } as StepStartEvent);
    const e3 = log.append("turn/start", { turn: 2 } as TurnStartEvent);

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);
    expect(log.length).toBe(3);
  });

  it("append events have timestamps", () => {
    const log = new SessionLog();
    const e = log.append("turn/start", { turn: 1 } as TurnStartEvent);
    expect(typeof e.timestamp).toBe("number");
    expect(e.timestamp).toBeGreaterThan(0);
  });

  // ── deriveMessages ──

  it("deriveMessages produces correct message history", () => {
    const log = new SessionLog();

    log.append("user/message", { turn: 1, content: "Hello" } as UserMessageEvent);
    log.append("assistant/message", {
      turn: 1,
      step: 1,
      content: "Hi there!",
    } as AssistantMessageEvent);
    log.append("user/message", { turn: 2, content: "How are you?" } as UserMessageEvent);

    const messages = log.deriveMessages();

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: "user", content: "Hello" });
    expect(messages[1]).toEqual({ role: "assistant", content: "Hi there!" });
    expect(messages[2]).toEqual({ role: "user", content: "How are you?" });
  });

  it("deriveMessages includes system prompt when provided", () => {
    const log = new SessionLog();
    log.append("user/message", { turn: 1, content: "Hi" } as UserMessageEvent);

    const messages = log.deriveMessages("You are a helpful assistant.");

    expect(messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(messages[1]).toEqual({ role: "user", content: "Hi" });
    expect(messages).toHaveLength(2);
  });

  it("deriveMessages includes tool results", () => {
    const log = new SessionLog();
    log.append("tool/result", {
      turn: 1,
      step: 1,
      callId: "call_1",
      name: "get_page",
      success: true,
      data: { url: "https://example.com" },
      duration: 150,
    } as ToolResultEvent);

    const messages = log.deriveMessages();

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("tool");
    expect(messages[0]!.toolCallId).toBe("call_1");
    expect(messages[0]!.name).toBe("get_page");
    expect(JSON.parse(messages[0]!.content)).toEqual({ url: "https://example.com" });
  });

  it("deriveMessages handles failed tool results", () => {
    const log = new SessionLog();
    log.append("tool/result", {
      turn: 1,
      step: 1,
      callId: "call_2",
      name: "get_page",
      success: false,
      error: "Network error",
      duration: 5000,
    } as ToolResultEvent);

    const messages = log.deriveMessages();
    expect(messages[0]!.content).toBe("Error: Network error");
  });

  // ── P3 typed visibility contract ──

  it("V1: audit-only custom entries never appear in derived model messages", () => {
    const log = new SessionLog();
    log.append('custom', {
      type: 'audit_diagnostic',
      data: { visibility: { semanticKind: 'audit_diagnostic', modelVisibility: 'none' }, detail: 'secret trace' },
    });

    expect(log.deriveMessages()).toEqual([]);
  });

  it("V2/V6: next_turn context is bound to logical turn and retries are read-only", () => {
    const log = new SessionLog();
    log.appendContext(
      { content: 'audit payload must not leak' },
      {
        semanticKind: 'coverage_continuation',
        contextLifetime: 'next_turn',
        targetLogicalTurnId: 'T17',
        modelProjection: { role: 'system', content: 'Continue checkout coverage' },
      },
    );

    const before = log.toJSON();
    const first = log.deriveMessages(undefined, 'T17');
    const retry = log.deriveMessages(undefined, 'T17');
    const later = log.deriveMessages(undefined, 'T18');

    expect(first).toEqual([{ role: 'system', content: 'Continue checkout coverage' }]);
    expect(retry).toEqual(first);
    expect(later).toEqual([]);
    expect(log.toJSON()).toEqual(before);
  });

  it("V2/V6: next_turn context is bound to logical turn and retries are read-only", () => {
    const log = new SessionLog();
    log.appendContext(
      { content: 'audit payload must not leak' },
      {
        semanticKind: 'coverage_continuation',
        contextLifetime: 'next_turn',
        targetLogicalTurnId: 'T17',
        modelProjection: { role: 'system', content: 'Continue checkout coverage' },
      },
    );

    const before = log.toJSON();
    const first = log.deriveMessages(undefined, 'T17');
    const retry = log.deriveMessages(undefined, 'T17');
    const later = log.deriveMessages(undefined, 'T18');

    expect(first).toEqual([{ role: 'system', content: 'Continue checkout coverage' }]);
    expect(retry).toEqual(first);
    expect(later).toEqual([]);
    expect(log.toJSON()).toEqual(before);
  });

  it("A1: next_turn context without logicalTurnId fails closed", () => {
    const log = new SessionLog();
    log.appendContext(
      { content: 'audit payload must not leak' },
      {
        semanticKind: 'coverage_continuation',
        contextLifetime: 'next_turn',
        targetLogicalTurnId: 'T17',
        modelProjection: { role: 'system', content: 'Must not appear without turn' },
      },
    );

    expect(log.deriveMessages()).toEqual([]);
  });

  it("A2: non-next-turn context does not require logicalTurnId", () => {
    const log = new SessionLog();
    log.appendContext(
      { content: 'audit payload' },
      {
        semanticKind: 'tool_failure_strategy',
        contextLifetime: 'until_superseded',
        supersessionKey: 'strategy:search',
        modelProjection: { role: 'system', content: 'Use keyboard navigation' },
      },
    );

    expect(log.deriveMessages()).toEqual([
      { role: 'system', content: 'Use keyboard navigation' },
    ]);
  });

  it("V3: unknown_custom cannot self-promote to model context", () => {
    const log = new SessionLog();
    log.append('custom', {
      type: 'future_kind',
      data: {
        visibility: {
          semanticKind: 'unknown_custom',
          modelVisibility: 'context',
          contextLifetime: 'next_turn',
          targetLogicalTurnId: 'T1',
          modelProjection: { role: 'system', content: 'Must remain invisible' },
        },
      },
    });

    expect(log.deriveMessages(undefined, 'T1')).toEqual([]);
  });

  it("V5: same role does not determine visibility", () => {
    const log = new SessionLog();
    log.appendContext(
      { content: 'coverage audit' },
      {
        semanticKind: 'coverage_continuation',
        contextLifetime: 'next_turn',
        targetLogicalTurnId: 'T1',
        modelProjection: { role: 'system', content: 'Visible guidance' },
      },
    );
    log.append('custom', {
      type: 'audit_diagnostic',
      data: { visibility: { semanticKind: 'audit_diagnostic', modelVisibility: 'none', modelProjection: { role: 'system', content: 'Invisible diagnostic' } } },
    });

    expect(log.deriveMessages(undefined, 'T1')).toEqual([
      { role: 'system', content: 'Visible guidance' },
    ]);
  });

  it("V7: same supersessionKey uses greatest append sequence; different keys coexist", () => {
    const log = new SessionLog();
    log.appendContext(
      { content: 'old' },
      { semanticKind: 'tool_failure_strategy', contextLifetime: 'until_superseded', supersessionKey: 'strategy:search', modelProjection: { role: 'system', content: 'Old strategy' } },
    );
    log.appendContext(
      { content: 'other' },
      { semanticKind: 'tool_failure_strategy', contextLifetime: 'until_superseded', supersessionKey: 'strategy:checkout', modelProjection: { role: 'system', content: 'Other strategy' } },
    );
    log.appendContext(
      { content: 'new' },
      { semanticKind: 'tool_failure_strategy', contextLifetime: 'until_superseded', supersessionKey: 'strategy:search', modelProjection: { role: 'system', content: 'New strategy' } },
    );

    expect(log.deriveMessages()).toEqual([
      { role: 'system', content: 'Other strategy' },
      { role: 'system', content: 'New strategy' },
    ]);
  });

  it("V8: context missing modelProjection fails closed without audit leakage", () => {
    const log = new SessionLog();
    log.appendContext(
      { content: 'raw headers=secret-cookie' },
      { semanticKind: 'recovery_guidance', contextLifetime: 'next_turn', targetLogicalTurnId: 'T1' },
    );

    expect(log.deriveMessages(undefined, 'T1')).toEqual([]);
    expect(log.toJSON()).toHaveLength(1);
  });

  it("V9: active contexts use append sequence ascending order", () => {
    const log = new SessionLog();
    log.appendContext(
      { content: 'first' },
      { semanticKind: 'coverage_continuation', contextLifetime: 'next_turn', targetLogicalTurnId: 'T1', modelProjection: { role: 'system', content: 'First' } },
    );
    log.appendContext(
      { content: 'second' },
      { semanticKind: 'recovery_guidance', contextLifetime: 'next_turn', targetLogicalTurnId: 'T1', modelProjection: { role: 'system', content: 'Second' } },
    );

    expect(log.deriveMessages(undefined, 'T1')).toEqual([
      { role: 'system', content: 'First' },
      { role: 'system', content: 'Second' },
    ]);
  });

  it("V10: repeated derivation does not mutate SessionLog", () => {
    const log = new SessionLog();
    log.appendContext(
      { content: 'audit' },
      { semanticKind: 'recovery_guidance', contextLifetime: 'next_turn', targetLogicalTurnId: 'T1', modelProjection: { role: 'system', content: 'Retry safely' } },
    );
    const before = log.toJSON();
    const a = log.deriveMessages(undefined, 'T1');
    const b = log.deriveMessages(undefined, 'T1');
    expect(a).toEqual(b);
    expect(log.toJSON()).toEqual(before);
  });

  it("V11: legacy system/note remains invisible while legacy conversation stays visible", () => {
    const log = new SessionLog();
    log.append('system/note', { note: 'legacy internal note' });
    log.append('user/message', { turn: 1, content: 'legacy user task' });
    expect(log.deriveMessages()).toEqual([{ role: 'user', content: 'legacy user task' }]);
  });

  it("V12: legacy user/assistant/tool-result normalization preserves behavior", () => {
    const log = new SessionLog();
    log.append('user/message', { turn: 1, content: 'hello' });
    log.append('assistant/message', { turn: 1, step: 1, content: 'hi' });
    log.append('tool/result', { turn: 1, step: 1, callId: 'c1', name: 'tool', success: true, data: { ok: true }, duration: 1 });
    expect(log.deriveMessages()).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi', toolCalls: undefined },
      { role: 'tool', content: JSON.stringify({ ok: true }, null, 2), toolCallId: 'c1', name: 'tool' },
    ]);
  });


  it("C1/C2: coverage and recovery guidance use explicit context metadata", () => {
    const log = new SessionLog();
    log.appendModelContext(
      { internalTarget: 'checkout', audit: { confidence: 0.4 } },
      { semanticKind: 'coverage_continuation', contextLifetime: 'next_turn', targetLogicalTurnId: 'T2', modelProjection: { role: 'system', content: 'Continue checkout' } },
    );
    log.appendModelContext(
      { internalRecovery: { stack: 'hidden' } },
      { semanticKind: 'recovery_guidance', contextLifetime: 'next_turn', targetLogicalTurnId: 'T2', modelProjection: { role: 'system', content: 'Retry safely' } },
    );

    expect(log.deriveMessages(undefined, 'T2')).toEqual([
      { role: 'system', content: 'Continue checkout' },
      { role: 'system', content: 'Retry safely' },
    ]);
  });

  it("C3/C4/C7: tool-failure and cognition guidance expose only safe projection", () => {
    const log = new SessionLog();
    log.appendModelContext(
      { exception: 'secret stack', retryCount: 3, internalId: 'x', guidance: 'Use keyboard' },
      { semanticKind: 'tool_failure_strategy', contextLifetime: 'next_turn', targetLogicalTurnId: 'T3', modelProjection: { role: 'system', content: 'Use keyboard' } },
    );
    log.appendModelContext(
      { rawHistory: ['private episode'], guidance: 'Try search' },
      { semanticKind: 'cognition_guidance', contextLifetime: 'next_turn', targetLogicalTurnId: 'T3', modelProjection: { role: 'system', content: 'Try search' } },
    );

    const messages = log.deriveMessages(undefined, 'T3');
    expect(messages).toEqual([
      { role: 'system', content: 'Use keyboard' },
      { role: 'system', content: 'Try search' },
    ]);
    expect(JSON.stringify(messages)).not.toContain('secret stack');
    expect(JSON.stringify(messages)).not.toContain('private episode');
  });

  it("C5/C6: workflow transition and diagnostics remain invisible", () => {
    const log = new SessionLog();
    log.append('system/note', { note: '[Workflow] TEST → REPORT' });
    log.append('custom', { type: 'align', data: { visibility: { semanticKind: 'audit_diagnostic', modelVisibility: 'none' }, reason: 'stale' } });
    log.append('custom', { type: 'request/config', data: { visibility: { semanticKind: 'request_config', modelVisibility: 'none' }, model: 'secret-model' } });

    expect(log.deriveMessages(undefined, 'T4')).toEqual([]);
  });

  it("C8: malformed context metadata is rejected at producer boundary", () => {
    const log = new SessionLog();
    expect(() => log.appendModelContext(
      { audit: 'x' },
      { semanticKind: 'coverage_continuation', contextLifetime: 'next_turn', targetLogicalTurnId: 'T1' },
    )).toThrow('requires modelProjection');
    expect(() => log.appendModelContext(
      { audit: 'x' },
      { semanticKind: 'coverage_continuation', contextLifetime: 'next_turn', modelProjection: { role: 'system', content: 'bad' } },
    )).toThrow('requires targetLogicalTurnId');
    expect(() => log.appendModelContext(
      { audit: 'x' },
      { semanticKind: 'workflow_transition' as any, contextLifetime: 'next_turn', targetLogicalTurnId: 'T1', modelProjection: { role: 'system', content: 'bad' } },
    )).toThrow('not an approved MODEL_CONTEXT kind');
  });

  it("C9/C10: ALIGN/request-config/execution-trace remain audit-only", () => {
    const log = new SessionLog();
    for (const type of ['align', 'request/config', 'execution/trace']) {
      log.append('custom', { type, data: { detail: 'internal' } });
    }
    expect(log.deriveMessages(undefined, 'T5')).toEqual([]);
  });

  it("C11: multiple migrated producers follow append sequence", () => {
    const log = new SessionLog();
    log.appendModelContext({ audit: 1 }, { semanticKind: 'coverage_continuation', contextLifetime: 'next_turn', targetLogicalTurnId: 'T6', modelProjection: { role: 'system', content: 'A' } });
    log.appendModelContext({ audit: 2 }, { semanticKind: 'recovery_guidance', contextLifetime: 'next_turn', targetLogicalTurnId: 'T6', modelProjection: { role: 'system', content: 'B' } });
    log.appendModelContext({ audit: 3 }, { semanticKind: 'cognition_guidance', contextLifetime: 'next_turn', targetLogicalTurnId: 'T6', modelProjection: { role: 'system', content: 'C' } });
    expect(log.deriveMessages(undefined, 'T6').map(message => message.content)).toEqual(['A', 'B', 'C']);
  });

  // ── getEventsByType ──
  it("getEventsByType filters correctly", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("user/message", { turn: 1, content: "Hello" } as UserMessageEvent);
    log.append("turn/start", { turn: 2 } as TurnStartEvent);
    log.append("user/message", { turn: 2, content: "World" } as UserMessageEvent);
    log.append("step/start", { turn: 1, step: 1 } as StepStartEvent);

    const turns = log.getEventsByType("turn/start");
    expect(turns).toHaveLength(2);

    const users = log.getEventsByType("user/message");
    expect(users).toHaveLength(2);

    const steps = log.getEventsByType("step/start");
    expect(steps).toHaveLength(1);

    const tools = log.getEventsByType("tool/call");
    expect(tools).toHaveLength(0);
  });

  // ── getLastEvent ──

  it("getLastEvent returns most recent matching event", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("turn/start", { turn: 2 } as TurnStartEvent);
    log.append("turn/start", { turn: 3 } as TurnStartEvent);

    const last = log.getLastEvent("turn/start");
    expect(last).toBeDefined();
    expect((last!.data as TurnStartEvent).turn).toBe(3);
  });

  it("getLastEvent returns undefined when no matching events", () => {
    const log = new SessionLog();
    log.append("user/message", { turn: 1, content: "Hi" } as UserMessageEvent);

    const last = log.getLastEvent("turn/start");
    expect(last).toBeUndefined();
  });

  // ── getSummary ──

  it("getSummary returns correct counts", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("step/start", { turn: 1, step: 1 } as StepStartEvent);
    log.append("tool/call", {
      turn: 1, step: 1, callId: "c1", name: "get", arguments: {}
    } as ToolCallEvent);
    log.append("tool/call", {
      turn: 1, step: 1, callId: "c2", name: "post", arguments: {}
    } as ToolCallEvent);
    log.append("turn/start", { turn: 2 } as TurnStartEvent);

    const summary = log.getSummary();
    expect(summary.totalEvents).toBe(5);
    expect(summary.turns).toBe(2);
    expect(summary.steps).toBe(1);
    expect(summary.toolCalls).toBe(2);
    expect(summary.duration).toBeGreaterThanOrEqual(0);
  });

  // ── toJSON ──

  it("toJSON returns copy of events", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("turn/start", { turn: 2 } as TurnStartEvent);

    const json = log.toJSON();
    expect(json).toHaveLength(2);

    // Verify it's a copy, not a reference
    json.push({} as any);
    expect(log.length).toBe(2);
  });

  // ── clear ──

  it("clear resets the log", () => {
    const log = new SessionLog();
    log.append("turn/start", { turn: 1 } as TurnStartEvent);
    log.append("user/message", { turn: 1, content: "Hi" } as UserMessageEvent);
    expect(log.length).toBe(2);

    log.clear();
    expect(log.length).toBe(0);
    expect(log.getEvents()).toHaveLength(0);

    // Seq numbers reset
    const e = log.append("turn/start", { turn: 1 } as TurnStartEvent);
    expect(e.seq).toBe(1);
  });
});
