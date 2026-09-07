/**
 * Tests for Planner — Coverage Target → TestPlan
 *
 * Test coverage:
 *   1. calculateRiskScore() - risk assessment
 *   2. selectPlannerLevel() - planner selection logic
 *   3. deterministicPlanner - simple patterns
 *   4. templatePlanner - UI pattern handlers
 *   5. generateTestPlan() - main entry point
 *   6. generateAllPlans() - batch planning
 */
import { describe, it, expect } from "vitest";
import {
  calculateRiskScore,
  selectPlannerLevel,
  generateTestPlan,
  generateAllPlans,
  validateTestPlan,
} from "./planner.js";
import {
  createCoverageModel,
  registerModule,
  registerSurface,
  registerFeature,
  COVERAGE_POLICIES,
  type CoverageModule,
  type CoverageSurface,
  type CoverageFeature,
  type CoverageTarget,
  type PriorityInfo,
} from "./coverage.js";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function createTestModule(priority: PriorityInfo = { level: 'normal', source: 'llm' }): CoverageModule {
  return {
    key: 'test-module',
    name: 'Test Module',
    priority,
    surfaces: [],
  };
}

function createTestSurface(priority: PriorityInfo = { level: 'normal', source: 'llm' }): CoverageSurface {
  return {
    key: 'test-surface',
    url: 'http://example.com/test',
    title: 'Test Surface',
    priority,
    coverageStatus: 'uncovered',
    executionStatus: 'idle',
    features: [],
  };
}

function createTestFeature(
  type: 'button' | 'link' | 'form' | 'table' | 'text-input' | 'checkbox' = 'button',
  priority: PriorityInfo = { level: 'normal', source: 'llm' }
): CoverageFeature {
  const feature: CoverageFeature = {
    key: `test-${type}`,
    name: `Test ${type}`,
    type,
    priority,
    scenarios: {
      normal: { status: 'not_tested' },
      validation: { status: 'not_applicable' },
      boundary: { status: 'not_applicable' },
      error: { status: 'not_applicable' },
      lifecycle: { status: 'not_applicable' },
    },
  };
  return feature;
}

function createTestTarget(
  surfaceKey = 'test-surface',
  featureKey = 'test-button',
  scenarioType: 'normal' | 'validation' | 'boundary' | 'error' = 'normal',
  priorityLevel: 'critical' | 'high' | 'normal' | 'low' = 'normal'
): CoverageTarget {
  return {
    surfaceKey,
    featureKey,
    scenarioType,
    priority: { level: priorityLevel, source: 'llm' },
  };
}

// ─── 1. calculateRiskScore() ─────────────────────────────────────────────────

