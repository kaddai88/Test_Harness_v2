/** P4 Phase 1A producer primitive conformance tests. */

import { describe, expect, it } from 'vitest';
import {
  startLogicalTurn,
  retryStreamGeneration,
  createStreamProducerState,
  emitStreamEnvelope,
  createFinalAssistantCommit,
  isCompleteStreamEnvelope,
} from './stream-generation.js';

describe('P4 Phase 1A: stream generation primitives', () => {
  it('A1: a new logical turn gets a logicalTurn and initial ordinal', () => {
    const result = startLogicalTurn('S1', 'T17');
    expect(result.identity.logicalTurn).toBe('T17');
    expect(result.identity.generationOrdinal).toBe(1);
  });

  it('A2: same logical turn retry keeps logicalTurn and increments ordinal', () => {
    const first = startLogicalTurn('S1', 'T17');
    const retry = retryStreamGeneration(first.state);
    expect(retry.identity.logicalTurn).toBe('T17');
    expect(retry.identity.generationOrdinal).toBe(2);
  });

  it('A3: new logical turn resets generation ordinal namespace', () => {
    const first = startLogicalTurn('S1', 'T17');
    const retry = retryStreamGeneration(first.state);
    const next = startLogicalTurn('S1', 'T18');
    expect(retry.identity.generationOrdinal).toBe(2);
    expect(next.identity.logicalTurn).toBe('T18');
    expect(next.identity.generationOrdinal).toBe(1);
    expect(next.identity.generationId).not.toBe(retry.identity.generationId);
  });

  it('seq is monotonic per generation and terminal status consumes a higher seq', () => {
    const { identity } = startLogicalTurn('S1', 'T17');
    const initial = createStreamProducerState(identity);
    const first = emitStreamEnvelope(initial, 'Hello', 'streaming');
    const terminal = emitStreamEnvelope(first.state, 'Hello', 'completed');
    expect(first.envelope.seq).toBe(1);
    expect(terminal.envelope.seq).toBe(2);
    expect(terminal.state.terminal).toBe(true);
    expect(() => emitStreamEnvelope(terminal.state, 'late', 'streaming')).toThrow();
  });

  it('final commit references terminal seq and same generation identity', () => {
    const { identity } = startLogicalTurn('S1', 'T17');
    const commit = createFinalAssistantCommit(identity, 2, 'Hello');
    expect(commit.sessionId).toBe('S1');
    expect(commit.logicalTurn).toBe('T17');
    expect(commit.generationId).toBe(identity.generationId);
    expect(commit.generationOrdinal).toBe(1);
    expect(commit.finalSeq).toBe(2);
  });

  it('incomplete legacy envelope is rejected', () => {
    expect(isCompleteStreamEnvelope({ sessionId: 'S1', turn: 17, partial: 'Hello', done: true })).toBe(false);
    expect(isCompleteStreamEnvelope({ streamContractVersion: 1, sessionId: 'S1' })).toBe(false);
  });
});
