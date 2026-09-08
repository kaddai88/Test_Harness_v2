/**
 * Regression tests for the Intent Model refactoring.
 *
 * Core separation of concerns:
 *   Intent role  — why this feature matters in THIS test session
 *                  (primary / prerequisite / supporting / incidental / irrelevant)
 *   Priority     — intrinsic business importance of the feature in general
 *   Scope        — which roles + priorities each test type requires
 *   Selection    — layered: role first, then priority (never additive luck)
 */
import { describe, it, expect } from 'vitest';
import {
  createCoverageModel,
  registerModule,
  registerSurface,
  registerFeature,
  updateScenario,
  markScenarioSkipped,
  extractTestIntent,
  assignIntentRoles,
  getCoverageGaps,
  selectNextTarget,
  shouldFinishTesting,
  isFeatureInScope,
  getRoleOrder,
  COVERAGE_POLICIES,
  type CoverageModel,
} from './coverage.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Model simulating the Zentao scenario:
 * instruction = "使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试"
 *
 * Discovered features include:
 *   - 项目集相关 (primary)
 *   - 登录表单   (prerequisite)
 *   - 普通按钮/输入框 (supporting)
 *   - 导航链接   (incidental)
 *   - 帮助中心   (irrelevant)
 */
function makeZentaoModel(instructions?: string): CoverageModel {
  const model = createCoverageModel();
  const mod = registerModule(model, 'mod_1', 'Zentao');
  const surface = registerSurface(model, 'mod_1', 'surface_1', 'https://zentao.example.com', '项目集列表');
  registerFeature(surface, 'feat_program_create', '创建项目集', 'button');
  registerFeature(surface, 'feat_program_edit', '编辑项目集', 'button');
  registerFeature(surface, 'feat_program_name', '项目集名称', 'text-input');
  registerFeature(surface, 'feat_login', '登录', 'button');
  registerFeature(surface, 'feat_search', '搜索', 'search');
  registerFeature(surface, 'feat_nav', '首页链接', 'link');
  registerFeature(surface, 'feat_help', '帮助中心', 'link');
  model.currentSurfaceKey = 'surface_1';

  assignIntentRoles(model, instructions);
  return model;
}

// ─── extractTestIntent ───────────────────────────────────────────────────────

describe('extractTestIntent', () => {
  it('extracts module + prerequisite + actions from the Zentao instruction', () => {
    const intent = extractTestIntent(
      '使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试'
    );
    expect(intent).toBeDefined();
    expect(intent!.prerequisites).toContain('登录');
    expect(intent!.primaryModules.join(' ')).toContain('项目集');
  });

  it('detects CRUD action verbs', () => {
    const intent = extractTestIntent('测试项目集的创建和删除功能');
    expect(intent).toBeDefined();
    expect(intent!.requiredActions).toContain('create');
    expect(intent!.requiredActions).toContain('delete');
  });

  it('returns undefined for empty instructions', () => {
    expect(extractTestIntent(undefined)).toBeUndefined();
    expect(extractTestIntent('')).toBeUndefined();
  });

  it('does not treat structural words as modules', () => {
    const intent = extractTestIntent('测试系统功能');
    if (intent) {
      expect(intent.primaryModules).not.toContain('系统');
      expect(intent.primaryModules).not.toContain('功能');
    }
  });
});

// ─── assignIntentRoles ───────────────────────────────────────────────────────

describe('assignIntentRoles', () => {
  it('assigns primary to 项目集 features, prerequisite to 登录', () => {
    const model = makeZentaoModel(
      '使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试'
    );
    const features = model.modules[0]!.surfaces[0]!.features;
    const byKey = (k: string) => features.find(f => f.key === k)!;

    expect(byKey('feat_program_create').intentRelevance?.role).toBe('primary');
    expect(byKey('feat_program_edit').intentRelevance?.role).toBe('primary');
    expect(byKey('feat_program_name').intentRelevance?.role).toBe('primary');
    expect(byKey('feat_login').intentRelevance?.role).toBe('prerequisite');
  });

  it('assigns incidental to navigation, irrelevant to help', () => {
    const model = makeZentaoModel(
      '使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试'
    );
    const features = model.modules[0]!.surfaces[0]!.features;
    const byKey = (k: string) => features.find(f => f.key === k)!;

    expect(byKey('feat_nav').intentRelevance?.role).toBe('incidental');
    expect(byKey('feat_help').intentRelevance?.role).toBe('irrelevant');
  });

  it('assigns primary to business features on the primary surface', () => {
    const model = makeZentaoModel(
      '使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试'
    );
    const features = model.modules[0]!.surfaces[0]!.features;
    expect(features.find(f => f.key === 'feat_search')!.intentRelevance?.role).toBe('primary');
  });

  it('defaults everything to incidental when no instructions', () => {
    const model = makeZentaoModel(undefined);
    const features = model.modules[0]!.surfaces[0]!.features;
    for (const f of features) {
      expect(f.intentRelevance?.role).toBe('incidental');
    }
  });
});

