import type { FinalAssistantCommit } from '../types';
import type { StreamGenerationState, StreamReducerState } from './streamReducer';

export interface FinalCommitResult {
  accepted: boolean;
  duplicate?: boolean;
  protocolViolation?: boolean;
  reason?: string;
}

/**
 * Apply a generation-bound final assistant commit. Stream state is retained
 * historically; only the generation's provisional presentation is retired.
 */
export function applyFinalAssistantCommit(
  state: StreamReducerState,
  commit: FinalAssistantCommit,
): { state: StreamReducerState; result: FinalCommitResult; finalContent?: string } {
  const session = state.streamsBySession[commit.sessionId];
  const generation = session?.generations[commit.generationId];
  if (!session || !generation) {
    if (session?.activeStream && commit.logicalTurn === session.activeStream.logicalTurn
      && commit.generationOrdinal < session.activeStream.generationOrdinal) {
      return { state, result: { accepted: false, reason: 'stale_generation' } };
    }
    return { state, result: { accepted: false, reason: 'unknown_generation' } };
  }
  if (generation.logicalTurn !== commit.logicalTurn || generation.generationOrdinal !== commit.generationOrdinal) {
    return { state, result: { accepted: false, reason: 'generation_identity_mismatch' } };
  }
  if (generation.status !== 'completed' || !generation.terminal || commit.finalSeq !== generation.latestSeq) {
    return { state, result: { accepted: false, reason: 'generation_not_completed_or_seq_mismatch' } };
  }

  if (session.activeStream && (
    session.activeStream.logicalTurn !== commit.logicalTurn
    || session.activeStream.generationOrdinal > commit.generationOrdinal
    || (session.activeStream.generationOrdinal === commit.generationOrdinal && session.activeStream.generationId !== commit.generationId)
  )) {
    return { state, result: { accepted: false, reason: 'stale_generation' } };
  }

  const existingFinal = (generation as StreamGenerationState & { finalSeq?: number; finalContent?: string });
  if (existingFinal.finalSeq !== undefined) {
    if (existingFinal.finalSeq === commit.finalSeq && existingFinal.finalContent === commit.content) {
      return { state, result: { accepted: true, duplicate: true }, finalContent: existingFinal.finalContent };
    }
    return { state, result: { accepted: false, protocolViolation: true, reason: 'final_commit_conflict' } };
  }

  const nextGeneration = {
    ...generation,
    finalSeq: commit.finalSeq,
    finalContent: commit.content,
    presentationRetired: true,
  } as StreamGenerationState;
  return {
    state: {
      ...state,
      streamsBySession: {
        ...state.streamsBySession,
        [commit.sessionId]: {
          ...session,
          generations: { ...session.generations, [commit.generationId]: nextGeneration },
        },
      },
    },
    result: { accepted: true },
    finalContent: commit.content,
  };
}

/** Helper used by tests/normalizers to validate a complete final commit. */
export function isValidFinalAssistantCommit(value: unknown): value is FinalAssistantCommit {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return c.streamContractVersion === 1
    && typeof c.sessionId === 'string' && c.sessionId.length > 0
    && typeof c.logicalTurn === 'string' && /^T\d+$/.test(c.logicalTurn)
    && typeof c.generationId === 'string' && c.generationId.length > 0
    && typeof c.generationOrdinal === 'number' && Number.isInteger(c.generationOrdinal) && c.generationOrdinal > 0
    && typeof c.finalSeq === 'number' && Number.isInteger(c.finalSeq) && c.finalSeq > 0
    && typeof c.content === 'string';
}
