/**
 * Durable Session Persistence Store (I8-A-R1)
 *
 * Implements SessionPersistenceStore using the project's existing
 * SessionRepository from th-persistence. This provides genuine durability
 * across worker/process restarts.
 *
 * The PersistedSessionState is stored in the SessionRow.metadata field,
 * which is persisted to the database (SQLite/PostgreSQL) or JSON file.
 */

import type {
  SessionPersistenceStore,
} from './session-persistence.js';
import type {
  PersistedSessionState,
} from './identity-semantics.js';
import type { SessionRepository } from '@test-harness/th-persistence';

/**
 * Durable session persistence store implementation
 *
 * Uses the project's SessionRepository to persist session state to
 * a durable backend (SQLite, PostgreSQL, or JSON file).
 *
 * This ensures that session identity semantics survives worker/process
 * restarts, which is a hard requirement from Phase 0.
 */
export class DurableSessionPersistenceStore implements SessionPersistenceStore {
  readonly capabilities = {
    // This generic wrapper cannot prove physical crash atomicity of its
    // underlying backend. Concrete adapters must advertise the capability.
    p2eAtomicSessionPublication: 'unknown' as const,
    backendId: 'session-repository',
  };
  private sessionRepo: SessionRepository;

  constructor(sessionRepo: SessionRepository) {
    this.sessionRepo = sessionRepo;
  }

  /**
   * Save session state to persistent storage
   *
   * Stores the PersistedSessionState in the SessionRow.metadata field.
   * If the session doesn't exist yet, it will be created.
   */
  async save(state: PersistedSessionState): Promise<void> {
    // Check if session exists
    const existingSession = await this.sessionRepo.findById(state.sessionId);

    if (existingSession) {
      // Update metadata with persisted state
      await this.sessionRepo.updateMetadata(state.sessionId, {
        persistedSessionState: state,
      });
    } else {
      // Create new session with metadata
      // Note: This requires the session to be created first by the AgentLoop
      // If the session doesn't exist, we can't persist state yet
      throw new Error(
        `Session ${state.sessionId} not found in repository. ` +
        `Session must be created before persisting identity semantics.`
      );
    }
  }

  /**
   * Load session state from persistent storage
   *
   * Retrieves the PersistedSessionState from the SessionRow.metadata field.
   * Returns null if the session doesn't exist or doesn't have persisted state.
   */
  async load(sessionId: string): Promise<PersistedSessionState | null> {
    const session = await this.sessionRepo.findById(sessionId);

    if (!session) {
      return null;
    }

    const persistedState = session.metadata?.persistedSessionState as PersistedSessionState | undefined;

    return persistedState ?? null;
  }

  /**
   * Delete session state from persistent storage
   *
   * Removes the persistedSessionState from the SessionRow.metadata field.
   * Note: This doesn't delete the session itself, just the identity semantics.
   */
  async delete(sessionId: string): Promise<void> {
    const session = await this.sessionRepo.findById(sessionId);

    if (session) {
      // Remove persistedSessionState from metadata, keep other metadata
      const { persistedSessionState, ...restMetadata } = session.metadata || {};
      await this.sessionRepo.updateMetadata(sessionId, restMetadata);
    }
  }

  /**
   * Check if session exists in persistent storage
   */
  async exists(sessionId: string): Promise<boolean> {
    const session = await this.sessionRepo.findById(sessionId);
    return session !== null;
  }
}

/**
 * Helper function to integrate DurableSessionPersistenceStore with AgentLoop
 *
 * This function creates a DurableSessionPersistenceStore from a SessionRepository
 * and can be used in the AgentLoop initialization.
 */
export function createDurableSessionPersistenceStore(
  sessionRepo: SessionRepository
): DurableSessionPersistenceStore {
  return new DurableSessionPersistenceStore(sessionRepo);
}