// ─── Scope semantics (new: intent / core / comprehensive / all) ──────────────

describe('Scope semantics', () => {
  const INSTR = '使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试';

  it("smoke scope 'intent': only primary + prerequisite", () => {
    const model = makeZentaoModel(INSTR);
    const policy = COVERAGE_POLICIES.smoke; // scope: intent
    const mod = model.modules[0]!;
    const surface = mod.surfaces[0]!;
    const byKey = (k: string) => surface.features.find(f => f.key === k)!;

    expect(isFeatureInScope(mod, surface, byKey('feat_program_create'), policy)).toBe(true);
    expect(isFeatureInScope(mod, surface, byKey('feat_login'), policy)).toBe(true);
    expect(isFeatureInScope(mod, surface, byKey('feat_search'), policy)).toBe(true);
    expect(isFeatureInScope(mod, surface, byKey('feat_nav'), policy)).toBe(false);
    expect(isFeatureInScope(mod, surface, byKey('feat_help'), policy)).toBe(false);
  });

  it("confirmation scope 'core': primary + prerequisite + critical", () => {
    const model = makeZentaoModel(INSTR);
    const policy = { ...COVERAGE_POLICIES.confirmation }; // scope: core
    const mod = model.modules[0]!;
    const surface = mod.surfaces[0]!;
    const search = surface.features.find(f => f.key === 'feat_search')!;

    // Explicitly model a supporting feature (not primary) with normal intrinsic priority
    search.intentRelevance = {
      role: 'supporting', score: 0.5, confidence: 0.6, source: 'user', reason: 'fixture',
    };
    expect(isFeatureInScope(mod, surface, search, policy)).toBe(false);

    // upgrade to critical intrinsic → now in core scope
    search.priority = { level: 'critical', source: 'system' };
    expect(isFeatureInScope(mod, surface, search, policy)).toBe(true);
  });

  it("acceptance scope 'comprehensive': all business features minus incidental/irrelevant", () => {
    const model = makeZentaoModel(INSTR);
    const policy = COVERAGE_POLICIES.acceptance; // scope: comprehensive
    const mod = model.modules[0]!;
    const surface = mod.surfaces[0]!;
    const byKey = (k: string) => surface.features.find(f => f.key === k)!;

    expect(isFeatureInScope(mod, surface, byKey('feat_program_create'), policy)).toBe(true);
    expect(isFeatureInScope(mod, surface, byKey('feat_login'), policy)).toBe(true);
    expect(isFeatureInScope(mod, surface, byKey('feat_search'), policy)).toBe(true);
    // incidental/irrelevant still excluded — coverage quality, not a count metric
    expect(isFeatureInScope(mod, surface, byKey('feat_nav'), policy)).toBe(false);
    expect(isFeatureInScope(mod, surface, byKey('feat_help'), policy)).toBe(false);
  });

  it("full scope 'all': everything", () => {
    const model = makeZentaoModel(INSTR);
    const policy = COVERAGE_POLICIES.full;
    const mod = model.modules[0]!;
    const surface = mod.surfaces[0]!;
    const byKey = (k: string) => surface.features.find(f => f.key === k)!;

    for (const key of ['feat_program_create', 'feat_login', 'feat_search', 'feat_nav', 'feat_help']) {
      expect(isFeatureInScope(mod, surface, byKey(key), policy)).toBe(true);
    }
  });

  it('acceptance covers the large majority of business features (not a fixed %)', () => {
    const model = makeZentaoModel(INSTR);
    const policy = COVERAGE_POLICIES.acceptance;
    const surface = model.modules[0]!.surfaces[0]!;
    const inScope = surface.features.filter(f => isFeatureInScope(
      model.modules[0]!, surface, f, policy
    ));
    // 5 of 7 business features in scope (nav + help excluded) = 71% here;
    // the point is structural exclusion, not an arbitrary threshold
    expect(inScope.length).toBe(5);
  });
});

// ─── Layered target selection: role beats priority beats scenario ────────────

