import type { AgentStreamChunkEventData } from '@test-harness/th-protocol';

/**
 * Map one AgentLoop stream event to the worker activity payload.
 * Producer-owned v1 fields are copied verbatim; worker creates no identity.
 */
export function mapStreamEventToActivity(
  event: AgentStreamChunkEventData,
  sessionId: string,
  timestamp: number,
): Record<string, unknown> {
  return {
    kind: 'stream',
    partial: event.partialContent,
    done: event.done,
    turn: event.turnNumber,
    streamEnvelope: event.streamEnvelope,
    sessionId,
    timestamp,
  };
}
