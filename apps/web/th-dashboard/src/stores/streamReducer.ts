import type { StreamEnvelope } from '../types';

export interface StreamGenerationState {
  readonly logicalTurn: string;
  readonly generationId: string;
  readonly generationOrdinal: number;
  readonly latestSeq: number;
  readonly content: string;
  readonly status: StreamEnvelope['status'];
  readonly terminal: boolean;
  readonly finalSeq?: number;
  readonly finalContent?: string;
  readonly presentationRetired?: boolean;
}

export interface StreamSessionState {
  readonly generations: Record<string, StreamGenerationState>;
  readonly activeStream: {
    logicalTurn: string;
    generationId: string;
    generationOrdinal: number;
  } | null;
}

export interface StreamReducerState {
  readonly streamsBySession: Record<string, StreamSessionState>;
  readonly diagnostics: readonly string[];
}

export const initialStreamReducerState: StreamReducerState = {
  streamsBySession: {},
  diagnostics: [],
};

function parseLogicalTurn(value: string): number | null {
  const match = /^T(\d+)$/.exec(value);
  return match ? Number(match[1]) : null;
}

function compareTurns(a: string, b: string): number {
  const numericA = parseLogicalTurn(a);
  const numericB = parseLogicalTurn(b);
  if (numericA !== null && numericB !== null) return numericA - numericB;
  // Transport normalization rejects non-canonical logical turns. This fallback
  // is fail-closed for direct callers: unknown ordering is never treated as
  // newer or authoritative.
  return 0;
}

/**
 * Apply one already-normalized accumulated envelope.
 * The reducer never generates identity fields or appends accumulated content.
 */
export function reduceStreamEnvelope(
  state: StreamReducerState,
  envelope: StreamEnvelope,
): StreamReducerState {
  const session = state.streamsBySession[envelope.sessionId] ?? {
    generations: {},
    activeStream: null,
  };
  const existing = session.generations[envelope.generationId];
  const active = session.activeStream;

  if (active) {
    const turnOrder = compareTurns(envelope.logicalTurn, active.logicalTurn);
    if (turnOrder < 0 || (turnOrder === 0 && envelope.generationOrdinal < active.generationOrdinal)) {
      return state;
    }
    if (turnOrder === 0 && envelope.generationOrdinal === active.generationOrdinal && envelope.generationId !== active.generationId) {
      return { ...state, diagnostics: [...state.diagnostics, `protocol violation: generation ordinal collision ${envelope.generationOrdinal}`] };
    }
  }

  if (existing) {
    if (existing.terminal) return state;
    if (envelope.seq < existing.latestSeq) return state;
    if (envelope.seq === existing.latestSeq) {
      if (existing.content === envelope.content && existing.status === envelope.status) return state;
      return { ...state, diagnostics: [...state.diagnostics, `protocol violation: duplicate seq ${envelope.seq}`] };
    }
  }

  const nextGeneration: StreamGenerationState = {
    logicalTurn: envelope.logicalTurn,
    generationId: envelope.generationId,
    generationOrdinal: envelope.generationOrdinal,
    latestSeq: envelope.seq,
    content: envelope.content,
    status: envelope.status,
    terminal: envelope.status !== 'streaming',
  };
  const generations = { ...session.generations, [envelope.generationId]: nextGeneration };
  const shouldActivate = !active
    || compareTurns(envelope.logicalTurn, active.logicalTurn) > 0
    || (compareTurns(envelope.logicalTurn, active.logicalTurn) === 0 && envelope.generationOrdinal > active.generationOrdinal)
    || envelope.generationId === active.generationId;

  return {
    ...state,
    streamsBySession: {
      ...state.streamsBySession,
      [envelope.sessionId]: {
        generations,
        activeStream: shouldActivate ? {
          logicalTurn: envelope.logicalTurn,
          generationId: envelope.generationId,
          generationOrdinal: envelope.generationOrdinal,
        } : active,
      },
    },
  };
}

export function selectActiveStream(
  state: StreamReducerState,
  sessionId: string,
): StreamGenerationState | null {
  const session = state.streamsBySession[sessionId];
  if (!session?.activeStream) return null;
  return session.generations[session.activeStream.generationId] ?? null;
}
