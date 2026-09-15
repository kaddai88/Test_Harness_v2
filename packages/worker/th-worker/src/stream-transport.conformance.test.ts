import { describe, expect, it } from 'vitest';
import type { AgentStreamChunkEventData, StreamEnvelope } from '@test-harness/th-protocol';
import { mapStreamEventToActivity } from './stream-transport.js';

function normalizeStreamEnvelope(value: unknown, outerSessionId?: string): StreamEnvelope | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.streamContractVersion !== 1
    || typeof candidate.sessionId !== 'string'
    || (outerSessionId !== undefined && candidate.sessionId !== outerSessionId)
    || typeof candidate.logicalTurn !== 'string'
    || typeof candidate.generationId !== 'string'
    || typeof candidate.generationOrdinal !== 'number'
    || !Number.isInteger(candidate.generationOrdinal)
    || typeof candidate.seq !== 'number'
    || !Number.isInteger(candidate.seq)
    || candidate.seq <= 0
    || candidate.payloadMode !== 'accumulated'
    || typeof candidate.content !== 'string'
    || !['streaming', 'completed', 'errored', 'cancelled'].includes(candidate.status as string)) return undefined;
  return candidate as unknown as StreamEnvelope;
}

describe('P4 Phase 1B-R1: worker → WebSocket → client transport', () => {
  const envelope = {
    streamContractVersion: 1 as const,
    sessionId: 'S1',
    logicalTurn: 'T17',
    generationId: 'S1:T17:g2',
    generationOrdinal: 2,
    seq: 7,
    payloadMode: 'accumulated' as const,
    content: 'Hello',
    status: 'streaming' as const,
  };

  it('round-trip preserves producer-owned envelope fields exactly', () => {
    const event: AgentStreamChunkEventData = {
      sessionId: 'S1', turnNumber: 17, partialContent: 'Hello', toolCallCount: 0, done: false,
      streamEnvelope: envelope,
    };
    const activity = mapStreamEventToActivity(event, 'S1', 123);
    const serialized = JSON.parse(JSON.stringify(activity)) as Record<string, unknown>;
    const normalized = normalizeStreamEnvelope(serialized.streamEnvelope, serialized.sessionId as string);
    expect(normalized).toEqual(envelope);
  });

  it('outer/envelope sessionId mismatch rejects v1 envelope', () => {
    const event = mapStreamEventToActivity({
      sessionId: 'S1', turnNumber: 17, partialContent: 'Hello', toolCallCount: 0, done: false,
      streamEnvelope: envelope,
    }, 'S2', 123);
    const serialized = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
    expect(normalizeStreamEnvelope(serialized.streamEnvelope, serialized.sessionId as string)).toBeUndefined();
  });

  it('worker mapping never regenerates missing producer fields', () => {
    const activity = mapStreamEventToActivity({
      sessionId: 'S1', turnNumber: 17, partialContent: 'legacy', toolCallCount: 0, done: false,
    }, 'S1', 123);
    expect(activity.streamEnvelope).toBeUndefined();
    expect(normalizeStreamEnvelope(activity.streamEnvelope, 'S1')).toBeUndefined();
  });
});
