import { describe, expect, it } from 'vitest';
import { normalizeStreamEnvelope, normalizeFinalAssistantCommit } from '../api/websocket';
import { applyFinalAssistantCommit } from '../stores/finalCommitReducer';
import { reduceStreamEnvelope, initialStreamReducerState, selectActiveStream } from '../stores/streamReducer';

describe('P4 Phase 1E: downstream envelope → normalization → reducer → final handoff', () => {
  const base = {
    streamContractVersion: 1,
    sessionId: 'S1',
    logicalTurn: 'T17',
    generationId: 'G2',
    generationOrdinal: 2,
    payloadMode: 'accumulated',
  } as const;

  it('E1: accumulated stream reaches one final presentation through full client chain', () => {
    const workerPayloads = [
      { ...base, seq: 1, content: 'H', status: 'streaming' },
      { ...base, seq: 2, content: 'He', status: 'streaming' },
      { ...base, seq: 3, content: 'Hello', status: 'completed' },
    ];
    let state = initialStreamReducerState;
    for (const payload of workerPayloads) {
      const envelope = normalizeStreamEnvelope(payload, 'S1');
      expect(envelope).toBeDefined();
      state = reduceStreamEnvelope(state, envelope!);
    }
    const commitPayload = { ...base, finalSeq: 3, content: 'Hello' };
    const commit = normalizeFinalAssistantCommit(commitPayload, 'S1');
    expect(commit).toBeDefined();
    const final = applyFinalAssistantCommit(state, commit!);
    expect(final.result.accepted).toBe(true);
    expect(final.finalContent).toBe('Hello');
    expect(selectActiveStream(final.state, 'S1')?.presentationRetired).toBe(true);
  });

  it('E2: sessions remain isolated through normalization/reducer/final handoff', () => {
    let state = initialStreamReducerState;
    state = reduceStreamEnvelope(state, normalizeStreamEnvelope({ ...base, sessionId: 'A', generationId: 'GA', content: 'A', seq: 1, status: 'completed' }, 'A')!);
    state = reduceStreamEnvelope(state, normalizeStreamEnvelope({ ...base, sessionId: 'B', logicalTurn: 'T8', generationId: 'GB', content: 'B', seq: 1, status: 'completed' }, 'B')!);
    const commitB = normalizeFinalAssistantCommit({ ...base, sessionId: 'B', logicalTurn: 'T8', generationId: 'GB', finalSeq: 1, content: 'B final' }, 'B')!;
    const final = applyFinalAssistantCommit(state, commitB);
    expect(selectActiveStream(final.state, 'A')?.content).toBe('A');
    expect(selectActiveStream(final.state, 'B')?.finalContent).toBe('B final');
  });

  it('E3: stale G1 packets and final commit cannot affect active G2', () => {
    let state = initialStreamReducerState;
    state = reduceStreamEnvelope(state, normalizeStreamEnvelope({ ...base, generationId: 'G2', content: 'G2', seq: 1, status: 'streaming' }, 'S1')!);
    state = reduceStreamEnvelope(state, normalizeStreamEnvelope({ ...base, generationId: 'G1', generationOrdinal: 1, content: 'old', seq: 9, status: 'completed' }, 'S1')!);
    const stale = normalizeFinalAssistantCommit({ ...base, generationId: 'G1', generationOrdinal: 1, finalSeq: 9, content: 'old final' }, 'S1')!;
    const final = applyFinalAssistantCommit(state, stale);
    expect(final.result.accepted).toBe(false);
    expect(selectActiveStream(final.state, 'S1')?.content).toBe('G2');
  });

  it('E4: duplicate, late, and gap behavior survives the chain', () => {
    let state = initialStreamReducerState;
    for (const payload of [
      { ...base, seq: 3, content: 'Hel', status: 'streaming' },
      { ...base, seq: 3, content: 'Hel', status: 'streaming' },
      { ...base, seq: 2, content: 'He', status: 'streaming' },
      { ...base, seq: 9, content: 'Hello', status: 'completed' },
    ]) state = reduceStreamEnvelope(state, normalizeStreamEnvelope(payload, 'S1')!);
    expect(selectActiveStream(state, 'S1')?.content).toBe('Hello');
    expect(selectActiveStream(state, 'S1')?.latestSeq).toBe(9);
  });

  it('E5: terminal stream followed by matching final commit retires only that generation', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, normalizeStreamEnvelope({ ...base, seq: 4, content: 'provisional', status: 'completed' }, 'S1')!);
    const final = applyFinalAssistantCommit(state, normalizeFinalAssistantCommit({ ...base, finalSeq: 4, content: 'committed' }, 'S1')!);
    expect(final.result.accepted).toBe(true);
    expect(selectActiveStream(final.state, 'S1')?.finalContent).toBe('committed');
  });

  it('E6: errored/cancelled generations cannot create final presentation', () => {
    for (const status of ['errored', 'cancelled'] as const) {
      const state = reduceStreamEnvelope(initialStreamReducerState, normalizeStreamEnvelope({ ...base, seq: 1, content: 'partial', status }, 'S1')!);
      const final = applyFinalAssistantCommit(state, normalizeFinalAssistantCommit({ ...base, finalSeq: 1, content: 'partial' }, 'S1')!);
      expect(final.result.accepted).toBe(false);
      expect(selectActiveStream(final.state, 'S1')?.finalContent).toBeUndefined();
    }
  });
});
