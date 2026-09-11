/**
 * P4 Phase 1A — Generation and sequence producer primitives.
 *
 * AgentLoop owns all identity/order allocation. This module does not wire
 * worker, WebSocket, Dashboard, final handoff, or reconnect behavior.
 */

import {
  STREAM_CONTRACT_VERSION,
  type FinalAssistantCommit,
  type StreamEnvelope,
  type StreamGenerationStatus,
} from '@test-harness/th-protocol';

export interface LogicalTurnIdentity {
  readonly sessionId: string;
  readonly logicalTurn: string;
}

export interface StreamGenerationIdentity extends LogicalTurnIdentity {
  readonly generationId: string;
  readonly generationOrdinal: number;
}

export interface GenerationAllocatorState {
  readonly sessionId: string;
  readonly logicalTurn: string;
  readonly nextGenerationOrdinal: number;
}

export interface StreamProducerState extends StreamGenerationIdentity {
  readonly nextSeq: number;
  readonly terminal: boolean;
}

let generationNonce = 0;

function allocateGenerationId(sessionId: string, logicalTurn: string): string {
  generationNonce += 1;
  return `${sessionId}:${logicalTurn}:g${generationNonce}`;
}

/** Start a generation; retry callers retain logicalTurn and advance ordinal. */
export function startStreamGeneration(
  state: GenerationAllocatorState,
): { identity: StreamGenerationIdentity; state: GenerationAllocatorState } {
  const ordinal = state.nextGenerationOrdinal;
  const identity: StreamGenerationIdentity = {
    sessionId: state.sessionId,
    logicalTurn: state.logicalTurn,
    generationId: allocateGenerationId(state.sessionId, state.logicalTurn),
    generationOrdinal: ordinal,
  };
  return {
    identity,
    state: { ...state, nextGenerationOrdinal: ordinal + 1 },
  };
}

/** Create the first generation namespace for a new logical turn. */
export function startLogicalTurn(
  sessionId: string,
  logicalTurn: string,
): { identity: StreamGenerationIdentity; state: GenerationAllocatorState } {
  return startStreamGeneration({ sessionId, logicalTurn, nextGenerationOrdinal: 1 });
}

/** Start a retry in the same logical turn with a greater generation ordinal. */
export function retryStreamGeneration(
  state: GenerationAllocatorState,
): { identity: StreamGenerationIdentity; state: GenerationAllocatorState } {
  return startStreamGeneration(state);
}

export function createStreamProducerState(
  identity: StreamGenerationIdentity,
): StreamProducerState {
  return { ...identity, nextSeq: 1, terminal: false };
}

/**
 * Emit one accumulated stream envelope and advance the sole producer seq.
 * Terminal events also consume a sequence; no event is emitted after terminal.
 */
export function emitStreamEnvelope(
  state: StreamProducerState,
  content: string,
  status: StreamGenerationStatus,
): { envelope: StreamEnvelope; state: StreamProducerState } {
  if (state.terminal) {
    throw new Error('Cannot emit after stream generation is terminal');
  }
  const envelope: StreamEnvelope = {
    streamContractVersion: STREAM_CONTRACT_VERSION,
    sessionId: state.sessionId,
    logicalTurn: state.logicalTurn,
    generationId: state.generationId,
    generationOrdinal: state.generationOrdinal,
    seq: state.nextSeq,
    payloadMode: 'accumulated',
    content,
    status,
  };
  return {
    envelope,
    state: { ...state, nextSeq: state.nextSeq + 1, terminal: status !== 'streaming' },
  };
}

/** Final commit references the producer-owned terminal stream seq. */
export function createFinalAssistantCommit(
  identity: StreamGenerationIdentity,
  finalSeq: number,
  content: string,
): FinalAssistantCommit {
  return {
    streamContractVersion: STREAM_CONTRACT_VERSION,
    ...identity,
    finalSeq,
    content,
  };
}

/** Identify whether a candidate envelope has all required v1 fields. */
export function isCompleteStreamEnvelope(value: unknown): value is StreamEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.streamContractVersion === STREAM_CONTRACT_VERSION
    && typeof candidate.sessionId === 'string'
    && typeof candidate.logicalTurn === 'string'
    && typeof candidate.generationId === 'string'
    && typeof candidate.generationOrdinal === 'number'
    && Number.isInteger(candidate.generationOrdinal)
    && typeof candidate.seq === 'number'
    && Number.isInteger(candidate.seq)
    && candidate.seq > 0
    && candidate.payloadMode === 'accumulated'
    && typeof candidate.content === 'string'
    && ['streaming', 'completed', 'errored', 'cancelled'].includes(candidate.status as string);
}
