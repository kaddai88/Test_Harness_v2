import { describe, it, expect } from 'vitest';
import {
  createCoverageModel,
  registerModule,
  registerSurface,
  registerFeature,
  extractTestIntent,
  assignIntentRoles,
  resolveIntentModule,
  resolveIntentSurface,
  type CoverageModel,
} from './coverage.js';

const INSTR = '使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试';

function makeLoginSurfaceModel(): CoverageModel {
  const model = createCoverageModel();
  registerModule(model, 'host::login', 'Zentao 登录');
  const surface = registerSurface(model, 'host::login', 'host::login', 'http://host/login', '用户登录');
  registerFeature(surface, 'login', '用户名', 'text-input');
  registerFeature(surface, 'password', '密码', 'text-input');
  model.currentSurfaceKey = surface.key;
  return model;
}

describe('P0-A: pending module intent', () => {
  it('preserves primary module when it is absent from login surface', () => {
    const model = makeLoginSurfaceModel();
    const intent = assignIntentRoles(model, INSTR);
    expect(intent?.primaryModules).toContain('项目集');
    expect(model.modules[0]!.intent).toBeUndefined();
    expect(model.modules[0]!.surfaces[0]!.features.every(f => f.intentRelevance?.role !== 'primary')).toBe(true);
  });

  it('resolves the pending module when a later surface title appears', () => {
    const model = makeLoginSurfaceModel();
    assignIntentRoles(model, INSTR);

    const module = registerModule(model, 'host::project', '项目集');
    const surface = registerSurface(model, module.key, 'host::project', 'http://host/project', '项目集列表');
    registerFeature(surface, 'create', '创建项目集', 'button');
    registerFeature(surface, 'name', '项目集名称', 'text-input');

    const resolution = resolveIntentModule(model, '项目集');
    expect(resolution.module?.key).toBe('host::project');
    expect(resolution.pending).toBe(false);
    expect(resolveIntentSurface('项目集', surface).role).toBe('primary');

    assignIntentRoles(model, INSTR);
    expect(module.intent?.role).toBe('primary');
    expect(surface.intent?.role).toBe('primary');
    expect(surface.features.every(f => f.intentRelevance?.role === 'primary')).toBe(true);
  });

  it('keeps technical module key distinct from semantic business name', () => {
    const model = createCoverageModel();
    const module = registerModule(model, '185_200_65_4::zentao_projectbrowsehtml', '项目集列表');
    expect(module.key).toContain('185_200_65_4');
    expect(module.name).toBe('项目集列表');
    expect(resolveIntentModule(model, '项目集').module?.key).toBe(module.key);
  });
});

describe('P0-B: major surface reconciliation', () => {
  it('does not reset already-covered features when binding a new primary surface', () => {
    const model = makeLoginSurfaceModel();
    assignIntentRoles(model, INSTR);
    const login = model.modules[0]!.surfaces[0]!.features[0]!;
    login.scenarios.normal.status = 'tested';

    const module = registerModule(model, 'host::project', '项目集');
    const surface = registerSurface(model, module.key, 'host::project', 'http://host/project', '项目集列表');
    registerFeature(surface, 'create', '创建项目集', 'button');
    assignIntentRoles(model, INSTR);

    expect(login.scenarios.normal.status).toBe('tested');
    expect(surface.intent?.role).toBe('primary');
  });

  it('reconciliation can promote a surface without requiring feature-name matches', () => {
    const model = createCoverageModel();
    registerModule(model, 'host::module', 'technical-module');
    const surface = registerSurface(model, 'host::module', 'host::module', 'http://host/program', '项目集管理');
    registerFeature(surface, 'f1', '创建', 'button');
    registerFeature(surface, 'f2', '名称', 'text-input');

    assignIntentRoles(model, INSTR);
    expect(surface.intent?.role).toBe('primary');
    expect(surface.features.find(f => f.key === 'f1')?.intentRelevance?.role).toBe('primary');
  });
});
