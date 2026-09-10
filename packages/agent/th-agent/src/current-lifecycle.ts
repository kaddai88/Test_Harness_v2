/**
 * P2-E Current Observation Lifecycle (I7-A)
 *
 * Implements the authoritative current observation state machine and
 * state-changing action invalidation primitives.
 *
 * Core invariants:
 * - Current observation transitions are explicit and typed
 * - State-changing actions IMMEDIATELY invalidate current
 * - Unknown tool effects fail closed (treated as state-changing)
 * - Lifecycle events remain distinct:
 *     invalidated ≠ explicit_unavailable ≠ acquisition_failure
 *     ≠ malformed_partial ≠ absent_body
 * - Only successful observations (via I4) create new occurrences
 *
 * Phase 1b scope (I7-A):
 * - State machine primitives (none / current / unavailable transitions)
 * - State-changing action classification (conservative, fail closed)
 * - Invalidation primitive
 * - Diagnostic helpers (state kind, occurrence ID extraction)
 * - Q7-Q10 conformance coverage
 *
 * NOT in scope (deferred to I7-B):
 * - Integration with actual action execution loop
 * - Pre-execution validation in tool execution boundary
 * - Multi-tool revalidation
 * - ALIGN log integration
 * - Session rollout activation
 */

import type {
  CurrentObservationState,
  UnavailableEvent,
  ObservationOccurrence,
} from './identity-semantics.js';

// ─── State Machine Primitives ────────────────────────────────────────────────

/**
 * Get the current state kind
 */
export function getCurrentStateKind(
  current: CurrentObservationState
): 'none' | 'current' | 'unavailable' {
  return current.kind;
}

/**
 * Get the current occurrence ID (or null if not current)
 */
export function getCurrentOccurrenceId(
  current: CurrentObservationState
): string | null {
  if (current.kind !== 'current') {
    return null;
  }
  return current.occurrence.occurrenceId.occurrenceId;
}

/**
 * Get the unavailable event kind (or null if not unavailable)
 *
 * Diagnostic helper: distinguishes between invalidated, explicit_unavailable,
 * acquisition_failure, malformed_partial, absent_body.
 */
export function getCurrentUnavailableKind(
  current: CurrentObservationState
): UnavailableEvent['kind'] | null {
  if (current.kind !== 'unavailable') {
    return null;
  }
  return current.event.kind;
}

/**
 * Get the current occurrence (or null if not current)
 */
export function getCurrentOccurrence(
  current: CurrentObservationState
): ObservationOccurrence | null {
  if (current.kind !== 'current') {
    return null;
  }
  return current.occurrence;
}

// ─── Invalidation ────────────────────────────────────────────────────────────

/**
 * Generate a unique event ID for unavailable events
 *
 * Uses timestamp + counter to ensure uniqueness within a session.
 * Future phases may integrate with durable event tracking.
 */
let unavailableEventCounter = 0;
function generateEventId(): string {
  unavailableEventCounter++;
  return `U${Date.now()}-${unavailableEventCounter}`;
}

/**
 * Invalidate the current observation due to a state-changing action
 *
 * CRITICAL INVARIANT (I7-A):
 * After a state-changing action executes (or may have applied, or effect
 * is uncertain), the current observation MUST be immediately invalidated.
 * The current state transitions to unavailable(kind='invalidated').
 *
 * NON-CURRENT STATE CONTRACT (I7-A-R1):
 *
 *   invalidateCurrent(current)          → unavailable(invalidated O_n)
 *     Records O_n as the invalidated occurrence and the invalidating action.
 *
 *   invalidateCurrent(none)             → none  (UNCHANGED)
 *     There is no current observation to invalidate. This helper MUST NOT
 *     fabricate a synthetic invalidatedOccurrenceId.
 *
 *   invalidateCurrent(unavailable(e))   → unavailable(e)  (UNCHANGED)
 *     The existing unavailable event (with its original epistemic cause) is
 *     preserved. This helper MUST NOT overwrite the original cause (e.g.,
 *     replace 'explicit_unavailable' or 'acquisition_failure' with
 *     'invalidated'). The lifecycle diagnostics depend on the original cause
 *     being preserved.
 *
 * This is a pure function: it does not mutate the input, it returns a new
 * CurrentObservationState.
 *
 * @param current - The current observation state
 * @param invalidatingAction - Optional action description for diagnostics
 * @returns New current state, or the input unchanged if not kind='current'
 */
