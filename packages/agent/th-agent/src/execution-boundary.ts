/**
 * P2-E Execution Boundary Integration (I7-B)
 *
 * Implements the integration between P2E correctness primitives and the
 * real AgentLoop execution path.
 *
 * Core invariants (I7-B):
 * - Each observation-dependent action gets immediate pre-execution validation
 * - Decision provenance is the SOLE correctness authority
 * - Structural SAME does NOT rescue stale actions
 * - Multi-tool response: each action revalidates against current state
 * - Only authoritative observation sources install current
 * - Fail-closed: unknown actions treated as observation-dependent
 *
 * NOT in scope (deferred to I8):
 * - Session identity semantics pinning (LEGACY vs P2E)
 * - Restart persistence
 * - Migration compatibility
 * - Rollout / rollback
 *
 * GATE: All I7-B logic is gated by `sessionIdentitySemantics.mode === 'P2E'`.
 * Legacy sessions are unaffected. This module does NOT silently enable P2E
 * for running sessions — that is I8's responsibility.
 */

import type { ToolCall } from '@test-harness/th-protocol';
import type {
  WorkflowContext,
} from './workflow.js';
import type {
  DecisionProvenance,
  CurrentObservationState,
} from './identity-semantics.js';
import type {
  ProvenanceAlignmentResult,
  AlignmentDiagnostic,
} from './provenance-validation.js';
import type {
  ActionResultStatus,
} from './current-lifecycle.js';
import {
  validateProvenanceAlignment,
  formatAlignmentResult,
  getAlignmentDiagnostic,
} from './provenance-validation.js';
import {
  invalidateCurrent,
  shouldInvalidateAfterToolExecution,
  classifyToolEffect,
  formatCurrentState,
} from './current-lifecycle.js';

// ─── Observation-Dependent Action Classification ─────────────────────────────

/**
 * Known tools that do NOT depend on observation state
 *
 * These tools either:
 * - Don't interact with browser state at all
 * - Are pure audit/logging operations
 * - Don't need observation alignment to execute safely
 *
 * IMPORTANT: This list is intentionally SMALL. Fail-closed principle:
 * unknown tools are treated as observation-dependent.
 */
const NON_OBSERVATION_DEPENDENT_TOOLS = new Set<string>([
  // Authoritative observation acquisition can establish the first current
  // observation and therefore cannot require a prior observation to validate.
  'browser_snapshot',
  // Meta/audit operations (no browser interaction)
  'report_finding',
  'session_log',
  'diagnostic_dump',
]);

/**
 * Determine if a tool call depends on observation state
 *
 * CRITICAL CONTRACT (I7-B, fail-closed):
 * - Known non-observation-dependent → may bypass observation alignment
 * - Known observation-dependent → MUST validate
 * - Unknown tool → treat as observation-dependent (fail-closed)
 *
 * This is the predicate that gates pre-execution validation.
 *
 * @param toolCall - The tool call to classify
 * @returns true if the tool depends on observation state
 */
export function isObservationDependentAction(toolCall: ToolCall): boolean {
  // Known non-observation-dependent tools bypass validation
  if (NON_OBSERVATION_DEPENDENT_TOOLS.has(toolCall.name)) {
    return false;
  }

  // Everything else — including unknown tools — is observation-dependent
  // FAIL CLOSED: unknown tools are treated as observation-dependent
  return true;
}

// ─── Pre-Execution Validation ────────────────────────────────────────────────

/**
 * Result of pre-execution validation
 */
export interface PreExecutionValidationResult {
  /** Whether the action can execute */
  allowed: boolean;
  /** The alignment result (for diagnostics) */
  alignment: ProvenanceAlignmentResult;
  /** Formatted diagnostic string */
  diagnostic: string;
  /** Structured diagnostic for logging */
  diagnosticInfo: AlignmentDiagnostic;
  /** If blocked, the reason */
  blockReason?: string;
}

/**
 * Validate an action before execution
 *
 * CRITICAL INVARIANT (I7-B):
 * - Observation-dependent actions MUST be validated immediately before execution
 * - Decision provenance is the SOLE correctness authority
 * - Structural SAME does NOT rescue stale actions
 * - Unknown tools are treated as observation-dependent (fail-closed)
 *
 * @param workflow - Current workflow context
 * @param toolCall - The tool call to validate
 * @returns Validation result with alignment info and block reason if blocked
 */
