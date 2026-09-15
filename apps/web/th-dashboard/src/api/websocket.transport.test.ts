import { describe, expect, it } from 'vitest';
import { normalizeStreamEnvelope } from './websocket';

describe('P4 Phase 1B: stream transport normalization', () => {
  const valid = {
    streamContractVersion: 1,
    sessionId: 'S1',
    logicalTurn: 'T17',
    generationId: 'S1:T17:g1',
    generationOrdinal: 1,
    seq: 7,
    payloadMode: 'accumulated',
    content: 'Hello',
    status: 'streaming',
  } as const;

  it('B1 preserves all v1 identity/order/payload fields exactly', () => {
    expect(normalizeStreamEnvelope(valid)).toEqual(valid);
  });

  it('B2 accepts terminal status without reinterpretation', () => {
    expect(normalizeStreamEnvelope({ ...valid, status: 'completed', seq: 8 })?.status).toBe('completed');
  });

  it('B3 preserves accumulated payload mode', () => {
    expect(normalizeStreamEnvelope(valid)?.payloadMode).toBe('accumulated');
  });

  it('B4 rejects legacy incomplete event', () => {
    expect(normalizeStreamEnvelope({ sessionId: 'S1', turn: 17, partial: 'Hello', done: true })).toBeUndefined();
  });

  it('B5 rejects missing producer-owned identity fields without generating replacements', () => {
    const { generationId, generationOrdinal, seq, ...missing } = valid;
    expect(normalizeStreamEnvelope(missing)).toBeUndefined();
    expect(normalizeStreamEnvelope({ ...valid, generationId: undefined })).toBeUndefined();
  });

  it('B6 rejects invalid payload mode and unknown contract version', () => {
    expect(normalizeStreamEnvelope({ ...valid, payloadMode: 'delta' })).toBeUndefined();
    expect(normalizeStreamEnvelope({ ...valid, streamContractVersion: 2 })).toBeUndefined();
  });

  it('B7 rejects invalid sequence, generation ordinal, and logical turn', () => {
    expect(normalizeStreamEnvelope({ ...valid, seq: 0 })).toBeUndefined();
    expect(normalizeStreamEnvelope({ ...valid, generationOrdinal: 1.5 })).toBeUndefined();
    expect(normalizeStreamEnvelope({ ...valid, logicalTurn: 'T9x' })).toBeUndefined();
    expect(normalizeStreamEnvelope({ ...valid, logicalTurn: '' })).toBeUndefined();
  });
});
