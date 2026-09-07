/**
 * Coverage Engine - Deterministic Coverage Model Management
 *
 * Core principle: Coverage Model decides "what to test next",
 * Planner decides "how to test it".
 *
 * Architecture:
 *   CoverageModel  → "What's missing?"
 *   CoveragePolicy → "Is it enough?"
 *   CoverageTarget → "What specifically?"
 *   Planner        → "How to test?"
 *   Execution      → "What happened?"
 *     → Coverage (did we test it?)
 *     → Outcome (did it pass?)
 *
 * Three core principles:
 *   1. Coverage ≠ TestPlan
 *   2. Coverage ≠ Outcome
 *   3. Page Change ≠ must call LLM
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type PriorityLevel = 'critical' | 'high' | 'normal' | 'low';
export type PrioritySource = 'user' | 'system' | 'llm';
export type TestType = 'smoke' | 'confirmation' | 'acceptance' | 'full';

export interface PriorityInfo {
  level: PriorityLevel;
  source: PrioritySource;
  confidence?: number;
  reason?: string;
}

export type ScenarioType = 'normal' | 'validation' | 'boundary' | 'error' | 'lifecycle';

export type ScenarioStatus =
  | 'not_applicable'
  | 'not_tested'
  | 'planned'
  | 'tested';

export type ScenarioOutcome = 'pass' | 'fail' | 'blocked';

export interface ScenarioCoverage {
  status: ScenarioStatus;
  outcome?: ScenarioOutcome;
  evidence?: Evidence[];
  testedAt?: number;
}

export interface Evidence {
  action: string;
  result: ScenarioOutcome;
  turn: number;
  timestamp: number;
}

// ─── Intent Relevance ────────────────────────────────────────────────────────

/**
 * How relevant a feature is to the user's stated testing intent.
 * Independent from PriorityInfo — priority is about business importance,
 * relevance is about "did the user specifically ask to test this?"
 *
 * Example:
 *   Feature "搜索框"   → priority: normal,  intentRelevance: 1.0 (user asked for search)
 *   Feature "删除按钮" → priority: critical, intentRelevance: 0.0 (user didn't mention delete)
 */
export interface IntentRelevance {
  score: number;          // 0 ~ 1
  source: 'user' | 'llm';
  matchedTerms?: string[];
  reason?: string;
}

export type FeatureType =
  | 'text-input'
  | 'number-input'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'button'
  | 'link'
  | 'form'
  | 'table'
  | 'search'
  | 'upload'
  | 'modal'
  | 'tab'
  | 'pagination'
  | 'navigation'
  | 'unknown';

export type CoverageStatus = 'uncovered' | 'partial' | 'covered';
export type ExecutionStatus = 'idle' | 'planning' | 'running' | 'completed' | 'blocked';

// ─── Coverage Model ──────────────────────────────────────────────────────────

export interface CoverageFeature {
  key: string;
  /** Aria ref from Playwright snapshot (e.g. "f13e87") — used for action matching */
  ref?: string;
  name: string;
  type: FeatureType;
  priority: PriorityInfo;
  scenarios: Record<ScenarioType, ScenarioCoverage>;
  /** How relevant this feature is to the user's stated testing intent */
  intentRelevance?: IntentRelevance;
}

export interface CoverageSurface {
  key: string;
  url?: string;
  title?: string;
  /** Signature hash at time of registration — used for surface change detection */
  signatureHash?: string;
  priority: PriorityInfo;
  coverageStatus: CoverageStatus;
  executionStatus: ExecutionStatus;
  features: CoverageFeature[];
  visitedAt?: number;
  testedAt?: number;
}

export interface CoverageModule {
  key: string;
  name: string;
  priority: PriorityInfo;
  surfaces: CoverageSurface[];
}

export interface DiscoveryState {
  lastDiscoveryAt?: number;
  stableTurns: number;
  hasPotentialUnexploredSurface: boolean;
}

export interface CoverageModel {
  modules: CoverageModule[];
  currentSurfaceKey?: string;
  discovery: DiscoveryState;
}

// ─── Coverage Policy ─────────────────────────────────────────────────────────

export interface CoveragePolicy {
  /** The test type this policy is for */
  testType: TestType;
  systemCoverage: {
    criticalModules: 'all' | 'none';
    majorModules: 'all' | 'most' | 'some' | 'minimal';
    normalModules: 'all' | 'most' | 'some' | 'minimal';
  };
  scenarioDepth: {
    [K in ScenarioType]?: 'required' | 'optional';
  };
  discovery: {
    activeExploration: boolean;
    stableTurnsBeforeFinish: number;
  };
  risk: {
    minimumPlannerLevel: 'deterministic' | 'template' | 'llm';
    criticalFeaturesAlwaysRequired: boolean;
  };
  budget: {
    maxTurns?: number;
    maxLLMCalls?: number;
    maxDurationMs?: number;
  };
}

// ─── Coverage Target ─────────────────────────────────────────────────────────

export interface CoverageTarget {
  surfaceKey: string;
  featureKey: string;
  scenarioType: ScenarioType;
  priority: PriorityInfo;
}

// ─── Scenario Applicability ──────────────────────────────────────────────────

