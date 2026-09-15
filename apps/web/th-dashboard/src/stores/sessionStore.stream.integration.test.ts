import { describe, expect, it } from 'vitest';
import type { AgentActivity } from '../types';
import { applyAgentActivityToStreamState } from './sessionStore';
import { initialStreamReducerState } from './streamReducer';

const envelope = {
  streamContractVersion: 1 as const,
  sessionId: 'A', logicalTurn: 'T1', generationId: 'G1', generationOrdinal: 1,
  seq: 1, payloadMode: 'accumulated' as const, content: 'Hello', status: 'streaming' as const,
};

describe('P4 Phase 1C-R1: sessionStore stream precedence and switching', () => {
  it('R1: valid v1 envelope wins; legacy partial from same activity is ignored', () => {
    const activity: AgentActivity = {
      id: 'a1', sessionId: 'A', turn: 1, kind: 'stream',
      partial: 'HelloHello', done: false, streamEnvelope: envelope, timestamp: 1,
    };
    const result = applyAgentActivityToStreamState(initialStreamReducerState, activity, 'A');
    expect(result.streamText).toBe('Hello');
    expect(result.streamState.streamsBySession.A?.generations.G1?.content).toBe('Hello');
  });

  it('R2: background Session B advances while visible Session A remains unchanged', () => {
    let state = initialStreamReducerState;
    const a: AgentActivity = { id: 'a', sessionId: 'A', turn: 1, kind: 'stream', streamEnvelope: envelope, timestamp: 1 };
    const b: AgentActivity = { id: 'b', sessionId: 'B', turn: 7, kind: 'stream', streamEnvelope: { ...envelope, sessionId: 'B', logicalTurn: 'T7', generationId: 'GB', content: 'BBBB' }, timestamp: 2 };
    state = applyAgentActivityToStreamState(state, a, 'A').streamState;
    const visible = applyAgentActivityToStreamState(state, b, 'A');
    expect(visible.streamText).toBe('Hello');
    expect(visible.streamState.streamsBySession.B?.generations.GB?.content).toBe('BBBB');
  });

  it('R3: A → B → A selection retains each session content', () => {
    let state = initialStreamReducerState;
    state = applyAgentActivityToStreamState(state, { id: 'a', sessionId: 'A', turn: 1, kind: 'stream', streamEnvelope: envelope, timestamp: 1 }, 'A').streamState;
    state = applyAgentActivityToStreamState(state, { id: 'b', sessionId: 'B', turn: 7, kind: 'stream', streamEnvelope: { ...envelope, sessionId: 'B', logicalTurn: 'T7', generationId: 'GB', content: 'BBBB' }, timestamp: 2 }, 'A').streamState;
    expect(applyAgentActivityToStreamState(state, { id: 'noop', sessionId: 'B', turn: 7, kind: 'tool_call', timestamp: 3 }, 'B').streamText).toBe('BBBB');
    expect(applyAgentActivityToStreamState(state, { id: 'noop', sessionId: 'A', turn: 1, kind: 'tool_call', timestamp: 4 }, 'A').streamText).toBe('Hello');
  });

  it('R4: legacy-only activity does not create or mutate v1 state', () => {
    const legacy: AgentActivity = { id: 'legacy', sessionId: 'A', turn: 1, kind: 'stream', partial: 'H', done: false, timestamp: 1 };
    const result = applyAgentActivityToStreamState(initialStreamReducerState, legacy, 'A');
    expect(result.streamText).toBe('');
    expect(result.streamState).toEqual(initialStreamReducerState);
  });
});