describe("calculateRiskScore", () => {
  it("returns higher score for critical priority", () => {
    const module = createTestModule({ level: 'critical', source: 'user' });
    const surface = createTestSurface();
    const feature = createTestFeature('button', { level: 'critical', source: 'user' });

    const score = calculateRiskScore(surface, feature, module);
    expect(score).toBeGreaterThanOrEqual(4); // critical = 4 points
  });

  it("returns higher score for high priority", () => {
    const module = createTestModule({ level: 'high', source: 'system' });
    const surface = createTestSurface();
    const feature = createTestFeature('button', { level: 'high', source: 'system' });

    const score = calculateRiskScore(surface, feature, module);
    expect(score).toBeGreaterThanOrEqual(3); // high = 3 points
  });

  it("returns lower score for normal priority", () => {
    const module = createTestModule({ level: 'normal', source: 'llm' });
    const surface = createTestSurface();
    const feature = createTestFeature('link', { level: 'normal', source: 'llm' });

    const score = calculateRiskScore(surface, feature, module);
    expect(score).toBeLessThan(4);
  });

  it("adds score for data mutation features (button, form)", () => {
    const module = createTestModule();
    const surface = createTestSurface();
    
    const buttonFeature = createTestFeature('button');
    const linkFeature = createTestFeature('link');

    const buttonScore = calculateRiskScore(surface, buttonFeature, module);
    const linkScore = calculateRiskScore(surface, linkFeature, module);

    expect(buttonScore).toBeGreaterThan(linkScore);
  });

  it("adds higher score for destructive actions (delete, remove)", () => {
    const module = createTestModule();
    const surface = createTestSurface();
    
    const deleteFeature: CoverageFeature = {
      key: 'delete-btn',
      name: 'Delete Item',
      type: 'button',
      priority: { level: 'normal', source: 'llm' },
      scenarios: {
        normal: { status: 'not_tested' },
        validation: { status: 'not_applicable' },
        boundary: { status: 'not_applicable' },
        error: { status: 'not_applicable' },
        lifecycle: { status: 'not_applicable' },
      },
    };

    const normalFeature = createTestFeature('button');
    normalFeature.name = 'Submit';

    const deleteScore = calculateRiskScore(surface, deleteFeature, module);
    const normalScore = calculateRiskScore(surface, normalFeature, module);

    expect(deleteScore).toBeGreaterThan(normalScore);
  });

  it("adds score for form complexity with many fields", () => {
    const module = createTestModule();
    const surface = createTestSurface();
    
    // Add many form fields to surface
    for (let i = 0; i < 12; i++) {
      surface.features.push({
        key: `field-${i}`,
        name: `Field ${i}`,
        type: 'text-input',
        priority: { level: 'normal', source: 'llm' },
        scenarios: {
          normal: { status: 'not_tested' },
          validation: { status: 'not_applicable' },
          boundary: { status: 'not_applicable' },
          error: { status: 'not_applicable' },
          lifecycle: { status: 'not_applicable' },
        },
      });
    }

    const formFeature = createTestFeature('form');
    const score = calculateRiskScore(surface, formFeature, module);

    expect(score).toBeGreaterThanOrEqual(3); // form with many fields
  });

  it("adds score for complex field types (dropdown, upload)", () => {
    const module = createTestModule();
    const surface = createTestSurface();
    
    // Add complex fields
    surface.features.push(
      { key: 'dropdown1', name: 'Dropdown 1', type: 'dropdown', priority: { level: 'normal', source: 'llm' },
        scenarios: { normal: { status: 'not_tested' }, validation: { status: 'not_applicable' },
          boundary: { status: 'not_applicable' }, error: { status: 'not_applicable' }, lifecycle: { status: 'not_applicable' } } },
      { key: 'dropdown2', name: 'Dropdown 2', type: 'dropdown', priority: { level: 'normal', source: 'llm' },
        scenarios: { normal: { status: 'not_tested' }, validation: { status: 'not_applicable' },
          boundary: { status: 'not_applicable' }, error: { status: 'not_applicable' }, lifecycle: { status: 'not_applicable' } } },
      { key: 'upload1', name: 'Upload 1', type: 'upload', priority: { level: 'normal', source: 'llm' },
        scenarios: { normal: { status: 'not_tested' }, validation: { status: 'not_applicable' },
          boundary: { status: 'not_applicable' }, error: { status: 'not_applicable' }, lifecycle: { status: 'not_applicable' } } },
    );

    const formFeature = createTestFeature('form');
    const score = calculateRiskScore(surface, formFeature, module);

    expect(score).toBeGreaterThanOrEqual(2);
  });

  it("adds score for unknown feature type", () => {
    const module = createTestModule();
    const surface = createTestSurface();
    const unknownFeature: CoverageFeature = {
      key: 'unknown',
      name: 'Unknown Widget',
      type: 'unknown',
      priority: { level: 'normal', source: 'llm' },
      scenarios: {
        normal: { status: 'not_tested' },
        validation: { status: 'not_applicable' },
        boundary: { status: 'not_applicable' },
        error: { status: 'not_applicable' },
        lifecycle: { status: 'not_applicable' },
      },
    };

    const score = calculateRiskScore(surface, unknownFeature, module);
    expect(score).toBeGreaterThanOrEqual(2); // unknown = 2 points
  });
});

// ─── 2. selectPlannerLevel() ─────────────────────────────────────────────────

