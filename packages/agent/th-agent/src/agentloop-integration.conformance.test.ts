/**
 * P2-E Conformance Tests R1-R12: I7-B-R1 AgentLoop Integration
 *
 * Verifies the real AgentLoop integration of P2E correctness primitives.
 *
 * R1-R2:   Request-bound provenance capture
 * R3-R4:   Pre-execution validation blocks stale actions
 * R5-R6:   Multi-tool revalidation
 * R7-R8:   Post-execution invalidation
 * R9-R10:  LEGACY vs P2E mode gating
 * R11-R12: Authoritative observation ingestion
 *
 * CRITICAL INVARIANT:
 * These tests verify the INTEGRATION, not just the primitives.
 * The integration module must correctly gate on session mode and
 * coordinate the four integration points.
 */

import { describe, it, expect } from 'vitest';
import type { WorkflowContext } from './workflow.js';
import type {
  ObservationOccurrence,
  CurrentObservationState,
  DecisionProvenance,
} from './identity-semantics.js';
import { captureRequestBoundProvenance } from './decision-provenance.js';
import { invalidateCurrent } from './current-lifecycle.js';
import {
  captureP2EDecisionProvenance,
  validateBeforeToolDispatch,
  handlePostToolExecution,
  installAuthoritativeObservation,
  isP2EActive,
} from './agentloop-integration.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createOccurrence(
  id: string,
  contentHash: string,
  contractVersion: string = 'v1'
): ObservationOccurrence {
  return {
    occurrenceId: {
      occurrenceId: id,
      timestamp: Date.now(),
    },
    outcome: 'complete',
    observationContent: {
      contractVersion,
      contentHash,
    },
    structuralEvidence: {
      contractVersion,
      completenessScope: 'complete',
      structuralIdentity: {
        structuralHash: `struct-${contentHash}`,
      },
    },
  };
}

function createWorkflow(
  mode: 'P2E' | 'LEGACY',
  decisionProvenance: DecisionProvenance,
  currentObservation: CurrentObservationState,
  occurrenceCounter: number = 0
): WorkflowContext {
  return {
    // Minimal workflow context for testing
    sessionIdentitySemantics: {
      mode,
      pinnedAt: Date.now(),
    },
    decisionProvenance,
    currentObservation,
    occurrenceCounter,
    observationContractVersion: 'v1',
    structuralContractVersion: 'v1',
  } as WorkflowContext;
}

function createToolCall(name: string, id: string = 'call-1'): { name: string; id: string; arguments: Record<string, unknown> } {
  return {
    name,
    id,
    arguments: {},
  };
}

// ─── R1-R2: Request-Bound Provenance Capture ─────────────────────────────────

describe('P2-E I7-B-R1 R1-R2: Request-Bound Provenance Capture', () => {
  describe('R1: actual model request captures provenance from current O17', () => {
    it('P2E session captures provenance from current observation', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow('P2E', null, current);

      const updated = captureP2EDecisionProvenance(workflow);

      // Decision provenance is captured from O17
      expect(updated.decisionProvenance).not.toBe('LEGACY_UNAVAILABLE');
      expect(updated.decisionProvenance).not.toBeNull();
      if (updated.decisionProvenance && updated.decisionProvenance !== 'LEGACY_UNAVAILABLE') {
        expect(updated.decisionProvenance.occurrenceId).toBe('O17');
      }
    });

    it('provenance capture is not response-time backfill', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow('P2E', null, current);

      // Capture provenance at request construction (O17 is current)
      const updated = captureP2EDecisionProvenance(workflow);

      // Later, O18 becomes current (simulating response-time change)
      const laterWorkflow = {
        ...updated,
        currentObservation: { kind: 'current' as const, occurrence: O18 },
      };

      // Decision provenance is STILL bound to O17 (not backfilled to O18)
      if (laterWorkflow.decisionProvenance && laterWorkflow.decisionProvenance !== 'LEGACY_UNAVAILABLE') {
        expect(laterWorkflow.decisionProvenance.occurrenceId).toBe('O17');
      }
    });
  });

  describe('R2: LEGACY session does not capture P2E provenance', () => {
    it('LEGACY session preserves existing behavior', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow('LEGACY', null, current);

      const updated = captureP2EDecisionProvenance(workflow);

      // LEGACY mode: decision provenance is not changed
      expect(updated.decisionProvenance).toBeNull();
    });
  });
});

