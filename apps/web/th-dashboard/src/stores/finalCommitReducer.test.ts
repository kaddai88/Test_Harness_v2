import { describe, expect, it } from 'vitest';
import { reduceStreamEnvelope, initialStreamReducerState, selectActiveStream } from './streamReducer';
import { applyFinalAssistantCommit, isValidFinalAssistantCommit } from './finalCommitReducer';
import type { FinalAssistantCommit } from '../types';

function env(overrides: any = {}) {
  return { streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2, seq: 1, payloadMode: 'accumulated', content: 'Hello', status: 'streaming', ...overrides } as const;
}

describe('P4 Phase 1D: FinalAssistantCommit handoff', () => {
  it('D1/S15: active terminal generation commit retires stream and yields one final presentation', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, env({ seq: 1, content: 'Hello wor' }));
    state = reduceStreamEnvelope(state, env({ seq: 2, content: 'Hello world', status: 'completed' }));
    const commit: FinalAssistantCommit = { streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2, finalSeq: 2, content: 'Hello world' };
    const result = applyFinalAssistantCommit(state, commit);
    expect(result.result.accepted).toBe(true);
    expect(result.finalContent).toBe('Hello world');
    expect(selectActiveStream(result.state, 'S')?.presentationRetired).toBe(true);
  });

  it('D2: duplicate final commit is idempotent', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, env({ seq: 1, content: 'Hello', status: 'completed' }));
    const commit: FinalAssistantCommit = { streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2, finalSeq: 1, content: 'Hello' };
    const first = applyFinalAssistantCommit(state, commit);
    const second = applyFinalAssistantCommit(first.state, commit);
    expect(second.result.accepted).toBe(true);
    expect(second.result.duplicate).toBe(true);
  });

  it('D3: final commit content is presentation authority', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, env({ seq: 1, content: 'Hello wor', status: 'completed' }));
    const commit: FinalAssistantCommit = { streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2, finalSeq: 1, content: 'Hello world' };
    expect(applyFinalAssistantCommit(state, commit).finalContent).toBe('Hello world');
  });

  it('D4/S16: stale G1 final cannot affect active G2', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, env({ generationId: 'G2', generationOrdinal: 2, seq: 1, status: 'completed', content: 'G2' }));
    const stale: FinalAssistantCommit = { streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G1', generationOrdinal: 1, finalSeq: 1, content: 'G1' };
    const result = applyFinalAssistantCommit(state, stale);
    expect(result.result.accepted).toBe(false);
    expect(selectActiveStream(result.state, 'S')?.presentationRetired).toBeUndefined();
  });

  it('D5/D6: same finalSeq conflict is protocol violation', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, env({ seq: 1, status: 'completed', content: 'Hello' }));
    const good: FinalAssistantCommit = { streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2, finalSeq: 1, content: 'Hello' };
    state = applyFinalAssistantCommit(state, good).state;
    const conflict = applyFinalAssistantCommit(state, { ...good, content: 'Other' });
    expect(conflict.result.protocolViolation).toBe(true);
  });

  it('D7: future/nonterminal/wrong seq commit fails closed', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, env({ seq: 1, status: 'streaming', content: 'Hello' }));
    const commit: FinalAssistantCommit = { streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2, finalSeq: 2, content: 'Hello' };
    expect(applyFinalAssistantCommit(state, commit).result.accepted).toBe(false);
  });

  it('D8: background Session B commit does not alter Session A', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, env({ sessionId: 'A', generationId: 'GA', content: 'A', status: 'completed' }));
    state = reduceStreamEnvelope(state, env({ sessionId: 'B', generationId: 'GB', content: 'B', status: 'completed' }));
    const commit: FinalAssistantCommit = { streamContractVersion: 1, sessionId: 'B', logicalTurn: 'T17', generationId: 'GB', generationOrdinal: 2, finalSeq: 1, content: 'B final' };
    const result = applyFinalAssistantCommit(state, commit);
    expect(selectActiveStream(result.state, 'A')?.content).toBe('A');
    expect(selectActiveStream(result.state, 'B')?.finalContent).toBe('B final');
  });

  it('D7b/D10: errored generation rejects otherwise matching final commit', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, {
      streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2,
      seq: 1, payloadMode: 'accumulated', content: 'partial', status: 'errored',
    });
    const commit = { streamContractVersion: 1 as const, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2, finalSeq: 1, content: 'partial' };
    const result = applyFinalAssistantCommit(state, commit);
    expect(result.result.accepted).toBe(false);
    expect(result.result.reason).toContain('not_completed');
    expect(selectActiveStream(result.state, 'S')?.presentationRetired).toBeUndefined();
  });

  it('D7c/D11: cancelled generation rejects otherwise matching final commit', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, {
      streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2,
      seq: 1, payloadMode: 'accumulated', content: 'partial', status: 'cancelled',
    });
    const commit = { streamContractVersion: 1 as const, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2, finalSeq: 1, content: 'partial' };
    const result = applyFinalAssistantCommit(state, commit);
    expect(result.result.accepted).toBe(false);
    expect(result.result.reason).toContain('not_completed');
    expect(selectActiveStream(result.state, 'S')?.presentationRetired).toBeUndefined();
  });

  it('D4b/S16: stale generation final cannot create authoritative presentation', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, {
      streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2,
      seq: 1, payloadMode: 'accumulated', content: 'new', status: 'streaming',
    });
    state = reduceStreamEnvelope(state, {
      streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G1', generationOrdinal: 1,
      seq: 1, payloadMode: 'accumulated', content: 'old', status: 'completed',
    });
    const commit = { streamContractVersion: 1 as const, sessionId: 'S', logicalTurn: 'T17', generationId: 'G1', generationOrdinal: 1, finalSeq: 1, content: 'old' };
    const result = applyFinalAssistantCommit(state, commit);
    expect(result.result.accepted).toBe(false);
    expect(result.result.reason).toBe('stale_generation');
    expect(selectActiveStream(result.state, 'S')?.finalContent).toBeUndefined();
  });
  it('D9: late same-generation stream cannot resurrect retired presentation', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, env({ seq: 1, status: 'completed', content: 'Hello' }));
    const commit: FinalAssistantCommit = { streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T17', generationId: 'G2', generationOrdinal: 2, finalSeq: 1, content: 'Hello' };
    state = applyFinalAssistantCommit(state, commit).state;
    const late = reduceStreamEnvelope(state, env({ seq: 2, status: 'streaming', content: 'Hello late' }));
    expect(selectActiveStream(late, 'S')?.presentationRetired).toBe(true);
    expect(selectActiveStream(late, 'S')?.content).toBe('Hello');
  });

  it('validates complete final commit identity metadata', () => {
    expect(isValidFinalAssistantCommit({ streamContractVersion: 1, sessionId: 'S', logicalTurn: 'T1', generationId: 'G1', generationOrdinal: 1, finalSeq: 1, content: 'x' })).toBe(true);
    expect(isValidFinalAssistantCommit({ sessionId: 'S', logicalTurn: 'T1', content: 'x' })).toBe(false);
  });
});