export function validateBeforeAction(
  workflow: WorkflowContext,
  toolCall: ToolCall
): PreExecutionValidationResult {
  // Check if this action depends on observation state
  const isObservationDependent = isObservationDependentAction(toolCall);

  // Non-observation-dependent actions always pass
  if (!isObservationDependent) {
    const dummyAlignment: ProvenanceAlignmentResult = {
      aligned: true,
      decisionOccurrenceId: null as any,
      currentOccurrenceId: null as any,
      decisionObservationContent: null as any,
      currentObservationContent: null as any,
      currentStateKind: 'current',
    };
    return {
      allowed: true,
      alignment: dummyAlignment,
      diagnostic: 'non-observation-dependent',
      diagnosticInfo: getAlignmentDiagnostic(dummyAlignment),
    };
  }

  // Get decision provenance from workflow
  const decisionProvenance: DecisionProvenance = workflow.decisionProvenance ?? 'LEGACY_UNAVAILABLE';

  // Get current observation state from workflow
  const currentObservation: CurrentObservationState = workflow.currentObservation ?? { kind: 'none' };

  // Validate alignment
  const alignment = validateProvenanceAlignment(decisionProvenance, currentObservation);

  // Format diagnostic
  const diagnostic = formatAlignmentResult(alignment);
  const diagnosticInfo = getAlignmentDiagnostic(alignment);

  // Determine if action is allowed
  if (alignment.aligned) {
    return {
      allowed: true,
      alignment,
      diagnostic: `${diagnostic} → ALLOWED`,
      diagnosticInfo,
    };
  }

  // Action is blocked
  let blockReason: string;
  switch (alignment.reason) {
    case 'legacy_unavailable':
      blockReason = 'Decision provenance is LEGACY_UNAVAILABLE; fresh observation + fresh model request required';
      break;
    case 'no_current':
      blockReason = 'No current observation available; cannot validate action against browser state';
      break;
    case 'current_unavailable':
      blockReason = `Current observation unavailable (${alignment.currentUnavailableKind}); cannot validate action`;
      break;
    case 'occurrence_mismatch':
      blockReason = `Decision occurrence (${alignment.decisionOccurrenceId}) ≠ current occurrence (${alignment.currentOccurrenceId}); stale decision, action blocked`;
      break;
    default:
      blockReason = 'Unknown misalignment reason';
  }

  return {
    allowed: false,
    alignment,
    diagnostic: `${diagnostic} → BLOCKED (${blockReason})`,
    diagnosticInfo,
    blockReason,
  };
}

// ─── Post-Execution Handling ─────────────────────────────────────────────────

/**
 * Classify the effect of a tool execution
 *
 * Maps tool execution result to ActionResultStatus for invalidation decision.
 *
 * CRITICAL CONTRACT (I7-B, I7-A-R1):
 * - success / dispatch_error / dispatch_timeout / transport_lost → state-changing
 * - may_have_applied / uncertain → state-changing
 * - definitely_not_applied → proven no effect
 *
 * @param toolCall - The tool call that was executed
 * @param result - The execution result
 * @returns Action result status
 */
export function classifyActionResultStatus(
  toolCall: ToolCall,
  result: { success: boolean; error?: string }
): ActionResultStatus {
  // If tool failed before dispatch and explicitly proves no browser effect,
  // preserve current. Generic prepare/input errors are intentionally NOT
  // classified here; callers must provide the explicit marker.
  if (!result.success && result.error?.includes('definitely_not_applied')) {
    return 'definitely_not_applied';
  }

  // If tool reported success
  if (result.success) {
    return 'success';
  }

  // If tool reported error with uncertain dispatch status
  if (result.error?.includes('timeout')) {
    return 'dispatch_timeout';
  }
  if (result.error?.includes('transport') || result.error?.includes('connection')) {
    return 'transport_lost';
  }
  if (result.error?.includes('dispatch')) {
    return 'dispatch_error';
  }

  // Generic failure — fail closed, treat as uncertain
  return 'uncertain';
}

