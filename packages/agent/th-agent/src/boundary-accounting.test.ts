/**
 * Regression tests for Iteration 2 ④: NAVIGATE boundary accounting.
 *
 * Scenario: the click that triggered NAVIGATE→TEST happens BEFORE the
 * coverage model exists. The action is buffered in pendingActions and
 * replayed through resolveActionFeature() after initialization.
 *
 * These tests verify the replay semantics:
 *   - a buffered action that matches a discovered feature records coverage
 *   - a buffered action that matches nothing is dropped (no false coverage)
 *   - replay never marks scenarios the action didn't actually target
 */
import { describe, it, expect } from 'vitest';
import {
  createCoverageModel,
  registerModule,
  registerSurface,
  registerFeature,
  updateScenario,
  resolveActionFeature,
  type CoverageModel,
  type CoverageFeature,
} from './coverage.js';

// Simulates the replay block in loop.ts coverage initialization
function replayPendingAction(
  model: CoverageModel,
  pa: { toolName: string; toolArgs: Record<string, unknown>; success: boolean; turn: number }
): CoverageFeature | null {
  if (!pa.success) return null;
  const match = resolveActionFeature(pa.toolName, pa.toolArgs, model);
  if (!match) return null;

  for (const mod of model.modules) {
    for (const surf of mod.surfaces) {
      const feat = surf.features.find(f => f.key === match.feature.key);
      if (feat) {
        updateScenario(feat, 'normal', 'pass', {
          action: pa.toolName,
          result: 'pass',
          turn: pa.turn,
          timestamp: Date.now(),
        });
        return feat;
      }
    }
  }
  return null;
}

describe('④ NAVIGATE boundary accounting', () => {
  it('boundary click that reached the target page gets recorded after replay', () => {
    // Pre-init: agent clicks "项目管理" menu item in NAVIGATE state
    const pendingAction = {
      toolName: 'browser_click',
      toolArgs: { target: 'e12', element: '项目管理菜单' },
      success: true,
      turn: 3,
    };

    // Post-init: coverage model now has features discovered from the new page
    const model = createCoverageModel();
    const mod = registerModule(model, 'mod_1', 'PM');
    const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://example.com/projects', '项目管理');
    registerFeature(surface, 'feat_nav', '项目管理菜单', 'link');
    surface.features[0]!.ref = 'e12'; // same ref as the boundary action

    const recorded = replayPendingAction(model, pendingAction);

    expect(recorded).not.toBeNull();
    expect(recorded!.key).toBe('feat_nav');
    expect(recorded!.scenarios['normal'].status).toBe('tested');
    expect(recorded!.scenarios['normal'].outcome).toBe('pass');
    // Evidence carries the original turn number
    expect(recorded!.scenarios['normal'].evidence?.[0]?.turn).toBe(3);
  });

  it('boundary action that matches nothing is dropped (no false coverage)', () => {
    const pendingAction = {
      toolName: 'browser_click',
      toolArgs: { target: 'e99', element: '完全无关的东西' },
      success: true,
      turn: 2,
    };

    const model = createCoverageModel();
    const mod = registerModule(model, 'mod_1', 'PM');
    const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://example.com/projects', 'Page');
    registerFeature(surface, 'feat_a', '项目管理', 'link');
    surface.features[0]!.ref = 'e12';

    const recorded = replayPendingAction(model, pendingAction);

    expect(recorded).toBeNull();
    // No feature was marked tested
    const all = model.modules[0]!.surfaces[0]!.features;
    expect(all.every(f => f.scenarios['normal'].status !== 'tested')).toBe(true);
  });

  it('failed boundary action is not replayed', () => {
    const pendingAction = {
      toolName: 'browser_click',
      toolArgs: { target: 'e12', element: '项目管理菜单' },
      success: false,
      turn: 2,
    };

    const model = createCoverageModel();
    const mod = registerModule(model, 'mod_1', 'PM');
    const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://example.com/projects', 'Page');
    registerFeature(surface, 'feat_nav', '项目管理菜单', 'link');
    surface.features[0]!.ref = 'e12';

    const recorded = replayPendingAction(model, pendingAction);
    expect(recorded).toBeNull();
    expect(model.modules[0]!.surfaces[0]!.features[0]!.scenarios['normal'].status).toBe('not_tested');
  });

  it('boundary action updates the MATCHED feature, not an arbitrary one', () => {
    const pendingAction = {
      toolName: 'browser_click',
      toolArgs: { target: 'e20', element: '设置按钮' },
      success: true,
      turn: 4,
    };

    const model = createCoverageModel();
    const mod = registerModule(model, 'mod_1', 'PM');
    const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://example.com/settings', '设置');
    registerFeature(surface, 'feat_settings', '设置按钮', 'button');
    registerFeature(surface, 'feat_other', '其他链接', 'link');
    surface.features[0]!.ref = 'e20';
    surface.features[1]!.ref = 'e21';

    const recorded = replayPendingAction(model, pendingAction);

    expect(recorded!.key).toBe('feat_settings');
    expect(model.modules[0]!.surfaces[0]!.features.find(f => f.key === 'feat_other')!.scenarios['normal'].status).toBe('not_tested');
  });
});