/**
 * Which scenarios are applicable for each feature type.
 * A scenario is "applicable" if the feature can meaningfully be tested with it.
 */
const SCENARIO_APPLICABILITY: Record<FeatureType, ScenarioType[]> = {
  'text-input':    ['normal', 'validation', 'boundary'],
  'number-input':  ['normal', 'validation', 'boundary'],
  'checkbox':      ['normal'],
  'radio':         ['normal'],
  'dropdown':      ['normal', 'validation'],
  'button':        ['normal', 'error'],
  'link':          ['normal'],
  'form':          ['normal', 'validation', 'boundary', 'error'],
  'table':         ['normal', 'boundary'],
  'search':        ['normal', 'validation', 'boundary'],
  'upload':        ['normal', 'validation', 'error'],
  'modal':         ['normal', 'error'],
  'tab':           ['normal'],
  'pagination':    ['normal', 'boundary'],
  'navigation':    ['normal'],
  'unknown':       ['normal'],
};

/**
 * Check if a scenario is applicable for a given feature type.
 */
export function isScenarioApplicable(
  featureType: FeatureType,
  scenarioType: ScenarioType
): boolean {
  return SCENARIO_APPLICABILITY[featureType]?.includes(scenarioType) ?? false;
}

// ─── Priority Helpers ────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<PriorityLevel, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// ─── Intent Relevance Calculation ────────────────────────────────────────────

/**
 * Keyword groups for intent matching.
 * Each entry maps a set of equivalent terms (CN + EN) to feature types they relate to.
 *
 * When the user's instructions contain any of these terms, features whose name
 * contains the term OR whose type matches the featureTypes list get a relevance score.
 */
const INTENT_KEYWORD_GROUPS: Array<{
  terms: string[];
  featureTypes: FeatureType[];
  baseScore: number;
}> = [
  {
    terms: ['搜索', 'search', '查询', 'query', '查找', '筛选', 'filter', 'find',
            '百度一下'],
    featureTypes: ['search', 'text-input', 'form', 'button'],
    baseScore: 1.0,
  },
  {
    terms: ['登录', 'login', 'signin', 'sign in', '认证', 'auth'],
    featureTypes: ['form', 'text-input', 'button'],
    baseScore: 1.0,
  },
  {
    terms: ['注册', 'register', 'signup', 'sign up', '注册'],
    featureTypes: ['form', 'text-input', 'button'],
    baseScore: 1.0,
  },
  {
    terms: ['创建', 'create', '新增', '添加', 'add', 'new'],
    featureTypes: ['button', 'form', 'modal'],
    baseScore: 0.9,
  },
  {
    terms: ['编辑', 'edit', '修改', 'update', '更改'],
    featureTypes: ['button', 'form', 'modal'],
    baseScore: 0.9,
  },
  {
    terms: ['删除', 'delete', '移除', 'remove', 'destroy', 'clear'],
    featureTypes: ['button', 'modal'],
    baseScore: 0.9,
  },
  {
    terms: ['上传', 'upload', '导入', 'import', '文件', 'file'],
    featureTypes: ['upload', 'button', 'form'],
    baseScore: 0.9,
  },
  {
    terms: ['下载', 'download', '导出', 'export'],
    featureTypes: ['button', 'link'],
    baseScore: 0.8,
  },
  {
    terms: ['提交', 'submit', '保存', 'save', '确认', '确定', 'confirm'],
    featureTypes: ['button', 'form'],
    baseScore: 0.8,
  },
  {
    terms: ['列表', 'list', '表格', 'table', '数据'],
    featureTypes: ['table', 'pagination'],
    baseScore: 0.7,
  },
  {
    terms: ['导航', 'navigation', '菜单', 'menu', '侧栏', 'sidebar'],
    featureTypes: ['navigation', 'link', 'tab'],
    baseScore: 0.6,
  },
  {
    terms: ['表单', 'form', '输入', 'input', '填写'],
    featureTypes: ['form', 'text-input', 'number-input', 'checkbox', 'radio', 'dropdown'],
    baseScore: 0.7,
  },
];

/**
 * Calculate intent relevance for a feature given user instructions.
 *
 * Tiered scoring (returns highest score across all matches):
 *
 *   Tier 1 — Direct name match (score = group.baseScore):
 *     Instructions contain a keyword AND feature.name also contains that keyword.
 *     Example: instructions="测试百度搜索", feature.name="搜索框"
 *     → "搜索" in both → score 1.0
 *
 *   Tier 2 — Feature name contains keyword (score = group.baseScore * 0.6):
 *     Feature name contains a keyword from the group, but instructions don't
 *     contain the feature name. This catches cases where the feature is obviously
 *     related to the intent by its name alone.
 *     Example: instructions="测试搜索功能", feature.name="搜索"
 *     → score 0.6
 *
 *   Tier 3 — Type-only match (score = group.baseScore * 0.3):
 *     Instructions contain a keyword AND feature.type matches the group's
 *     featureTypes list, but the feature NAME has no keyword overlap.
 *     This is a weak signal — many features might share the same type.
 *     Example: instructions="测试搜索", feature.name="用户名输入框", type="text-input"
 *     → score 0.3
 *
 * Returns undefined if no match found (relevance = 0).
 */