export function invalidateCurrent(
  current: CurrentObservationState,
  invalidatingAction?: string
): CurrentObservationState {
  // If already unavailable (any kind), remain unavailable with the existing event.
  // We don't replace one unavailability with another — the original event is the
  // authoritative record of why the current became unavailable.
  // Exception: if current is 'none', there's nothing to invalidate, so stay 'none'.
  if (current.kind === 'unavailable') {
    return current;
  }
  if (current.kind === 'none') {
    return current;
  }

  // current.kind === 'current': transition to unavailable(kind='invalidated')
  const invalidatedOccurrenceId = current.occurrence.occurrenceId.occurrenceId;

  const invalidationEvent: UnavailableEvent = {
    kind: 'invalidated',
    eventId: generateEventId(),
    invalidatedOccurrenceId,
    invalidatingAction,
    timestamp: Date.now(),
  };

  return {
    kind: 'unavailable',
    event: invalidationEvent,
  };
}

/**
 * Transition to unavailable state with explicit_unavailable kind
 *
 * Used when authoritative acquisition explicitly reports unavailable.
 * Distinct from invalidation (which is caused by a state-changing action).
 */
export function markUnavailableExplicit(
  current: CurrentObservationState,
  reason: string
): CurrentObservationState {
  if (current.kind === 'unavailable' || current.kind === 'none') {
    // If already unavailable or none, create a new explicit_unavailable event.
    // This is different from invalidateCurrent: explicit_unavailable represents
    // an authoritative "no observation available" signal, not an action-caused
    // invalidation.
  }

  const event: UnavailableEvent = {
    kind: 'explicit_unavailable',
    eventId: generateEventId(),
    reason,
    timestamp: Date.now(),
  };

  return {
    kind: 'unavailable',
    event,
  };
}

// ─── State-Changing Action Classification ────────────────────────────────────

/**
 * Tool classification for state-changing action detection
 *
 * CRITICAL (I7-A, fail-closed principle):
 * - Known read-only tools → NOT state-changing
 * - Known state-changing tools → state-changing
 * - UNKNOWN tools → state-changing (fail closed)
 *
 * The fail-closed principle is critical: if we don't know whether a tool
 * changes state, we MUST treat it as state-changing to prevent stale
 * observation from being used for action validation.
 */
export type ToolEffectClassification =
  | 'read_only'        // Known to not change browser state
  | 'state_changing'   // Known to change browser state, OR unknown (fail closed)
  | 'uncertain';       // Effect uncertain (also treated as state-changing)

/**
 * Known read-only browser tools
 *
 * These tools are known to not modify browser state.
 * Any tool not in this list is treated as state-changing (fail closed).
 */
const READ_ONLY_TOOLS = new Set<string>([
  'browser_snapshot',
  'browser_get_text',
  'browser_get_attribute',
  'browser_evaluate_readonly',
]);

/**
 * Known state-changing browser tools
 *
 * These tools are known to modify browser state.
 * Any tool not in READ_ONLY_TOOLS is treated as state-changing (fail closed).
 */
const STATE_CHANGING_TOOLS = new Set<string>([
  'browser_click',
  'browser_navigate',
  'browser_fill_form',
  'browser_type',
  'browser_select_option',
  'browser_check',
  'browser_uncheck',
  'browser_hover',
  'browser_press_key',
  'browser_drag',
  'browser_close',
]);

/**
 * Classify whether a tool execution is state-changing
 *
 * FAIL-CLOSED PRINCIPLE (I7-A):
 * - Known read-only → 'read_only'
 * - Known state-changing → 'state_changing'
 * - Unknown → 'state_changing' (fail closed)
 *
 * @param toolName - Name of the tool
 * @returns Tool effect classification
 */
export function classifyToolEffect(toolName: string): ToolEffectClassification {
  if (READ_ONLY_TOOLS.has(toolName)) {
    return 'read_only';
  }

  if (STATE_CHANGING_TOOLS.has(toolName)) {
    return 'state_changing';
  }

  // FAIL CLOSED: unknown tool → treat as state-changing
  // This is critical: if we don't know the tool's effect, we MUST
  // invalidate current to prevent stale observation from being used.
  return 'state_changing';
}

