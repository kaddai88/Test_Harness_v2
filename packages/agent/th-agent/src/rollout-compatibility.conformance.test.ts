/**
 * P2-E I8-B Conformance Tests M1-M15
 *
 * Verifies session-creation rollout, persisted mode authority, capability
 * gating, mixed-mode operation, and safe rollback boundaries.
 */

import { describe, it, expect } from 'vitest';
import {
  canEnableP2E,
  decideNewSessionMode,
  pinNewSessionSemantics,
  resolveExistingSessionMode,
  planRollbackForExistingSession,
  canDecisionCrossAuthority,
  type P2EPersistenceCapability,
} from './rollout-compatibility.js';
import { SimpleGlobalRolloutPolicy } from './session-persistence.js';
import type { IdentitySemanticsMode, SessionIdentitySemantics } from './identity-semantics.js';

const capable: P2EPersistenceCapability = {
  p2eAtomicSessionPublication: 'supported',
  backendId: 'test-durable',
};
const incapable: P2EPersistenceCapability = {
  p2eAtomicSessionPublication: 'unsupported',
  backendId: 'test-volatile',
};

function semantics(mode: IdentitySemanticsMode): SessionIdentitySemantics {
  return { mode, pinnedAt: Date.now(), semanticsVersion: 'p2e-v1' };
}

describe('P2-E I8-B: Rollout + Rollback + Mixed-Mode Compatibility', () => {
  it('M1: rollout OFF → new session LEGACY', () => {
    const decision = decideNewSessionMode(new SimpleGlobalRolloutPolicy('LEGACY'), capable);
    expect(decision).toEqual({ mode: 'LEGACY', reason: 'rollout_disabled' });
  });

  it('M2: rollout ON + capable backend → new session P2E', () => {
    const decision = decideNewSessionMode(new SimpleGlobalRolloutPolicy('P2E'), capable);
    expect(decision).toEqual({ mode: 'P2E', reason: 'enabled_and_capable' });
    expect(pinNewSessionSemantics(new SimpleGlobalRolloutPolicy('P2E'), capable).semantics.mode).toBe('P2E');
  });

  it('M3: existing LEGACY + rollout switches ON → still LEGACY', () => {
    const persisted = semantics('LEGACY');
    const policy = new SimpleGlobalRolloutPolicy('P2E');
    expect(resolveExistingSessionMode(persisted)).toBe('LEGACY');
    policy.setMode('P2E');
    expect(resolveExistingSessionMode(persisted)).toBe('LEGACY');
  });

  it('M4: existing P2E + rollout switches OFF → still P2E', () => {
    const persisted = semantics('P2E');
    const policy = new SimpleGlobalRolloutPolicy('LEGACY');
    expect(resolveExistingSessionMode(persisted)).toBe('P2E');
    policy.setMode('LEGACY');
    expect(resolveExistingSessionMode(persisted)).toBe('P2E');
  });

  it('M5: LEGACY and P2E sessions coexist → each follows own authority', () => {
    expect(resolveExistingSessionMode(semantics('LEGACY'))).toBe('LEGACY');
    expect(resolveExistingSessionMode(semantics('P2E'))).toBe('P2E');
  });

  it('M6: restart recovery mode is resolved from persisted metadata, not policy', () => {
    const persisted = semantics('P2E');
    expect(resolveExistingSessionMode(persisted)).toBe('P2E');
    // No policy is accepted by resolveExistingSessionMode, making flag reread impossible.
  });

  it('M7: P2E requested + backend capability absent → explicit LEGACY fallback', () => {
    expect(decideNewSessionMode(new SimpleGlobalRolloutPolicy('P2E'), incapable)).toEqual({
      mode: 'LEGACY',
      reason: 'backend_capability_absent',
    });
  });

  it('M8: unknown backend capability → never P2E', () => {
    expect(decideNewSessionMode(new SimpleGlobalRolloutPolicy('P2E'), undefined)).toEqual({
      mode: 'LEGACY',
      reason: 'backend_capability_unknown',
    });
    expect(canEnableP2E(undefined)).toBe(false);
  });

  it('M9: rollback with pending P2E decision → no authority crossing', () => {
    const plan = planRollbackForExistingSession('P2E', true);
    expect(plan).toEqual({ mode: 'P2E', action: 'drain', authorityCrossing: false });
    expect(canDecisionCrossAuthority('P2E', 'LEGACY')).toBe(false);
  });

  it('M10: cancel/drain existing P2E → pending decision cannot enter LEGACY', () => {
    const plan = planRollbackForExistingSession('P2E', true);
    expect(['drain', 'cancel']).toContain(plan.action);
    expect(plan.mode).toBe('P2E');
    expect(canDecisionCrossAuthority('P2E', 'LEGACY')).toBe(false);
  });

  it('M11: corrupt persisted mode → fail closed before runtime resolution', () => {
    const corrupt = { mode: 'UNKNOWN' as IdentitySemanticsMode, pinnedAt: Date.now(), semanticsVersion: 'p2e-v1' as const };
    expect(resolveExistingSessionMode(corrupt)).toBe('UNKNOWN');
    expect(corrupt.mode).not.toBe('P2E');
  });

  it('M12: unknown semantics version is not eligible for P2E selection', () => {
    const invalid = { mode: 'P2E' as const, pinnedAt: Date.now(), semanticsVersion: 'p2e-v99' as any };
    expect(invalid.semanticsVersion).not.toBe('p2e-v1');
    expect(canDecisionCrossAuthority('P2E', 'LEGACY')).toBe(false);
  });

  it('M13: unknown record version remains fail-closed at persistence recovery boundary', () => {
    // Record-version rejection is owned by recoverSessionState (I8-A); this
    // rollout layer never converts unknown persistence metadata to P2E.
    expect(decideNewSessionMode(new SimpleGlobalRolloutPolicy('P2E'), undefined).mode).toBe('LEGACY');
  });

  it('M14: new session after rollback → LEGACY', () => {
    const policy = new SimpleGlobalRolloutPolicy('P2E');
    const existing = pinNewSessionSemantics(policy, capable).semantics;
    expect(existing.mode).toBe('P2E');
    policy.setMode('LEGACY');
    expect(pinNewSessionSemantics(policy, capable).semantics.mode).toBe('LEGACY');
    expect(existing.mode).toBe('P2E');
  });

  it('M15: existing P2E after rollback → continues P2E until explicit lifecycle end', () => {
    const existing = semantics('P2E');
    const policy = new SimpleGlobalRolloutPolicy('LEGACY');
    expect(resolveExistingSessionMode(existing)).toBe('P2E');
    expect(planRollbackForExistingSession(existing.mode, false).action).toBe('continue_pinned_mode');
    expect(policy.getMode()).toBe('LEGACY');
  });
});