// ─── R3-R4: Pre-Execution Validation ─────────────────────────────────────────

describe('P2-E I7-B-R1 R3-R4: Pre-Execution Validation', () => {
  describe('R3: O17 decision + O18 current (same content) → action blocked', () => {
    it('content SAME does not rescue stale action in real integration', () => {
      const sameHash = 'same-hash';
      const O17 = createOccurrence('O17', sameHash);
      const O18 = createOccurrence('O18', sameHash);

      // Decision bound to O17
      const provenance = captureRequestBoundProvenance(O17);
      // Current is O18 (same content, different occurrence)
      const current = { kind: 'current' as const, occurrence: O18 };
      const workflow = createWorkflow('P2E', provenance, current);

      const toolCall = createToolCall('browser_click');
      const result = validateBeforeToolDispatch(workflow, toolCall);

      // Action is blocked
      expect(result.allowed).toBe(false);
      expect(result.errorMessage).toContain('stale decision');
    });
  });

  describe('R4: O17 decision + O18 current (structural SAME) → action blocked', () => {
    it('structural SAME does not rescue stale action in real integration', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');

      // Make structural evidence identical
      O18.structuralEvidence = { ...O17.structuralEvidence };

      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O18 };
      const workflow = createWorkflow('P2E', provenance, current);

      const toolCall = createToolCall('browser_click');
      const result = validateBeforeToolDispatch(workflow, toolCall);

      // Action is blocked
      expect(result.allowed).toBe(false);
    });
  });
});

// ─── R5-R6: Multi-Tool Revalidation ──────────────────────────────────────────

describe('P2-E I7-B-R1 R5-R6: Multi-Tool Revalidation', () => {
  describe('R5: A1 changes state → A2 from same response is blocked', () => {
    it('multi-tool response revalidates before every action', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O17 };
      let workflow = createWorkflow('P2E', provenance, current);

      // A1: browser_click succeeds
      const A1 = createToolCall('browser_click', 'A1');

      // A1 passes validation
      const A1Result = validateBeforeToolDispatch(workflow, A1);
      expect(A1Result.allowed).toBe(true);

      // A1 executes and changes state → invalidate current
      workflow = handlePostToolExecution(workflow, A1, { success: true });

      // A2: same decision, same tool — but current is invalidated
      const A2 = createToolCall('browser_click', 'A2');
      const A2Result = validateBeforeToolDispatch(workflow, A2);

      // A2 is blocked
      expect(A2Result.allowed).toBe(false);
    });
  });

  describe('R6: A1 → O18 ingested → A2 still blocks (decision=P17)', () => {
    it('even with new O18, decision bound to O17 is stale', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');
      const provenance = captureRequestBoundProvenance(O17);

      // Current is O17
      let workflow = createWorkflow('P2E', provenance, { kind: 'current', occurrence: O17 });

      // A1 executes and changes state
      const A1 = createToolCall('browser_click', 'A1');
      workflow = handlePostToolExecution(workflow, A1, { success: true });

      // New authoritative observation O18 is ingested
      workflow = installAuthoritativeObservation(
        workflow,
        'browser_snapshot',
        'new snapshot text',
        'https://example.com',
        'complete'
      );

      // A2: decision is still bound to O17, current is now O18
      const A2 = createToolCall('browser_click', 'A2');
      const A2Result = validateBeforeToolDispatch(workflow, A2);

      // A2 is blocked
      expect(A2Result.allowed).toBe(false);
    });
  });
});

// ─── R7-R8: Post-Execution Invalidation ──────────────────────────────────────

describe('P2-E I7-B-R1 R7-R8: Post-Execution Invalidation', () => {
  describe('R7: tool throws after possible dispatch → current invalidated', () => {
    it('dispatch_error invalidates current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O17 };
      let workflow = createWorkflow('P2E', provenance, current);

      const toolCall = createToolCall('browser_click');
      const result = { success: false, error: 'dispatch failed after send' };

      workflow = handlePostToolExecution(workflow, toolCall, result);

      // Current is invalidated
      expect(workflow.currentObservation.kind).toBe('unavailable');
    });
  });

  describe('R8: pre-dispatch rejection → current retained', () => {
    it('definitely_not_applied preserves current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O17 };
      let workflow = createWorkflow('P2E', provenance, current);

      const toolCall = createToolCall('browser_click');
      const result = { success: false, error: 'definitely_not_applied: validation rejected before dispatch' };

      workflow = handlePostToolExecution(workflow, toolCall, result);

      // Current is preserved
      expect(workflow.currentObservation.kind).toBe('current');
      if (workflow.currentObservation.kind === 'current') {
        expect(workflow.currentObservation.occurrence.occurrenceId.occurrenceId).toBe('O17');
      }
    });
  });
});