/**
 * Result status of an action execution attempt
 *
 * CRITICAL CONTRACT (I7-A-R1):
 * The taxonomy distinguishes between "proven no effect on browser state"
 * and "side-effect status is uncertain or positive". The rule is:
 *
 *   Only PROVEN-NO-EFFECT → keep current
 *
 * Everything else that may have reached browser state → invalidate current.
 *
 * IMPORTANT: generic "failure" does NOT mean "no effect". Most real failures
 * are post-dispatch (network error, timeout, partial apply, serialization
 * failure after dispatch). Those MUST invalidate.
 *
 * Categories:
 * - success: applied successfully → invalidate
 * - may_have_applied: possibly applied → invalidate
 * - uncertain: unknown if applied → invalidate
 * - dispatch_error: dispatched but threw → invalidate (error was AFTER dispatch)
 * - dispatch_timeout: dispatched but timed out → invalidate (effect unknown)
 * - transport_lost: dispatched but transport lost → invalidate (effect unknown)
 * - definitely_not_applied: PROVEN no effect (e.g., pre-dispatch rejection,
 *   input validation rejection before any side effect) → keep current
 */
export type ActionResultStatus =
  | 'success'
  | 'may_have_applied'
  | 'uncertain'
  | 'definitely_not_applied'
  | 'dispatch_error'
  | 'dispatch_timeout'
  | 'transport_lost';

/**
 * Check if an action result status is PROVEN to have no browser-state effect
 *
 * CRITICAL (I7-A-R1):
 * Only `definitely_not_applied` is treated as proven-no-effect.
 * Everything else — including all forms of failure — is treated as
 * "may have affected browser state" and triggers invalidation.
 */
export function isProvenNoEffect(status: ActionResultStatus): boolean {
  return status === 'definitely_not_applied';
}

/**
 * Determine if a tool execution should invalidate current observation
 *
 * CRITICAL CONTRACT (I7-A-R1):
 *
 * Rule: only PROVEN-NO-EFFECT → keep current
 *       everything else → invalidate
 *
 * Semantics:
 * - read_only tool (any status) → NO invalidation
 * - definitely_not_applied → NO invalidation (proven no effect)
 * - success / may_have_applied / uncertain / dispatch_error /
 *   dispatch_timeout / transport_lost → INVALIDATE
 *
 * IMPORTANT: generic failure does NOT mean "no effect". All dispatch-related
 * outcomes — including errors, timeouts, and lost transport — are treated
 * as "may have affected browser state" and trigger invalidation.
 *
 * @param toolName - Name of the tool
 * @param resultStatus - Action result status
 * @returns true if current should be invalidated
 */
export function shouldInvalidateAfterToolExecution(
  toolName: string,
  resultStatus: ActionResultStatus
): boolean {
  const classification = classifyToolEffect(toolName);

  // Read-only tools never invalidate (regardless of status)
  if (classification === 'read_only') {
    return false;
  }

  // Only definitely_not_applied preserves current
  // Everything else — including all failure variants — invalidates
  return !isProvenNoEffect(resultStatus);
}

// ─── Diagnostic Helpers ──────────────────────────────────────────────────────

/**
 * Format current observation state for logging/diagnostics
 *
 * Output format:
 * - none → "none"
 * - current → "current(O{occurrenceId}:{contentHash})"
 * - unavailable → "unavailable({kind}:{eventId})"
 */
export function formatCurrentState(current: CurrentObservationState): string {
  switch (current.kind) {
    case 'none':
      return 'none';
    case 'current':
      return `current(O${current.occurrence.occurrenceId.occurrenceId}:${current.occurrence.observationContent.contentHash})`;
    case 'unavailable':
      return `unavailable(${current.event.kind}:${current.event.eventId})`;
  }
}

/**
 * Diagnostic summary of current state
 *
 * Provides domain-tagged diagnostic information for I7 alignment diagnostics.
 */
export interface CurrentStateDiagnostic {
  stateKind: 'none' | 'current' | 'unavailable';
  occurrenceId: string | null;
  contentHash: string | null;
  contractVersion: string | null;
  unavailableKind: UnavailableEvent['kind'] | null;
  unavailableEventId: string | null;
}

export function getCurrentStateDiagnostic(
  current: CurrentObservationState
): CurrentStateDiagnostic {
  switch (current.kind) {
    case 'none':
      return {
        stateKind: 'none',
        occurrenceId: null,
        contentHash: null,
        contractVersion: null,
        unavailableKind: null,
        unavailableEventId: null,
      };
    case 'current':
      return {
        stateKind: 'current',
        occurrenceId: current.occurrence.occurrenceId.occurrenceId,
        contentHash: current.occurrence.observationContent.contentHash,
        contractVersion: current.occurrence.observationContent.contractVersion,
        unavailableKind: null,
        unavailableEventId: null,
      };
    case 'unavailable':
      return {
        stateKind: 'unavailable',
        occurrenceId: null,
        contentHash: null,
        contractVersion: null,
        unavailableKind: current.event.kind,
        unavailableEventId: current.event.eventId,
      };
  }
}
