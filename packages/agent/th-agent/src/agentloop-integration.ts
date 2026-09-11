/**
 * P2-E AgentLoop Integration (I7-B-R1)
 *
 * Integrates P2E correctness primitives into the real AgentLoop execution path.
 *
 * Four integration points:
 * 1. Model request construction → capture request-bound provenance
 * 2. Before each tool dispatch → validate provenance vs current
 * 3. After tool execution → classify effect + invalidate if needed
 * 4. Authoritative snapshot ingestion → use I4 occurrence ingestion path
 *
 * GATE: All I7-B-R1 logic is gated by `sessionIdentitySemantics.mode === 'P2E'`.
 * LEGACY sessions are completely unaffected.
 *
 * NOT in scope (deferred to I8):
 * - Session mode pinning/migration
 * - Rollout authority
 * - Restart persistence
 */

import type { WorkflowContext } from './workflow.js';
import type { ToolCall } from '@test-harness/th-protocol';
import type {
  ObservationOccurrence,
  CurrentObservationState,
} from './identity-semantics.js';
import { captureRequestBoundProvenance } from './decision-provenance.js';
import {
  validateBeforeAction,
  handleAfterAction,
  isAuthoritativeObservationSource,
  formatI7BAlignDiagnostic,
  type PreExecutionValidationResult,
} from './execution-boundary.js';
import {
  ingestSuccessfulObservation,
  type AcquisitionOutcome,
} from './observation-lifecycle.js';
import { constructObservationEnvelope, constructObservationContentIdentity } from './observation-projection.js';
import { constructStructuralProjection, constructStructuralEvidence } from './structural-projection.js';

// ─── Integration Point 1: Capture Request-Bound Provenance ───────────────────

/**
 * Capture P2E decision provenance at model request construction time
 *
 * CRITICAL INVARIANT (I7-B-R1):
 * - Provenance is captured from current observation at request construction
 * - NOT at response time (prevents late-capture bug)
 * - Only active when session mode is P2E
 *
 * @param workflow - Current workflow context
 * @returns Updated workflow context with decision provenance captured
 */
export function captureP2EDecisionProvenance(
  workflow: WorkflowContext
): WorkflowContext {
  // Only active for P2E sessions
  if (workflow.sessionIdentitySemantics.mode !== 'P2E') {
    return workflow;
  }

  // Get current observation
  const currentObservation = workflow.currentObservation;

  // If current is an observation occurrence, capture provenance
  if (currentObservation.kind === 'current') {
    const occurrence = currentObservation.occurrence;
    const provenance = captureRequestBoundProvenance(occurrence);

    return {
      ...workflow,
      decisionProvenance: provenance,
    };
  }

  // Current is not an observation (none/unavailable) → LEGACY_UNAVAILABLE
  return {
    ...workflow,
    decisionProvenance: 'LEGACY_UNAVAILABLE',
  };
}

// ─── Integration Point 2: Pre-Execution Validation ───────────────────────────

/**
 * Result of pre-execution validation with integration context
 */
export interface PreExecutionIntegrationResult {
  /** Whether the action should execute */
  allowed: boolean;
  /** The validation result */
  validation: PreExecutionValidationResult;
  /** Diagnostic string for logging */
  diagnostic: string;
  /** If blocked, the error message for tool result */
  errorMessage?: string;
}

/**
 * Validate before tool execution (Integration Point 2)
 *
 * CRITICAL INVARIANT (I7-B-R1):
 * - Every observation-dependent action validates immediately before dispatch
 * - Blocked actions never reach the executor
 * - Only active when session mode is P2E
 *
 * @param workflow - Current workflow context
 * @param toolCall - The tool call about to execute
 * @returns Integration result with allowed/blocked decision
 */
export function validateBeforeToolDispatch(
  workflow: WorkflowContext,
  toolCall: ToolCall
): PreExecutionIntegrationResult {
  // Only active for P2E sessions
  if (workflow.sessionIdentitySemantics.mode !== 'P2E') {
    return {
      allowed: true,
      validation: {
        allowed: true,
        alignment: {
          aligned: true,
          decisionOccurrenceId: '',
          currentOccurrenceId: '',
          decisionObservationContent: null as any,
          currentObservationContent: null as any,
          currentStateKind: 'current',
        },
        diagnostic: 'LEGACY mode',
        diagnosticInfo: {} as any,
      },
      diagnostic: 'LEGACY mode — no validation',
    };
  }

  // Validate using execution-boundary primitive
  const validation = validateBeforeAction(workflow, toolCall);

  if (!validation.allowed) {
    return {
      allowed: false,
      validation,
      diagnostic: formatI7BAlignDiagnostic(validation, toolCall),
      errorMessage: validation.blockReason ?? 'Action blocked by P2E provenance validation',
    };
  }

  return {
    allowed: true,
    validation,
    diagnostic: formatI7BAlignDiagnostic(validation, toolCall),
  };
}

// ─── Integration Point 3: Post-Execution Invalidation ────────────────────────

/**
 * Handle post-execution state transitions (Integration Point 3)
 *
 * CRITICAL INVARIANT (I7-B-R1):
 * - After tool execution, classify effect and invalidate if needed
 * - Only active when session mode is P2E
 *
 * @param workflow - Current workflow context
 * @param toolCall - The tool call that just executed
 * @param result - The execution result
 * @returns Updated workflow context
 */
export function handlePostToolExecution(
  workflow: WorkflowContext,
  toolCall: ToolCall,
  result: { success: boolean; error?: string }
): WorkflowContext {
  // Only active for P2E sessions
  if (workflow.sessionIdentitySemantics.mode !== 'P2E') {
    return workflow;
  }

  // Use execution-boundary primitive
  return handleAfterAction(workflow, toolCall, result);
}