export function calculateIntentRelevance(
  instructions: string | undefined,
  featureName: string,
  featureType: FeatureType
): IntentRelevance | undefined {
  if (!instructions || instructions.trim().length === 0) return undefined;

  const instrLower = instructions.toLowerCase();
  const nameLower = featureName.toLowerCase();
  const matchedTerms: string[] = [];
  let bestScore = 0;
  let bestTier = 0;

  for (const group of INTENT_KEYWORD_GROUPS) {
    for (const term of group.terms) {
      const termLower = term.toLowerCase();
      const instrHasTerm = instrLower.includes(termLower);
      const nameHasTerm = nameLower.includes(termLower);

      if (instrHasTerm && nameHasTerm) {
        // Tier 1: Direct name match — both instruction and feature name contain the keyword
        const score = group.baseScore;
        if (score > bestScore || (score === bestScore && 1 > bestTier)) {
          bestScore = score;
          bestTier = 1;
        }
        matchedTerms.push(term);
      } else if (nameHasTerm) {
        // Tier 2: Feature name contains keyword (even if instruction doesn't directly)
        const score = group.baseScore * 0.6;
        if (score > bestScore || (score === bestScore && 2 > bestTier)) {
          bestScore = score;
          bestTier = 2;
        }
        matchedTerms.push(term);
      } else if (instrHasTerm && group.featureTypes.includes(featureType)) {
        // Tier 3: Type-only match — weak signal
        const score = group.baseScore * 0.3;
        if (score > bestScore || (score === bestScore && 3 > bestTier)) {
          bestScore = score;
          bestTier = 3;
        }
        matchedTerms.push(term);
      }
    }
  }

  if (bestScore === 0) return undefined;

  // Clamp to [0, 1]
  const score = Math.min(1, Math.max(0, bestScore));

  const tierLabel = bestTier === 1 ? 'direct' : bestTier === 2 ? 'name' : 'type';

  return {
    score,
    source: 'user',
    matchedTerms: [...new Set(matchedTerms)],
    reason: `[${tierLabel}] Matched instructions: "${instructions.slice(0, 60)}${instructions.length > 60 ? '...' : ''}"`,
  };
}

/**
 * Calculate intent relevance for ALL features in a coverage model.
 * Called after feature discovery, before target selection.
 *
 * Two-pass approach:
 *   Pass 1: Keyword-based matching for each feature
 *   Pass 2: Structural heuristics (e.g., "only textbox on page = search box")
 */
export function calculateAllIntentRelevance(
  model: CoverageModel,
  instructions: string | undefined
): void {
  if (!instructions) return;
  const instrLower = instructions.toLowerCase();

  // Collect all features across all surfaces for structural analysis
  const allFeatures: CoverageFeature[] = [];
  for (const module of model.modules) {
    for (const surface of module.surfaces) {
      for (const feature of surface.features) {
        allFeatures.push(feature);
      }
    }
  }

  // Pass 1: Keyword-based matching
  for (const feature of allFeatures) {
    feature.intentRelevance = calculateIntentRelevance(
      instructions,
      feature.name,
      feature.type
    );
  }

  // Pass 2: Structural heuristics
  // If the page has exactly one textbox and the instructions suggest search/input,
  // that textbox is very likely the search box — regardless of its label.
  const textboxes = allFeatures.filter(f => f.type === 'text-input');
  const searchKeywords = ['search', '搜索', 'query', '查询', 'find', '查找', 'input', '输入', 'keyword', '关键词'];
  const instrMentionsSearch = searchKeywords.some(k => instrLower.includes(k));

  if (textboxes.length === 1 && instrMentionsSearch) {
    const tb = textboxes[0]!;
    const currentScore = tb.intentRelevance?.score ?? 0;
    // Boost to at least 0.8 — a single textbox on a search-mentioning page is very likely the search box
    if (currentScore < 0.8) {
      tb.intentRelevance = {
        score: 0.8,
        source: 'user',
        matchedTerms: [...(tb.intentRelevance?.matchedTerms ?? []), '[structural:single-textbox]'],
        reason: `Only textbox on page + instructions mention search`,
      };
    }
  }
}

/**
 * Get effective priority from module → surface → feature (max wins).
 */
export function effectivePriority(
  module: CoverageModule,
  surface: CoverageSurface,
  feature: CoverageFeature
): PriorityLevel {
  const levels = [module.priority.level, surface.priority.level, feature.priority.level];
  const maxOrder = Math.max(...levels.map(l => PRIORITY_ORDER[l]));
  return (Object.entries(PRIORITY_ORDER).find(([_, v]) => v === maxOrder)?.[0] as PriorityLevel) ?? 'normal';
}

// ─── Coverage Model Operations ───────────────────────────────────────────────

/**
 * Create an empty Coverage Model.
 */
export function createCoverageModel(): CoverageModel {
  return {
    modules: [],
    currentSurfaceKey: undefined,
    discovery: {
      stableTurns: 0,
      hasPotentialUnexploredSurface: false,
    },
  };
}

/**
 * Register or merge a module into the coverage model.
 */