describe("selectPlannerLevel", () => {
  it("returns deterministic for low risk + simple feature in smoke test", () => {
    const level = selectPlannerLevel(1, 'link', 'smoke');
    expect(level).toBe('deterministic');
  });

  it("returns deterministic for low risk in smoke test", () => {
    const level = selectPlannerLevel(2, 'button', 'smoke');
    expect(level).toBe('deterministic');
  });

  it("returns template for medium risk in confirmation test", () => {
    const level = selectPlannerLevel(4, 'form', 'confirmation');
    expect(level).toBe('template');
  });

  it("returns llm for high risk in full test", () => {
    const level = selectPlannerLevel(5, 'form', 'full');
    expect(level).toBe('llm');
  });

  it("returns deterministic for link/tab/navigation regardless of risk", () => {
    expect(selectPlannerLevel(2, 'link', 'full')).toBe('deterministic');
    expect(selectPlannerLevel(3, 'tab', 'full')).toBe('deterministic');
    expect(selectPlannerLevel(2, 'navigation', 'full')).toBe('deterministic');
  });

  it("returns template for form in confirmation test", () => {
    const level = selectPlannerLevel(3, 'form', 'confirmation');
    expect(level).toBe('template');
  });

  it("returns llm for high risk form in acceptance test", () => {
    const level = selectPlannerLevel(6, 'form', 'acceptance');
    expect(level).toBe('llm');
  });

  it("thresholds are stricter for full test type", () => {
    // Same risk score, different test types
    const smokeLevel = selectPlannerLevel(3, 'form', 'smoke');
    const fullLevel = selectPlannerLevel(3, 'form', 'full');

    // Full test should use more advanced planner
    const levelOrder = { deterministic: 0, template: 1, llm: 2 };
    expect(levelOrder[fullLevel]).toBeGreaterThanOrEqual(levelOrder[smokeLevel]);
  });
});

// ─── 3. generateTestPlan() - Planner Selection ───────────────────────────────

describe("generateTestPlan", () => {
  it("selects deterministic planner for simple link", () => {
    const model = createCoverageModel();
    const module = registerModule(model, 'mod1', 'Module 1', { level: 'normal', source: 'llm' });
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/page');
    const feature = registerFeature(surface, 'link1', 'Go to Details', 'link');

    const target: CoverageTarget = {
      surfaceKey: 'surf1',
      featureKey: 'link1',
      scenarioType: 'normal',
      priority: { level: 'normal', source: 'llm' },
    };

    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).not.toBeNull();
    expect(plan!.plannerLevel).toBe('deterministic');
    expect(plan!.steps.length).toBeGreaterThan(0);
  });

  it("selects template planner for form", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/form');
    registerFeature(surface, 'field1', 'Name', 'text-input');
    registerFeature(surface, 'field2', 'Email', 'text-input');
    const formFeature = registerFeature(surface, 'form1', 'Create Form', 'form');

    const target: CoverageTarget = {
      surfaceKey: 'surf1',
      featureKey: 'form1',
      scenarioType: 'normal',
      priority: { level: 'normal', source: 'llm' },
    };

    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.confirmation);

    expect(plan).not.toBeNull();
    expect(plan!.plannerLevel).toBe('template');
    expect(plan!.steps.some(s => s.description.includes('Fill'))).toBe(true);
  });

  it("selects llm planner for high-risk critical feature in full test", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1', { level: 'critical', source: 'user' });
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/critical');
    
    // Add complex form fields
    for (let i = 0; i < 8; i++) {
      registerFeature(surface, `field${i}`, `Field ${i}`, 'text-input');
    }
    registerFeature(surface, 'upload1', 'Upload File', 'upload');
    registerFeature(surface, 'dropdown1', 'Select Type', 'dropdown');
    
    const feature = registerFeature(surface, 'critical-form', 'Critical Process', 'form', 
      { level: 'critical', source: 'user' });

    const target: CoverageTarget = {
      surfaceKey: 'surf1',
      featureKey: 'critical-form',
      scenarioType: 'normal',
      priority: { level: 'critical', source: 'user' },
    };

    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.full);

    expect(plan).not.toBeNull();
    expect(plan!.plannerLevel).toBe('llm');
  });

  it("returns null for unknown target", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    registerSurface(model, 'mod1', 'surf1', 'http://example.com');

    const target: CoverageTarget = {
      surfaceKey: 'nonexistent-surface',
      featureKey: 'nonexistent-feature',
      scenarioType: 'normal',
      priority: { level: 'normal', source: 'llm' },
    };

    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).toBeNull();
  });
});

