/**
 * I9-A-R1 Runtime Ownership Normalization tests.
 *
 * These tests verify that one authoritative snapshot event is fanned out to
 * explicitly owned projections with copy-on-write failure isolation.
 */

import { describe, expect, it } from 'vitest';
import type { WorkflowContext } from './workflow.js';
import type { ObservationOccurrence } from './identity-semantics.js';
import { processAuthoritativeSnapshot } from './agentloop-integration.js';
import { captureRequestBoundProvenance } from './decision-provenance.js';
import { formatI7BAlignDiagnostic, validateBeforeAction } from './execution-boundary.js';

function occurrence(id: string, contentHash: string): ObservationOccurrence {
  return {
    occurrenceId: { occurrenceId: id, timestamp: Date.now() },
    outcome: 'complete',
    observationContent: { contractVersion: 'v1', contentHash },
    structuralEvidence: {
      contractVersion: 'v1',
      completenessScope: 'complete',
      structuralIdentity: { structuralHash: 'struct-same' },
    },
  };
}

function workflow(mode: 'LEGACY' | 'P2E'): WorkflowContext {
  const current = occurrence('O17', 'hash17');
  return {
    currentSnapshotIdentity: { version: 17, hash: 'legacy17' },
    decisionSnapshotIdentity: { version: 17, hash: 'legacy17' },
    currentObservation: { kind: 'current', occurrence: current },
    decisionProvenance: captureRequestBoundProvenance(current),
    sessionIdentitySemantics: { mode, pinnedAt: Date.now(), semanticsVersion: 'p2e-v1' },
    occurrenceCounter: 17,
    observationContractVersion: 'v1',
    structuralContractVersion: 'v1',
  } as WorkflowContext;
}

function legacyProjection(current: WorkflowContext, snapshot: Record<string, unknown>): WorkflowContext {
  return {
    ...current,
    lastRawSnapshot: String(snapshot.text ?? ''),
    lastSnapshot: String(snapshot.text ?? ''),
    currentSnapshotIdentity: { version: 18, hash: 'legacy18' },
  };
}

describe('I9-A-R1: runtime ownership normalization', () => {
  it('P2E diagnostic uses occurrence domain and does not leak legacy identity', () => {
    const current = occurrence('O18', 'hash18');
    const context = {
      ...workflow('P2E'),
      currentObservation: { kind: 'current' as const, occurrence: current },
      decisionProvenance: captureRequestBoundProvenance(occurrence('O17', 'hash17')),
    };
    const validation = validateBeforeAction(context, {
      name: 'browser_click', id: 'call-1', arguments: {},
    } as any);

    const diagnostic = formatI7BAlignDiagnostic(validation, {
      name: 'browser_click', id: 'call-1', arguments: {},
    } as any);

    expect(diagnostic).toContain('decisionOccurrence=O17');
    expect(diagnostic).toContain('currentOccurrence=O18');
    expect(diagnostic).not.toContain('legacy17');
    expect(diagnostic).not.toContain('v17:legacy17');
  });

  it('separates stale occurrence alignment from structural diagnostics', () => {
    const oldOccurrence = occurrence('O17', 'hash17');
    const newOccurrence = occurrence('O18', 'hash18');
    const context = {
      ...workflow('P2E'),
      currentObservation: { kind: 'current' as const, occurrence: newOccurrence },
      decisionProvenance: captureRequestBoundProvenance(oldOccurrence),
    };
    const validation = validateBeforeAction(context, {
      name: 'browser_click', id: 'call-1', arguments: {},
    } as any);
    const diagnostic = formatI7BAlignDiagnostic(validation, {
      name: 'browser_click', id: 'call-1', arguments: {},
    } as any, 'SAME');

    expect(validation.allowed).toBe(false);
    expect(diagnostic).toContain('alignmentStatus=STALE');
    expect(diagnostic).toContain('structuralComparison=SAME');
    expect(diagnostic).toContain('non-authoritative');
  });

  it('P2E fan-out success updates legacy compatibility state and creates exactly one occurrence', () => {
    const initial = workflow('P2E');
    const result = processAuthoritativeSnapshot(
      initial, 'browser_snapshot', '- button "Save" [ref=e18]',
      'https://example.com/page', 'complete', legacyProjection,
    );

    expect(result.lastRawSnapshot).toContain('Save');
    expect(result.currentSnapshotIdentity?.hash).toBe('legacy18');
    expect(result.currentObservation.kind).toBe('current');
    if (result.currentObservation.kind === 'current') {
      expect(result.currentObservation.occurrence.observationEnvelope?.snapshotBody).toContain('Save');
      expect(result.currentObservation.occurrence.occurrenceId.occurrenceId).toBe('O17');
    }
    expect(result.occurrenceCounter).toBe(18);
  });

  it('P2E fan-out failure leaves both projections at the prior state', () => {
    const initial = workflow('P2E');
    const result = processAuthoritativeSnapshot(
      initial, 'browser_snapshot', 'partial payload',
      'https://example.com/page', 'accepted_partial', legacyProjection,
    );

    // Missing scope makes I4 reject the P2E stage. The coordinator returns the
    // original workflow, so legacy compatibility state is not half-committed.
    expect(result).toBe(initial);
    expect(result.lastRawSnapshot).toBeUndefined();
    expect(result.currentSnapshotIdentity?.hash).toBe('legacy17');
    expect(result.currentObservation.kind).toBe('current');
    expect(result.occurrenceCounter).toBe(17);
  });

  it('legacy staging failure prevents P2E publication', () => {
    const initial = workflow('P2E');
    const result = processAuthoritativeSnapshot(
      initial, 'browser_snapshot', 'new snapshot',
      'https://example.com/page', 'complete', () => {
        throw new Error('legacy projection failed');
      },
    );

    expect(result).toBe(initial);
    expect(result.currentObservation.kind).toBe('current');
    expect(result.occurrenceCounter).toBe(17);
  });

  it('LEGACY branch updates compatibility projection without installing P2E current', () => {
    const initial = workflow('LEGACY');
    const result = processAuthoritativeSnapshot(
      initial, 'browser_snapshot', 'legacy snapshot',
      'https://example.com/page', 'complete', legacyProjection,
    );

    expect(result.lastRawSnapshot).toBe('legacy snapshot');
    expect(result.currentSnapshotIdentity?.hash).toBe('legacy18');
    expect(result.currentObservation.kind).toBe('current');
    if (result.currentObservation.kind === 'current') {
      expect(result.currentObservation.occurrence).toBe(initial.currentObservation.kind === 'current'
        ? initial.currentObservation.occurrence : undefined);
    }
    expect(result.occurrenceCounter).toBe(17);
  });

  it('one event creates one P2E occurrence and advances counter once', () => {
    const initial = workflow('P2E');
    const result = processAuthoritativeSnapshot(
      initial, 'browser_snapshot', 'one event',
      'https://example.com/page', 'complete', legacyProjection,
    );

    expect(result.occurrenceCounter).toBe(18);
    expect(result.currentObservation.kind).toBe('current');
  });

  it('non-authoritative source does not fan out to either projection', () => {
    const initial = workflow('P2E');
    const result = processAuthoritativeSnapshot(
      initial, 'llm_message', 'snapshot-like text',
      'https://example.com/page', 'complete', legacyProjection,
    );

    expect(result).toBe(initial);
  });
});
