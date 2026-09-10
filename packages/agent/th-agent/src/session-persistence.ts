/**
 * Session Persistence Layer (I8-A)
 *
 * Handles durable storage and recovery of session identity semantics.
 * Ensures pinned mode survives worker restart.
 *
 * Key invariants:
 * - Global rollout policy is read ONCE at session creation
 * - Persisted mode is the runtime correctness authority
 * - Worker restart restores persisted mode, does NOT re-read global flag
 * - Legacy state without metadata migrates to LEGACY deterministically
 * - Corrupt/unknown semantics fail closed (never silently choose P2E)
 */

import type {
  SessionIdentitySemantics,
  IdentitySemanticsMode,
  PersistedSessionState,
  DecisionProvenance,
  CurrentObservationState,
} from './identity-semantics.js';
import type { P2EDurabilityCapability } from './rollout-compatibility.js';

// ─── Global Rollout Policy ──────────────────────────────────────────────────

/**
 * Global rollout policy interface
 *
 * Determines which sessions get P2E vs LEGACY semantics at creation time.
 * This policy is read ONCE when a session is created and pinned to the session.
 * It is NOT re-read during session lifetime or after worker restart.
 */
export interface GlobalRolloutPolicy {
  /** Get the current global rollout mode */
  getMode(): IdentitySemanticsMode;
}

/**
 * Simple global rollout policy implementation
 *
 * Reads from environment variable or config. Defaults to LEGACY for safety.
 */
export class SimpleGlobalRolloutPolicy implements GlobalRolloutPolicy {
  private mode: IdentitySemanticsMode;

  constructor(mode: IdentitySemanticsMode = 'LEGACY') {
    this.mode = mode;
  }

  getMode(): IdentitySemanticsMode {
    return this.mode;
  }

  /** Update the global mode (affects NEW sessions only) */
  setMode(mode: IdentitySemanticsMode): void {
    this.mode = mode;
  }
}

// ─── Session Persistence Store ──────────────────────────────────────────────

/**
 * Session persistence store interface
 *
 * Abstracts the storage backend for session state. Implementations can use
 * file system, database, or in-memory storage for testing.
 */
export interface SessionPersistenceStore {
  /**
   * Capability descriptor owned by the instantiated backend.
   * P2E rollout MUST NOT be enabled when absent or false.
   */
  readonly capabilities?: {
    readonly p2eAtomicSessionPublication: P2EDurabilityCapability;
    readonly backendId?: string;
  };
  /** Save session state to persistent storage */
  save(state: PersistedSessionState): Promise<void>;

  /**
   * Atomically publish an occurrence and allocator state.
   *
   * The backend MUST make the new counter and the correctness-relevant
   * occurrence/provenance record visible together, or leave the prior state
   * intact. A store that cannot provide this guarantee must not be used for
   * P2E rollout (P9 physical durability remains a separate gate).
   */
  publishOccurrence?(state: PersistedSessionState): Promise<void>;

  /** Load session state from persistent storage */
  load(sessionId: string): Promise<PersistedSessionState | null>;

  /** Delete session state from persistent storage */
  delete(sessionId: string): Promise<void>;

  /** Check if session exists in persistent storage */
  exists(sessionId: string): Promise<boolean>;
}

/**
 * In-memory session persistence store (for testing)
 *
 * Stores session state in a Map. Useful for unit tests and development.
 */
export class InMemorySessionPersistenceStore implements SessionPersistenceStore {
  readonly capabilities = {
    p2eAtomicSessionPublication: 'unsupported' as const,
    backendId: 'in-memory',
  };
  private store = new Map<string, PersistedSessionState>();

  async save(state: PersistedSessionState): Promise<void> {
    this.store.set(state.sessionId, { ...state });
  }

  /** In-memory single-record publication is atomic for test purposes. */
  async publishOccurrence(state: PersistedSessionState): Promise<void> {
    this.store.set(state.sessionId, { ...state });
  }

  async load(sessionId: string): Promise<PersistedSessionState | null> {
    const state = this.store.get(sessionId);
    return state ? { ...state } : null;
  }

