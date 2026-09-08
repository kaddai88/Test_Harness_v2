/**
 * P2: Snapshot lifecycle version consistency.
 *
 * Core question this answers: "Is the snapshot the LLM saw the same version
 * as the snapshot Coverage/Resolver is looking at?"
 *
 * snapshotVersion is monotonically increasing:
 *   - every observed snapshot (via updateWorkflowContext) bumps the version
 *   - the initial coverage-init snapshot also bumps it
 *
 * The [ALIGN] log line carries both the current version and the version the
 * LLM decided at. A mismatch proves the action was decided against a stale
 * snapshot — distinguishing Case B (ref_unknown due to version skew) from
 * Case A (aligned) and Case C (ref_drift).
 */
import { describe, it, expect } from 'vitest';
import { createInitialContext, updateWorkflowContext, WorkflowState } from './workflow.js';

const INIT = WorkflowState.INIT;

describe('P2: snapshot version lifecycle', () => {
  it('starts at version 0', () => {
    const ctx = createInitialContext(50, 'https://example.com');
    expect(ctx.snapshotVersion).toBe(0);
  });

  it('bumps version on each observed snapshot', () => {
    let ctx = createInitialContext(50, 'https://example.com');
    const snap1 = '- button "A" [ref=e1]';
    const snap2 = '- button "B" [ref=e2]';

    ctx = updateWorkflowContext(ctx, 'browser_snapshot', {}, true, { text: snap1 }, INIT);
    const v1 = ctx.snapshotVersion;
    expect(v1).toBeGreaterThan(0);

    ctx = updateWorkflowContext(ctx, 'browser_snapshot', {}, true, { text: snap2 }, INIT);
    expect(ctx.snapshotVersion).toBe(v1 + 1);
  });

  it('does NOT bump version when snapshot text is absent', () => {
    let ctx = createInitialContext(50, 'https://example.com');
    ctx = updateWorkflowContext(ctx, 'browser_snapshot', {}, true, { text: '- button [ref=e1]' }, INIT);
    const v = ctx.snapshotVersion;

    // Non-snapshot tool or empty text → version unchanged
    ctx = updateWorkflowContext(ctx, 'browser_click', {}, true, undefined, INIT);
    expect(ctx.snapshotVersion).toBe(v);
  });

  it('version pairs with refs: same bump extracts the refs of that snapshot', () => {
    let ctx = createInitialContext(50, 'https://example.com');
    const snap1 = '- button "A" [ref=e1]\n- textbox "B" [ref=e2]';

    ctx = updateWorkflowContext(ctx, 'browser_snapshot', {}, true, { text: snap1 }, INIT);
    expect(ctx.snapshotVersion).toBe(1);
    expect(ctx.currentSnapshotRefs).toContain('e1');
    expect(ctx.currentSnapshotRefs).toContain('e2');

    const snap2 = '- button "C" [ref=e3]';
    ctx = updateWorkflowContext(ctx, 'browser_snapshot', {}, true, { text: snap2 }, INIT);
    expect(ctx.snapshotVersion).toBe(2);
    expect(ctx.currentSnapshotRefs).toEqual(['e3']);
  });

  it('decided@v semantics: an action decided before a later snapshot is detectably stale', () => {
    // Simulate the ALIGN diagnostic flow:
    // 1. LLM observes snapshot v1 and decides an action with ref=e1
    // 2. A new snapshot v2 arrives (auto-snapshot after a previous action)
    // 3. At ALIGN time, current version is v2 — decided@v1 ≠ v2 proves
    //    the action was based on a stale snapshot.
    let ctx = createInitialContext(50, 'https://example.com');
    const snapV1 = '- button "提交" [ref=e1]';
    ctx = updateWorkflowContext(ctx, 'browser_snapshot', {}, true, { text: snapV1 }, INIT);
    const decisionSnapshotVersion = ctx.snapshotVersion;
    expect(decisionSnapshotVersion).toBe(1);

    // Between decision and execution, page changed
    const snapV2 = '- button "确认" [ref=e9]';
    ctx = updateWorkflowContext(ctx, 'browser_snapshot', {}, true, { text: snapV2 }, INIT);

    const staleRef = 'e1';
    const refInCurrentSnapshot = ctx.currentSnapshotRefs.includes(staleRef);
    const versionSkew = ctx.snapshotVersion !== decisionSnapshotVersion;

    // This is exactly the ref_unknown + version-skew signature
    expect(refInCurrentSnapshot).toBe(false);
    expect(versionSkew).toBe(true);
  });
});