describe('Layered target selection', () => {
  const INSTR = '使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试';

  it('primary target ALWAYS outranks prerequisite, regardless of priority', () => {
    const model = makeZentaoModel(INSTR);
    const policy = COVERAGE_POLICIES.smoke;
    const surface = model.modules[0]!.surfaces[0]!;

    // Give login CRITICAL intrinsic priority — still must not beat primary
    surface.features.find(f => f.key === 'feat_login')!.priority = {
      level: 'critical', source: 'system',
    };

    const target = selectNextTarget(model, policy, INSTR);
    expect(target).not.toBeNull();
    expect(target!.featureKey).toBe('feat_program_create'); // primary wins
  });

  it('prerequisite outranks supporting after primary targets are done', () => {
    const model = makeZentaoModel(INSTR);
    const policy = COVERAGE_POLICIES.smoke;
    const surface = model.modules[0]!.surfaces[0]!;

    // Complete all primary targets
    for (const f of surface.features) {
      if (f.intentRelevance?.role === 'primary') {
        updateScenario(f, 'normal', 'pass');
      }
    }

    const target = selectNextTarget(model, policy, INSTR);
    expect(target).not.toBeNull();
    expect(target!.featureKey).toBe('feat_login');
  });

  it('skipped targets are never re-selected', () => {
    const model = makeZentaoModel(INSTR);
    const policy = COVERAGE_POLICIES.smoke;
    const surface = model.modules[0]!.surfaces[0]!;

    const target = selectNextTarget(model, policy, INSTR, [
      'feat_program_create', 'feat_program_edit', 'feat_program_name', 'feat_search',
    ]);
    expect(target).not.toBeNull();
    expect(target!.featureKey).toBe('feat_login');
  });

  it('smoke exits after primary + prerequisite are covered — no link traversal', () => {
    const model = makeZentaoModel(INSTR);
    const policy = COVERAGE_POLICIES.smoke;
    const surface = model.modules[0]!.surfaces[0]!;

    // Test primary + prerequisite
    for (const f of surface.features) {
      if (f.intentRelevance?.role === 'primary' || f.intentRelevance?.role === 'prerequisite') {
        updateScenario(f, 'normal', 'pass');
      }
    }
    model.discovery.stableTurns = policy.discovery.stableTurnsBeforeFinish;

    // Gaps must be empty (supporting/incidental/irrelevant excluded by scope)
    const gaps = getCoverageGaps(model, policy, INSTR);
    expect(gaps).toHaveLength(0);

    const finish = shouldFinishTesting(model, policy, { turnsUsed: 8 });
    expect(finish.shouldFinish).toBe(true);
    expect(finish.reason).toBe('coverage_target_met');
  });
});

// ─── Honest skipped coverage still works ─────────────────────────────────────

describe('skipped coverage (preserved from Iteration 2)', () => {
  it('skipped removes the scenario from gaps under new scope model', () => {
    const model = makeZentaoModel(
      '使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试'
    );
    const policy = { ...COVERAGE_POLICIES.acceptance }; // comprehensive scope
    const surface = model.modules[0]!.surfaces[0]!;
    const search = surface.features.find(f => f.key === 'feat_search')!;

    // supporting is in comprehensive scope → gap exists
    let gaps = getCoverageGaps(model, policy);
    expect(gaps.some(g => g.featureKey === 'feat_search')).toBe(true);

    markScenarioSkipped(search, 'normal', 'stagnation after 3 unmatched turns');

    gaps = getCoverageGaps(model, policy);
    // normal scenario no longer a gap; validation/boundary still are (honest:
    // only the skipped scenario is removed)
    expect(gaps.some(g => g.featureKey === 'feat_search' && g.scenarioType === 'normal')).toBe(false);
    expect(search.scenarios['normal'].outcome).toBe('skipped');

    // Skip remaining scenarios too → feature fully out of gaps
    markScenarioSkipped(search, 'validation', 'stagnation');
    markScenarioSkipped(search, 'boundary', 'stagnation');
    gaps = getCoverageGaps(model, policy);
    expect(gaps.some(g => g.featureKey === 'feat_search')).toBe(false);
  });
});

// ─── Role ordering sanity ────────────────────────────────────────────────────

describe('role ordering', () => {
  it('primary > prerequisite > supporting > incidental > irrelevant', () => {
    expect(getRoleOrder('primary')).toBeGreaterThan(getRoleOrder('prerequisite'));
    expect(getRoleOrder('prerequisite')).toBeGreaterThan(getRoleOrder('supporting'));
    expect(getRoleOrder('supporting')).toBeGreaterThan(getRoleOrder('incidental'));
    expect(getRoleOrder('incidental')).toBeGreaterThan(getRoleOrder('irrelevant'));
  });
});
