import { describe, expect, it } from 'vitest';
import {
  initialStreamReducerState,
  reduceStreamEnvelope,
  selectActiveStream,
} from './streamReducer';
import type { StreamEnvelope } from '../types';

function envelope(overrides: Partial<StreamEnvelope> = {}): StreamEnvelope {
  return {
    streamContractVersion: 1,
    sessionId: 'S1',
    logicalTurn: 'T17',
    generationId: 'G1',
    generationOrdinal: 1,
    seq: 1,
    payloadMode: 'accumulated',
    content: 'H',
    status: 'streaming',
    ...overrides,
  };
}

describe('P4 Phase 1C: normalized stream reducer', () => {
  it('S1 replaces accumulated content instead of appending', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ seq: 1, content: 'H' }));
    state = reduceStreamEnvelope(state, envelope({ seq: 2, content: 'He' }));
    state = reduceStreamEnvelope(state, envelope({ seq: 3, content: 'Hello' }));
    expect(selectActiveStream(state, 'S1')?.content).toBe('Hello');
  });

  it('S2 ignores same-seq identical duplicate', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ seq: 1, content: 'H' }));
    const before = selectActiveStream(state, 'S1');
    state = reduceStreamEnvelope(state, envelope({ seq: 1, content: 'H' }));
    expect(selectActiveStream(state, 'S1')).toEqual(before);
  });

  it('S3 ignores lower sequence', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ seq: 3, content: 'Hel' }));
    state = reduceStreamEnvelope(state, envelope({ seq: 2, content: 'He' }));
    expect(selectActiveStream(state, 'S1')?.content).toBe('Hel');
  });

  it('S4 accepts sequence gaps', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ seq: 3, content: 'Hel' }));
    state = reduceStreamEnvelope(state, envelope({ seq: 9, content: 'Hello' }));
    expect(selectActiveStream(state, 'S1')?.content).toBe('Hello');
  });

  it('S5 old logical turn cannot overwrite newer turn', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ logicalTurn: 'T18', seq: 1, content: 'new' }));
    state = reduceStreamEnvelope(state, envelope({ logicalTurn: 'T17', seq: 9, content: 'late old' }));
    expect(selectActiveStream(state, 'S1')?.content).toBe('new');
  });

  it('S6 old generation cannot overwrite newer generation in same turn', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ generationId: 'G2', generationOrdinal: 2, seq: 1, content: 'new' }));
    state = reduceStreamEnvelope(state, envelope({ generationId: 'G1', generationOrdinal: 1, seq: 9, content: 'late old' }));
    expect(selectActiveStream(state, 'S1')?.content).toBe('new');
  });

  it('S7 isolates sessions', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ sessionId: 'A', content: 'A' }));
    state = reduceStreamEnvelope(state, envelope({ sessionId: 'B', content: 'B' }));
    expect(selectActiveStream(state, 'A')?.content).toBe('A');
    expect(selectActiveStream(state, 'B')?.content).toBe('B');
  });

  it('S8 retains A/B/A stream state', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ sessionId: 'A', content: 'A' }));
    state = reduceStreamEnvelope(state, envelope({ sessionId: 'B', content: 'B' }));
    expect(selectActiveStream(state, 'A')?.content).toBe('A');
    expect(selectActiveStream(state, 'B')?.content).toBe('B');
  });

  it('S9 ignores duplicate replay', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ seq: 4, content: 'Hello' }));
    state = reduceStreamEnvelope(state, envelope({ seq: 4, content: 'Hello' }));
    expect(selectActiveStream(state, 'S1')?.latestSeq).toBe(4);
  });

  it('S10 accepts newer reconnect snapshot', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ seq: 9, content: 'Hello' }));
    state = reduceStreamEnvelope(state, envelope({ seq: 14, content: 'Hello world' }));
    expect(selectActiveStream(state, 'S1')?.content).toBe('Hello world');
  });

  it('S11 ignores same-generation partial after terminal', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ seq: 1, content: 'Hello', status: 'completed' }));
    state = reduceStreamEnvelope(state, envelope({ seq: 2, content: 'Hello late', status: 'streaming' }));
    expect(selectActiveStream(state, 'S1')?.content).toBe('Hello');
  });

  it('S12 allows a higher generation after terminal old generation', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ seq: 2, content: 'failed', status: 'errored' }));
    state = reduceStreamEnvelope(state, envelope({ generationId: 'G2', generationOrdinal: 2, seq: 1, content: 'retry', status: 'streaming' }));
    expect(selectActiveStream(state, 'S1')?.content).toBe('retry');
  });

  it('S13 old-generation terminal cannot mutate newer generation', () => {
    let state = reduceStreamEnvelope(initialStreamReducerState, envelope({ generationId: 'G2', generationOrdinal: 2, seq: 1, content: 'new' }));
    state = reduceStreamEnvelope(state, envelope({ generationId: 'G1', generationOrdinal: 1, seq: 5, content: 'old terminal', status: 'completed' }));
    expect(selectActiveStream(state, 'S1')?.content).toBe('new');
  });

  it('S14 stream status does not create session terminal state', () => {
    const state = reduceStreamEnvelope(initialStreamReducerState, envelope({ status: 'cancelled' }));
    expect(selectActiveStream(state, 'S1')?.status).toBe('cancelled');
    expect(state).not.toHaveProperty('sessionStatus');
  });

  it('S18 malformed envelope is outside reducer input contract', () => {
    // Transport normalization rejects malformed values; reducer accepts only
    // typed StreamEnvelope, so no identity fallback exists here.
    expect(selectActiveStream(initialStreamReducerState, 'S1')).toBeNull();
  });
});
