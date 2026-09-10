/**
 * P2-E I8-B Rollout, Rollback, and Mixed-Mode Compatibility
 *
 * Owns the session-creation rollout decision and safe rollback boundaries.
 * It does not mutate an existing session's pinned mode and does not perform
 * I9 legacy cleanup.
 *
 * Core invariants:
 * - Global rollout policy is consulted only for NEW session creation.
 * - Existing sessions retain their persisted mode regardless of flag changes.
 * - P2E requires an explicitly capable persistence backend.
 * - Unknown/absent backend capability never enables P2E.
 * - Rollback affects new sessions only; existing P2E sessions drain/cancel/replan
 *   at an explicit lifecycle boundary and never cross correctness authorities.
 */

import type {
  IdentitySemanticsMode,
  SessionIdentitySemantics,
} from './identity-semantics.js';
import type {
  GlobalRolloutPolicy,
} from './session-persistence.js';

// ─── Backend Capability ──────────────────────────────────────────────────────

/**
 * Persistence capability required before P2E can be selected for a new session.
 * The descriptor must come from the instantiated backend, not rollout config.
 */
export type P2EDurabilityCapability = 'supported' | 'unsupported' | 'unknown';

export interface P2EPersistenceCapability {
  /** Physical/logical capability status advertised by the actual backend */
  readonly p2eAtomicSessionPublication: P2EDurabilityCapability;
  /** Optional backend identifier for diagnostics */
  readonly backendId?: string;
}

export function canEnableP2E(
  capability: P2EPersistenceCapability | undefined
): boolean {
  return capability?.p2eAtomicSessionPublication === 'supported';
}

// ─── Rollout Decision ────────────────────────────────────────────────────────

export type P2ERolloutDecision =
  | { mode: 'P2E'; reason: 'enabled_and_capable' }
  | {
      mode: 'LEGACY';
      reason: 'rollout_disabled' | 'backend_capability_absent' | 'backend_capability_unknown';
    };

/**
 * Select the mode for a NEW session.
 *
 * The global policy is read by this function exactly once per new session.
 * Existing session recovery must bypass this function and use persisted mode.
 *
 * Conservative v1 behavior: an explicitly requested P2E rollout with a backend
 * that is false/unknown falls back to LEGACY with a typed reason. This is a
 * visible policy decision, not a silent assumption of safety.
 */
export function decideNewSessionMode(
  policy: GlobalRolloutPolicy,
  capability: P2EPersistenceCapability | undefined
): P2ERolloutDecision {
  const requestedMode = policy.getMode();

  if (requestedMode !== 'P2E') {
    return { mode: 'LEGACY', reason: 'rollout_disabled' };
  }

  if (capability === undefined || capability.p2eAtomicSessionPublication === 'unknown') {
    return { mode: 'LEGACY', reason: 'backend_capability_unknown' };
  }

  if (capability.p2eAtomicSessionPublication === 'unsupported') {
    return { mode: 'LEGACY', reason: 'backend_capability_absent' };
  }

  return { mode: 'P2E', reason: 'enabled_and_capable' };
}

/**
 * Pin new-session semantics from the rollout decision.
 */
export function pinNewSessionSemantics(
  policy: GlobalRolloutPolicy,
  capability: P2EPersistenceCapability | undefined
): { semantics: SessionIdentitySemantics; decision: P2ERolloutDecision } {
  const decision = decideNewSessionMode(policy, capability);
  const semantics: SessionIdentitySemantics = {
    mode: decision.mode,
    pinnedAt: Date.now(),
    semanticsVersion: 'p2e-v1',
  };

  return { semantics, decision };
}

// ─── Existing Session Authority ──────────────────────────────────────────────

/**
 * Resolve runtime mode for an existing session.
 *
 * Persisted mode is authoritative. The global policy is intentionally not an
 * argument, making accidental flag-based reinterpretation impossible here.
 */
export function resolveExistingSessionMode(
  persisted: SessionIdentitySemantics
): IdentitySemanticsMode {
  return persisted.mode;
}

// ─── Rollback Boundary ───────────────────────────────────────────────────────

export type RollbackSessionAction =
  | 'continue_pinned_mode'
  | 'drain'
  | 'cancel'
  | 'replan_at_fresh_request';

/**
 * Describe safe rollback handling for an existing session.
 *
 * Rollback never mutates the existing mode. A P2E session remains P2E until an
 * explicit lifecycle end; it cannot hand a pending P2E decision to LEGACY.
 */
export function planRollbackForExistingSession(
  mode: IdentitySemanticsMode,
  hasPendingDecision: boolean
): {
  mode: IdentitySemanticsMode;
  action: RollbackSessionAction;
  authorityCrossing: false;
} {
  if (mode === 'LEGACY') {
    return { mode, action: 'continue_pinned_mode', authorityCrossing: false };
  }

  if (hasPendingDecision) {
    return { mode, action: 'drain', authorityCrossing: false };
  }

  return { mode, action: 'continue_pinned_mode', authorityCrossing: false };
}

/**
 * Verify that a pending decision cannot cross from its pinned authority into
 * another session mode during rollback.
 */
export function canDecisionCrossAuthority(
  decisionMode: IdentitySemanticsMode,
  sessionMode: IdentitySemanticsMode
): boolean {
  return decisionMode === sessionMode;
}