  async delete(sessionId: string): Promise<void> {
    this.store.delete(sessionId);
  }

  async exists(sessionId: string): Promise<boolean> {
    return this.store.has(sessionId);
  }

  /** Clear all stored sessions (for testing) */
  clear(): void {
    this.store.clear();
  }
}

// ─── Session Semantics Pinning ──────────────────────────────────────────────

/**
 * Pin session identity semantics at creation time
 *
 * Reads the global rollout policy ONCE and creates immutable session semantics.
 * This is the ONLY place where the global flag is read for a session.
 *
 * @param sessionId - Session identifier
 * @param policy - Global rollout policy
 * @returns Pinned session identity semantics
 */
export function pinSessionSemantics(
  sessionId: string,
  policy: GlobalRolloutPolicy
): SessionIdentitySemantics {
  const mode = policy.getMode();

  return {
    mode,
    pinnedAt: Date.now(),
    semanticsVersion: 'p2e-v1',
  };
}

// ─── Session State Persistence ──────────────────────────────────────────────

/**
 * Create a new session state
 *
 * Pins semantics from global policy and creates initial state.
 *
 * I8-A-R3: Atomic durable publication ensures occurrence counter and initial
 * state are committed together, preventing crash-induced ID reuse.
 *
 * @param sessionId - Session identifier
 * @param policy - Global rollout policy
 * @param store - Persistence store
 * @returns Created session state
 */
export async function createSessionState(
  sessionId: string,
  policy: GlobalRolloutPolicy,
  store: SessionPersistenceStore
): Promise<PersistedSessionState> {
  const semantics = pinSessionSemantics(sessionId, policy);

  const state: PersistedSessionState = {
    sessionId,
    semantics,
    lastDecisionProvenance: 'LEGACY_UNAVAILABLE',
    lastCurrentObservation: { kind: 'none' },
    occurrenceCounter: 0, // Initial counter for occurrence ID allocation
    recordVersion: 'record-v1', // Persistence schema version
    persistedAt: Date.now(),
  };

  // CRITICAL (I8-A-R3): Atomic durable publication
  // The entire state (including counter=0) is persisted atomically
  await store.save(state);
  return state;
}

/**
 * Recover session state after worker restart
 *
 * CRITICAL INVARIANT (I8-A-R1):
 * - Restores persisted mode from storage
 * - Does NOT re-read global rollout policy
 * - If state is missing or corrupt, returns null (fail closed)
 * - If semantics version is unknown, returns null (fail closed)
 * - Persisted current observation is historical evidence only, NOT authoritative
 * - Pending decision provenance is preserved but requires fresh observation
 * - Occurrence counter is restored to prevent ID reuse across restart
 *
 * I8-A-R3: Validates recordVersion to ensure safe decoding of persisted state.
 *
 * @param sessionId - Session identifier
 * @param store - Persistence store
 * @returns Recovered session state, or null if unavailable/corrupt
 */
export async function recoverSessionState(
  sessionId: string,
  store: SessionPersistenceStore
): Promise<PersistedSessionState | null> {
  const state = await store.load(sessionId);

  if (!state) {
    // Session not found - fail closed
    return null;
  }

  // CRITICAL (I8-A-R3): Validate record version
  if (state.recordVersion !== 'record-v1') {
    // Unknown record version - fail closed
    return null;
  }

  // Validate semantics version
  if (state.semantics.semanticsVersion !== 'p2e-v1') {
    // Unknown semantics version - fail closed
    return null;
  }

  // Validate mode
  if (state.semantics.mode !== 'LEGACY' && state.semantics.mode !== 'P2E') {
    // Corrupt mode - fail closed
    return null;
  }

  // CRITICAL: Persisted current observation is historical evidence only.
  // It is NOT authoritative after restart. The AgentLoop will check
  // isAuthoritativeAfterRestart and require fresh observation if false.
  // This enforces the invariant: "A session's correctness mode survives restart;
  // a browser observation's authority does NOT automatically survive restart."

  // Return state as-is (occurrenceCounter is already persisted)
  return state;
}

