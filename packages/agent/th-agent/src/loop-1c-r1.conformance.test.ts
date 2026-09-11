/**
 * P3 1C-R1 real AgentLoop turn-boundary conformance.
 *
 * Uses the actual tool-failure producer in loop.ts, captures the actual
 * messages passed to llm.stream(), and verifies T1 -> T2 -> T3 semantics.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentLoop, type AgentLogger } from './loop.js';
import { ToolRegistry } from '@test-harness/th-tools';
import { THContainer, EventBusImpl } from '@test-harness/th-core';
import type { Message } from '@test-harness/th-protocol';

vi.mock('@test-harness/th-cognition', () => ({
  CognitiveEngine: class {
    onSessionStart() { return {}; }
    onBeforeAction() { return {}; }
    onAfterAction() { return { learnings: [] }; }
    getStats() { return { episodes: 0, knowledge: 0, procedures: 0 }; }
    onSessionEnd() { return { episodes: 0, knowledge: 0, procedures: 0 }; }
  },
}));

const SNAPSHOT = '- button "Target" [ref=e17]';

function logger(): AgentLogger {
  return { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, toolCall: () => {}, toolResult: () => {} };
}

class FailureScriptLLM {
  readonly id = 'p3-turn-boundary';
  readonly name = 'P3 Turn Boundary';
  readonly capabilities = ['chat', 'tool_use', 'streaming'] as any;
  readonly requests: Message[][] = [];
  private requestNumber = 0;

  async complete(): Promise<any> {
    return { id: 'unused', content: '', toolCalls: [], usage: {}, finishReason: 'stop', model: this.id };
  }

  async *stream(request: { messages: Message[] }): AsyncIterable<any> {
    this.requests.push(request.messages);
    this.requestNumber++;
    const call = this.requestNumber === 1
      ? { name: 'browser_snapshot', args: {} }
      : this.requestNumber === 2
        ? { name: 'browser_click', args: { target: 'e17' } }
        : undefined;

    if (call) {
      yield {
        type: 'tool_call',
        data: { index: 0, id: `call-${this.requestNumber}`, name: call.name, arguments: JSON.stringify(call.args) },
      };
    }
    yield { type: 'done', data: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  }

  async countTokens(): Promise<number> { return 0; }
  async healthCheck(): Promise<boolean> { return true; }
}

function registry(): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register({
    id: 'browser_snapshot', name: 'browser_snapshot', description: 'snapshot', category: 'browser',
    inputSchema: z.any().optional(), outputSchema: z.any(), rawJsonSchema: { type: 'object', properties: {} },
    execute: async () => ({ success: true, data: { text: SNAPSHOT }, duration: 1 }),
  } as any);
  tools.register({
    id: 'browser_click', name: 'browser_click', description: 'click', category: 'browser',
    inputSchema: z.any().optional(), outputSchema: z.any(), rawJsonSchema: { type: 'object', properties: {} },
    execute: async () => ({ success: false, error: 'definitely_not_applied: pre-dispatch test rejection', duration: 1 }),
  } as any);
  return tools;
}

describe('P3 1C-R1: real AgentLoop logical-turn boundary', () => {
  it('real T1 failure producer targets T2, then expires after T2', async () => {
    const llm = new FailureScriptLLM();
    const container = new THContainer();

    await new AgentLoop().run({
      sessionId: 'p3-1c-turn-boundary',
      target: { url: 'https://example.com', scope: 'page' },
      config: {
        strategy: 'sequential', maxTurns: 3, maxRetriesPerAction: 1,
        instructions: 'test target', testType: 'smoke',
        llm: { provider: 'scripted', model: 'scripted', temperature: 0 },
      } as any,
      llm: llm as any,
      toolRegistry: registry(),
      eventBus: container.events as EventBusImpl,
      container,
      logger: logger(),
      identitySemanticsMode: 'P2E',
    });

    // Actual loop request sequence: T1 snapshot, T2 failed click, T3 stop.
    expect(llm.requests.length).toBe(3);

    const t1 = llm.requests[0]!;
    const t2 = llm.requests[1]!;
    const t3 = llm.requests[2]!;

    const t1Guidance = t1.find(m => typeof m.content === 'string' && m.content.includes('different approach'));
    const t2Guidance = t2.find(m => typeof m.content === 'string' && m.content.includes('different approach'));
    const t3Guidance = t3.find(m => typeof m.content === 'string' && m.content.includes('different approach'));

    // Producer runs at end of T2 and targets T3 (the next actual logical turn).
    expect(t1Guidance).toBeUndefined();
    expect(t2Guidance).toBeUndefined();
    expect(t3Guidance).toBeDefined();

    // Only the safe model projection is present; audit-only internals are absent.
    expect(t3Guidance!.content).toContain('different approach');
    expect(t3Guidance!.content).not.toContain('definitely_not_applied');
    expect(t3Guidance!.content).not.toContain('retryCount');

    // The same actual request construction must not duplicate the context.
    expect(t3.filter(m => typeof m.content === 'string' && m.content.includes('different approach'))).toHaveLength(1);
  });

  it('actual turn derivation uses the loop turn identity, not an undefined fallback', async () => {
    const llm = new FailureScriptLLM();
    const container = new THContainer();

    await new AgentLoop().run({
      sessionId: 'p3-1c-turn-id',
      target: { url: 'https://example.com', scope: 'page' },
      config: {
        strategy: 'sequential', maxTurns: 3, maxRetriesPerAction: 1,
        instructions: 'test target', testType: 'smoke',
        llm: { provider: 'scripted', model: 'scripted', temperature: 0 },
      } as any,
      llm: llm as any,
      toolRegistry: registry(),
      eventBus: container.events as EventBusImpl,
      container,
      logger: logger(),
      identitySemanticsMode: 'P2E',
    });

    const contextMessages = llm.requests.map(messages =>
      messages.filter(m => typeof m.content === 'string' && m.content.includes('different approach'))
    );

    // Guidance appended during actual T2 must be visible in actual T3 request,
    // not T2 (off-by-one) and not absent due to missing logicalTurnId.
    expect(contextMessages[0]).toHaveLength(0);
    expect(contextMessages[1]).toHaveLength(0);
    expect(contextMessages[2]).toHaveLength(1);
  });
});
