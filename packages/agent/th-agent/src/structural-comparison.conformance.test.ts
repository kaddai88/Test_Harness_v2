/**
 * P2-E Conformance Tests C13-C14: Structural Evidence Comparison
 *
 * Verifies the three-valued comparison invariants:
 *
 * C13: Contract version compatibility
 *   C13-a: same contract + compatible scope + same hash → SAME
 *   C13-b: same contract + compatible scope + different hash → DIFFERENT
 *   C13-c: different contract + same hash → NOT_COMPARABLE (contract reason)
 *   C13-d: different contract + different hash → NOT_COMPARABLE (contract reason)
 *
 * C14: Completeness scope compatibility
 *   C14-a: same contract + incompatible scope + same hash → NOT_COMPARABLE (evidence/scope reason)
 *   C14-b: same contract + incompatible scope + different hash → NOT_COMPARABLE (evidence/scope reason)
 *   C14-c: unknown/unsupported scope relation → NOT_COMPARABLE
 *
 * Precedence test:
 *   contract incompatible AND scope incompatible → NOT_COMPARABLE (contract_incomparability)
 *
 * Key invariants:
 * - Comparison order: contract → scope → hash (comparability first, identity second)
 * - NOT_COMPARABLE reasons are typed: contract, evidence_scope
 * - completenessScope does NOT enter structural hash
 * - contract version is comparability boundary, not identity material
 */

import { describe, it, expect } from 'vitest';
import {
  compareStructuralEvidence,
  areContractsCompatible,
  areScopesCompatible,
  formatComparisonResult,
  isStructurallyEqual,
  isStructurallyDifferent,
  isIncomparable,
  getIncomparabilityReason,
  isSupportedStructuralContract,
  isSupportedCompletenessScope,
} from './structural-comparison.js';
import type { StructuralEvidence, IdentityComparison } from './identity-semantics.js';

// Helper to create test evidence
function createEvidence(
  contractVersion: string,
  completenessScope: string,
  structuralHash: string
): StructuralEvidence {
  return {
    contractVersion,
    completenessScope,
    structuralIdentity: { structuralHash },
  };
}

