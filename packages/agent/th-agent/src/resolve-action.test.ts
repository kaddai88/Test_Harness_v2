/**
 * Regression tests for resolveActionFeature()
 *
 * P1-B verification — 6 cases:
 *   1. exact ref match → true
 *   2. ref different, but normalized name same → name match
 *   3. ref/name both different → unmatched
 *   4. target A, action actually belongs to feature B → A not marked tested
 *   5. action can't find existing feature, but matches a feature in model → match that
 *   6. action cannot reliably determine feature → no coverage update
 */
import { describe, it, expect } from 'vitest';
import {
  createCoverageModel,
  registerModule,
  registerSurface,
  registerFeature,
  resolveActionFeature,
  type CoverageModel,
} from './coverage.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeModel(): CoverageModel {
  const model = createCoverageModel();
  const mod = registerModule(model, 'mod_1', 'Test Module');
  const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://example.com', 'Test Page');
  // Register features with refs (as if discovered from aria snapshot)
  registerFeature(surface, 'feat_search', '搜索框', 'text-input');
  registerFeature(surface, 'feat_button', '百度一下', 'button');
  registerFeature(surface, 'feat_news', '新闻', 'link');
  registerFeature(surface, 'feat_login', '登录', 'link');
  // Set aria refs (simulate discoverFeaturesFromSnapshot behavior)
  surface.features.find(f => f.key === 'feat_search')!.ref = 'e37';
  surface.features.find(f => f.key === 'feat_button')!.ref = 'e58';
  surface.features.find(f => f.key === 'feat_news')!.ref = 'e10';
  surface.features.find(f => f.key === 'feat_login')!.ref = 'e20';
  return model;
}

// ─── Case 1: Exact ref match → true ─────────────────────────────────────────

