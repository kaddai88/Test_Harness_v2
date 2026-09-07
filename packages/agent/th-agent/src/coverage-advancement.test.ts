/**
 * Regression tests for coverage completion → target advancement.
 *
 * P1-C: When a scenario is marked as 'tested', it must be excluded
 * from coverage gaps, and selectNextTarget() must advance to the next target.
 *
 * Cases:
 *   1. completed normal scenario → feature not in coverage gaps
 *   2. completed feature → selectNextTarget() does not return it
 *   3. A completed + B uncovered → selectNextTarget() must return B
 *   4. currentTarget A + action matches B → A unchanged, B completed → next = C
 */
import { describe, it, expect } from 'vitest';
import {
  createCoverageModel,
  registerModule,
  registerSurface,
  registerFeature,
  updateScenario,
  getCoverageGaps,
  selectNextTarget,
  COVERAGE_POLICIES,
  type CoverageModel,
  type CoverageTarget,
} from './coverage.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SMOKE_POLICY = COVERAGE_POLICIES.smoke;

function makeModel(): CoverageModel {
  const model = createCoverageModel();
  registerModule(model, 'mod_1', 'Test Module');
  const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://example.com', 'Page');
  registerFeature(surface, 'feat_a', 'Feature A', 'text-input');
  registerFeature(surface, 'feat_b', 'Feature B', 'button');
  registerFeature(surface, 'feat_c', 'Feature C', 'link');
  model.currentSurfaceKey = 'surface_1';
  return model;
}

function getTarget(model: CoverageModel, featureKey: string, scenarioType: 'normal' = 'normal'): CoverageTarget {
  return {
    surfaceKey: 'surface_1',
    featureKey,
    scenarioType,
    priority: { level: 'normal', source: 'system' },
  };
}

// ─── Case 1: completed scenario → excluded from gaps ────────────────────────

describe('Coverage completion → gap exclusion', () => {
  it('excludes a tested normal scenario from coverage gaps', () => {
    const model = makeModel();
    const surface = model.modules[0]!.surfaces[0]!;
    const featA = surface.features.find(f => f.key === 'feat_a')!;

    // Before: feat_a/normal should be in gaps
    const gapsBefore = getCoverageGaps(model, SMOKE_POLICY);
    expect(gapsBefore.some(g => g.featureKey === 'feat_a' && g.scenarioType === 'normal')).toBe(true);

    // Mark feat_a/normal as tested
    updateScenario(featA, 'normal', 'pass', {
      action: 'browser_type',
      result: 'pass',
      turn: 1,
      timestamp: Date.now(),
    });

    // After: feat_a/normal should NOT be in gaps
    const gapsAfter = getCoverageGaps(model, SMOKE_POLICY);
    expect(gapsAfter.some(g => g.featureKey === 'feat_a' && g.scenarioType === 'normal')).toBe(false);
  });

  it('feature with all required scenarios tested disappears from gaps entirely', () => {
    const model = makeModel();
    const surface = model.modules[0]!.surfaces[0]!;
    const featA = surface.features.find(f => f.key === 'feat_a')!;

    // Mark all applicable scenarios as tested
    for (const [type, cov] of Object.entries(featA.scenarios)) {
      if (cov.status !== 'not_applicable') {
        updateScenario(featA, type as any, 'pass');
      }
    }

    const gaps = getCoverageGaps(model, SMOKE_POLICY);
    expect(gaps.some(g => g.featureKey === 'feat_a')).toBe(false);
  });
});

// ─── Case 2: completed feature → selectNextTarget() skips it ────────────────

describe('selectNextTarget() skips completed', () => {
  it('does not return a feature whose normal scenario is tested', () => {
    const model = makeModel();
    const surface = model.modules[0]!.surfaces[0]!;
    const featA = surface.features.find(f => f.key === 'feat_a')!;

    updateScenario(featA, 'normal', 'pass');

    const target = selectNextTarget(model, SMOKE_POLICY);
    expect(target).not.toBeNull();
    expect(target!.featureKey).not.toBe('feat_a');
  });
});

// ─── Case 3: A completed + B uncovered → returns B ──────────────────────────

describe('selectNextTarget() advances to next uncovered', () => {
  it('returns B when A is completed and B is uncovered', () => {
    const model = makeModel();
    const surface = model.modules[0]!.surfaces[0]!;
    const featA = surface.features.find(f => f.key === 'feat_a')!;

    // Complete A
    updateScenario(featA, 'normal', 'pass');

    const target = selectNextTarget(model, SMOKE_POLICY);
    expect(target).not.toBeNull();
    // Must be B or C (both uncovered), NOT A
    expect(['feat_b', 'feat_c']).toContain(target!.featureKey);
  });

  it('returns C when A and B are completed', () => {
    const model = makeModel();
    const surface = model.modules[0]!.surfaces[0]!;
    const featA = surface.features.find(f => f.key === 'feat_a')!;
    const featB = surface.features.find(f => f.key === 'feat_b')!;

    updateScenario(featA, 'normal', 'pass');
    updateScenario(featB, 'normal', 'pass');

    const target = selectNextTarget(model, SMOKE_POLICY);
    expect(target).not.toBeNull();
    expect(target!.featureKey).toBe('feat_c');
  });

  it('returns null when all features are completed', () => {
    const model = makeModel();
    const surface = model.modules[0]!.surfaces[0]!;

    for (const feat of surface.features) {
      for (const [type, cov] of Object.entries(feat.scenarios)) {
        if (cov.status !== 'not_applicable') {
          updateScenario(feat, type as any, 'pass');
        }
      }
    }

    const target = selectNextTarget(model, SMOKE_POLICY);
    expect(target).toBeNull();
  });
});

// ─── Case 4: action on B while target is A → A stays, B advances ────────────

describe('currentTarget preservation', () => {
  it('updating B does not change A — A remains in gaps', () => {
    const model = makeModel();
    const surface = model.modules[0]!.surfaces[0]!;
    const featA = surface.features.find(f => f.key === 'feat_a')!;
    const featB = surface.features.find(f => f.key === 'feat_b')!;

    // Update B (simulating: LLM was targeting A but action matched B)
    updateScenario(featB, 'normal', 'pass');

    // A should still be in gaps
    const gaps = getCoverageGaps(model, SMOKE_POLICY);
    expect(gaps.some(g => g.featureKey === 'feat_a')).toBe(true);

    // B should NOT be in gaps
    expect(gaps.some(g => g.featureKey === 'feat_b')).toBe(false);

    // selectNextTarget should return A (still uncovered, first available)
    const target = selectNextTarget(model, SMOKE_POLICY);
    expect(target).not.toBeNull();
    expect(target!.featureKey).toBe('feat_a');
  });

  it('after B completed then A completed → next target is C', () => {
    const model = makeModel();
    const surface = model.modules[0]!.surfaces[0]!;
    const featA = surface.features.find(f => f.key === 'feat_a')!;
    const featB = surface.features.find(f => f.key === 'feat_b')!;

    // First: B completed (by action that matched B while target was A)
    updateScenario(featB, 'normal', 'pass');
    let target = selectNextTarget(model, SMOKE_POLICY);
    expect(target!.featureKey).toBe('feat_a');

    // Then: A completed (by action that finally matched A)
    updateScenario(featA, 'normal', 'pass');
    target = selectNextTarget(model, SMOKE_POLICY);
    expect(target!.featureKey).toBe('feat_c');
  });
});
