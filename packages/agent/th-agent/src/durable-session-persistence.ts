/**
 * Durable Session Persistence Store (I8-A-R1)
 *
 * Implements SessionPersistenceStore through an owner-bound P2E metadata
 * capability. The Agent package remains persistence-provider neutral.
 *
 * PersistedSessionState is one logical value owned by the P2E partition.
 */

import type {
  SessionPersistenceStore,
} from './session-persistence.js';
import type {
  PersistedSessionState,
} from './identity-semantics.js';
export interface P2ESessionMetadataCapability {
  read(sessionId: string): Promise<{ persistedSessionState?: unknown | null } | null>;
  replace(input: {
    sessionId: string;
    fields: { persistedSessionState: PersistedSessionState };
  }): Promise<{ persistedSessionState?: unknown | null }>;
  clear(sessionId: string): Promise<void>;
}

/**
 * Durable session persistence store implementation
 *
 * Uses the injected owner capability to persist session state through the
 * currently composed authority backend.
 *
 * This ensures that session identity semantics survives worker/process
 * restarts, which is a hard requirement from Phase 0.
 */
export class DurableSessionPersistenceStore implements SessionPersistenceStore {
  readonly capabilities = {
    p2eAtomicSessionPublication: 'supported' as const,
    backendId: 'p2e-metadata-owner',
  };

  constructor(private readonly metadata: P2ESessionMetadataCapability) {}

  /**
   * Save session state to persistent storage
   *
   * Replaces the complete P2E-owned state in one authority transaction.
   */
  async save(state: PersistedSessionState): Promise<void> {
    try {
      await this.metadata.replace({
        sessionId: state.sessionId,
        fields: { persistedSessionState: state },
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'Session not found') throw error;
      throw new Error(
        `Session ${state.sessionId} not found in repository. ` +
        `Session must be created before persisting identity semantics.`
      );
    }
  }

  async publishOccurrence(state: PersistedSessionState): Promise<void> {
    await this.save(state);
  }

  /**
   * Load session state from persistent storage
   *
   * Retrieves the PersistedSessionState from the SessionRow.metadata field.
   * Returns null if the session doesn't exist or doesn't have persisted state.
   */
  async load(sessionId: string): Promise<PersistedSessionState | null> {
    const fields = await this.metadata.read(sessionId);
    const persistedState = fields?.persistedSessionState;
    return persistedState && typeof persistedState === 'object'
      ? persistedState as PersistedSessionState
      : null;
  }

  /**
   * Delete session state from persistent storage
   *
   * Clears only the P2E-owned state. The session and other owners are retained.
   */
  async delete(sessionId: string): Promise<void> {
    if (await this.metadata.read(sessionId) !== null) await this.metadata.clear(sessionId);
  }

  /**
   * Check if session exists in persistent storage
   */
  async exists(sessionId: string): Promise<boolean> {
    return await this.metadata.read(sessionId) !== null;
  }
}

/**
 * Helper function to integrate DurableSessionPersistenceStore with AgentLoop
 *
 * This function binds the Agent store to the P2E owner capability.
 */
export function createDurableSessionPersistenceStore(
  metadata: P2ESessionMetadataCapability
): DurableSessionPersistenceStore {
  return new DurableSessionPersistenceStore(metadata);
}
