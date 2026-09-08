/**
 * P1 regression tests: Snapshot → Feature → Action lifecycle alignment.
 *
 * extractSnapshotRefs + updateWorkflowContext.currentSnapshotRefs must let the
 * [ALIGN] diagnostic distinguish exactly three root causes for an unmatched action:
 *   ref_drift   — feature ref stale, action ref IS current
 *   ref_unknown — action ref not in the current snapshot at all
 *   no_ref      — action had no ref (name-only matching)
 */
import { describe, it, expect } from 'vitest';
import { extractSnapshotRefs, createInitialContext, updateWorkflowContext } from './workflow.js';
import { WorkflowState } from './workflow.js';

const SNAPSHOT = [
  '- banner:',
  '  - heading "Zentao" [level=1] [ref=e1]',
  '  - textbox "用户名" [ref=e20]',
  '  - textbox "密码" [ref=e21]',
  '  - button "登录" [ref=e22]',
  '- main:',
  '  - link "项目集" [ref=e30]',
].join('\n');

describe('extractSnapshotRefs', () => {
  it('extracts all bracketed refs from an aria snapshot', () => {
    const refs = extractSnapshotRefs(SNAPSHOT);
    expect(refs).toContain('e1');
    expect(refs).toContain('e20');
    expect(refs).toContain('e21');
    expect(refs).toContain('e22');
    expect(refs).toContain('e30');
    expect(refs).toHaveLength(5);
  });

  it('returns empty for a snapshot without refs', () => {
    expect(extractSnapshotRefs('- heading "plain"')).toEqual([]);
  });

  it('deduplicates repeated refs', () => {
    const text = '- button "a" [ref=e1]\n- button "b" [ref=e1]';
    expect(extractSnapshotRefs(text)).toEqual(['e1']);
  });
});

describe('updateWorkflowContext records currentSnapshotRefs', () => {
  it('updates refs on browser_snapshot success', () => {
    let ctx = createInitialContext(10, 'http://x');
    ctx = updateWorkflowContext(
      ctx, 'browser_snapshot', {}, true,
      { text: SNAPSHOT },
      WorkflowState.NAVIGATE
    );
    expect(ctx.currentSnapshotRefs).toContain('e22');
    expect(ctx.lastRawSnapshot).toBe(SNAPSHOT);
  });

  it('keeps previous refs when a non-snapshot tool runs', () => {
    let ctx = createInitialContext(10, 'http://x');
    ctx = updateWorkflowContext(
      ctx, 'browser_snapshot', {}, true,
      { text: SNAPSHOT },
      WorkflowState.NAVIGATE
    );
    ctx = updateWorkflowContext(
      ctx, 'browser_click', { target: 'e22', element: '登录' }, true,
      undefined,
      WorkflowState.TEST
    );
    expect(ctx.currentSnapshotRefs).toContain('e22');
  });
});

describe('alignment verdict logic (mirrors loop.ts [ALIGN] block)', () => {
  const snapshotRefs = extractSnapshotRefs(SNAPSHOT);

  function verdict(targetFeatureRef: string | undefined, actionRef: string): string {
    const actionRefInSnapshot = !actionRef || snapshotRefs.includes(actionRef);
    const refConsistent = !targetFeatureRef || !actionRef || targetFeatureRef === actionRef;
    if (targetFeatureRef && actionRef && !refConsistent && actionRefInSnapshot) {
      return 'ref_drift';
    } else if (actionRef && !actionRefInSnapshot) {
      return 'ref_unknown';
    } else if (!actionRef) {
      return 'no_ref';
    }
    return 'resolver_miss';
  }

  it('ref_drift: feature ref stale (e10), action ref current (e22)', () => {
    expect(verdict('e10', 'e22')).toBe('ref_drift');
  });

  it('ref_unknown: action ref (e99) not in current snapshot', () => {
    expect(verdict(undefined, 'e99')).toBe('ref_unknown');
    expect(verdict('e10', 'e99')).toBe('ref_unknown'); // unknown wins over drift
  });

  it('no_ref: action carried no ref', () => {
    expect(verdict('e10', '')).toBe('no_ref');
  });

  it('resolver_miss: refs consistent but resolver failed', () => {
    expect(verdict('e22', 'e22')).toBe('resolver_miss');
  });
});