export function registerModule(
  model: CoverageModel,
  key: string,
  name: string,
  priority: PriorityInfo = { level: 'normal', source: 'llm' }
): CoverageModule {
  const existing = model.modules.find(m => m.key === key);
  if (existing) {
    // Merge: keep higher priority
    if (PRIORITY_ORDER[priority.level] > PRIORITY_ORDER[existing.priority.level]) {
      existing.priority = priority;
    }
    return existing;
  }
  const newModule: CoverageModule = {
    key,
    name,
    priority,
    surfaces: [],
  };
  model.modules.push(newModule);
  return newModule;
}

/**
 * Register or merge a surface into a module.
 */
export function registerSurface(
  model: CoverageModel,
  moduleKey: string,
  surfaceKey: string,
  url?: string,
  title?: string,
  priority?: PriorityInfo
): CoverageSurface {
  const module = model.modules.find(m => m.key === moduleKey);
  if (!module) {
    throw new Error(`Module ${moduleKey} not found`);
  }

  const existing = module.surfaces.find(s => s.key === surfaceKey);
  if (existing) {
    // Merge: keep higher priority, update URL/title if changed
    if (priority && PRIORITY_ORDER[priority.level] > PRIORITY_ORDER[existing.priority.level]) {
      existing.priority = priority;
    }
    if (url) existing.url = url;
    if (title) existing.title = title;
    return existing;
  }

  const newSurface: CoverageSurface = {
    key: surfaceKey,
    url,
    title,
    priority: priority ?? { level: 'normal', source: 'llm' },
    coverageStatus: 'uncovered',
    executionStatus: 'idle',
    features: [],
  };
  module.surfaces.push(newSurface);
  return newSurface;
}

/**
 * Register a feature into a surface.
 */
export function registerFeature(
  surface: CoverageSurface,
  key: string,
  name: string,
  type: FeatureType,
  priority: PriorityInfo = { level: 'normal', source: 'llm' }
): CoverageFeature {
  const existing = surface.features.find(f => f.key === key);
  if (existing) {
    // Merge: keep higher priority
    if (PRIORITY_ORDER[priority.level] > PRIORITY_ORDER[existing.priority.level]) {
      existing.priority = priority;
    }
    return existing;
  }

  // Initialize all scenarios with not_applicable or not_tested based on feature type
  const scenarios: Record<ScenarioType, ScenarioCoverage> = {
    normal: { status: isScenarioApplicable(type, 'normal') ? 'not_tested' : 'not_applicable' },
    validation: { status: isScenarioApplicable(type, 'validation') ? 'not_tested' : 'not_applicable' },
    boundary: { status: isScenarioApplicable(type, 'boundary') ? 'not_tested' : 'not_applicable' },
    error: { status: isScenarioApplicable(type, 'error') ? 'not_tested' : 'not_applicable' },
    lifecycle: { status: isScenarioApplicable(type, 'lifecycle') ? 'not_tested' : 'not_applicable' },
  };

  const newFeature: CoverageFeature = {
    key,
    name,
    type,
    priority,
    scenarios,
  };
  surface.features.push(newFeature);
  return newFeature;
}

/**
 * Update scenario execution result.
 * Key principle: Coverage ≠ Outcome
 * A failed test still counts as "covered".
 */
export function updateScenario(
  feature: CoverageFeature,
  scenarioType: ScenarioType,
  outcome: ScenarioOutcome,
  evidence?: Evidence
): void {
  const scenario = feature.scenarios[scenarioType];
  if (!scenario) return;

  // Update coverage status
  scenario.status = 'tested';
  scenario.outcome = outcome;
  scenario.testedAt = Date.now();

  // Add evidence
  if (evidence) {
    if (!scenario.evidence) {
      scenario.evidence = [];
    }
    scenario.evidence.push(evidence);
  }
}

/**
 * Mark a scenario as planned (will be tested soon).
 */
export function markScenarioPlanned(
  feature: CoverageFeature,
  scenarioType: ScenarioType
): void {
  const scenario = feature.scenarios[scenarioType];
  if (!scenario) return;
  if (scenario.status === 'not_tested') {
    scenario.status = 'planned';
  }
}

// ─── Coverage Calculation ────────────────────────────────────────────────────

/**
 * Check if a feature is fully covered according to policy.
 * A feature is covered if all applicable AND required scenarios are tested.
 */
export function isFeatureCovered(
  feature: CoverageFeature,
  policy: CoveragePolicy
): boolean {
  const requiredScenarios = (Object.entries(feature.scenarios) as [ScenarioType, ScenarioCoverage][])
    .filter(([type, cov]) =>
      cov.status !== 'not_applicable' &&           // Applicable
      policy.scenarioDepth[type] === 'required'    // Policy requires it
    );

  return requiredScenarios.every(([_, cov]) => cov.status === 'tested');
}

/**
 * Check if a surface is fully covered.
 */
export function isSurfaceCovered(
  surface: CoverageSurface,
  policy: CoveragePolicy
): boolean {
  if (surface.features.length === 0) return false;
  return surface.features.every(f => isFeatureCovered(f, policy));
}

/**
 * Check if a module is fully covered.
 */
export function isModuleCovered(
  module: CoverageModule,
  policy: CoveragePolicy
): boolean {
  if (module.surfaces.length === 0) return false;
  return module.surfaces.every(s => isSurfaceCovered(s, policy));
}

