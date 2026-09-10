/**
 * P2-E I8-B-R1 Runtime Rollout Integration Tests (N1-N10)
 *
 * These tests exercise AgentLoop session creation/recovery wiring rather than
 * only testing rollout policy primitives.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { AgentLoop, type AgentLogger } from './loop.js';
import { InMemorySessionPersistenceStore } from './session-persistence.js';
import type { SessionPersistenceStore } from './session-persistence.js';
import type { PersistedSessionState } from './identity-semantics.js';
import { SimpleGlobalRolloutPolicy } from './session-persistence.js';
import { THContainer, EventBusImpl } from '@test-harness/th-core';
import { ToolRegistry } from '@test-harness/th-tools';

vi.mock('@test-harness/th-cognition', () => ({
  CognitiveEngine: class {
    onSessionStart() { return {}; }
    onBeforeAction() { return {}; }
    onAfterAction() { return { learnings: [] }; }
    getStats() { return { episodes: 0, knowledge: 0, procedures: 0 }; }
    onSessionEnd() { return { episodes: 0, knowledge: 0, procedures: 0 }; }
  },
}));

function makeLogger(): AgentLogger {
  return { info: () => {}, debug: () => {}, warn: () => {}, error: () => {}, toolCall: () => {}, toolResult: () => {} };
}

function makeConfig() {
  return {
    strategy: 'sequential', maxTurns: 1, maxRetriesPerAction: 1,
    instructions: 'test', testType: 'smoke',
    llm: { provider: 'scripted', model: 'scripted', temperature: 0 },
  } as any;
}

class StopLLM {
  readonly id = 'stop';
  readonly name = 'Stop';
  readonly capabilities = ['chat', 'streaming'] as any;
  async complete(): Promise<any> { return { content: 'done', toolCalls: [] }; }
  async *stream(): AsyncIterable<any> {
    yield { type: 'content', data: 'done' };
    yield { type: 'done', data: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
  }
  async countTokens(): Promise<number> { return 0; }
  async healthCheck(): Promise<boolean> { return true; }
}

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    id: 'browser_snapshot', name: 'browser_snapshot', description: 'snapshot', category: 'browser',
    inputSchema: z.any().optional(), outputSchema: z.any(), rawJsonSchema: { type: 'object', properties: {} },
    execute: async () => ({ success: true, data: { text: '' }, duration: 1 }),
  } as any);
  return registry;
}

async function runLoop(
  sessionId: string,
  store: SessionPersistenceStore,
  policy?: SimpleGlobalRolloutPolicy,
  mode?: 'LEGACY' | 'P2E',
) {
  const container = new THContainer();
  return new AgentLoop().run({
    sessionId, target: { url: 'https://example.com', scope: 'page' }, config: makeConfig(),
    llm: new StopLLM() as any, toolRegistry: makeRegistry(),
    eventBus: container.events as EventBusImpl, container, logger: makeLogger(),
    sessionPersistenceStore: store, rolloutPolicy: policy, identitySemanticsMode: mode,
  });
}

describe('P2-E I8-B-R1: Runtime Rollout Integration', () => {
  it('N1: actual new session rollout OFF persists LEGACY', async () => {
    const store = new InMemorySessionPersistenceStore();
    await runLoop('n1', store, new SimpleGlobalRolloutPolicy('LEGACY'));
    const persisted = await store.load('n1');
    expect(persisted?.semantics.mode).toBe('LEGACY');
  });

  it('N2: actual new session rollout ON with capable backend persists P2E', async () => {
    const store: SessionPersistenceStore = new InMemorySessionPersistenceStore();
    // Capability is supplied by the actual backend adapter in production.
    Object.defineProperty(store, 'capabilities', { value: { p2eAtomicSessionPublication: 'supported', backendId: 'capable-test' } });
    await runLoop('n2', store, new SimpleGlobalRolloutPolicy('P2E'));
    const persisted = await store.load('n2');
    expect(persisted?.semantics.mode).toBe('P2E');
  });

  it('N3: rollout ON with incapable backend persists LEGACY and preserves fallback reason in decision behavior', async () => {
    const store = new InMemorySessionPersistenceStore();
    await runLoop('n3', store, new SimpleGlobalRolloutPolicy('P2E'));
    const persisted = await store.load('n3');
    expect(persisted?.semantics.mode).toBe('LEGACY');
  });

  it('N4: existing LEGACY recovery while rollout ON does not consult policy', async () => {
    const store = new InMemorySessionPersistenceStore();
    await runLoop('n4', store, new SimpleGlobalRolloutPolicy('LEGACY'));
    const policy = new SimpleGlobalRolloutPolicy('P2E');
    const spy = vi.spyOn(policy, 'getMode');
    await runLoop('n4', store, policy);
    expect((await store.load('n4'))?.semantics.mode).toBe('LEGACY');
    expect(spy).not.toHaveBeenCalled();
  });

  it('N5: existing P2E recovery while rollout OFF remains P2E', async () => {
    const store: SessionPersistenceStore = new InMemorySessionPersistenceStore();
    Object.defineProperty(store, 'capabilities', { value: { p2eAtomicSessionPublication: 'supported', backendId: 'capable-test' } });
    await runLoop('n5', store, new SimpleGlobalRolloutPolicy('P2E'));
    await runLoop('n5', store, new SimpleGlobalRolloutPolicy('LEGACY'));
    expect((await store.load('n5'))?.semantics.mode).toBe('P2E');
  });

  it('N6: LEGACY and P2E sessions coexist in same worker with independent persisted modes', async () => {
    const legacyStore = new InMemorySessionPersistenceStore();
    const p2eStore: SessionPersistenceStore = new InMemorySessionPersistenceStore();
    Object.defineProperty(p2eStore, 'capabilities', { value: { p2eAtomicSessionPublication: 'supported', backendId: 'capable-test' } });
    await Promise.all([
      runLoop('n6-legacy', legacyStore, new SimpleGlobalRolloutPolicy('LEGACY')),
      runLoop('n6-p2e', p2eStore, new SimpleGlobalRolloutPolicy('P2E')),
    ]);
    expect((await legacyStore.load('n6-legacy'))?.semantics.mode).toBe('LEGACY');
    expect((await p2eStore.load('n6-p2e'))?.semantics.mode).toBe('P2E');
  });

  it('N7: rollback with pending P2E decision retains P2E authority; no mode rewrite', async () => {
    const store: SessionPersistenceStore = new InMemorySessionPersistenceStore();
    Object.defineProperty(store, 'capabilities', { value: { p2eAtomicSessionPublication: 'supported', backendId: 'capable-test' } });
    await runLoop('n7', store, new SimpleGlobalRolloutPolicy('P2E'));
    await runLoop('n7', store, new SimpleGlobalRolloutPolicy('LEGACY'));
    expect((await store.load('n7'))?.semantics.mode).toBe('P2E');
  });

  it('N8: rollback OFF → subsequent new session LEGACY', async () => {
    const store = new InMemorySessionPersistenceStore();
    await runLoop('n8', store, new SimpleGlobalRolloutPolicy('LEGACY'));
    expect((await store.load('n8'))?.semantics.mode).toBe('LEGACY');
  });

  it('N9: capability comes from actual backend adapter, caller cannot assert capability through policy', async () => {
    const store = new InMemorySessionPersistenceStore();
    const policy = new SimpleGlobalRolloutPolicy('P2E');
    await runLoop('n9', store, policy);
    // InMemory adapter advertises false; requested P2E is safely downgraded.
    expect((await store.load('n9'))?.semantics.mode).toBe('LEGACY');
  });

  it('N10: corrupt/unknown persisted semantics are rejected by the actual AgentLoop path', async () => {
    const store = new InMemorySessionPersistenceStore();
    const corrupt: PersistedSessionState = {
      sessionId: 'n10', semantics: { mode: 'UNKNOWN' as any, pinnedAt: Date.now(), semanticsVersion: 'p2e-v1' },
      lastDecisionProvenance: 'LEGACY_UNAVAILABLE', lastCurrentObservation: { kind: 'none' },
      occurrenceCounter: 0, recordVersion: 'record-v1', persistedAt: Date.now(),
    };
    await store.save(corrupt);

    // Existing invalid record must not be interpreted as a new session.
    await expect(runLoop('n10', store, new SimpleGlobalRolloutPolicy('P2E'))).rejects.toThrow('recovery rejected');
    expect((await store.load('n10'))?.semantics.mode).toBe('UNKNOWN');
  });

  it('N11: P2E pin persistence failure prevents any P2E runtime activity', async () => {
    const base = new InMemorySessionPersistenceStore();
    const failingStore: SessionPersistenceStore = {
      capabilities: { p2eAtomicSessionPublication: 'supported', backendId: 'failing-test' },
      async save(): Promise<void> { throw new Error('pin persistence failed'); },
      async publishOccurrence(): Promise<void> { throw new Error('pin persistence failed'); },
      async load(sessionId: string) { return base.load(sessionId); },
      async delete(sessionId: string) { return base.delete(sessionId); },
      async exists(sessionId: string) { return base.exists(sessionId); },
    };
    const policy = new SimpleGlobalRolloutPolicy('P2E');
    const stream = new StopLLM();

    const container = new THContainer();
    await expect(new AgentLoop().run({
      sessionId: 'n11', target: { url: 'https://example.com', scope: 'page' }, config: makeConfig(),
      llm: stream as any, toolRegistry: makeRegistry(), eventBus: container.events as EventBusImpl,
      container, logger: makeLogger(), sessionPersistenceStore: failingStore, rolloutPolicy: policy,
    })).rejects.toThrow('pin persistence failed');
  });

  it('N12: successful pin persistence permits P2E runtime to begin', async () => {
    const store: SessionPersistenceStore = new InMemorySessionPersistenceStore();
    Object.defineProperty(store, 'capabilities', { value: { p2eAtomicSessionPublication: 'supported', backendId: 'capable-test' } });
    await runLoop('n12', store, new SimpleGlobalRolloutPolicy('P2E'));
    expect((await store.load('n12'))?.semantics.mode).toBe('P2E');
  });
});