// ─── 4. Deterministic Planner Tests ──────────────────────────────────────────

describe("deterministicPlanner", () => {
  it("generates click step for link", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    registerFeature(surface, 'link1', 'View Details', 'link');

    const target = createTestTarget('surf1', 'link1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).not.toBeNull();
    expect(plan!.plannerLevel).toBe('deterministic');
    expect(plan!.steps[0]?.tool).toBe('browser_click');
    expect(plan!.steps[0]?.description).toContain('View Details');
  });

  it("generates click step for tab", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    registerFeature(surface, 'tab1', 'Settings Tab', 'tab');

    const target = createTestTarget('surf1', 'tab1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).not.toBeNull();
    expect(plan!.steps[0]?.description).toContain('Settings Tab');
    expect(plan!.steps[0]?.description).toContain('active');
  });

  it("generates check step for checkbox", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    registerFeature(surface, 'cb1', 'Accept Terms', 'checkbox');

    const target = createTestTarget('surf1', 'cb1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).not.toBeNull();
    expect(plan!.steps[0]?.tool).toBe('browser_check');
  });

  it("generates next page step for pagination", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    registerFeature(surface, 'page1', 'Next Page', 'pagination');

    const target = createTestTarget('surf1', 'page1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).not.toBeNull();
    expect(plan!.steps[0]?.description).toContain('next page');
  });

  it("generates boundary test for pagination", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    registerFeature(surface, 'page1', 'Pagination', 'pagination');

    const target = createTestTarget('surf1', 'page1', 'boundary');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.confirmation);

    expect(plan).not.toBeNull();
    expect(plan!.steps[0]?.description).toContain('first page');
    expect(plan!.steps[0]?.description).toContain('last page');
  });
});

// ─── 5. Template Planner Tests ───────────────────────────────────────────────

describe("templatePlanner", () => {
  it("generates form fill steps for form feature", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/form');
    registerFeature(surface, 'name', 'Name', 'text-input');
    registerFeature(surface, 'email', 'Email', 'text-input');
    registerFeature(surface, 'submit', 'Submit', 'button');
    registerFeature(surface, 'form1', 'Create Form', 'form');

    const target = createTestTarget('surf1', 'form1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.confirmation);

    expect(plan).not.toBeNull();
    expect(plan!.plannerLevel).toBe('template');
    expect(plan!.steps.some(s => s.description.includes('Fill'))).toBe(true);
    expect(plan!.steps.some(s => s.description.includes('Submit'))).toBe(true);
  });

  it("generates validation test for form", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/form');
    registerFeature(surface, 'name', 'Name', 'text-input');
    registerFeature(surface, 'form1', 'Form', 'form');

    const target = createTestTarget('surf1', 'form1', 'validation');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.confirmation);

    expect(plan).not.toBeNull();
    expect(plan!.steps.some(s => s.description.toLowerCase().includes('invalid') || 
                                  s.description.toLowerCase().includes('required'))).toBe(true);
  });

  it("generates table verification steps", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/list');
    registerFeature(surface, 'table1', 'User Table', 'table');

    const target = createTestTarget('surf1', 'table1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).not.toBeNull();
    expect(plan!.steps.some(s => s.description.includes('table'))).toBe(true);
  });

  it("generates search test steps", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/search');
    registerFeature(surface, 'search1', 'Search Box', 'search');

    const target = createTestTarget('surf1', 'search1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).not.toBeNull();
    expect(plan!.steps.some(s => s.description.toLowerCase().includes('search'))).toBe(true);
  });

  it("generates upload test steps", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/upload');
    registerFeature(surface, 'upload1', 'File Upload', 'upload');

    const target = createTestTarget('surf1', 'upload1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).not.toBeNull();
    expect(plan!.steps.some(s => s.description.toLowerCase().includes('upload'))).toBe(true);
  });

  it("generates CRUD delete steps with confirmation", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/list');
    registerFeature(surface, 'delete1', 'Delete Item', 'button');

    const target = createTestTarget('surf1', 'delete1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.confirmation);

    expect(plan).not.toBeNull();
    expect(plan!.steps.some(s => s.description.toLowerCase().includes('confirm'))).toBe(true);
  });
});

