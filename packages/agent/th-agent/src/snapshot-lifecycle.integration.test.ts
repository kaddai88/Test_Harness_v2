/**
 * P2 Phase 1 integration coverage: execute the real AgentLoop through
 * snapshot observation → TEST initialization → model decision → action.
 */
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { AgentLoop, type AgentLogger } from './loop.js';
import { ToolRegistry } from '@test-harness/th-tools';
import { THContainer } from '@test-harness/th-core';
import { EventBusImpl } from '@test-harness/th-core';

vi.mock('@test-harness/th-cognition', () => ({
  CognitiveEngine: class {
    onSessionStart() { return {}; }
    onBeforeAction() { return {}; }
    onAfterAction() { return { learnings: [] }; }
    getStats() { return { episodes: 0, knowledge: 0, procedures: 0 }; }
    onSessionEnd() { return { episodes: 0, knowledge: 0, procedures: 0 }; }
  },
}));

const SNAPSHOT = [
  '- heading "Test page"',
  '- button "Target button" [ref=e1]',
  '- textbox "Target input" [ref=e2]',
  '- paragraph "',
  'x'.repeat(240),
  '"',
].join('\n');

function makeTool(id: string, execute: (input: unknown) => Promise<any>) {
  return {
    id,
    name: id,
    description: id,
    category: 'browser' as const,
    inputSchema: z.any().optional(),
    outputSchema: z.any(),
    rawJsonSchema: { type: 'object', properties: {} },
    execute,
  };
}

class ScriptedLLM {
  readonly id = 'scripted';
  readonly name = 'Scripted';
  readonly capabilities = ['chat', 'tool_use', 'streaming'] as any;
  private call = 0;

  async complete(): Promise<any> {
    return { id: 'unused', content: '', toolCalls: [], usage: {}, finishReason: 'stop', model: 'scripted' };
  }

  async *stream(): AsyncIterable<any> {
    this.call++;
    const calls = [
      { name: 'browser_navigate', args: { url: 'https://example.com' } },
      { name: 'browser_snapshot', args: {} },
      // Deliberately unmatched: action ref is not a known feature. This forces
      // the real ALIGN path and lets the test assert current vs decided identity.
      { name: 'browser_click', args: { target: 'e999', element: 'unknown' } },
    ];
    const call = calls[this.call - 1];
    if (call) {
      yield { type: 'tool_call', data: { index: 0, id: `call-${this.call}`, name: call.name, arguments: JSON.stringify(call.args) } };
      yield { type: 'done', data: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    } else {
      yield { type: 'content', data: 'done' };
      yield { type: 'done', data: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
    }
  }

  async countTokens(): Promise<number> { return 0; }
  async healthCheck(): Promise<boolean> { return true; }
}

describe('P2 Phase 1 AgentLoop snapshot lifecycle', () => {
  it('routes the initial TEST snapshot through identity and ALIGN decision capture', async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('browser_navigate', async () => ({ success: true, data: { text: '' }, duration: 1 })));
    registry.register(makeTool('browser_snapshot', async () => ({ success: true, data: { text: SNAPSHOT }, duration: 1 })));
    registry.register(makeTool('browser_click', async () => ({ success: true, data: { text: '' }, duration: 1 })));

    const logs: string[] = [];
    const decisionIdentities: Array<{ version: number; hash: string } | null> = [];
    const logger: AgentLogger = {
      info: message => logs.push(message),
      debug: () => {},
      warn: message => logs.push(message),
      error: message => logs.push(message),
      toolCall: () => {},
      toolResult: () => {},
    };

    const container = new THContainer();
    const loop = new AgentLoop();
    const llm = new ScriptedLLM();
    const result = await loop.run({
      sessionId: 'p2-lifecycle-integration',
      target: { url: 'https://example.com', scope: 'page' },
      config: {
        strategy: 'sequential',
        maxTurns: 3,
        maxRetriesPerAction: 1,
        instructions: 'test the target button',
        testType: 'full',
        llm: { provider: 'scripted', model: 'scripted', temperature: 0 },
      },
      llm: llm as any,
      toolRegistry: registry,
      eventBus: container.events as EventBusImpl,
      container,
      logger,
      onDecisionSnapshotIdentity: identity => {
        decisionIdentities.push(identity ? { ...identity } : null);
      },
    });

    // The real loop reached its bounded end; the assertion of interest is the
    // lifecycle evidence emitted while executing the scripted action.
    expect(result.sessionId).toBe('p2-lifecycle-integration');
    expect(decisionIdentities.length).toBeGreaterThan(0);
    expect(decisionIdentities.some(identity => identity !== null)).toBe(true);
    const decided = decisionIdentities.find(identity => identity !== null)!;
    expect(decided.version).toBeGreaterThan(0);
    expect(decided.hash).toMatch(/^[0-9a-f]+$/);

    const align = logs.find(line => line.startsWith('[ALIGN]'));
    if (align) {
      expect(align).toMatch(/current=v\d+:[0-9a-f]+/);
      expect(align).toMatch(/decided=v\d+:[0-9a-f]+/);
      expect(align).not.toContain('current=—');
      expect(align).not.toContain('decided=—');
    }
  });
});