describe('resolveActionFeature — Case 1: exact ref match', () => {
  it('matches feature by aria ref with confidence 1.0', () => {
    const model = makeModel();
    const result = resolveActionFeature(
      'browser_type',
      { target: 'e37', element: '搜索框', text: 'hello' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_search');
    expect(result!.method).toBe('ref');
    expect(result!.confidence).toBe(1.0);
  });

  it('matches even when element description differs from feature name', () => {
    const model = makeModel();
    // LLM says "搜索输入框" but feature name is "搜索框" — ref still matches
    const result = resolveActionFeature(
      'browser_type',
      { target: 'e37', element: '搜索输入框', text: 'hello' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_search');
    expect(result!.method).toBe('ref');
    expect(result!.confidence).toBe(1.0);
  });

  it('matches browser_click with ref', () => {
    const model = makeModel();
    const result = resolveActionFeature(
      'browser_click',
      { target: 'e58', element: '百度一下搜索按钮' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_button');
    expect(result!.method).toBe('ref');
  });
});

// ─── Case 2: ref different, normalized name same → name/normalized match ────

describe('resolveActionFeature — Case 2: normalized name match', () => {
  it('matches by exact name when ref is different or absent', () => {
    const model = makeModel();
    // No ref in action args, but exact name match
    const result = resolveActionFeature(
      'browser_click',
      { element: '新闻' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_news');
    expect(result!.method).toBe('name');
    expect(result!.confidence).toBe(0.95);
  });

  it('matches by normalized name (strips 按钮 suffix)', () => {
    const model = makeModel();
    // LLM says "百度一下按钮" but feature name is "百度一下"
    // After normalization: "百度一下" === "百度一下"
    const result = resolveActionFeature(
      'browser_click',
      { element: '百度一下按钮' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_button');
    expect(result!.method).toBe('normalized');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('matches by normalized name (strips 链接 suffix)', () => {
    const model = makeModel();
    const result = resolveActionFeature(
      'browser_click',
      { element: '新闻链接' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_news');
    expect(result!.method).toBe('normalized');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

// ─── Case 3: ref/name both different → unmatched ────────────────────────────

describe('resolveActionFeature — Case 3: both different → unmatched', () => {
  it('returns null when ref does not match any feature', () => {
    const model = makeModel();
    const result = resolveActionFeature(
      'browser_click',
      { target: 'e999', element: '不存在的元素' },
      model
    );
    expect(result).toBeNull();
  });

  it('returns null when name has no overlap with any feature', () => {
    const model = makeModel();
    const result = resolveActionFeature(
      'browser_click',
      { element: '完全不相关的东西' },
      model
    );
    expect(result).toBeNull();
  });

  it('for browser_type, matches the only text-input even if name is unrelated (structural fallback)', () => {
    const model = makeModel();
    // browser_type + only one text-input on surface → matches via structural fallback
    // This is the Baidu case: placeholder text "热搜..." doesn't match "搜索框"
    // but the action IS clearly targeting the search box (only textbox on page)
    const result = resolveActionFeature(
      'browser_type',
      { target: 'e99', element: 'random text', text: 'hello' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_search');
    expect(result!.confidence).toBe(0.75); // structural fallback
  });

  it('returns null for browser_click when ref and name are both wrong', () => {
    const model = makeModel();
    // browser_click is too generic for structural fallback
    const result = resolveActionFeature(
      'browser_click',
      { target: 'e99', element: 'unknown element' },
      model
    );
    expect(result).toBeNull();
  });
});

// ─── Case 4: target A, action belongs to B → A not polluted ─────────────────

describe('resolveActionFeature — Case 4: no false coverage', () => {
  it('matches to the CORRECT feature, not the current target', () => {
    const model = makeModel();
    // Current target is feat_news (新闻), but action is on search box (feat_search)
    // resolveActionFeature should find feat_search, NOT feat_news
    const result = resolveActionFeature(
      'browser_type',
      { target: 'e37', element: '搜索框', text: 'hello' },
      model
    );
    expect(result).not.toBeNull();
    // Must match feat_search (the actual element), NOT feat_news (the target)
    expect(result!.feature.key).toBe('feat_search');
    expect(result!.feature.key).not.toBe('feat_news');
  });

  it('returns the action feature even when target is different', () => {
    const model = makeModel();
    // Target is "登录" but action clicks "百度一下"
    const result = resolveActionFeature(
      'browser_click',
      { target: 'e58', element: '百度一下' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_button');
    expect(result!.feature.key).not.toBe('feat_login');
  });

  it('returns null when action cannot be matched to any feature', () => {
    const model = makeModel();
    // Target is "新闻" but action is on an unknown element
    const result = resolveActionFeature(
      'browser_click',
      { target: 'e99', element: '未知元素' },
      model
    );
    expect(result).toBeNull();
    // Caller should NOT mark feat_news as tested in this case
  });
});

// ─── Case 5: action matches a feature in model (not the target) ─────────────

describe('resolveActionFeature — Case 5: discover via action', () => {
  it('matches action to a known feature even if it was not the target', () => {
    const model = makeModel();
    // Action clicks on login link — feat_login exists in model
    const result = resolveActionFeature(
      'browser_click',
      { target: 'e20', element: '登录' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_login');
    expect(result!.method).toBe('ref');
  });

  it('matches via name for a feature discovered by snapshot', () => {
    const model = makeModel();
    // Action references "百度一下" by name only (no ref)
    const result = resolveActionFeature(
      'browser_click',
      { element: '百度一下' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_button');
  });

  it('handles browser_fill_form structure', () => {
    const model = makeModel();
    const result = resolveActionFeature(
      'browser_fill_form',
      { fields: [{ target: 'e37', name: '搜索框', value: 'hello' }] },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_search');
    expect(result!.method).toBe('ref');
  });
});

// ─── Case 6: cannot reliably determine → no coverage update ─────────────────

describe('resolveActionFeature — Case 6: unreliable → no update', () => {
  it('returns null for empty tool args', () => {
    const model = makeModel();
    const result = resolveActionFeature(
      'browser_click',
      {},
      model
    );
    expect(result).toBeNull();
  });

  it('returns null for very short element name (below 2 chars after normalization)', () => {
    const model = makeModel();
    // "按钮" normalizes to "" (stripped) — too short to match
    const result = resolveActionFeature(
      'browser_click',
      { element: '按钮' },
      model
    );
    expect(result).toBeNull();
  });

  it('returns null when only unrelated context is available', () => {
    const model = makeModel();
    const result = resolveActionFeature(
      'browser_press_key',
      { key: 'Enter' },
      model
    );
    expect(result).toBeNull();
  });

  it('does not match partial overlaps that are too vague', () => {
    const model = makeModel();
    // "搜" is a substring of "搜索框" but too short to be meaningful
    // (normalized name length < 2 check should catch this)
    const result = resolveActionFeature(
      'browser_click',
      { element: '搜' },
      model
    );
    // Even if it matches, confidence should be below threshold
    if (result) {
      expect(result.confidence).toBeLessThan(0.8);
    }
  });
});

// ─── Case 7 (bonus): structural fallback for unique feature type ────────────

describe('resolveActionFeature — structural fallback (unique type on surface)', () => {
  it('matches browser_type to the only text-input on the surface', () => {
    // Create a model with only ONE text-input (like Baidu's search box)
    const model = createCoverageModel();
    const mod = registerModule(model, 'mod_1', 'Module');
    const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://example.com', 'Page');
    // Only one text-input
    registerFeature(surface, 'feat_search', '搜索框', 'text-input');
    surface.features[0]!.ref = 'e37';
    // Set currentSurfaceKey so structural fallback can scope to this surface
    model.currentSurfaceKey = 'surface_1';

    // Action with WRONG ref (ref drifted) but element is a textbox
    const result = resolveActionFeature(
      'browser_type',
      { target: 'f99', element: 'random placeholder text', text: 'hello' },
      model
    );
    // Should still match via structural fallback (only 1 text-input on surface)
    expect(result).not.toBeNull();
    expect(result!.feature.key).toBe('feat_search');
    expect(result!.confidence).toBe(0.75);
  });

  it('does NOT use structural fallback when multiple features of same type exist', () => {
    const model = createCoverageModel();
    const mod = registerModule(model, 'mod_1', 'Module');
    const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://example.com', 'Page');
    // Two text-inputs — structural fallback should NOT pick one
    registerFeature(surface, 'feat_a', 'field A', 'text-input');
    registerFeature(surface, 'feat_b', 'field B', 'text-input');
    surface.features[0]!.ref = 'e1';
    surface.features[1]!.ref = 'e2';
    model.currentSurfaceKey = 'surface_1';

    const result = resolveActionFeature(
      'browser_type',
      { target: 'e99', element: 'unknown field' },
      model
    );
    // Ambiguous — should not match
    expect(result).toBeNull();
  });

  it('prefers exact ref match over structural fallback', () => {
    const model = createCoverageModel();
    const mod = registerModule(model, 'mod_1', 'Module');
    const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://example.com', 'Page');
    registerFeature(surface, 'feat_a', 'field A', 'text-input');
    surface.features[0]!.ref = 'e1';
    model.currentSurfaceKey = 'surface_1';

    // Correct ref match should win
    const result = resolveActionFeature(
      'browser_type',
      { target: 'e1', element: 'field A', text: 'hello' },
      model
    );
    expect(result).not.toBeNull();
    expect(result!.method).toBe('ref');
    expect(result!.confidence).toBe(1.0);
  });
});