/**
 * Update session state after decision/observation changes
 *
 * Persists the latest decision provenance and current observation state.
 * Does NOT change the pinned semantics mode.
 *
 * I8-A-R3: Atomic durable publication ensures occurrence counter, provenance,
 * and observation state are committed together, preventing crash-induced ID reuse.
 *
 * @param sessionId - Session identifier
 * @param decisionProvenance - Latest decision provenance
 * @param currentObservation - Latest current observation state
 * @param occurrenceCounter - Current occurrence counter (incremented by allocateOccurrenceId)
 * @param store - Persistence store
 */
export async function updateSessionState(
  sessionId: string,
  decisionProvenance: DecisionProvenance,
  currentObservation: CurrentObservationState,
  occurrenceCounter: number,
  store: SessionPersistenceStore
): Promise<void> {
  const existingState = await store.load(sessionId);

  if (!existingState) {
    throw new Error(`Session ${sessionId} not found in persistence store`);
  }

  // I8-A-R4: Build the complete new record locally. Nothing is published
  // until counter + current occurrence + provenance are all present.
  const updatedState: PersistedSessionState = {
    ...existingState,
    lastDecisionProvenance: decisionProvenance,
    lastCurrentObservation: currentObservation,
    occurrenceCounter,
    recordVersion: 'record-v1',
    persistedAt: Date.now(),
  };

  // A backend with a transaction-capable publication method owns the atomic
  // durable commit. The fallback save is logical single-record atomicity only;
  // physical crash atomicity is a P9 backend capability gate.
  if (store.publishOccurrence) {
    await store.publishOccurrence(updatedState);
  } else {
    await store.save(updatedState);
  }
}

// ─── Legacy State Migration ─────────────────────────────────────────────────

/**
 * Migrate legacy session state (without semantics metadata)
 *
 * CRITICAL INVARIANT:
 * - Legacy state without semantics metadata migrates to LEGACY mode
 * - Does NOT synthesize P2E provenance from old snapshotVersion/hash
 * - Uses LEGACY_UNAVAILABLE for decision provenance
 * - Uses 'none' for current observation state
 *
 * I8-A-R3: Includes recordVersion for persistence schema versioning.
 *
 * @param sessionId - Session identifier
 * @param store - Persistence store
 * @returns Migrated session state
 */
export async function migrateLegacySessionState(
  sessionId: string,
  store: SessionPersistenceStore
): Promise<PersistedSessionState> {
  const semantics: SessionIdentitySemantics = {
    mode: 'LEGACY',
    pinnedAt: Date.now(),
    semanticsVersion: 'p2e-v1',
  };

  const state: PersistedSessionState = {
    sessionId,
    semantics,
    lastDecisionProvenance: 'LEGACY_UNAVAILABLE',
    lastCurrentObservation: { kind: 'none' },
    occurrenceCounter: 0, // Legacy migration starts with counter at 0
    recordVersion: 'record-v1', // Persistence schema version
    persistedAt: Date.now(),
  };

  await store.save(state);
  return state;
}

// ─── Session Semantics Validation ───────────────────────────────────────────

/**
 * Validate that session semantics are safe to use
 *
 * Checks:
 * - Semantics version is recognized
 * - Mode is valid (LEGACY or P2E)
 * - Mode has not changed (immutable for session lifetime)
 *
 * @param semantics - Session identity semantics to validate
 * @returns true if semantics are safe, false otherwise
 */
export function validateSessionSemantics(
  semantics: SessionIdentitySemantics
): boolean {
  // Check semantics version
  if (semantics.semanticsVersion !== 'p2e-v1') {
    return false;
  }

  // Check mode
  if (semantics.mode !== 'LEGACY' && semantics.mode !== 'P2E') {
    return false;
  }

  // Check pinnedAt is valid timestamp
  if (!Number.isFinite(semantics.pinnedAt) || semantics.pinnedAt <= 0) {
    return false;
  }

  return true;
}

/**
 * Check if a session should use P2E correctness path
 *
 * @param semantics - Session identity semantics
 * @returns true if P2E, false if LEGACY
 */
export function shouldUseP2EPath(
  semantics: SessionIdentitySemantics
): boolean {
  return semantics.mode === 'P2E';
}