// ─── Integration Point 4: Authoritative Snapshot Ingestion ───────────────────

/**
 * Install new authoritative observation from browser_snapshot
 *
 * CRITICAL INVARIANT (I7-B-R1):
 * - Only authoritative sources can install current observation
 * - Uses I4 atomic ingestion path
 * - Only active when session mode is P2E
 *
 * @param workflow - Current workflow context
 * @param toolName - The tool that produced the snapshot
 * @param snapshotText - The snapshot text
 * @param url - The current URL
 * @param outcome - The acquisition outcome
 * @returns Updated workflow context
 */
export function installAuthoritativeObservation(
  workflow: WorkflowContext,
  toolName: string,
  snapshotText: string,
  url: string,
  outcome: AcquisitionOutcome
): WorkflowContext {
  // Only active for P2E sessions
  if (workflow.sessionIdentitySemantics.mode !== 'P2E') {
    return workflow;
  }

  // Only authoritative sources can install current
  if (!isAuthoritativeObservationSource(toolName)) {
    return workflow;
  }

  // Use I4 atomic ingestion path
  const result = ingestSuccessfulObservation(
    snapshotText,
    url,
    outcome,
    {
      currentObservation: workflow.currentObservation,
      occurrenceCounter: workflow.occurrenceCounter,
      observationContractVersion: workflow.observationContractVersion,
      structuralContractVersion: workflow.structuralContractVersion,
    }
  );

  return {
    ...workflow,
    currentObservation: result.currentObservation,
    occurrenceCounter: result.occurrenceCounter,
  };
}

// ─── Authoritative Snapshot Single-Source Fan-Out (I9-A-R1) ──────────────────

/**
 * Process one authoritative browser_snapshot event through explicit consumer
 * projections. The event is acquired once; LEGACY compatibility projection and
 * P2E I4 occurrence ingestion are independent consumers of that same event.
 *
 * This coordinator deliberately keeps legacy fields for LEGACY compatibility,
 * but no longer relies on "legacy update first, then P2E update" as an implicit
 * ownership/order contract.
 */
export function processAuthoritativeSnapshot(
  workflow: WorkflowContext,
  toolName: string,
  rawSnapshot: string,
  url: string,
  outcome: AcquisitionOutcome,
  legacyProjection: (
    current: WorkflowContext,
    snapshot: Record<string, unknown>,
  ) => WorkflowContext,
): WorkflowContext {
  if (!isAuthoritativeObservationSource(toolName)) {
    return workflow;
  }

  const snapshot = { text: rawSnapshot };
  // Stage P2E first from the source event itself. No caller-visible state is
  // committed yet. An accepted partial without explicit scope is rejected by
  // I4 and therefore aborts the fan-out before the LEGACY branch can run.
  if (outcome === 'accepted_partial') {
    return workflow;
  }

  try {
    const stagedP2E = isP2EActive(workflow)
      ? installAuthoritativeObservation(workflow, toolName, rawSnapshot, url, outcome)
      : workflow;

    // Consumer 1: legacy compatibility projection is independently staged from
    // the same raw event, not from P2E or legacy-mutated state.
    const stagedLegacy = legacyProjection({ ...workflow }, snapshot);

    // Single commit: combine the two copy-on-write staged results only after
    // both branches have completed. P2E fields are taken from stagedP2E;
    // legacy fields are taken from stagedLegacy.
    return {
      ...stagedLegacy,
      currentObservation: stagedP2E.currentObservation,
      occurrenceCounter: stagedP2E.occurrenceCounter,
    };
  } catch {
    // Single-commit contract: if either stage fails, expose the original
    // workflow unchanged. The error is intentionally left for the caller's
    // existing result/error path to report.
    return workflow;
  }
}



/**
 * Check if P2E integration is active for this workflow
 */
export function isP2EActive(workflow: WorkflowContext): boolean {
  return workflow.sessionIdentitySemantics.mode === 'P2E';
}

/**
 * Format P2E integration diagnostic for logging
 */
export function formatP2EIntegrationDiagnostic(
  phase: 'capture' | 'validate' | 'invalidate' | 'install',
  workflow: WorkflowContext,
  toolCall?: ToolCall,
  result?: { success: boolean; error?: string }
): string {
  const active = isP2EActive(workflow);
  const parts = [`[P2E-${phase.toUpperCase()}] active=${active}`];

  if (!active) {
    return parts.join(' ');
  }

  switch (phase) {
    case 'capture':
      parts.push(`decisionProvenance=${workflow.decisionProvenance === 'LEGACY_UNAVAILABLE' ? 'LEGACY' : 'captured'}`);
      break;
    case 'validate':
      if (toolCall) {
        const validation = validateBeforeAction(workflow, toolCall);
        parts.push(`tool=${toolCall.name}`, `allowed=${validation.allowed}`);
        if (!validation.allowed) {
          parts.push(`reason=${validation.alignment.aligned ? 'n/a' : validation.alignment.reason}`);
        }
      }
      break;
    case 'invalidate':
      if (toolCall && result) {
        const updated = handleAfterAction(workflow, toolCall, result);
        parts.push(`tool=${toolCall.name}`, `currentState=${updated.currentObservation.kind}`);
      }
      break;
    case 'install':
      parts.push(`currentState=${workflow.currentObservation.kind}`);
      if (workflow.currentObservation.kind === 'current') {
        parts.push(`occurrence=${workflow.currentObservation.occurrence.occurrenceId.occurrenceId}`);
      }
      break;
  }

  return parts.join(' ');
}