/**
 * Update coverage status for a surface based on its features.
 */
export function updateSurfaceCoverageStatus(
  surface: CoverageSurface,
  policy: CoveragePolicy
): void {
  if (surface.features.length === 0) {
    surface.coverageStatus = 'uncovered';
    return;
  }

  const coveredCount = surface.features.filter(f => isFeatureCovered(f, policy)).length;

  if (coveredCount === surface.features.length) {
    surface.coverageStatus = 'covered';
  } else if (coveredCount > 0) {
    surface.coverageStatus = 'partial';
  } else {
    surface.coverageStatus = 'uncovered';
  }
}

// ─── Coverage Gap Analysis ───────────────────────────────────────────────────

/**
 * Calculate a composite score for a coverage target.
 * Used to sort gaps by desirability — higher = should be tested first.
 *
 * Components:
 *   priorityScore:       0–4  from effectivePriority (critical=4, high=3, normal=2, low=1)
 *   intentRelevanceScore: 0–4  from feature.intentRelevance.score * 4
 *
 * This ensures user intent has comparable weight to business priority.
 */
function scoreTarget(
  target: CoverageTarget,
  model: CoverageModel
): number {
  const priorityScore = PRIORITY_ORDER[target.priority.level] ?? 2;

  // Find the feature to get intent relevance
  let intentScore = 0;
  for (const module of model.modules) {
    const surface = module.surfaces.find(s => s.key === target.surfaceKey);
    if (!surface) continue;
    const feature = surface.features.find(f => f.key === target.featureKey);
    if (feature?.intentRelevance) {
      intentScore = feature.intentRelevance.score * 4; // Scale to 0–4 range
    }
    break;
  }

  return priorityScore + intentScore;
}

/**
 * Get all uncovered or partially covered targets.
 *
 * When `instructions` is provided, targets are sorted by a composite score:
 *   score = priorityScore + intentRelevanceScore
 *
 * This ensures features relevant to the user's intent are tested first,
 * while still respecting business priority.
 */
export function getCoverageGaps(
  model: CoverageModel,
  policy: CoveragePolicy,
  instructions?: string
): CoverageTarget[] {
  const gaps: CoverageTarget[] = [];

  for (const module of model.modules) {
    for (const surface of module.surfaces) {
      for (const feature of surface.features) {
        for (const [scenarioType, coverage] of Object.entries(feature.scenarios) as [ScenarioType, ScenarioCoverage][]) {
          // Skip if not applicable
          if (coverage.status === 'not_applicable') continue;

          // Skip if already tested
          if (coverage.status === 'tested') continue;

          // Check if policy requires this scenario
          const isRequired = policy.scenarioDepth[scenarioType] === 'required';

          // Critical features always required regardless of policy
          const isCritical = feature.priority.level === 'critical';
          const forceRequired = isCritical && policy.risk.criticalFeaturesAlwaysRequired;

          if (isRequired || forceRequired) {
            gaps.push({
              surfaceKey: surface.key,
              featureKey: feature.key,
              scenarioType,
              priority: {
                level: effectivePriority(module, surface, feature),
                source: feature.priority.source,
              },
            });
          }
        }
      }
    }
  }

  // Sort by composite score (priority + intent relevance)
  gaps.sort((a, b) => scoreTarget(b, model) - scoreTarget(a, model));

  return gaps;
}

/**
 * Select the next coverage target to test.
 *
 * Three-phase selection:
 *   Phase 1: Features with intent relevance > 0.5 (user specifically asked for these)
 *   Phase 2: Critical / high priority features
 *   Phase 3: Everything else, sorted by composite score
 *
 * Skipped targets (stagnated — selected multiple times but never matched by an action)
 * are excluded from selection to prevent infinite loops.
 */
export function selectNextTarget(
  model: CoverageModel,
  policy: CoveragePolicy,
  instructions?: string,
  skippedTargets?: string[]
): CoverageTarget | null {
  const gaps = getCoverageGaps(model, policy, instructions);
  if (gaps.length === 0) return null;

  const skipped = new Set(skippedTargets ?? []);

  // Helper: find first gap not in skipped set, optionally filtered by predicate
  function findGap(predicate?: (g: CoverageTarget, model: CoverageModel) => boolean): CoverageTarget | null {
    for (const g of gaps) {
      if (skipped.has(g.featureKey)) continue;
      if (predicate && !predicate(g, model)) continue;
      return g;
    }
    return null;
  }

  // Phase 1: High intent relevance (> 0.5)
  const phase1 = findGap((g) => {
    for (const m of model.modules) {
      for (const s of m.surfaces) {
        if (s.key !== g.surfaceKey) continue;
        const f = s.features.find(ff => ff.key === g.featureKey);
        if (f?.intentRelevance && f.intentRelevance.score > 0.5) return true;
      }
    }
    return false;
  });
  if (phase1) return phase1;

  // Phase 2: Critical or high priority
  const phase2 = findGap(g => g.priority.level === 'critical' || g.priority.level === 'high');
  if (phase2) return phase2;

  // Phase 3: Best composite score (already sorted)
  return findGap() ?? null;
}