// ─── R9-R10: LEGACY vs P2E Mode Gating ───────────────────────────────────────

describe('P2-E I7-B-R1 R9-R10: LEGACY vs P2E Mode Gating', () => {
  describe('R9: LEGACY session completely preserves old path', () => {
    it('LEGACY mode does not activate P2E validation', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O18 };
      const workflow = createWorkflow('LEGACY', provenance, current);

      const toolCall = createToolCall('browser_click');
      const result = validateBeforeToolDispatch(workflow, toolCall);

      // LEGACY mode: validation always passes
      expect(result.allowed).toBe(true);
      expect(result.diagnostic).toContain('LEGACY');
    });

    it('isP2EActive correctly identifies mode', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = { kind: 'current' as const, occurrence: O17 };

      const p2eWorkflow = createWorkflow('P2E', null, current);
      expect(isP2EActive(p2eWorkflow)).toBe(true);

      const legacyWorkflow = createWorkflow('LEGACY', null, current);
      expect(isP2EActive(legacyWorkflow)).toBe(false);
    });
  });

  describe('R10: P2E session uses new path but does not mutate mode', () => {
    it('P2E validation does not change session mode', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow('P2E', provenance, current);

      const toolCall = createToolCall('browser_click');

      // Run validation
      validateBeforeToolDispatch(workflow, toolCall);

      // Session mode is unchanged
      expect(workflow.sessionIdentitySemantics.mode).toBe('P2E');
    });
  });
});

// ─── R11-R12: Authoritative Observation Ingestion ────────────────────────────

describe('P2-E I7-B-R1 R11-R12: Authoritative Observation Ingestion', () => {
  describe('R11: incidental snapshot-like payload cannot install current', () => {
    it('non-authoritative source does not install current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O17 };
      let workflow = createWorkflow('P2E', provenance, current, 0);

      // Try to install from non-authoritative source
      workflow = installAuthoritativeObservation(
        workflow,
        'llm_message',  // Not authoritative
        'snapshot-like text',
        'https://example.com',
        'complete'
      );

      // Current is unchanged
      expect(workflow.currentObservation.kind).toBe('current');
      if (workflow.currentObservation.kind === 'current') {
        expect(workflow.currentObservation.occurrence.occurrenceId.occurrenceId).toBe('O17');
      }
      expect(workflow.occurrenceCounter).toBe(0);
    });
  });

  describe('R12: approved auto/tool-post snapshot uses I4 ingestion path', () => {
    it('browser_snapshot installs new current via I4 path', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O17 };
      let workflow = createWorkflow('P2E', provenance, current, 0);

      // Install from authoritative source
      workflow = installAuthoritativeObservation(
        workflow,
        'browser_snapshot',  // Authoritative
        'new snapshot text',
        'https://example.com',
        'complete'
      );

      // Current is updated to new occurrence
      expect(workflow.currentObservation.kind).toBe('current');
      if (workflow.currentObservation.kind === 'current') {
        // New occurrence has a different ID (from I4 ingestion)
        expect(workflow.currentObservation.occurrence.occurrenceId.occurrenceId).not.toBe('O17');
      }
      // Occurrence counter is incremented
      expect(workflow.occurrenceCounter).toBeGreaterThan(0);
    });

    it('unknown snapshot source does not install current (fail-closed)', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O17 };
      let workflow = createWorkflow('P2E', provenance, current, 0);

      workflow = installAuthoritativeObservation(
        workflow,
        'unknown_snapshot_tool',
        'snapshot text',
        'https://example.com',
        'complete'
      );

      // Current is unchanged
      expect(workflow.currentObservation.kind).toBe('current');
      if (workflow.currentObservation.kind === 'current') {
        expect(workflow.currentObservation.occurrence.occurrenceId.occurrenceId).toBe('O17');
      }
    });
  });
});
