/**
 * P2-E Conformance Tests B1-B13: I7-B Execution Boundary Integration
 *
 * Verifies the integration between P2E correctness primitives and the
 * real AgentLoop execution path.
 *
 * B1-B4:  Pre-execution validation (alignment check)
 * B5-B6:  Post-execution invalidation + revalidation
 * B7-B8:  LEGACY_UNAVAILABLE and no-current blocks
 * B9:     Fail-closed for unknown actions
 * B10-B11: Authoritative observation source gating
 * B12-B13: Result status classification
 *
 * CRITICAL INVARIANT:
 * Structural SAME does NOT rescue stale actions (B4).
 * This is the key invariant that all of P2-E was designed to protect.
 *
 * NOTE: These are unit tests for the execution-boundary primitives.
 * Integration with the real loop.ts is verified separately.
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
  isObservationDependentAction,
  validateBeforeAction,
  handleAfterAction,
  classifyActionResultStatus,
  isAuthoritativeObservationSource,
  formatI7BAlignDiagnostic,
} from './execution-boundary.js';

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
  decisionProvenance: DecisionProvenance,
  currentObservation: CurrentObservationState
): Partial<WorkflowContext> {
  return {
    decisionProvenance,
    currentObservation,
  };
}

function createToolCall(name: string, id: string = 'call-1'): { name: string; id: string; arguments: Record<string, unknown> } {
  return {
    name,
    id,
    arguments: {},
  };
}

// ─── B1-B4: Pre-Execution Validation ────────────────────────────────────────

describe('P2-E I7-B B1-B4: Pre-Execution Validation', () => {
  describe('B1: O17 decision + current O17 → action executes', () => {
    it('aligned decision and current allows action execution', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow(provenance, current);
      const toolCall = createToolCall('browser_click');

      const result = validateBeforeAction(workflow as WorkflowContext, toolCall);

      expect(result.allowed).toBe(true);
      expect(result.alignment.aligned).toBe(true);
    });
  });

  describe('B2: O17 decision + current O18 → action blocked before dispatch', () => {
    it('occurrence mismatch blocks action execution', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O18 };
      const workflow = createWorkflow(provenance, current);
      const toolCall = createToolCall('browser_click');

      const result = validateBeforeAction(workflow as WorkflowContext, toolCall);

      expect(result.allowed).toBe(false);
      expect(result.alignment.aligned).toBe(false);
      if (!result.alignment.aligned) {
        expect(result.alignment.reason).toBe('occurrence_mismatch');
        expect(result.blockReason).toContain('stale decision');
      }
    });
  });

  describe('B3: O17/O18 same content → still blocked (CRITICAL INVARIANT)', () => {
    it('content SAME does NOT rescue stale action', () => {
      const sameHash = 'same-hash';
      const O17 = createOccurrence('O17', sameHash);
      const O18 = createOccurrence('O18', sameHash);
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O18 };
      const workflow = createWorkflow(provenance, current);
      const toolCall = createToolCall('browser_click');

      const result = validateBeforeAction(workflow as WorkflowContext, toolCall);

      // CRITICAL: Even though content is identical, occurrence differs → blocked
      expect(result.allowed).toBe(false);
      if (!result.alignment.aligned) {
        expect(result.alignment.reason).toBe('occurrence_mismatch');
      }
    });
  });

  describe('B4: O17/O18 structural SAME → still blocked (CRITICAL INVARIANT)', () => {
    it('structural SAME does NOT rescue stale action', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');

      // Make structural evidence identical
      O18.structuralEvidence = { ...O17.structuralEvidence };

      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O18 };
      const workflow = createWorkflow(provenance, current);
      const toolCall = createToolCall('browser_click');

      const result = validateBeforeAction(workflow as WorkflowContext, toolCall);

      // CRITICAL: Even though structural is identical, occurrence differs → blocked
      expect(result.allowed).toBe(false);
      if (!result.alignment.aligned) {
        expect(result.alignment.reason).toBe('occurrence_mismatch');
      }
    });
  });
});

// ─── B5-B6: Post-Execution Invalidation ──────────────────────────────────────

describe('P2-E I7-B B5-B6: Post-Execution Invalidation + Revalidation', () => {
  describe('B5: A1 changes state → invalidates current → A2 revalidates and blocks', () => {
    it('state-changing action invalidates current, blocking subsequent actions', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'current' as const, occurrence: O17 };
      let workflow = createWorkflow(provenance, current) as WorkflowContext;

      // A1: browser_click succeeds
      const A1 = createToolCall('browser_click', 'A1');
      const A1Result = { success: true };

      // A1 passes pre-validation
      const A1Validation = validateBeforeAction(workflow, A1);
      expect(A1Validation.allowed).toBe(true);

      // A1 executes and changes state → invalidate current
      workflow = handleAfterAction(workflow, A1, A1Result);

      // Current is now invalidated
      expect(workflow.currentObservation.kind).toBe('unavailable');

      // A2: same decision, same tool — but current is invalidated
      const A2 = createToolCall('browser_click', 'A2');
      const A2Validation = validateBeforeAction(workflow, A2);

      // A2 is blocked because current is unavailable
      expect(A2Validation.allowed).toBe(false);
      if (!A2Validation.alignment.aligned) {
        expect(A2Validation.alignment.reason).toBe('current_unavailable');
      }
    });
  });

  describe('B6: A1 → O18 ingested → A2 still blocks because provenance=O17', () => {
    it('even with new O18, decision bound to O17 is still stale', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const O18 = createOccurrence('O18', 'hash18');
      const provenance = captureRequestBoundProvenance(O17);

      // Current is O17
      let workflow = createWorkflow(provenance, { kind: 'current', occurrence: O17 }) as WorkflowContext;

      // A1 executes and changes state
      const A1 = createToolCall('browser_click', 'A1');
      workflow = handleAfterAction(workflow, A1, { success: true });

      // New authoritative observation O18 is ingested (via I4 atomic ingestion)
      workflow = {
        ...workflow,
        currentObservation: { kind: 'current', occurrence: O18 },
      };

      // A2: decision is still bound to O17, current is now O18
      const A2 = createToolCall('browser_click', 'A2');
      const A2Validation = validateBeforeAction(workflow, A2);

      // A2 is blocked because decision O17 ≠ current O18
      expect(A2Validation.allowed).toBe(false);
      if (!A2Validation.alignment.aligned) {
        expect(A2Validation.alignment.reason).toBe('occurrence_mismatch');
      }
    });
  });
});

// ─── B7-B8: LEGACY_UNAVAILABLE and no-current ────────────────────────────────

describe('P2-E I7-B B7-B8: LEGACY_UNAVAILABLE and no-current blocks', () => {
  describe('B7: LEGACY_UNAVAILABLE → observation-dependent action blocked', () => {
    it('LEGACY_UNAVAILABLE blocks observation-dependent actions', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const legacyProvenance: DecisionProvenance = 'LEGACY_UNAVAILABLE';
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow(legacyProvenance, current);
      const toolCall = createToolCall('browser_click');

      const result = validateBeforeAction(workflow as WorkflowContext, toolCall);

      expect(result.allowed).toBe(false);
      if (!result.alignment.aligned) {
        expect(result.alignment.reason).toBe('legacy_unavailable');
        expect(result.blockReason).toContain('fresh observation');
      }
    });
  });

  describe('B8: current none/unavailable → action blocked', () => {
    it('current none blocks action', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = { kind: 'none' as const };
      const workflow = createWorkflow(provenance, current);
      const toolCall = createToolCall('browser_click');

      const result = validateBeforeAction(workflow as WorkflowContext, toolCall);

      expect(result.allowed).toBe(false);
      if (!result.alignment.aligned) {
        expect(result.alignment.reason).toBe('no_current');
      }
    });

    it('current unavailable blocks action', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const provenance = captureRequestBoundProvenance(O17);
      const current = invalidateCurrent({ kind: 'current', occurrence: O17 }, 'previous-action');
      const workflow = createWorkflow(provenance, current);
      const toolCall = createToolCall('browser_click');

      const result = validateBeforeAction(workflow as WorkflowContext, toolCall);

      expect(result.allowed).toBe(false);
      if (!result.alignment.aligned) {
        expect(result.alignment.reason).toBe('current_unavailable');
      }
    });
  });
});

// ─── B9: Fail-closed for unknown actions ─────────────────────────────────────

describe('P2-E I7-B B9: Fail-closed for unknown actions', () => {
  it('unknown tool is treated as observation-dependent', () => {
    const unknownTool = createToolCall('unknown_custom_tool');
    expect(isObservationDependentAction(unknownTool)).toBe(true);
  });

  it('known observation-dependent tools require validation', () => {
    const browserTools = ['browser_click', 'browser_navigate', 'browser_fill_form', 'browser_type'];
    for (const tool of browserTools) {
      expect(isObservationDependentAction(createToolCall(tool))).toBe(true);
    }
  });

  it('known non-observation-dependent tools bypass validation', () => {
    const metaTools = ['report_finding', 'session_log', 'diagnostic_dump'];
    for (const tool of metaTools) {
      expect(isObservationDependentAction(createToolCall(tool))).toBe(false);
    }
  });

  it('non-observation-dependent tools always pass validation', () => {
    const O17 = createOccurrence('O17', 'hash17');
    const O18 = createOccurrence('O18', 'hash18');
    const provenance = captureRequestBoundProvenance(O17);
    const current = { kind: 'current' as const, occurrence: O18 };
    const workflow = createWorkflow(provenance, current);
    const toolCall = createToolCall('report_finding');

    const result = validateBeforeAction(workflow as WorkflowContext, toolCall);

    // Even though decision O17 ≠ current O18, report_finding bypasses validation
    expect(result.allowed).toBe(true);
  });
});

// ─── B10-B11: Authoritative Observation Source Gating ────────────────────────

describe('P2-E I7-B B10-B11: Authoritative Observation Source Gating', () => {
  describe('B10: incidental snapshot-like payload cannot install current', () => {
    it('known non-authoritative sources are rejected', () => {
      const nonAuthoritative = [
        'llm_message',
        'diagnostic_dump',
        'incidental_html',
        'unknown_tool',
      ];

      for (const source of nonAuthoritative) {
        expect(isAuthoritativeObservationSource(source)).toBe(false);
      }
    });
  });

  describe('B11: authoritative auto/tool-post snapshot goes through I4 ingestion', () => {
    it('explicit browser_snapshot is authoritative', () => {
      expect(isAuthoritativeObservationSource('browser_snapshot')).toBe(true);
    });

    it('unknown sources are NOT authoritative (fail-closed)', () => {
      expect(isAuthoritativeObservationSource('unknown_snapshot_tool')).toBe(false);
      expect(isAuthoritativeObservationSource('auto_snapshot')).toBe(false);
    });
  });
});

// ─── B12-B13: Result Status Classification ───────────────────────────────────

describe('P2-E I7-B B12-B13: Result Status Classification', () => {
  describe('B12: definitely_not_applied → previous current retained', () => {
    it('definitely_not_applied result does not invalidate current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow(null, current) as WorkflowContext;
      const toolCall = createToolCall('browser_click');

      // Simulate pre-dispatch rejection
      const result = { success: false, error: 'definitely_not_applied: validation rejected before dispatch' };
      const status = classifyActionResultStatus(toolCall, result);
      expect(status).toBe('definitely_not_applied');

      const updatedWorkflow = handleAfterAction(workflow, toolCall, result);

      // Current is preserved
      expect(updatedWorkflow.currentObservation.kind).toBe('current');
      if (updatedWorkflow.currentObservation.kind === 'current') {
        expect(updatedWorkflow.currentObservation.occurrence.occurrenceId.occurrenceId).toBe('O17');
      }
    });
  });

  describe('B13: dispatch_error/timeout/transport_lost → current invalidated', () => {
    it('dispatch_error invalidates current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow(null, current) as WorkflowContext;
      const toolCall = createToolCall('browser_click');

      const result = { success: false, error: 'dispatch failed after send' };
      const status = classifyActionResultStatus(toolCall, result);
      expect(status).toBe('dispatch_error');

      const updatedWorkflow = handleAfterAction(workflow, toolCall, result);
      expect(updatedWorkflow.currentObservation.kind).toBe('unavailable');
    });

    it('dispatch_timeout invalidates current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow(null, current) as WorkflowContext;
      const toolCall = createToolCall('browser_click');

      const result = { success: false, error: 'timeout after dispatch' };
      const status = classifyActionResultStatus(toolCall, result);
      expect(status).toBe('dispatch_timeout');

      const updatedWorkflow = handleAfterAction(workflow, toolCall, result);
      expect(updatedWorkflow.currentObservation.kind).toBe('unavailable');
    });

    it('transport_lost invalidates current', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow(null, current) as WorkflowContext;
      const toolCall = createToolCall('browser_click');

      const result = { success: false, error: 'connection lost during transport' };
      const status = classifyActionResultStatus(toolCall, result);
      expect(status).toBe('transport_lost');

      const updatedWorkflow = handleAfterAction(workflow, toolCall, result);
      expect(updatedWorkflow.currentObservation.kind).toBe('unavailable');
    });

    it('generic failure (uncertain) invalidates current (fail-closed)', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow(null, current) as WorkflowContext;
      const toolCall = createToolCall('browser_click');

      const result = { success: false, error: 'something went wrong' };
      const status = classifyActionResultStatus(toolCall, result);
      expect(status).toBe('uncertain');

      const updatedWorkflow = handleAfterAction(workflow, toolCall, result);
      expect(updatedWorkflow.currentObservation.kind).toBe('unavailable');
    });

    it('read-only tools never invalidate, regardless of result status', () => {
      const O17 = createOccurrence('O17', 'hash17');
      const current = { kind: 'current' as const, occurrence: O17 };
      const workflow = createWorkflow(null, current) as WorkflowContext;
      const toolCall = createToolCall('browser_snapshot');

      // Even if browser_snapshot "fails", it never invalidates
      const result = { success: false, error: 'timeout' };
      const updatedWorkflow = handleAfterAction(workflow, toolCall, result);

      expect(updatedWorkflow.currentObservation.kind).toBe('current');
    });
  });
});

// ─── Diagnostic Formatting ───────────────────────────────────────────────────

describe('P2-E I7-B Diagnostic Formatting', () => {
  it('formatI7BAlignDiagnostic formats aligned result', () => {
    const O17 = createOccurrence('O17', 'hash17');
    const provenance = captureRequestBoundProvenance(O17);
    const current = { kind: 'current' as const, occurrence: O17 };
    const workflow = createWorkflow(provenance, current);
    const toolCall = createToolCall('browser_click');

    const validation = validateBeforeAction(workflow as WorkflowContext, toolCall);
    const diagnostic = formatI7BAlignDiagnostic(validation, toolCall);

    expect(diagnostic).toContain('[I7B-ALIGN]');
    expect(diagnostic).toContain('tool=browser_click');
    expect(diagnostic).toContain('alignmentStatus=ALIGNED');
  });

  it('formatI7BAlignDiagnostic formats misaligned result', () => {
    const O17 = createOccurrence('O17', 'hash17');
    const O18 = createOccurrence('O18', 'hash18');
    const provenance = captureRequestBoundProvenance(O17);
    const current = { kind: 'current' as const, occurrence: O18 };
    const workflow = createWorkflow(provenance, current);
    const toolCall = createToolCall('browser_click');

    const validation = validateBeforeAction(workflow as WorkflowContext, toolCall);
    const diagnostic = formatI7BAlignDiagnostic(validation, toolCall);

    expect(diagnostic).toContain('[I7B-ALIGN]');
    expect(diagnostic).toContain('alignmentStatus=STALE');
    expect(diagnostic).toContain('misalignmentReason=occurrence_mismatch');
  });

  it('formatI7BAlignDiagnostic includes structural comparison as diagnostic-only', () => {
    const O17 = createOccurrence('O17', 'hash17');
    const O18 = createOccurrence('O18', 'hash18');
    const provenance = captureRequestBoundProvenance(O17);
    const current = { kind: 'current' as const, occurrence: O18 };
    const workflow = createWorkflow(provenance, current);
    const toolCall = createToolCall('browser_click');

    const validation = validateBeforeAction(workflow as WorkflowContext, toolCall);
    const diagnostic = formatI7BAlignDiagnostic(validation, toolCall, 'SAME');

    // Structural comparison is marked as diagnostic-only, non-authoritative
    expect(diagnostic).toContain('structuralComparison=SAME');
    expect(diagnostic).toContain('diagnostic-only');
    expect(diagnostic).toContain('non-authoritative');
  });
});
