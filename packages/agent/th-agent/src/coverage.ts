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
  | 'tested'
  | 'skipped';

export type ScenarioOutcome = 'pass' | 'fail' | 'blocked' | 'skipped';

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
  /** Why this outcome happened (e.g. skip reason) */
  reason?: string;
}

// ─── Intent Model ────────────────────────────────────────────────────────────

/**
 * Intent role — WHY this feature matters to the current test task.
 * This is the PRIMARY signal for target selection; numeric score is secondary.
 *
 *   primary      — the user explicitly asked to test this (target module/feature)
 *   prerequisite — required to reach/verify the primary target (e.g. login)
 *   supporting   — functional element that may participate in testing, not demanded
 *   incidental   — present on the page, unrelated to the task (navigation, decor)
 *   irrelevant   — clearly unrelated (help, legal, decorative)
 *
 * Role answers "what job does this feature do in THIS test session",
 * while PriorityInfo answers "how important is this feature in general".
 * They are independent dimensions and must never be conflated.
 */
export type IntentRole =
  | 'primary'
  | 'prerequisite'
  | 'supporting'
  | 'incidental'
  | 'irrelevant';

/**
 * How a feature relates to the user's stated testing intent.
 * `role` carries the semantics; `score` is a derived convenience for
 * sorting/logging and has no independent meaning.
 */
export interface IntentRelevance {
  role: IntentRole;
  score: number;          // derived from role (0 ~ 1)
  confidence: number;     // 0 ~ 1 — how sure we are about the role
  source: 'user' | 'llm';
  matchedTerms?: string[];
  reason?: string;
}

/**
 * Structured understanding of what the user wants tested.
 * Extracted ONCE from the instruction text (deterministic extraction),
 * then matched against discovered entities (modules/surfaces/features).
 *
 * Example — "使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试":
 *   primaryModules: ["项目集"]
 *   prerequisites:  ["登录"]
 *   requiredActions: []
 *   depth: "normal"
 */