// ─── 6. generateAllPlans() ───────────────────────────────────────────────────

describe("generateAllPlans", () => {
  it("generates plans for all uncovered required targets", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    registerFeature(surface, 'link1', 'Link 1', 'link');
    registerFeature(surface, 'link2', 'Link 2', 'link');

    const plans = generateAllPlans(model, COVERAGE_POLICIES.smoke);

    expect(plans.length).toBe(2);
    expect(plans.every(p => p.plannerLevel === 'deterministic')).toBe(true);
  });

  it("does not generate plans for already tested scenarios", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    const feature = registerFeature(surface, 'link1', 'Link 1', 'link');
    
    // Mark as tested
    feature.scenarios.normal.status = 'tested';

    const plans = generateAllPlans(model, COVERAGE_POLICIES.smoke);

    expect(plans.length).toBe(0);
  });

  it("does not generate plans for not_applicable scenarios", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    registerFeature(surface, 'link1', 'Link 1', 'link');
    // link has validation/boundary/error as not_applicable

    const plans = generateAllPlans(model, COVERAGE_POLICIES.full);

    // Only normal scenario should have a plan
    expect(plans.length).toBe(1);
    expect(plans[0]!.scenarioType).toBe('normal');
  });

  it("sorts plans by priority (critical first)", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    registerFeature(surface, 'normal-link', 'Normal Link', 'link', { level: 'normal', source: 'llm' });
    registerFeature(surface, 'critical-link', 'Critical Link', 'link', { level: 'critical', source: 'user' });

    const plans = generateAllPlans(model, COVERAGE_POLICIES.smoke);

    expect(plans.length).toBe(2);
    expect(plans[0]!.priority).toBe('critical');
    expect(plans[1]!.priority).toBe('normal');
  });

  it("plans from different surfaces do not interfere", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface1 = registerSurface(model, 'mod1', 'surf1', 'http://example.com/page1');
    const surface2 = registerSurface(model, 'mod1', 'surf2', 'http://example.com/page2');
    registerFeature(surface1, 'link1', 'Link 1', 'link');
    registerFeature(surface2, 'link2', 'Link 2', 'link');

    const plans = generateAllPlans(model, COVERAGE_POLICIES.smoke);

    expect(plans.length).toBe(2);
    expect(plans[0]!.surfaceKey).not.toBe(plans[1]!.surfaceKey);
  });
});

// ─── 7. TestPlan/Coverage Boundary ───────────────────────────────────────────

describe("TestPlan/Coverage boundary", () => {
  it("TestPlan does not contain coverage status", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    registerFeature(surface, 'link1', 'Link 1', 'link');

    const target = createTestTarget('surf1', 'link1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    expect(plan).not.toBeNull();
    // TestPlan should NOT have 'completed' or 'status' fields
    const planObj = plan as unknown as Record<string, unknown>;
    expect(planObj.completed).toBeUndefined();
    expect(planObj.status).toBeUndefined();
  });

  it("Coverage update requires explicit updateScenario call, not TestPlan completion", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com');
    const feature = registerFeature(surface, 'link1', 'Link 1', 'link');

    // Generate plan
    const target = createTestTarget('surf1', 'link1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.smoke);

    // Coverage should still be not_tested
    expect(feature.scenarios.normal.status).toBe('not_tested');

    // Plan exists but coverage is not affected
    expect(plan).not.toBeNull();
    expect(feature.scenarios.normal.status).toBe('not_tested');
  });
});

// ─── 8. Planner Precedence (Regression Tests) ────────────────────────────────