/**
 * Handle post-execution state transitions
 *
 * CRITICAL INVARIANT (I7-B):
 * - After tool execution, classify effect and potentially invalidate current
 * - Only definitely_not_applied preserves current
 * - Everything else invalidates current (fail-closed)
 * - Read-only tools never invalidate
 *
 * @param workflow - Current workflow context
 * @param toolCall - The tool call that was executed
 * @param result - The execution result
 * @returns Updated workflow context
 */
export function handleAfterAction(
  workflow: WorkflowContext,
  toolCall: ToolCall,
  result: { success: boolean; error?: string }
): WorkflowContext {
  // Classify tool effect
  const toolEffect = classifyToolEffect(toolCall.name);

  // Read-only tools never invalidate
  if (toolEffect === 'read_only') {
    return workflow;
  }

  // Classify action result status
  const resultStatus = classifyActionResultStatus(toolCall, result);

  // Determine if current should be invalidated
  const shouldInvalidate = shouldInvalidateAfterToolExecution(toolCall.name, resultStatus);

  if (!shouldInvalidate) {
    // Current is preserved (only definitely_not_applied reaches here)
    return workflow;
  }

  // Invalidate current
  const invalidatedAction = `${toolCall.name} (${resultStatus})`;
  const newCurrent = invalidateCurrent(workflow.currentObservation, invalidatedAction);

  return {
    ...workflow,
    currentObservation: newCurrent,
  };
}

// ─── Authoritative Observation Source Gating ─────────────────────────────────

/**
 * Known authoritative observation sources
 *
 * Only these sources are allowed to install current observation.
 * This prevents incidental snapshot-like text from overwriting authoritative current.
 */
const AUTHORITATIVE_OBSERVATION_SOURCES = new Set<string>([
  'browser_snapshot',           // Explicit snapshot request
  // Auto-snapshot and tool-post snapshot will be added when implemented
]);

/**
 * Check if a tool result is from an authoritative observation source
 *
 * CRITICAL CONTRACT (I7-B):
 * - Only authoritative sources can install current observation
 * - Incidental snapshot-like text MUST NOT overwrite current
 * - Unknown sources are NOT authoritative (fail-closed)
 *
 * @param toolName - Name of the tool that produced the result
 * @returns true if the tool is an authoritative observation source
 */
export function isAuthoritativeObservationSource(toolName: string): boolean {
  return AUTHORITATIVE_OBSERVATION_SOURCES.has(toolName);
}

// ─── Diagnostic Formatting ───────────────────────────────────────────────────

/**
 * Format I7-B ALIGN diagnostic for logging
 *
 * Output format (I7-B approved format):
 *
 * [I7B-ALIGN] decisionOccurrence=O17 currentOccurrence=O18
 *             alignmentStatus=STALE misalignmentReason=occurrence_mismatch
 *             currentStateKind=current
 *             structuralComparison=SAME (diagnostic-only, non-authoritative)
 */
export function formatI7BAlignDiagnostic(
  validation: PreExecutionValidationResult,
  toolCall: ToolCall,
  structuralComparison?: 'SAME' | 'DIFFERENT' | 'NOT_COMPARABLE'
): string {
  const parts: string[] = [
    `[I7B-ALIGN] tool=${toolCall.name}`,
  ];

  if (validation.diagnosticInfo.decisionOccurrence) {
    parts.push(`decisionOccurrence=${validation.diagnosticInfo.decisionOccurrence}`);
  } else {
    parts.push(`decisionOccurrence=LEGACY`);
  }

  if (validation.diagnosticInfo.currentOccurrence) {
    parts.push(`currentOccurrence=${validation.diagnosticInfo.currentOccurrence}`);
  } else {
    parts.push(`currentOccurrence=${validation.diagnosticInfo.currentStateKind}`);
  }

  parts.push(`alignmentStatus=${validation.allowed ? 'ALIGNED' : 'STALE'}`);

  if (!validation.allowed && validation.diagnosticInfo.misalignmentReason) {
    parts.push(`misalignmentReason=${validation.diagnosticInfo.misalignmentReason}`);
  }

  parts.push(`currentStateKind=${validation.diagnosticInfo.currentStateKind}`);

  // Structural comparison is diagnostic-only, non-authoritative
  if (structuralComparison !== undefined) {
    parts.push(`structuralComparison=${structuralComparison} (diagnostic-only, non-authoritative)`);
  }

  return parts.join(' ');
}