export interface TestIntent {
  /** Modules the user explicitly asked to test (e.g. "项目集") */
  primaryModules: string[];
  /** Specific features the user named (e.g. "搜索框") */
  primaryFeatures: string[];
  /** Prerequisites needed to reach the target (e.g. login) */
  prerequisites: string[];
  /** Actions requested within the target (e.g. CRUD verbs) */
  requiredActions: string[];
  /** Test depth implied by the instruction */
  depth: 'smoke' | 'normal' | 'comprehensive';
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

/**
 * Coverage scope — controls WHICH discovered features the policy requires testing.
 * Scope is about COVERAGE SEMANTICS, not about understanding user intent
 * (that is the Intent Model's job). Scope consumes intent roles + priorities.
 *
 *   all            — every discovered feature (Full)
 *   comprehensive  — all business features (primary/prerequisite/supporting)
 *                    minus incidental/irrelevant (Acceptance)
 *   core           — intent primary + prerequisite + critical intrinsic (Confirmation)
 *   intent         — primary + prerequisite only (Smoke)
 */
export type CoverageScope = 'all' | 'comprehensive' | 'core' | 'intent';

// ─── Coverage Model ──────────────────────────────────────────────────────────

export interface CoverageFeature {
  key: string;
  /** Aria ref from Playwright snapshot (e.g. "f13e87") — used for action matching */
  ref?: string;
  name: string;
  type: FeatureType;
  /** Intrinsic business importance — "how important is this feature in general" */
  priority: PriorityInfo;
  scenarios: Record<ScenarioType, ScenarioCoverage>;
  /** How this feature relates to the user's current test task (Intent Model) */
  intentRelevance?: IntentRelevance;
}

export interface CoverageSurface {
  key: string;
  url?: string;
  title?: string;
  /** Semantic headings/landmarks observed on this surface */
  semanticLabels?: string[];
  /** Intent binding for the current test session */
  intent?: {
    role: 'primary' | 'supporting' | 'incidental';
    matchedBy?: string;
    confidence?: number;
  };
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
  /** Technical stable identity (never replace with a business label) */
  key: string;
  /** Semantic/business name when resolved from user intent or site metadata */
  name: string;
  /** Intent binding persists even when the module is not on the current surface */
  intent?: {
    role: 'primary' | 'supporting' | 'incidental';
    matchedBy?: string;
    confidence?: number;
  };
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
  /** Which discovered features are in required scope */
  scope: CoverageScope;
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

// ─── Intent Extraction ───────────────────────────────────────────────────────

/**
 * PREREQUISITE_PATTERNS — deterministic detection of mandatory pre-steps.
 * "登录系统"/"sign in" in instructions → login is a prerequisite, not the target.
 */
const PREREQUISITE_PATTERNS: Array<{ terms: string[]; prerequisite: string }> = [
  { terms: ['登录', 'login', 'signin', 'sign in', '认证', 'auth'], prerequisite: '登录' },
];

/** Action verbs that map to CRUD operations users may request */
const ACTION_TERMS: Record<string, string[]> = {
  create: ['创建', '新建', '添加', 'create', 'add', 'new'],
  edit: ['编辑', '修改', 'edit', 'update', '更改'],
  delete: ['删除', '移除', 'delete', 'remove', 'destroy'],
  search: ['搜索', '查询', '查找', 'search', 'query', 'find', '筛选', 'filter'],
};

/** Non-module words that should never be treated as module names */
const NON_MODULE_WORDS = new Set([
  '系统', '功能', '页面', '流程', '操作', '模块', '测试', '验证', '检查',
  '登录', '注册', '管理', '系统功能', '用户',
]);

/** Role → derived score (for sorting only; role is the semantic) */
const ROLE_SCORE: Record<IntentRole, number> = {
  primary: 1.0,
  prerequisite: 0.9,
  supporting: 0.5,
  incidental: 0.2,
  irrelevant: 0.0,
};

/** Role ranking used by layered target selection */
const ROLE_ORDER: Record<IntentRole, number> = {
  primary: 5,
  prerequisite: 4,
  supporting: 3,
  incidental: 2,
  irrelevant: 1,
};

/**
 * extractTestIntent — deterministic extraction of the structured test intent
 * from user instructions.
 *
 * Design: keyword groups are NOT used for per-feature scoring anymore.
 * They only feed deterministic decisions:
 *   1. Prerequisite detection (login etc.)
 *   2. Required action verbs (create/delete/...)
 *   3. Primary module CANDIDATES (quoted strings / verb objects)
 *
 * Module candidates are name-based CANDIDATES, not final decisions —
 * the real signal is matching them against discovered module/surface/feature
 * names in assignIntentRoles().
 */
export function extractTestIntent(instructions: string | undefined): TestIntent | undefined {
  if (!instructions || instructions.trim().length === 0) return undefined;
  const instrLower = instructions.toLowerCase();

  // 1. Prerequisites: login etc.
  const prerequisites: string[] = [];
  for (const p of PREREQUISITE_PATTERNS) {
    if (p.terms.some(t => instrLower.includes(t))) {
      prerequisites.push(p.prerequisite);
    }
  }

  // 2. Required actions: CRUD verbs found in instructions
  const requiredActions: string[] = [];
  for (const [action, terms] of Object.entries(ACTION_TERMS)) {
    if (terms.some(t => instrLower.includes(t))) {
      requiredActions.push(action);
    }
  }

  // 3. Primary module candidates: quoted names, verb objects, "模块X" patterns.
  const primaryModules: string[] = [];
  const CJK = '[\u4e00-\u9fa5\\w]';
  const candidatePatterns: Array<{ re: RegExp; group: number }> = [
    { re: /模块[\s“\"‘']*([一-龥\w]{2,20})/g, group: 1 },
    { re: /对[\s“\"‘]*([一-龥\w]{2,20})(?:进行)?/g, group: 1 },
    { re: /(?:测试|验证|检查|进入|访问)([一-龥\w]{2,10})/g, group: 1 },
    { re: /[“\"‘]([^”\"’]{2,20})[”\"’]/g, group: 1 },
  ];
  for (const { re, group } of candidatePatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(instructions)) !== null) {
      let candidate = (m[group] ?? '').trim();
      // Strip structural prefixes/suffixes
      candidate = candidate
        .replace(/^(?:\u5bf9|\u6a21\u5757|\u6d4b\u8bd5|\u9a8c\u8bc1|\u8fdb\u5165|\u8bbf\u95ee|\u7684)/, '')
        .replace(/(?:\u6a21\u5757|\u529f\u80fd|\u7cfb\u7edf|\u9875\u9762)$/, '')
        .trim();
      if (candidate.length >= 2 && !NON_MODULE_WORDS.has(candidate)) {
        primaryModules.push(candidate);
      }
    }
  }

  return {
    primaryModules: [...new Set(primaryModules)],
    primaryFeatures: [],
    prerequisites,
    requiredActions,
    depth: 'normal',
  };
}

/** Resolver result for module/surface/feature intent binding. */
export interface IntentResolution {
  role: 'primary' | 'prerequisite' | 'supporting' | 'incidental' | 'irrelevant';
  matchedBy: 'module' | 'surface' | 'feature' | 'normalized' | 'prerequisite' | 'type' | 'none';
  confidence: number;
  pending: boolean;
}

function normalizeIntentEntity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_.\-/:：]+/g, '')
    .replace(/["'“”‘’「」『』()（）]/g, '')
    .trim();
}

function entityMatches(candidate: string, target: string): boolean {
  const c = normalizeIntentEntity(candidate);
  const t = normalizeIntentEntity(target);
  if (!c || !t || c.length < 2 || t.length < 2) return false;
  return c === t || c.includes(t) || t.includes(c);
}

/**
 * Semantic fallback for business-module labels. A module like "项目集"
 * and a control like "项目名称" share the meaningful stem "项目".
 * This is deliberately conservative (two or more consecutive CJK chars)
 * and is only used after exact module/surface matching fails.
 */
function entitySemanticMatches(candidate: string, target: string): boolean {
  if (entityMatches(candidate, target)) return true;
  const c = normalizeIntentEntity(candidate);
  const t = normalizeIntentEntity(target);
  if (!c || !t) return false;

  // Business names often share a two-character domain stem:
  // "项目集" ↔ "项目创建向导", "用户" ↔ "用户管理".
  // Use a conservative CJK bigram intersection rather than a broad fuzzy match.
  const cjkBigrams = (value: string): string[] => {
    const runs = value.match(/[一-龥]+/g) ?? [];
    const grams: string[] = [];
    for (const run of runs) {
      for (let i = 0; i < run.length - 1; i++) {
        grams.push(run.slice(i, i + 2));
      }
    }
    return grams;
  };
  const targetBigrams = new Set(cjkBigrams(t));
  return cjkBigrams(c).some(bigram => targetBigrams.has(bigram));
}

function isAuthSurface(surface: CoverageSurface): boolean {
  return /login|signin|auth|登录|密码/i.test(`${surface.url ?? ''} ${surface.title ?? ''}`);
}

/** Deterministic bilingual aliases for common business entities. */
const INTENT_ENTITY_ALIASES: Record<string, string[]> = {
  '项目集': ['项目集', '项目', 'project', 'program'],
  '用户': ['用户', 'user', 'member'],
  '产品': ['产品', 'product'],
  '测试': ['测试', 'test', 'qa'],
};

function entityAliasMatches(candidate: string, target: string): boolean {
  if (entitySemanticMatches(candidate, target)) return true;
  const c = normalizeIntentEntity(candidate);
  const t = normalizeIntentEntity(target);
  for (const [canonical, aliases] of Object.entries(INTENT_ENTITY_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeIntentEntity);
    const candidateInGroup = normalizedAliases.some(a => c.includes(a) || a.includes(c));
    const targetInGroup = normalizedAliases.some(a => t.includes(a) || a.includes(t));
    if (candidateInGroup && targetInGroup) return true;
    // The user target itself can be the canonical key while the page only
    // exposes an English URL/title alias.
    if (normalizeIntentEntity(canonical) === t && candidateInGroup) return true;
  }
  return false;
}

/**
 * Resolve a primary module against the current Coverage Model.
 * Module technical keys are fallback identity only; semantic names and
 * surface titles are preferred. No match is a PENDING intent, never irrelevant.
 */
export function resolveIntentModule(
  model: CoverageModel,
  moduleName: string
): { module?: CoverageModule; matchedBy: 'module' | 'surface' | 'normalized' | 'none'; confidence: number; pending: boolean } {
  const normalized = normalizeIntentEntity(moduleName);

  // 1. Semantic module name exact/normalized match
  for (const module of model.modules) {
    if (entityMatches(module.name, moduleName)) {
      return { module, matchedBy: normalizeIntentEntity(module.name) === normalized ? 'module' : 'normalized', confidence: 1.0, pending: false };
    }
  }

  // 2. Surface semantic title/labels match
  for (const module of model.modules) {
    for (const surface of module.surfaces) {
      const labels = [surface.title ?? '', surface.url ?? '', ...(surface.semanticLabels ?? [])];
      if (labels.some(label => entityAliasMatches(label, moduleName))) {
        return { module, matchedBy: 'surface', confidence: 0.9, pending: false };
      }
    }
  }

  // 3. Technical key fallback (never rename the key)
  for (const module of model.modules) {
    if (entityMatches(module.key, moduleName)) {
      return { module, matchedBy: 'normalized', confidence: 0.7, pending: false };
    }
  }

  // 4. No current match — preserve as pending, not irrelevant
  return { matchedBy: 'none', confidence: 0, pending: true };
}

/** Resolve a primary module against one surface's features. */
export function resolveIntentSurface(
  moduleName: string,
  surface: CoverageSurface
): IntentResolution {
  const labels = [surface.title ?? '', ...(surface.semanticLabels ?? [])];
  if (labels.some(label => entityAliasMatches(label, moduleName))) {
    return { role: 'primary', matchedBy: 'surface', confidence: 0.95, pending: false };
  }

  // Feature-level exact/normalized semantic match
  if (surface.features.some(feature => entitySemanticMatches(feature.name, moduleName))) {
    return { role: 'primary', matchedBy: 'feature', confidence: 0.85, pending: false };
  }

  // The module may not be visible on this surface yet — preserve pending intent.
  return { role: 'incidental', matchedBy: 'none', confidence: 0, pending: true };
}

/** Resolve a primary module against a feature. */
export function resolveIntentFeature(
  moduleName: string,
  feature: CoverageFeature
): IntentResolution {
  if (entityMatches(feature.name, moduleName)) {
    return { role: 'primary', matchedBy: 'feature', confidence: 0.85, pending: false };
  }
  return { role: 'incidental', matchedBy: 'none', confidence: 0, pending: true };
}

export function assignIntentRoles(
  model: CoverageModel,
  instructions: string | undefined
): TestIntent | undefined {
  const intent = extractTestIntent(instructions);

  const allFeatures: CoverageFeature[] = [];
  for (const module of model.modules) {
    for (const surface of module.surfaces) {
      for (const feature of surface.features) {
        allFeatures.push(feature);
      }
    }
  }

  if (!intent) {
    // No instructions → no task context. Everything is incidental;
    // scope falls back to intrinsic priority only.
    for (const feature of allFeatures) {
      feature.intentRelevance = {
        role: 'incidental',
        score: ROLE_SCORE.incidental,
        confidence: 1.0,
        source: 'user',
        reason: 'No instructions provided \u2014 defaulting to incidental',
      };
    }
    return undefined;
  }

  const moduleNamesLower = intent.primaryModules.map(m => m.toLowerCase());
  const prerequisiteTerms = PREREQUISITE_PATTERNS.flatMap(p => p.terms);

  // Resolve the pending primary modules against the CURRENT model.
  // A miss is intentionally preserved as pending; it is not downgraded to
  // irrelevant. When a later surface appears, assignIntentRoles runs again.
  for (const module of model.modules) {
    let moduleMatched = false;
    for (const moduleName of intent.primaryModules) {
      const resolution = resolveIntentModule(model, moduleName);
      if (resolution.module?.key !== module.key) continue;

      module.intent = {
        role: 'primary',
        matchedBy: resolution.matchedBy,
        confidence: resolution.confidence,
      };
      // Set semantic name only when it came from intent resolution; keep
      // technical key stable and do not overwrite unrelated business names.
      if (resolution.matchedBy === 'surface' || resolution.matchedBy === 'module') {
        module.name = module.name || moduleName;
      }
      moduleMatched = true;
      break;
    }

    // Reconcile each surface independently; a module can contain both
    // primary and unrelated surfaces.
    for (const surface of module.surfaces) {
      const surfaceMatch = intent.primaryModules
        .map(name => ({ name, resolution: resolveIntentSurface(name, surface) }))
        .find(item => !item.resolution.pending);
      if (surfaceMatch) {
        surface.intent = {
          role: 'primary',
          matchedBy: surfaceMatch.resolution.matchedBy,
          confidence: surfaceMatch.resolution.confidence,
        };
      } else if (moduleMatched) {
        surface.intent = { role: 'supporting', matchedBy: 'module', confidence: 0.65 };
      }
    }
  }

  for (const module of model.modules) {
    for (const surface of module.surfaces) {
      const surfaceIsPrimary = surface.intent?.role === 'primary';
      for (const feature of surface.features) {
        const nameLower = feature.name.toLowerCase();
        let role: IntentRole = 'irrelevant';
        let confidence = 0.6;
        let reason = '';
        let matched = false;

        // 1. Primary: current surface/module resolved to a requested module.
        // This is the lifecycle fix: once the target surface appears, ALL
        // business features on it can be primary without naming each control.
        if (
          surfaceIsPrimary &&
          !prerequisiteTerms.some(t => nameLower.includes(t)) &&
          !/\u5e2e\u52a9|\u5173\u4e8e|\u9690\u79c1|\u6761\u6b3e|help|about|privacy|terms|copyright/i.test(feature.name) &&
          feature.type !== 'navigation' &&
          feature.type !== 'tab' &&
          feature.type !== 'link'
        ) {
          role = 'primary';
          confidence = surface.intent?.confidence ?? 0.8;
          reason = `Belongs to primary surface "${surface.title ?? surface.key}"`;
          matched = true;
        }

        // 2. Feature-level primary match, even if surface title is generic
        if (!matched) {
          for (const modName of intent.primaryModules) {
            const resolution = resolveIntentFeature(modName, feature);
            if (!resolution.pending) {
              role = 'primary';
              confidence = resolution.confidence;
              reason = `Feature matches requested module "${modName}"`;
              matched = true;
              break;
            }
          }
        }

        // 3. Prerequisite: login etc.
        if (!matched && prerequisiteTerms.some(t => nameLower.includes(t))) {
          role = 'prerequisite';
          confidence = 0.9;
          reason = 'Prerequisite for reaching the test target (login flow)';
          matched = true;
        }

        // 4-6. Default classification by name/type
        if (!matched) {
          if (/\u5e2e\u52a9|\u5173\u4e8e|\u9690\u79c1|\u6761\u6b3e|help|about|privacy|terms|copyright/i.test(feature.name)) {
            role = 'irrelevant';
            confidence = 0.8;
            reason = 'Decorative/legal/help element';
          } else if (feature.type === 'navigation' || feature.type === 'tab' || feature.type === 'link') {
            role = 'incidental';
            confidence = 0.7;
            reason = 'Navigation element \u2014 outside requested test scope';
          } else if (feature.type !== 'unknown') {
            role = 'supporting';
            confidence = 0.6;
            reason = 'Functional element \u2014 available if the flow needs it';
          } else {
            role = 'irrelevant';
            confidence = 0.5;
            reason = 'Unknown element type';
          }
        }

        feature.intentRelevance = {
          role,
          score: ROLE_SCORE[role],
          confidence,
          source: 'user',
          matchedTerms: matched ? [feature.name] : undefined,
          reason,
        };
      }
    }
  }

  return intent;
}

/** Role score lookup (for sorting/logging; role is the semantic) */
export function getRoleScore(role: IntentRole): number {
  return ROLE_SCORE[role];
}

/** Role ranking lookup (used by layered target selection) */
export function getRoleOrder(role: IntentRole): number {
  return ROLE_ORDER[role];
}

/**
 * Get effective priority from module \u2192 surface \u2192 feature (max wins).
 * Priority answers "how important is this feature in general" \u2014
 * it never explains what the user wants to test (that is Intent's job).
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

/**
 * Mark a scenario as skipped with a reason — honest coverage.
 *
 * A skipped scenario is NOT tested (coverage ≠ outcome), but it is also
 * no longer a gap — the scheduling layer gave up on it for a recorded
 * reason (e.g. target stagnation). It stays visible in reports as:
 *   status: skipped, outcome: skipped, evidence.reason: why
 */
export function markScenarioSkipped(
  feature: CoverageFeature,
  scenarioType: ScenarioType,
  reason: string
): void {
  const scenario = feature.scenarios[scenarioType];
  if (!scenario) return;

  // Only skip scenarios that haven't been tested
  if (scenario.status === 'tested' || scenario.status === 'not_applicable') return;

  scenario.status = 'skipped';
  scenario.outcome = 'skipped';
  scenario.testedAt = Date.now();
  if (!scenario.evidence) {
    scenario.evidence = [];
  }
  scenario.evidence.push({
    action: 'skipped',
    result: 'skipped',
    turn: 0,
    timestamp: Date.now(),
    reason,
  });
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

// ─── Scope Filtering ─────────────────────────────────────────────────────────

/**
 * Check whether a feature is within the policy's required scope.
 *
 * Scope semantics:
 *   all              → every feature is in scope
 *   intent_relevant  → intent score > 0.5 OR effective priority is critical
 *   critical         → effective priority is critical OR high
 *   discovered_core  → intent score > 0.5 OR critical OR high
 *
 * Features outside scope are excluded from required coverage (gaps,
 * isFeatureCovered, module/surface coverage) — they are still tracked
 * and can be tested opportunistically, but the exit criteria don't
 * demand them.
 */
/**
 * Check whether a feature is within the policy's required scope.
 *
 * Scope is LAYERED on intent role + intrinsic priority — it does NOT
 * try to understand user intent itself (that is the Intent Model's job).
 *
 *   intent         → primary | prerequisite only (Smoke: exactly what the user asked)
 *   core           → primary | prerequisite | critical intrinsic (Confirmation)
 *   comprehensive  → primary | prerequisite | supporting (all business features;
 *                    excludes incidental/irrelevant) (Acceptance)
 *   all            → everything (Full)
 */
export function isFeatureInScope(
  module: CoverageModule,
  surface: CoverageSurface,
  feature: CoverageFeature,
  policy: CoveragePolicy
): boolean {
  const role = feature.intentRelevance?.role;

  switch (policy.scope) {
    case 'intent':
      return role === 'primary' || role === 'prerequisite';

    case 'core': {
      if (role === 'primary' || role === 'prerequisite') return true;
      // Critical intrinsic features are always core business capability
      return effectivePriority(module, surface, feature) === 'critical';
    }

    case 'comprehensive':
      // All business features — excludes incidental (navigation) and
      // irrelevant (help/legal) elements
      return role === 'primary' || role === 'prerequisite' || role === 'supporting';

    case 'all':
    default:
      return true;
  }
}

// ─── Coverage Gap Analysis ────────────────────────────────────────

/**
 * Find the feature for a target (helper).
 */
function findFeature(model: CoverageModel, target: CoverageTarget): CoverageFeature | undefined {
  for (const m of model.modules) {
    const surface = m.surfaces.find(s => s.key === target.surfaceKey);
    if (!surface) continue;
    return surface.features.find(f => f.key === target.featureKey);
  }
  return undefined;
}

/**
 * Get all uncovered or partially covered targets WITHIN the policy scope.
 *
 * Ordering is LAYERED (not a single additive score):
 *   1. Intent role (primary > prerequisite > supporting > incidental > irrelevant)
 *   2. Intrinsic priority (critical > high > normal > low)
 *   3. Scenario depth weight (normal > validation > boundary > error > lifecycle)
 *
 * Layering guarantees a primary+uncovered target ALWAYS outranks an
 * incidental one — no numeric coincidence can invert the order.
 */
export function getCoverageGaps(
  model: CoverageModel,
  policy: CoveragePolicy,
  instructions?: string,
  currentSurfaceOnly = false
): CoverageTarget[] {
  const gaps: CoverageTarget[] = [];

  const SCENARIO_ORDER: Record<ScenarioType, number> = {
    normal: 5, validation: 4, boundary: 3, error: 2, lifecycle: 1,
  };

  for (const module of model.modules) {
    for (const surface of module.surfaces) {
      // Target selection is local to the currently observed surface. Keep
      // prior surface coverage in the model, but never let stale targets
      // compete after a major navigation change.
      if (currentSurfaceOnly && model.currentSurfaceKey && surface.key !== model.currentSurfaceKey) continue;

      for (const feature of surface.features) {
        if (!isFeatureInScope(module, surface, feature, policy)) continue;

        for (const [scenarioType, coverage] of Object.entries(feature.scenarios) as [ScenarioType, ScenarioCoverage][]) {
          if (coverage.status === 'not_applicable') continue;
          if (coverage.status === 'tested') continue;
          if (coverage.status === 'skipped') continue;

          const isRequired = policy.scenarioDepth[scenarioType] === 'required';
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

  // Layered sort: role first, then priority, then scenario depth.
  gaps.sort((a, b) => {
    const fa = findFeature(model, a);
    const fb = findFeature(model, b);
    const roleA = fa?.intentRelevance ? getRoleOrder(fa.intentRelevance.role) : 0;
    const roleB = fb?.intentRelevance ? getRoleOrder(fb.intentRelevance.role) : 0;
    if (roleA !== roleB) return roleB - roleA;

    const prioA = PRIORITY_ORDER[a.priority.level] ?? 2;
    const prioB = PRIORITY_ORDER[b.priority.level] ?? 2;
    if (prioA !== prioB) return prioB - prioA;

    return (SCENARIO_ORDER[b.scenarioType] ?? 0) - (SCENARIO_ORDER[a.scenarioType] ?? 0);
  });

  return gaps;
}

/**
 * Select the next coverage target to test.
 *
 * LAYERED selection (replaces additive scoring):
 *   Layer 1: primary role targets (the user explicitly asked for these)
 *   Layer 2: prerequisite targets (login etc. — required to reach primary)
 *   Layer 3: critical/high intrinsic priority
 *   Layer 4: everything else in scope (already gap-sorted)
 *
 * Skipped targets (stagnated) are excluded to prevent infinite loops.
 */
export function selectNextTarget(
  model: CoverageModel,
  policy: CoveragePolicy,
  instructions?: string,
  skippedTargets?: string[]
): CoverageTarget | null {
  const gaps = getCoverageGaps(model, policy, instructions, true);
  if (gaps.length === 0) return null;

  const skipped = new Set(skippedTargets ?? []);

  function findGap(predicate?: (g: CoverageTarget) => boolean): CoverageTarget | null {
    for (const g of gaps) {
      if (skipped.has(g.featureKey)) continue;
      if (predicate && !predicate(g)) continue;
      return g;
    }
    return null;
  }

  function featureFor(g: CoverageTarget): CoverageFeature | undefined {
    return findFeature(model, g);
  }

  // Layer 1: primary
  const primary = findGap(g => featureFor(g)?.intentRelevance?.role === 'primary');
  if (primary) return primary;

  // Layer 2: prerequisite
  const prereq = findGap(g => featureFor(g)?.intentRelevance?.role === 'prerequisite');
  if (prereq) return prereq;

  // Layer 3: critical/high intrinsic
  const highPriority = findGap(g => {
    const lvl = g.priority.level;
    return lvl === 'critical' || lvl === 'high';
  });
  if (highPriority) return highPriority;

  // Layer 4: best remaining (gaps are already sorted by the layered sort)
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
 *   2. Required coverage satisfied (scope-filtered: only in-scope features count)
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

  // 2. Required coverage (major modules) — scope-filtered
  //    Out-of-scope features (e.g. unrelated links under 'intent_relevant'
  //    scope) must NOT block exit. Count a surface covered if all its
  //    IN-SCOPE features are covered.
  const majorModules = model.modules.filter(m =>
    m.priority.level === 'critical' || m.priority.level === 'high'
  );
  const requiredCovered = majorModules.length === 0 ||
    majorModules.every(m => moduleInScopeFeaturesCovered(m, policy));

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

/**
 * Check whether all IN-SCOPE features of a module are covered.
 * Out-of-scope features are ignored for exit-criteria purposes.
 * A module with zero in-scope features counts as covered (vacuous truth).
 */
function moduleInScopeFeaturesCovered(
  module: CoverageModule,
  policy: CoveragePolicy
): boolean {
  for (const surface of module.surfaces) {
    for (const feature of surface.features) {
      if (!isFeatureInScope(module, surface, feature, policy)) continue;
      // Skipped scenarios don't block exit (honest coverage: recorded, not demanded)
      const requiredScenarios = (Object.entries(feature.scenarios) as [ScenarioType, ScenarioCoverage][])
        .filter(([type, cov]) =>
          cov.status !== 'not_applicable' &&
          cov.status !== 'skipped' &&
          policy.scenarioDepth[type] === 'required'
        );
      if (!requiredScenarios.every(([_, cov]) => cov.status === 'tested')) {
        return false;
      }
    }
  }
  return true;
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
      // Show intent role for the gap (primary/prerequisite/...)
      let roleStr = '';
      for (const m of model.modules) {
        const s = m.surfaces.find(ss => ss.key === gap.surfaceKey);
        if (!s) continue;
        const f = s.features.find(ff => ff.key === gap.featureKey);
        if (f?.intentRelevance) {
          roleStr = ` role=${f.intentRelevance.role}`;
        }
        break;
      }
      lines.push(`- ${gap.featureKey}/${gap.scenarioType} [${gap.priority.level}]${roleStr}`);
    }
  }

  return lines.join('\n');
}

// ─── Default Policies ────────────────────────────────────────────────────────

export const COVERAGE_POLICIES: Record<TestType, CoveragePolicy> = {
  smoke: {
    testType: 'smoke',
    scope: 'intent',
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
    scope: 'core',
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
    scope: 'comprehensive',
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
    scope: 'all',
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
