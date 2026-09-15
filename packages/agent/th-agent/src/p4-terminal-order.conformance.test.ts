import { describe, expect, it } from 'vitest';
import { AgentLoop, type AgentLogger } from './loop.js';
import { AgentStreamChunkEvent, AgentFinalAssistantCommitEvent } from '@test-harness/th-protocol';
import { THContainer } from '@test-harness/th-core';
import { ToolRegistry } from '@test-harness/th-tools';

class TerminalStreamLLM {
  readonly id = 'terminal-order';
  readonly name = 'Terminal Order';
  readonly capabilities = ['chat', 'streaming'] as any;
  async complete(): Promise<any> { return { content: '', toolCalls: [] }; }
  async *stream(): AsyncIterable<any> {
    yield { type: 'content', data: 'Hello' };
    yield { type: 'done', data: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  }
  async countTokens(): Promise<number> { return 0; }
  async healthCheck(): Promise<boolean> { return true; }
}

const logger: AgentLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, toolCall: () => {}, toolResult: () => {} };

describe('P4 Phase 1E-R1: terminal envelope → final commit ordering', () => {
  it('observes completed envelope before matching FinalAssistantCommit', async () => {
    const container = new THContainer();
    const registry = new ToolRegistry();
    const order: string[] = [];
    let terminalSeq = 0;
    let commitSeq = 0;

    container.events.on(AgentStreamChunkEvent, event => {
      if (event.streamEnvelope?.status === 'completed') {
        order.push('completed');
        terminalSeq = event.streamEnvelope.seq;
      }
    });
    container.events.on(AgentFinalAssistantCommitEvent, event => {
      order.push('final');
      commitSeq = event.commit.finalSeq;
    });

    const result = await new AgentLoop().run({
      sessionId: 'p4-terminal-order',
      target: { url: 'https://example.com', scope: 'page' },
      config: { strategy: 'sequential', maxTurns: 1, maxRetriesPerAction: 1, instructions: 'finish', testType: 'smoke', llm: { provider: 'test', model: 'test', temperature: 0 } } as any,
      llm: new TerminalStreamLLM() as any,
      toolRegistry: registry,
      eventBus: container.events,
      container,
      logger,
      identitySemanticsMode: 'P2E',
    });

    expect(result.sessionId).toBe('p4-terminal-order');
    expect(order).toEqual(['completed', 'final']);
    expect(commitSeq).toBe(terminalSeq);
  });
});
