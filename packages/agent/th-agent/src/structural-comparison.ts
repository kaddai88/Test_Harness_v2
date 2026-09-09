/**
 * P2-E Structural Evidence Comparison (I5)
 *
 * Implements three-valued structural comparison with typed diagnostics.
 *
 * Core invariants:
 * - Comparison order: contract → scope → hash (comparability first, identity second)
 * - NOT_COMPARABLE reasons are typed: contract_incomparability, evidence_scope_incomparability
 * - Scope compatibility uses explicit v1 policy, not string matching
 * - completenessScope does NOT enter structural hash
 * - contract version is comparability boundary, not identity material
 *
 * Phase 1a scope:
 * - StructuralEvidence comparison logic
 * - Three-valued comparison: SAME / DIFFERENT / NOT_COMPARABLE
 * - Contract version compatibility check
 * - Completeness scope compatibility check
 * - C13-C14 conformance coverage
 *
 * NOT in scope (deferred to I7):
 * - Current observation state transitions
 * - Decision provenance validation
 * - Action alignment diagnostics
 */

import type {
  StructuralEvidence,
  IdentityComparison,
} from './identity-semantics.js';

// ─── Supportedness Predicates (v1) ──────────────────────────────────────────

/**
 * v1 supported structural contract versions
 */
const SUPPORTED_STRUCTURAL_CONTRACTS = new Set(['v1', 'structural-v1']);

/**
 * v1 supported completeness scopes (canonical scopes)
 */
const SUPPORTED_COMPLETENESS_SCOPES = new Set([
  'complete',
  'viewport',
  'main-content',
  'partial:main-content',
  'partial:viewport',
]);

/**
 * Check if a structural contract version is supported in v1
 */
export function isSupportedStructuralContract(contractVersion: string): boolean {
  return SUPPORTED_STRUCTURAL_CONTRACTS.has(contractVersion);
}

/**
 * Check if a completeness scope is supported/canonical in v1
 */
export function isSupportedCompletenessScope(scope: string): boolean {
  return SUPPORTED_COMPLETENESS_SCOPES.has(scope);
}

// ─── Scope Compatibility Policy (v1) ─────────────────────────────────────────

/**
 * Check if two completeness scopes are compatible for comparison
 *
 * v1 policy:
 * - known supported scope A == known supported scope B → compatible
 * - unknown / unsupported scope → NOT_COMPARABLE
 * - different supported scopes → NOT_COMPARABLE
 *
 * No containment/subset semantics in v1.
 */
export function areScopesCompatible(scopeA: string, scopeB: string): boolean {
  // Both must be supported AND equal
  return (
    isSupportedCompletenessScope(scopeA) &&
    isSupportedCompletenessScope(scopeB) &&
    scopeA === scopeB
  );
}

// ─── Contract Compatibility ──────────────────────────────────────────────────

/**
 * Check if two contract versions are compatible for comparison
 *
 * v1 policy:
 * - known supported contract A == known supported contract B → compatible
 * - unknown / unsupported contract → NOT_COMPARABLE
 * - different supported contracts → NOT_COMPARABLE
 *
 * No migration/equivalence mapping in v1.
 */
export function areContractsCompatible(contractA: string, contractB: string): boolean {
  // Both must be supported AND equal
  return (
    isSupportedStructuralContract(contractA) &&
    isSupportedStructuralContract(contractB) &&
    contractA === contractB
  );
}

// ─── Structural Evidence Comparison ──────────────────────────────────────────

/**
 * Compare two StructuralEvidence records using three-valued comparison
 *
 * Comparison order (comparability first, identity second):
 * 1. Contract compatibility check
 *    - incompatible → NOT_COMPARABLE (reason: contract_incomparability)
 * 2. Completeness scope compatibility check
 *    - incompatible → NOT_COMPARABLE (reason: evidence_scope_incomparability)
 * 3. Structural identity hash comparison
 *    - equal → SAME
 *    - unequal → DIFFERENT
 *
 * IMPORTANT:
 * - Different hash + incompatible scope → NOT_COMPARABLE (not DIFFERENT)
 * - Same hash + incompatible scope → NOT_COMPARABLE (not SAME)
 * - completenessScope does NOT enter the hash
 * - contract version is comparability boundary, not identity material
 */
export function compareStructuralEvidence(
  evidenceA: StructuralEvidence,
  evidenceB: StructuralEvidence
): IdentityComparison {
  // Step 1: Contract compatibility
  if (!areContractsCompatible(evidenceA.contractVersion, evidenceB.contractVersion)) {
    return {
      result: 'NOT_COMPARABLE',
      reason: 'contract',
    };
  }

  // Step 2: Completeness scope compatibility
  if (!areScopesCompatible(evidenceA.completenessScope, evidenceB.completenessScope)) {
    return {
      result: 'NOT_COMPARABLE',
      reason: 'evidence_scope',
    };
  }

  // Step 3: Structural identity hash comparison
  const hashA = evidenceA.structuralIdentity.structuralHash;
  const hashB = evidenceB.structuralIdentity.structuralHash;

  if (hashA === hashB) {
    return { result: 'SAME' };
  }

  return { result: 'DIFFERENT' };
}

// ─── Diagnostic Helpers ──────────────────────────────────────────────────────

/**
 * Format comparison result for logging/diagnostics
 */
export function formatComparisonResult(comparison: IdentityComparison): string {
  if (comparison.result === 'NOT_COMPARABLE') {
    return `NOT_COMPARABLE (${comparison.reason})`;
  }
  return comparison.result;
}

/**
 * Check if comparison result indicates structural equality
 */
export function isStructurallyEqual(comparison: IdentityComparison): boolean {
  return comparison.result === 'SAME';
}

/**
 * Check if comparison result indicates structural difference
 */
export function isStructurallyDifferent(comparison: IdentityComparison): boolean {
  return comparison.result === 'DIFFERENT';
}

/**
 * Check if comparison result indicates incomparability
 */
export function isIncomparable(comparison: IdentityComparison): boolean {
  return comparison.result === 'NOT_COMPARABLE';
}

/**
 * Get incomparability reason if applicable
 */
export function getIncomparabilityReason(
  comparison: IdentityComparison
): 'contract' | 'evidence_scope' | null {
  if (comparison.result === 'NOT_COMPARABLE') {
    return comparison.reason;
  }
  return null;
}