describe("planner precedence", () => {
  it("CRUD button is NOT handled by form template", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/list');
    
    // Add a CRUD delete button
    const deleteFeature = registerFeature(surface, 'delete1', 'Delete Item', 'button');

    const target = createTestTarget('surf1', 'delete1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.confirmation);

    expect(plan).not.toBeNull();
    // Should be handled by CRUD template, NOT form template
    // CRUD template generates steps with "Confirm deletion"
    expect(plan!.steps.some(s => s.description.toLowerCase().includes('confirm'))).toBe(true);
    // Form template would generate steps with "Fill" - should NOT be present
    expect(plan!.steps.some(s => s.description.includes('Fill'))).toBe(false);
  });

  it("CRUD create button is handled by CRUD template, not form template", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/list');
    
    registerFeature(surface, 'create1', 'Create User', 'button');

    const target = createTestTarget('surf1', 'create1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.confirmation);

    expect(plan).not.toBeNull();
    // CRUD template generates "open creation form"
    expect(plan!.steps.some(s => s.description.toLowerCase().includes('creation form'))).toBe(true);
    // Form template would generate "Fill" steps - should NOT be present for button type
    expect(plan!.steps.some(s => s.description.includes('Fill'))).toBe(false);
  });

  it("form type feature IS handled by form template", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/form');
    registerFeature(surface, 'name', 'Name', 'text-input');
    registerFeature(surface, 'form1', 'User Form', 'form');

    const target = createTestTarget('surf1', 'form1', 'normal');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.confirmation);

    expect(plan).not.toBeNull();
    // Form template generates "Fill" steps
    expect(plan!.steps.some(s => s.description.includes('Fill'))).toBe(true);
  });
});

// ─── 9. Plan Validation ──────────────────────────────────────────────────────

describe("validateTestPlan", () => {
  it("returns false for empty steps", () => {
    const plan = {
      surfaceKey: 'surf1',
      featureKey: 'feat1',
      scenarioType: 'normal' as const,
      plannerLevel: 'deterministic' as const,
      steps: [],
      priority: 'normal' as const,
    };

    expect(validateTestPlan(plan)).toBe(false);
  });

  it("returns false for step without description", () => {
    const plan = {
      surfaceKey: 'surf1',
      featureKey: 'feat1',
      scenarioType: 'normal' as const,
      plannerLevel: 'deterministic' as const,
      steps: [{ description: '' }],
      priority: 'normal' as const,
    };

    expect(validateTestPlan(plan)).toBe(false);
  });

  it("returns false for invalid scenarioType", () => {
    const plan = {
      surfaceKey: 'surf1',
      featureKey: 'feat1',
      scenarioType: 'invalid' as any,
      plannerLevel: 'deterministic' as const,
      steps: [{ description: 'Do something' }],
      priority: 'normal' as const,
    };

    expect(validateTestPlan(plan)).toBe(false);
  });

  it("returns false for invalid plannerLevel", () => {
    const plan = {
      surfaceKey: 'surf1',
      featureKey: 'feat1',
      scenarioType: 'normal' as const,
      plannerLevel: 'invalid' as any,
      steps: [{ description: 'Do something' }],
      priority: 'normal' as const,
    };

    expect(validateTestPlan(plan)).toBe(false);
  });

  it("returns true for valid plan", () => {
    const plan = {
      surfaceKey: 'surf1',
      featureKey: 'feat1',
      scenarioType: 'normal' as const,
      plannerLevel: 'deterministic' as const,
      steps: [{ description: 'Click link' }],
      priority: 'normal' as const,
    };

    expect(validateTestPlan(plan)).toBe(true);
  });
});

// ─── 10. Empty Plan Fallback ─────────────────────────────────────────────────

describe("empty plan fallback", () => {
  it("unsupported scenario falls back to LLM planner instead of empty plan", () => {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'Module 1');
    const surface = registerSurface(model, 'mod1', 'surf1', 'http://example.com/list');
    
    // CRUD delete + validation scenario
    // CRUD template only handles 'normal' for delete, so validation would produce empty steps
    registerFeature(surface, 'delete1', 'Delete Item', 'button');

    const target = createTestTarget('surf1', 'delete1', 'validation');
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.confirmation);

    expect(plan).not.toBeNull();
    // Should NOT be empty - should fall back to LLM
    expect(plan!.steps.length).toBeGreaterThan(0);
    // Should be valid
    expect(validateTestPlan(plan!)).toBe(true);
    // Should be LLM since template couldn't handle it
    expect(plan!.plannerLevel).toBe('llm');
  });
});
