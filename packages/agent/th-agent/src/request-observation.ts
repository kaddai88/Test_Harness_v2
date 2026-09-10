import type { Message } from '@test-harness/th-protocol';
import type { WorkflowContext } from './workflow.js';

/**
 * Append the exact occurrence-bound observation to a P2E model request.
 *
 * The envelope and provenance are both read from the same authoritative
 * ObservationOccurrence. This is the request co-origin invariant for R2-1.
 */
export function appendP2EObservationToRequest(
  messages: Message[],
  workflow: WorkflowContext
): Message[] {
  if (workflow.sessionIdentitySemantics.mode !== 'P2E') {
    return messages;
  }

  if (workflow.currentObservation.kind !== 'current') {
    return messages;
  }

  const envelope = workflow.currentObservation.occurrence.observationEnvelope;
  if (!envelope) {
    // The request must not invent an observation from legacy fields. I4
    // occurrences created before envelope retention remain observable only
    // through their existing provenance until reacquisition.
    return messages;
  }

  return [
    ...messages,
    {
      role: 'user',
      content: `[P2E observation ${workflow.currentObservation.occurrence.occurrenceId.occurrenceId}]\n${JSON.stringify(envelope)}`,
    },
  ];
}