describe('P2-E Conformance C13-C14: Structural Evidence Comparison', () => {
  describe('C13: Contract version compatibility', () => {
    it('C13-a: same contract + compatible scope + same hash → SAME', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v1', 'complete', 'abc123');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      expect(result.result).toBe('SAME');
      expect(isStructurallyEqual(result)).toBe(true);
      expect(isStructurallyDifferent(result)).toBe(false);
      expect(isIncomparable(result)).toBe(false);
    });

    it('C13-b: same contract + compatible scope + different hash → DIFFERENT', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v1', 'complete', 'def456');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      expect(result.result).toBe('DIFFERENT');
      expect(isStructurallyEqual(result)).toBe(false);
      expect(isStructurallyDifferent(result)).toBe(true);
      expect(isIncomparable(result)).toBe(false);
    });

    it('C13-c: different contract + same hash → NOT_COMPARABLE (contract reason)', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v2', 'complete', 'abc123');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('contract');
      expect(formatComparisonResult(result)).toBe('NOT_COMPARABLE (contract)');
    });

    it('C13-d: different contract + different hash → NOT_COMPARABLE (contract reason)', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v2', 'complete', 'def456');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Even though hashes differ, contract incompatibility takes precedence
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('contract');
    });
  });

  describe('C14: Completeness scope compatibility', () => {
    it('C14-a: same contract + incompatible scope + same hash → NOT_COMPARABLE (evidence/scope reason)', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v1', 'partial:viewport', 'abc123');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Even though hashes are same, scope incompatibility makes them incomparable
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('evidence_scope');
      expect(formatComparisonResult(result)).toBe('NOT_COMPARABLE (evidence_scope)');
    });

    it('C14-b: same contract + incompatible scope + different hash → NOT_COMPARABLE (evidence/scope reason)', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v1', 'partial:viewport', 'def456');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Even though hashes differ, scope incompatibility takes precedence over hash comparison
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('evidence_scope');
    });

    it('C14-c: unknown/unsupported scope relation → NOT_COMPARABLE', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v1', 'unknown-scope', 'abc123');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Unknown scope relation is incompatible in v1 (exact equality only)
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('evidence_scope');
    });

    it('C14-d: same scope string → compatible (v1 exact equality)', () => {
      const evidenceA = createEvidence('v1', 'partial:main-content', 'abc123');
      const evidenceB = createEvidence('v1', 'partial:main-content', 'def456');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Same scope string is compatible, so comparison proceeds to hash
      expect(result.result).toBe('DIFFERENT');
      expect(isStructurallyDifferent(result)).toBe(true);
    });
  });

  describe('Precedence test: contract takes precedence over scope', () => {
    it('contract incompatible AND scope incompatible → NOT_COMPARABLE (contract)', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v2', 'partial:viewport', 'def456');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Contract incompatibility is checked first, so reason is 'contract'
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('contract');
    });
  });

  describe('Comparison order invariant: comparability first, identity second', () => {
    it('different hash + incompatible scope → NOT_COMPARABLE (not DIFFERENT)', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v1', 'partial:viewport', 'def456');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Even though hashes differ, scope incompatibility prevents comparison
      expect(result.result).not.toBe('DIFFERENT');
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(getIncomparabilityReason(result)).toBe('evidence_scope');
    });

    it('same hash + incompatible scope → NOT_COMPARABLE (not SAME)', () => {
      const evidenceA = createEvidence('v1', 'complete', 'abc123');
      const evidenceB = createEvidence('v1', 'partial:viewport', 'abc123');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Even though hashes are same, scope incompatibility prevents comparison
      expect(result.result).not.toBe('SAME');
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(getIncomparabilityReason(result)).toBe('evidence_scope');
    });
  });

  describe('I5-R1: Unknown string validation', () => {
    it('same UNKNOWN contract string + same hash → NOT_COMPARABLE (contract)', () => {
      const evidenceA = createEvidence('future-made-up-v99', 'complete', 'abc123');
      const evidenceB = createEvidence('future-made-up-v99', 'complete', 'abc123');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Even though contract strings are identical and hashes are same,
      // unknown contract version makes them incomparable
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('contract');
    });

    it('same UNKNOWN contract string + different hash → NOT_COMPARABLE (contract)', () => {
      const evidenceA = createEvidence('future-made-up-v99', 'complete', 'abc123');
      const evidenceB = createEvidence('future-made-up-v99', 'complete', 'def456');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Even though contract strings are identical, unknown contract version
      // makes them incomparable regardless of hash difference
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('contract');
    });

    it('same UNKNOWN scope string + same contract + same hash → NOT_COMPARABLE (evidence_scope)', () => {
      const evidenceA = createEvidence('v1', 'partial:whatever-unknown', 'abc123');
      const evidenceB = createEvidence('v1', 'partial:whatever-unknown', 'abc123');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Even though scope strings are identical and hashes are same,
      // unknown scope makes them incomparable
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('evidence_scope');
    });

    it('same UNKNOWN scope string + same contract + different hash → NOT_COMPARABLE (evidence_scope)', () => {
      const evidenceA = createEvidence('v1', 'partial:whatever-unknown', 'abc123');
      const evidenceB = createEvidence('v1', 'partial:whatever-unknown', 'def456');

      const result = compareStructuralEvidence(evidenceA, evidenceB);

      // Even though scope strings are identical, unknown scope makes them
      // incomparable regardless of hash difference
      expect(result.result).toBe('NOT_COMPARABLE');
      expect(isIncomparable(result)).toBe(true);
      expect(getIncomparabilityReason(result)).toBe('evidence_scope');
    });

    it('isSupportedStructuralContract validates supported contracts', () => {
      expect(isSupportedStructuralContract('v1')).toBe(true);
      expect(isSupportedStructuralContract('v2')).toBe(false);
      expect(isSupportedStructuralContract('future-made-up-v99')).toBe(false);
      expect(isSupportedStructuralContract('')).toBe(false);
    });

    it('isSupportedCompletenessScope validates supported scopes', () => {
      expect(isSupportedCompletenessScope('complete')).toBe(true);
      expect(isSupportedCompletenessScope('viewport')).toBe(true);
      expect(isSupportedCompletenessScope('main-content')).toBe(true);
      expect(isSupportedCompletenessScope('partial:main-content')).toBe(true);
      expect(isSupportedCompletenessScope('partial:viewport')).toBe(true);
      expect(isSupportedCompletenessScope('partial:whatever-unknown')).toBe(false);
      expect(isSupportedCompletenessScope('unknown-scope')).toBe(false);
      expect(isSupportedCompletenessScope('')).toBe(false);
    });
  });

  describe('Diagnostic helpers', () => {
    it('formatComparisonResult formats SAME correctly', () => {
      const result: IdentityComparison = { result: 'SAME' };
      expect(formatComparisonResult(result)).toBe('SAME');
    });

    it('formatComparisonResult formats DIFFERENT correctly', () => {
      const result: IdentityComparison = { result: 'DIFFERENT' };
      expect(formatComparisonResult(result)).toBe('DIFFERENT');
    });

    it('formatComparisonResult formats NOT_COMPARABLE with reason', () => {
      const contractResult: IdentityComparison = {
        result: 'NOT_COMPARABLE',
        reason: 'contract',
      };
      expect(formatComparisonResult(contractResult)).toBe('NOT_COMPARABLE (contract)');

      const scopeResult: IdentityComparison = {
        result: 'NOT_COMPARABLE',
        reason: 'evidence_scope',
      };
      expect(formatComparisonResult(scopeResult)).toBe('NOT_COMPARABLE (evidence_scope)');
    });

    it('getIncomparabilityReason returns null for comparable results', () => {
      const sameResult: IdentityComparison = { result: 'SAME' };
      expect(getIncomparabilityReason(sameResult)).toBeNull();

      const differentResult: IdentityComparison = { result: 'DIFFERENT' };
      expect(getIncomparabilityReason(differentResult)).toBeNull();
    });
  });

  describe('Scope and contract compatibility helpers', () => {
    it('areContractsCompatible: v1 supported contracts', () => {
      expect(areContractsCompatible('v1', 'v1')).toBe(true);
      expect(areContractsCompatible('structural-v1', 'structural-v1')).toBe(true);
      expect(areContractsCompatible('v1', 'v2')).toBe(false);
      expect(areContractsCompatible('v1', 'v1.0')).toBe(false);
      expect(areContractsCompatible('future-made-up-v99', 'future-made-up-v99')).toBe(false);
    });

    it('areScopesCompatible: v1 supported scopes', () => {
      expect(areScopesCompatible('complete', 'complete')).toBe(true);
      expect(areScopesCompatible('partial:viewport', 'partial:viewport')).toBe(true);
      expect(areScopesCompatible('complete', 'partial:viewport')).toBe(false);
      expect(areScopesCompatible('partial:main', 'partial:viewport')).toBe(false);
      expect(areScopesCompatible('partial:whatever-unknown', 'partial:whatever-unknown')).toBe(false);
    });
  });
});