// ─── Action → Feature Resolution ─────────────────────────────────────────────

/**
 * Result of resolving an action to a coverage feature.
 * method indicates HOW the match was found; confidence indicates reliability.
 */
export interface FeatureMatch {
  feature: CoverageFeature;
  method: 'ref' | 'name' | 'normalized';
  confidence: number;
}

/** Confidence threshold for accepting a match. Below this → no coverage update. */
const MATCH_CONFIDENCE_THRESHOLD = 0.8;

/**
 * Extract the target ref and element description from tool arguments.
 * Different tools have different argument shapes:
 *   - browser_click: { target: "e37", element: "搜索框" }
 *   - browser_type:  { target: "e37", element: "搜索框", text: "hello" }
 *   - browser_fill_form: { fields: [{ target: "e37", name: "搜索框" }] }
 */
function extractActionIdentity(
  toolName: string,
  toolArgs: Record<string, unknown>
): { targetRef: string; elementDesc: string } {
  let targetRef = String(toolArgs.target ?? '');
  let elementDesc = String(toolArgs.element ?? '');

  // browser_fill_form has a different structure
  if (toolName === 'browser_fill_form' && Array.isArray(toolArgs.fields)) {
    const fields = toolArgs.fields as Array<Record<string, unknown>>;
    const firstField = fields[0];
    if (firstField) {
      targetRef = String(firstField.target ?? targetRef);
      elementDesc = String(firstField.name ?? elementDesc);
    }
  }

  return { targetRef, elementDesc };
}

/**
 * Normalize a feature name for comparison.
 * Strips common suffixes like 按钮/链接/输入框/框 and lowercases.
 */
function normalizeFeatureName(name: string): string {
  return name
    .replace(/(按钮|链接|输入框|框|文本框|下拉框|选择框|复选框)/g, '')
    .replace(/(button|link|input|box|field|checkbox|dropdown|select)/gi, '')
    .trim()
    .toLowerCase();
}

/**
 * Resolve which coverage feature an action corresponds to.
 *
 * Matching hierarchy (returns highest-confidence match across ALL features):
 *   1. ref exact match:       action target ref === feature.ref           → 1.00
 *   2. name exact match:      action element desc === feature.name        → 0.95
 *   3. normalized match:      normalized names overlap                    → 0.80–0.85
 *   4. structural fallback:   feature type is unique on surface + action
 *                             type matches                                → 0.75
 *
 * Returns null if no match exceeds the confidence threshold.
 *
 * Key principle: false negatives are acceptable; false positives are not.
 * We'd rather miss a coverage update than incorrectly mark the wrong feature.
 */
export function resolveActionFeature(
  toolName: string,
  toolArgs: Record<string, unknown>,
  model: CoverageModel
): FeatureMatch | null {
  const { targetRef, elementDesc } = extractActionIdentity(toolName, toolArgs);

  // Collect all features from the model
  const allFeatures: CoverageFeature[] = [];
  for (const module of model.modules) {
    for (const surface of module.surfaces) {
      for (const feature of surface.features) {
        allFeatures.push(feature);
      }
    }
  }

  let bestMatch: FeatureMatch | null = null;

  for (const feature of allFeatures) {
    // Method 1: ref exact match (highest confidence)
    if (targetRef && feature.ref && targetRef === feature.ref) {
      return { feature, method: 'ref', confidence: 1.0 };
    }

    // Method 2: name exact match
    if (elementDesc && feature.name && elementDesc === feature.name) {
      const match: FeatureMatch = { feature, method: 'name', confidence: 0.95 };
      if (!bestMatch || match.confidence > bestMatch.confidence) bestMatch = match;
      continue; // ref match would still beat this
    }

    // Method 3: normalized name match
    if (elementDesc && feature.name) {
      const normElement = normalizeFeatureName(elementDesc);
      const normFeature = normalizeFeatureName(feature.name);

      if (normElement && normFeature && normElement.length >= 2 && normFeature.length >= 2) {
        if (normElement === normFeature) {
          const match: FeatureMatch = { feature, method: 'normalized', confidence: 0.85 };
          if (!bestMatch || match.confidence > bestMatch.confidence) bestMatch = match;
        } else if (normElement.includes(normFeature) || normFeature.includes(normElement)) {
          const match: FeatureMatch = { feature, method: 'normalized', confidence: 0.80 };
          if (!bestMatch || match.confidence > bestMatch.confidence) bestMatch = match;
        }
      }
    }
  }

  // If we already have a confident match, return it
  if (bestMatch && bestMatch.confidence >= MATCH_CONFIDENCE_THRESHOLD) {
    return bestMatch;
  }

  // Method 4: Structural fallback — if the feature type is unique on the current
  // surface, and the action tool implies interaction with that type, it's very
  // likely the right feature. This handles aria ref drift between snapshots.
  //
  // Example: Baidu's search box is the only text-input on the homepage.
  //   browser_type on a textbox → matches the unique text-input feature.
  if (targetRef || elementDesc) {
    // Find features on the current surface
    const currentSurfaceKey = model.currentSurfaceKey;
    let surfaceFeatures = allFeatures;
    if (currentSurfaceKey) {
      for (const m of model.modules) {
        const surface = m.surfaces.find(s => s.key === currentSurfaceKey);
        if (surface) {
          surfaceFeatures = surface.features;
          break;
        }
      }
    }

    // Tool → expected feature type mapping
    // Only TYPING tools use structural fallback — they're strongly associated with text-input.
    // Click tools are too generic (any button/link/checkbox) and would cause false matches.
    const typingToolTypes: Record<string, FeatureType[]> = {
      browser_type: ['text-input', 'search'],
      browser_fill_form: ['form', 'text-input'],
    };

    const expectedTypes = typingToolTypes[toolName] ?? [];
    for (const expectedType of expectedTypes) {
      const featuresOfType = surfaceFeatures.filter(f => f.type === expectedType);
      if (featuresOfType.length === 1) {
        const uniqueFeature = featuresOfType[0]!;
        const match: FeatureMatch = { feature: uniqueFeature, method: 'normalized', confidence: 0.75 };
        if (!bestMatch || match.confidence > bestMatch.confidence) {
          bestMatch = match;
        }
      }
    }
  }

  // Final threshold check — accept structural fallback (0.75) too
  if (bestMatch && bestMatch.confidence >= 0.75) {
    return bestMatch;
  }

  return null;
}

