/**
 * P2-E Conformance Test C1: Content SAME ≠ Occurrence SAME
 *
 * This test verifies the core invariant that two observations with identical
 * content must have different occurrence identities.
 *
 * This is the fundamental distinction that P2-E was designed to enforce:
 * - Observation content identity answers "what was observed"
 * - Observation occurrence identity answers "when it was observed"
 * - Two occurrences can have SAME content but DIFFERENT occurrence IDs
 *
 * Test scenario:
 * 1. Take first observation Oₙ
 * 2. Take second observation Oₙ₊₁ with identical content
 * 3. Verify: content identity is SAME
 * 4. Verify: occurrence identity is DIFFERENT
 */

import { describe, it, expect } from 'vitest';
import {
  ObservationContentIdentity,
  ObservationOccurrenceIdentity,
} from './identity-semantics.js';
import { createHash } from 'node:crypto';

/**
 * Generate a unique occurrence ID
 * In Phase 1a, we use a simple counter-based approach.
 * Later phases will integrate with the occurrence lifecycle.
 */
let occurrenceCounter = 0;
function generateOccurrenceId(): ObservationOccurrenceIdentity {
  occurrenceCounter++;
  return {
    occurrenceId: `O${occurrenceCounter}`,
    timestamp: Date.now(),
  };
}

/**
 * Compute observation content identity from raw snapshot
 * In Phase 1a, we use a simple hash of the raw text.
 * Later phases will implement field-aware normalization.
 */
function computeObservationContentIdentity(
  rawSnapshot: string,
  contractVersion: string = 'v1'
): ObservationContentIdentity {
  const contentHash = createHash('sha256')
    .update(rawSnapshot, 'utf8')
    .digest('hex')
    .slice(0, 12);
  return {
    contractVersion,
    contentHash,
  };
}

/**
 * Compare two observation content identities
 */
function compareObservationContent(
  a: ObservationContentIdentity,
  b: ObservationContentIdentity
): { result: 'SAME' | 'DIFFERENT' | 'NOT_COMPARABLE'; reason?: string } {
  // Phase 1a: Only compare within same contract version
  if (a.contractVersion !== b.contractVersion) {
    return { result: 'NOT_COMPARABLE', reason: 'contract incomparability' };
  }

  if (a.contentHash === b.contentHash) {
    return { result: 'SAME' };
  }

  return { result: 'DIFFERENT' };
}

describe('P2-E Conformance C1: Content SAME ≠ Occurrence SAME', () => {
  it('two observations with identical content must have different occurrence IDs', () => {
    // Arrange: identical raw snapshot
    const rawSnapshot = `
      button "Submit" [ref=e37]
      textbox "Username" [ref=e38]
      textbox "Password" [ref=e39]
    `;

    // Act: observe the same content twice
    const occurrence1 = generateOccurrenceId();
    const content1 = computeObservationContentIdentity(rawSnapshot);

    const occurrence2 = generateOccurrenceId();
    const content2 = computeObservationContentIdentity(rawSnapshot);

    // Assert: content identity is SAME
    const contentComparison = compareObservationContent(content1, content2);
    expect(contentComparison.result).toBe('SAME');

    // Assert: occurrence identity is DIFFERENT
    expect(occurrence1.occurrenceId).not.toBe(occurrence2.occurrenceId);
  });

  it('two observations with different content must have different occurrence IDs', () => {
    // Arrange: different raw snapshots
    const rawSnapshot1 = `button "Submit" [ref=e37]`;
    const rawSnapshot2 = `button "Cancel" [ref=e42]`;

    // Act: observe different content
    const occurrence1 = generateOccurrenceId();
    const content1 = computeObservationContentIdentity(rawSnapshot1);

    const occurrence2 = generateOccurrenceId();
    const content2 = computeObservationContentIdentity(rawSnapshot2);

    // Assert: content identity is DIFFERENT
    const contentComparison = compareObservationContent(content1, content2);
    expect(contentComparison.result).toBe('DIFFERENT');

    // Assert: occurrence identity is DIFFERENT
    expect(occurrence1.occurrenceId).not.toBe(occurrence2.occurrenceId);
  });

  it('content identity comparison across contract versions is NOT_COMPARABLE', () => {
    // Arrange: same raw snapshot
    const rawSnapshot = `button "Submit" [ref=e37]`;

    // Act: compute content identity with different contract versions
    const content1 = computeObservationContentIdentity(rawSnapshot, 'v1');
    const content2 = computeObservationContentIdentity(rawSnapshot, 'v2');

    // Assert: content hashes are identical (same input)
    expect(content1.contentHash).toBe(content2.contentHash);

    // Assert: but comparison is NOT_COMPARABLE due to different contract versions
    const contentComparison = compareObservationContent(content1, content2);
    expect(contentComparison.result).toBe('NOT_COMPARABLE');
    expect(contentComparison.reason).toBe('contract incomparability');
  });
});