// ─── Exit Criteria ───────────────────────────────────────────────────────────

export interface FinishDecision {
  shouldFinish: boolean;
  reason: 'coverage_target_met' | 'budget_exhausted' | 'continue';
  details: {
    criticalCovered: boolean;
    requiredCovered: boolean;
    discoveryStable: boolean;
    noBlockingIssue: boolean;
    budgetExhausted: boolean;
    coverageRate: number;
  };
}

/**
 * Check if testing should finish.
 *
 * Exit criteria (in order):
 *   1. Critical targets covered
 *   2. Required coverage satisfied
 *   3. Discovery stable
 *   4. No blocking issues
 *   5. Budget exhausted (hard limit)
 */
export function shouldFinishTesting(
  model: CoverageModel,
  policy: CoveragePolicy,
  budget: { turnsUsed: number }
): FinishDecision {
  // 1. Critical modules covered
  const criticalModules = model.modules.filter(m => m.priority.level === 'critical');
  const criticalCovered = criticalModules.length === 0 ||
    criticalModules.every(m => isModuleCovered(m, policy));

  // 2. Required coverage (major modules)
  const majorModules = model.modules.filter(m =>
    m.priority.level === 'critical' || m.priority.level === 'high'
  );
  const requiredCovered = majorModules.length === 0 ||
    majorModules.every(m => isModuleCovered(m, policy));

  // 3. Discovery stable
  const discoveryStable = model.discovery.stableTurns >= policy.discovery.stableTurnsBeforeFinish;

  // 4. No blocking issues (check for blocked execution status)
  const hasBlockingIssue = model.modules.some(m =>
    m.surfaces.some(s => s.executionStatus === 'blocked')
  );
  const noBlockingIssue = !hasBlockingIssue;

  // 5. Budget exhausted
  const budgetExhausted = policy.budget.maxTurns !== undefined &&
    budget.turnsUsed >= policy.budget.maxTurns;

  // Calculate coverage rate for reporting
  const totalSurfaces = model.modules.reduce((sum, m) => sum + m.surfaces.length, 0);
  const coveredSurfaces = model.modules.reduce(
    (sum, m) => sum + m.surfaces.filter(s => s.coverageStatus === 'covered').length,
    0
  );
  const coverageRate = totalSurfaces > 0 ? coveredSurfaces / totalSurfaces : 0;

  // Target satisfied = all conditions met
  const targetSatisfied = criticalCovered && requiredCovered && discoveryStable && noBlockingIssue;

  return {
    shouldFinish: targetSatisfied || budgetExhausted,
    reason: targetSatisfied
      ? 'coverage_target_met'
      : budgetExhausted
        ? 'budget_exhausted'
        : 'continue',
    details: {
      criticalCovered,
      requiredCovered,
      discoveryStable,
      noBlockingIssue,
      budgetExhausted,
      coverageRate,
    },
  };
}

// ─── Coverage Summary ────────────────────────────────────────────────────────

export interface CoverageSummary {
  modules: {
    total: number;
    covered: number;
    partial: number;
    uncovered: number;
  };
  surfaces: {
    total: number;
    covered: number;
    partial: number;
    uncovered: number;
  };
  features: {
    total: number;
    covered: number;
  };
  critical: {
    total: number;
    covered: number;
  };
}

/**
 * Generate a summary of coverage status.
 */
export function getCoverageSummary(
  model: CoverageModel,
  policy: CoveragePolicy
): CoverageSummary {
  const summary: CoverageSummary = {
    modules: { total: 0, covered: 0, partial: 0, uncovered: 0 },
    surfaces: { total: 0, covered: 0, partial: 0, uncovered: 0 },
    features: { total: 0, covered: 0 },
    critical: { total: 0, covered: 0 },
  };

  for (const module of model.modules) {
    summary.modules.total++;
    if (isModuleCovered(module, policy)) {
      summary.modules.covered++;
    } else if (module.surfaces.some(s => s.coverageStatus !== 'uncovered')) {
      summary.modules.partial++;
    } else {
      summary.modules.uncovered++;
    }

    if (module.priority.level === 'critical') {
      summary.critical.total++;
      if (isModuleCovered(module, policy)) {
        summary.critical.covered++;
      }
    }

    for (const surface of module.surfaces) {
      summary.surfaces.total++;
      switch (surface.coverageStatus) {
        case 'covered': summary.surfaces.covered++; break;
        case 'partial': summary.surfaces.partial++; break;
        default: summary.surfaces.uncovered++; break;
      }

      for (const feature of surface.features) {
        summary.features.total++;
        if (isFeatureCovered(feature, policy)) {
          summary.features.covered++;
        }
      }
    }
  }

  return summary;
}

/**
 * Generate a compact text summary for LLM prompt injection.
 */
export function formatCoverageSummary(
  model: CoverageModel,
  policy: CoveragePolicy,
  currentSurfaceKey?: string
): string {
  const summary = getCoverageSummary(model, policy);
  const gaps = getCoverageGaps(model, policy);

  const lines: string[] = [
    'COVERAGE',
    `Modules: ${summary.modules.covered}/${summary.modules.total}`,
    `Surfaces: ${summary.surfaces.covered}/${summary.surfaces.total}`,
    `Features: ${summary.features.covered}/${summary.features.total}`,
    `Critical: ${summary.critical.covered}/${summary.critical.total}`,
    '',
  ];

  if (currentSurfaceKey) {
    const currentSurface = model.modules
      .flatMap(m => m.surfaces)
      .find(s => s.key === currentSurfaceKey);
    if (currentSurface) {
      lines.push('CURRENT');
      lines.push(`Surface: ${currentSurface.title ?? currentSurface.key}`);
      lines.push(`Status: ${currentSurface.coverageStatus}`);
      lines.push('');
    }
  }

  if (gaps.length > 0) {
    lines.push('TODO');
    for (const gap of gaps.slice(0, 5)) {
      // Find feature to get intent relevance
      let relevanceStr = '';
      for (const m of model.modules) {
        const s = m.surfaces.find(ss => ss.key === gap.surfaceKey);
        if (!s) continue;
        const f = s.features.find(ff => ff.key === gap.featureKey);
        if (f?.intentRelevance && f.intentRelevance.score > 0) {
          relevanceStr = ` intent=${f.intentRelevance.score.toFixed(1)}`;
        }
        break;
      }
      lines.push(`- ${gap.featureKey}/${gap.scenarioType} [${gap.priority.level}]${relevanceStr}`);
    }
  }

  return lines.join('\n');
}

// ─── Default Policies ────────────────────────────────────────────────────────

export const COVERAGE_POLICIES: Record<TestType, CoveragePolicy> = {
  smoke: {
    testType: 'smoke',
    systemCoverage: {
      criticalModules: 'all',
      majorModules: 'minimal',
      normalModules: 'minimal',
    },
    scenarioDepth: {
      normal: 'required',
      validation: 'optional',
      boundary: 'optional',
      error: 'optional',
      lifecycle: 'optional',
    },
    discovery: {
      activeExploration: false,
      stableTurnsBeforeFinish: 3,
    },
    risk: {
      minimumPlannerLevel: 'deterministic',
      criticalFeaturesAlwaysRequired: true,
    },
    budget: {
      maxTurns: 50,
    },
  },
  confirmation: {
    testType: 'confirmation',
    systemCoverage: {
      criticalModules: 'all',
      majorModules: 'all',
      normalModules: 'some',
    },
    scenarioDepth: {
      normal: 'required',
      validation: 'required',
      boundary: 'optional',
      error: 'optional',
      lifecycle: 'optional',
    },
    discovery: {
      activeExploration: true,
      stableTurnsBeforeFinish: 5,
    },
    risk: {
      minimumPlannerLevel: 'template',
      criticalFeaturesAlwaysRequired: true,
    },
    budget: {
      maxTurns: 100,
    },
  },
  acceptance: {
    testType: 'acceptance',
    systemCoverage: {
      criticalModules: 'all',
      majorModules: 'all',
      normalModules: 'most',
    },
    scenarioDepth: {
      normal: 'required',
      validation: 'required',
      boundary: 'required',
      error: 'required',
      lifecycle: 'optional',
    },
    discovery: {
      activeExploration: true,
      stableTurnsBeforeFinish: 8,
    },
    risk: {
      minimumPlannerLevel: 'template',
      criticalFeaturesAlwaysRequired: true,
    },
    budget: {
      maxTurns: 200,
    },
  },
  full: {
    testType: 'full',
    systemCoverage: {
      criticalModules: 'all',
      majorModules: 'all',
      normalModules: 'all',
    },
    scenarioDepth: {
      normal: 'required',
      validation: 'required',
      boundary: 'required',
      error: 'required',
      lifecycle: 'required',
    },
    discovery: {
      activeExploration: true,
      stableTurnsBeforeFinish: 10,
    },
    risk: {
      minimumPlannerLevel: 'llm',
      criticalFeaturesAlwaysRequired: true,
    },
    budget: {
      maxTurns: 500,
    },
  },
};
