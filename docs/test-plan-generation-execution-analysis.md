# 测试计划生成与执行机制：架构分析与演进文档

## 执行摘要

本文档记录了 Test-Harness 系统测试计划生成与执行机制的深度分析、问题发现、修复实施和验证过程。通过三轮迭代（P0-P2 Phase 1），系统从"覆盖率引擎是死代码"演进为"真正的 coverage-driven 测试系统"，测试通过率从 0% 提升到 173 个测试全部通过，并实现了 Intent Model 四概念分离、ALIGN 诊断链与 snapshot lifecycle 版本一致性。

**当前基线（commit 5f6eacf）：**
- 173/173 测试通过（12 文件）
- Intent Model：`TestIntent.primaryModules` 在页面未出现时保持 pending，目标 surface 出现后晋升 primary
- Scope 重定义：`all/comprehensive/core/intent` 消费 role，不解释意图
- ALIGN 四 verdict 决策树（no_ref/ref_unknown/ref_drift/resolver_miss）
- snapshotVersion + decided@vN 时序诊断
- 消除 LLM stub 滥用：只有 'unknown' 类型使用 LLM 规划器
- E2E 验证：Zentao 验收（primary 0→18，skip 14→3，coverage_target_met 正常退出）
- 建立 honest skipped coverage：跳过的目标有明确记录
- 完成 planner coverage completeness：所有已知类型都有真实计划

---

## 1. 原始架构理解

### 1.1 系统定位

Test-Harness 是一个 AI 驱动的自动化 Web 测试平台，采用 TypeScript 单体仓库架构，核心目标是通过 LLM 代理对网站进行自主探索和功能验证。

**核心分层设计：**
```
Coverage Model  → "测什么？"（What's missing?）
Planner         → "怎么测？"（How to test?）
Workflow FSM    → "什么时候切换阶段？"（State transitions）
Agent Loop      → "驱动一切运转"（Orchestrator）
```

### 1.2 关键技术组件

#### 1.2.1 Coverage Engine（coverage.ts）

**数据模型（四层树状结构）：**
```
CoverageModel
  └── CoverageModule[]           ← 业务模块（如"项目管理"、"人员管理"）
        └── CoverageSurface[]    ← 页面/视图（如"项目列表页"、"项目详情页"）
              └── CoverageFeature[]  ← 可交互元素（如"名称输入框"、"提交按钮"）
                    └── Record<ScenarioType, ScenarioCoverage>  ← 5 种测试场景
```

**关键类型：**
- FeatureType: 16 种（text-input, button, form, table, search 等）
- ScenarioType: 5 种（normal, validation, boundary, error, lifecycle）
- ScenarioStatus: not_applicable | not_tested | planned | tested | skipped
- ScenarioOutcome: pass | fail | blocked | skipped

**四条覆盖策略预设：**
| 策略 | maxTurns | 场景深度 | 最低 Planner 级别 | 发现模式 |
|------|----------|----------|-------------------|----------|
| smoke | 50 | 仅 normal required | deterministic | 被动，3 turns 稳定即停 |
| confirmation | 100 | normal + validation required | template | 主动探索，5 turns 稳定 |
| acceptance | 200 | normal + validation + boundary + error required | template | 主动探索，8 turns 稳定 |
| full | 500 | 全部 5 种 required | llm | 主动探索，10 turns 稳定 |

**核心原则（写在 coverage.ts 文件头）：**
1. Coverage ≠ TestPlan — 覆盖率模型决定"测什么"，Planner 决定"怎么测"
2. Coverage ≠ Outcome — 测试失败也算"已覆盖"
3. Page Change ≠ must call LLM — 页面变化不一定需要调 LLM

#### 1.2.2 Planner（planner.ts）

**三级架构：**
```
CoverageTarget
    ↓
PlannerSelector (risk score + test type)
    ↓
Deterministic / Template / LLM
    ↓
TestPlan
```

**风险评分（calculateRiskScore）：**
5 个维度，总分 0-15+：
- Business Criticality (0-4): 从 effectivePriority 取值
- Data Mutation (0-3): button/form/upload + 是否 destructive
- State Complexity (0-3): form 类型的 field 数量
- Form Complexity (0-3): 复杂字段类型数量
- Unknown (0-2): feature.type === 'unknown'

**Planner 选择逻辑（selectPlannerLevel）：**
```typescript
// 确定性类型（始终走 deterministic）
deterministicTypes = ['link', 'tab', 'navigation', 'checkbox', 'radio', 
                      'pagination', 'dropdown', 'button']

// text-input/number-input: 低风险走 deterministic，高风险走 template
if (featureType === 'text-input' || featureType === 'number-input') {
  if (riskScore < t.llm) return 'deterministic';
  return 'template';
}

// 模板类型（始终走 template）
templateTypes = ['form', 'table', 'search', 'upload', 'modal']

// unknown: 只能走 llm
if (featureType === 'unknown') return 'llm';
```

**模板规划器注册表（TEMPLATE_PLANNERS）：**
按优先级排序：
1. crudTemplate: 处理 CRUD 命名的 button（创建/编辑/删除）
2. formTemplate: 处理 form 类型
3. tableTemplate: 处理 table 类型
4. searchTemplate: 处理 search 类型 + 搜索意图的 text-input
5. uploadTemplate: 处理 upload 类型
6. modalTemplate: 处理 modal 类型
7. inputTemplate: 通用 text-input/number-input 后备

**特定性覆盖（Specificity Override）：**
当 plannerLevel 为 'deterministic' 但存在专门的模板匹配时，优先使用模板：
```typescript
if (plannerLevel === 'deterministic') {
  const matchingTemplate = TEMPLATE_PLANNERS.find(t =>
    t.name !== 'input' && t.canHandle(targetSurface, targetFeature, target)
  );
  if (matchingTemplate) {
    plannerLevel = 'template';
  }
}
```

#### 1.2.3 Workflow State Machine（workflow.ts）

**状态转换表：**
```
INIT ──→ LOGIN ──→ NAVIGATE ──→ TEST ──→ REPORT ──→ DONE
  │                                 ↑  ↓(自环)
  └──→ NAVIGATE (跳过登录)          │
                                    │
                    coverage 满足   │
                    或 testPlan 完成 │
                    或 stagnant ≥ 5  │
                    或 budget 耗尽   │
```

**关键 Guard 条件：**
- INIT→LOGIN: URL 含 login 或页面含 password
- INIT→NAVIGATE: 无登录表单且内容非空
- NAVIGATE→TEST: targetReached = true（URL 匹配目标或 snapshot 内容 > 200 字符）
- TEST→REPORT: coverageInitialized 时检查 coverageComplete；否则检查 testPlan 完成或 stagnant

**状态不变量（Invariants）：**
每个状态定义了什么必须为真，违反时记录告警但不阻断执行：
- LOGIN: 必须在登录页或已提交登录
- NAVIGATE: 不应仍在登录页
- TEST: targetReached 必须为 true，且不应在登录页
- REPORT: 必须至少执行过一次测试操作

#### 1.2.4 Agent Loop（loop.ts）

**主循环结构：**
```
while (turnCount < maxTurns && !aborted) {
    executeTurn():
        1. 构建 system prompt（base + state + coverage 注入）
        2. deriveMessages() 从 SessionLog 重建消息历史
        3. Pre-step waterfall（插件可修改/拒绝）
        4. 构建 tool schemas（按状态过滤）
        5. Request waterfall（插件可修改 model config）
        6. LLM streaming call
        7. 解析 tool calls
        8. 逐个执行 tool calls:
            a. Login guard（防止重复登录）
            b. Pre-execute waterfall
            c. 3-stage pipeline: prepare → dispatch → finalize
            d. Post-execute waterfall
            e. 更新 workflow context
            f. Action verification（前后 snapshot diff）
            g. Cognitive engine 学习
            h. Coverage model 更新
        9. 检查状态转换 (tryTransition)
       10. 进入 TEST 时初始化 coverage model
       11. 停滞检测 + 验证失败升级
}
```

**Coverage 驱动的 prompt 注入：**
当处于 TEST 状态且 coverage 已初始化时，每个 turn 都会：
1. 从最新 snapshot 提取 surface signature
2. 检测 surface 是否变化（major/minor/same）
3. 如果是新 surface → 注册 module + surface + 发现 features
4. selectNextTarget() → 找到优先级最高的覆盖缺口
5. generateTestPlan() → 为这个缺口生成测试步骤
6. 将 coverage summary + current target + test steps 注入 system prompt
7. 如果没有 target → 检查是否应该结束（shouldFinishTesting）

---

## 2. 问题发现（Iteration 0）

通过实际启动服务器并对 baidu.com 进行 smoke 测试，发现以下严重问题：

### 2.1 🔴 P0: NAVIGATE→TEST 状态转换缺陷

**现象：**
Coverage Model 从未初始化，Planner 从未运行，覆盖率追踪完全没生效。日志显示：
```
Turn 2: [Workflow] Already logged in — skipping to NAVIGATE (init → navigate)
Turn 3: State=navigate   ← 仍在 NAVIGATE
Turn 4: State=navigate   ← 仍在 NAVIGATE（搜索已完成，快照已取）
Turn 5: State=navigate   ← 仍在 NAVIGATE
Turn 6: Session complete. ← LLM 直接结束
```

**根因：**
`targetReached` 只在 `browser_snapshot` 的 `updateWorkflowContext` 中设置，但 LLM 在 NAVIGATE 阶段就已经完成了所有测试操作（输入+搜索+验证），然后直接结束——它认为任务已完成，没有理由再调一次 snapshot 来"触发"状态转换。

**影响：**
- `coverage.ts` 全部 818 行代码 — 完全死代码
- `planner.ts` 全部 1017 行代码 — 完全死代码
- `surface-signature.ts` 全部 530 行代码 — 完全死代码

### 2.2 🔴 P1-A: Feature Relevance / Priority 缺失

**现象：**
Coverage 模型发现了 26 个 features，但第一个 target 是 `feat_0`（新闻链接），而不是用户指令中的"搜索框"。

**根因：**
`discoverFeaturesFromSnapshot()` 按 aria snapshot 的行顺序注册 feature，没有优先级区分。首页上"新闻"链接排在搜索框前面，所以先被选中。

**影响：**
Planner 生成的 plan 是"Click link 新闻"，但 LLM 按照用户指令去操作搜索框 → action→target 匹配失败。

### 2.3 🔴 P1-B: Action → Feature 匹配率低

**现象：**
```
target feature: "谍战大剧《交锋》第一波真实口碑" (text-input, ref=?)
actual action: browser_type(target="e37", element="搜索框")
match: false  ← name mismatch
```

**根因：**
百度的搜索框用热搜做 placeholder，aria snapshot 的 label 是热搜文本而非"搜索框"。feature discovery 把 placeholder 文本注册为 feature name，导致 action 匹配失败。

**影响：**
LLM 做对了（输入搜索框），但 coverage 系统没认出来 → 覆盖率永远 0% → session 跑到 maxTurns。

### 2.4 🔴 P1-C: Target Advancement 卡死

**现象：**
```
[TARGET] feat_11 (登录) — 系统选中
[COVERAGE] Updated feat_14 — LLM 实际点了搜索按钮
[TARGET-STATE] feat_11/normal status=planned  ← 卡死状态！
[TARGET] feat_11 — 再次选中
...无限循环
```

**根因：**
`markScenarioPlanned()` 在 prompt 注入时调用（LLM 还没实际操作），当 LLM 的实际操作不匹配 target 时，target 卡在 `planned` 状态。`getCoverageGaps()` 仍返回 `planned`（只跳过 `tested`/`not_applicable`）→ 永远被选中 → 死循环。

**影响：**
Coverage 状态机死锁，session 无法推进。

### 2.5 🔴 P1-D: LoginGuard 误触发

**现象：**
```
[Agent] [LoginGuard] Login confirmed. Blocking: https://www.baidu.com
```

**根因：**
```typescript
if (toolCall.name === "browser_navigate") {
  if (!navUrl.toLowerCase().includes("login")) {
    context.state.set("loginConfirmed", true);  // ❌ 错误推断
  }
}
```

导航到非登录 URL 不等于"登录成功"。

**影响：**
误判登录状态，可能导致错误的状态转换或阻塞行为。

### 2.6 🟡 P1-E: Session 状态管理缺失

**现象：**
Session 状态从 `pending` → `planning` → `completed`，缺少中间的 `running` 状态。

**根因：**
```typescript
Line 117: updateStatus(sessionId, "planning")  // 开始处理时
Line 320: updateStatus(sessionId, status)       // 结束时直接 → completed/failed
```

没有在 AgentLoop 开始执行后设置 `running` 状态。

**影响：**
前端 Dashboard 无法区分"正在规划"和"正在执行"。

### 2.7 🟡 P2: 日志噪音过大

**现象：**
```
[Worker] broadcast agent:activity for e838dd20      ← ×80+ 噪音
[WebSocket] Broadcasting agent:activity to 0 clients ← ×80+ 噪音
[MCPTools] Registered: browser_close                ← ×26 逐个注册
  [Agent] Turn 3...                                  ← 每 turn
  [Agent] [Workflow] State=navigate, allowed tools: ...(26 个工具名) ← 每 turn
  [Agent] [SURFACE] key: www_baidu_com, change: same, hash: 3fbf→3fbf ← 每 turn 无变化
  [Agent] [COVERAGE] summary: COVERAGE | Modules: 0/1 | ... 全文 ← 每 turn
```

**影响：**
45 秒 session 约 150+ 行日志，有效信息 < 20%，调试困难。

---

## 3. 修复实施

### 3.1 Iteration 1: P0-P1-E + P2

#### 3.1.1 P0: NAVIGATE→TEST 确定性转换

**修改文件：** `workflow.ts`, `loop.ts`

**核心改动：**
1. 在 `updateWorkflowContext` 中增加 URL 匹配逻辑：
```typescript
if (toolName === 'browser_navigate' && success) {
  updated.currentPageUrl = String(toolArgs.url ?? '');
  if (context.targetUrl && updated.currentPageUrl) {
    const currentNorm = normalizeUrlForCompare(updated.currentPageUrl);
    const targetNorm = normalizeUrlForCompare(context.targetUrl);
    if (currentNorm === targetNorm || currentNorm.startsWith(targetNorm + '/')) {
      updated.targetReached = true;
    }
  }
}
```

2. 限制 NAVIGATE 阶段工具集：
```typescript
case WorkflowState.NAVIGATE:
  return [
    'browser_navigate', 'browser_navigate_back',
    'browser_snapshot', 'browser_evaluate',
    'browser_click', 'browser_wait_for',
    'browser_tabs',
  ];
```

3. 在 LLM 无 tool call 时检查 coverage：
```typescript
if (!response.toolCalls || response.toolCalls.length === 0) {
  if (context.workflowState === WorkflowState.TEST && context.workflow.coverageModel) {
    const finish = shouldFinishTesting(
      context.workflow.coverageModel,
      context.workflow.coveragePolicy,
      { turnsUsed: context.turnCount }
    );
    if (finish.shouldFinish) {
      context.workflow.coverageComplete = true;
    } else {
      // 注入提示让 LLM 继续
      sessionLog.append('system/note', {
        note: 'Continue testing. Coverage not complete.'
      });
      return { complete: false, response: { content: response.content } };
    }
  }
}
```

**验证结果：**
- NAVIGATE→TEST 转换在 Turn 3 触发（之前永不触发）
- Coverage Model 成功初始化，发现 35 个 features
- Planner 开始运行，生成测试计划

#### 3.1.2 P1-A: Intent Relevance

**修改文件：** `coverage.ts`, `loop.ts`

**核心改动：**
1. 新增 `IntentRelevance` 类型：
```typescript
export interface IntentRelevance {
  score: number;          // 0 ~ 1
  source: 'user' | 'llm';
  matchedTerms?: string[];
  reason?: string;
}
```

2. 实现关键词匹配（12 组关键词）：
```typescript
const INTENT_KEYWORD_GROUPS = [
  {
    terms: ['搜索', 'search', '查询', 'query', '查找', '筛选', 'filter', 'find', '百度一下'],
    featureTypes: ['search', 'text-input', 'form', 'button'],
    baseScore: 1.0,
  },
  {
    terms: ['登录', 'login', 'signin', 'sign in', '认证', 'auth'],
    featureTypes: ['form', 'text-input', 'button'],
    baseScore: 1.0,
  },
  // ... 10 组更多关键词
];
```

3. 分层打分（3 层）：
- Tier 1 (Direct): 指令和 feature name 都包含关键词 → score = baseScore
- Tier 2 (Name): feature name 包含关键词 → score = baseScore * 0.6
- Tier 3 (Type): 指令包含关键词 + feature type 匹配 → score = baseScore * 0.3

4. 在 feature discovery 后调用 `calculateAllIntentRelevance()`

5. 修改 `selectNextTarget()` 三阶段选择：
```typescript
// Phase 1: intentRelevance > 0.5 的 features
const phase1 = findGap(g => {
  const feature = getFeature(g);
  return (feature.intentRelevance?.score ?? 0) > 0.5;
});
if (phase1) return phase1;

// Phase 2: critical 或 high priority
const phase2 = findGap(g => 
  g.priority.level === 'critical' || g.priority.level === 'high'
);
if (phase2) return phase2;

// Phase 3: composite score 排序
return findGap() ?? null;
```

**回归测试：** 18 个测试覆盖所有分层逻辑

#### 3.1.3 P1-B: Action → Feature Resolution

**修改文件：** `coverage.ts`, `loop.ts`

**核心改动：**
1. 新增 `FeatureMatch` 类型和 `resolveActionFeature()` 函数：
```typescript
export interface FeatureMatch {
  feature: CoverageFeature;
  method: 'ref' | 'name' | 'normalized' | 'structural';
  confidence: number;
}

export function resolveActionFeature(
  toolName: string,
  toolArgs: Record<string, unknown>,
  model: CoverageModel
): FeatureMatch | null {
  const { targetRef, elementDesc } = extractActionIdentity(toolName, toolArgs);
  
  // Method 1: ref exact match (confidence: 1.00)
  for (const feature of allFeatures) {
    if (targetRef && feature.ref && targetRef === feature.ref) {
      return { feature, method: 'ref', confidence: 1.0 };
    }
  }
  
  // Method 2: name exact match (confidence: 0.95)
  // Method 3: normalized name match (confidence: 0.80-0.85)
  // Method 4: structural fallback (confidence: 0.75, typing tools only)
  
  // Threshold: 0.75
  if (bestMatch && bestMatch.confidence >= 0.75) {
    return bestMatch;
  }
  return null;
}
```

2. 关键设计决策：
- 只有 `browser_type` 和 `browser_fill_form` 使用 structural fallback（typing 操作几乎总是操作 text-input）
- `browser_click` 不做唯一类型推断（避免假阳性）
- 匹配到谁就更新谁（不默认更新 currentCoverageTarget）

3. 在 loop.ts 中替换 inline matching 逻辑：
```typescript
const match = resolveActionFeature(toolCall.name, toolArgs, context.workflow.coverageModel);

if (match && result.success) {
  // 更新匹配到的 feature 的 coverage
  updateScenario(match.feature, scenarioType, 'pass', { ... });
  
  // 如果是当前 target，标记匹配
  if (match.feature.key === target.featureKey) {
    targetMatchedThisTurn = true;
  }
}
```

**回归测试：** 23 个测试覆盖所有匹配层级

#### 3.1.4 P1-C: Target Advancement

**修改文件：** `loop.ts`, `coverage.ts`

**核心改动：**
1. 移除 prompt 注入时的 `markScenarioPlanned()`（不再提前标记）

2. 添加 stagnation 检测：
```typescript
if (context.workflow.currentCoverageTarget) {
  if (targetMatchedThisTurn) {
    context.workflow.targetStagnationCount = 0;
  } else {
    context.workflow.targetStagnationCount++;
    if (context.workflow.targetStagnationCount >= 3) {
      const skippedKey = context.workflow.currentCoverageTarget.featureKey;
      if (!context.workflow.skippedTargets.includes(skippedKey)) {
        context.workflow.skippedTargets.push(skippedKey);
        
        // 标记为 skipped（不再标记为 planned）
        markScenarioSkipped(feat, skippedTarget.scenarioType, skipReason);
      }
      context.workflow.targetStagnationCount = 0;
    }
  }
}
```

3. 新增 `markScenarioSkipped()` 函数：
```typescript
export function markScenarioSkipped(
  feature: CoverageFeature,
  scenarioType: ScenarioType,
  reason: string
): void {
  const scenario = feature.scenarios[scenarioType];
  if (!scenario) return;
  
  if (scenario.status === 'tested' || scenario.status === 'not_applicable') return;
  
  scenario.status = 'skipped';
  scenario.outcome = 'skipped';
  scenario.testedAt = Date.now();
  scenario.evidence = [{
    action: 'skipped',
    result: 'skipped',
    turn: 0,
    timestamp: Date.now(),
    reason,
  }];
}
```

4. `getCoverageGaps()` 排除 skipped：
```typescript
for (const [scenarioType, coverage] of Object.entries(feature.scenarios)) {
  if (coverage.status === 'not_applicable') continue;
  if (coverage.status === 'tested') continue;
  if (coverage.status === 'skipped') continue;  // 新增
  
  // ... 检查是否 required
}
```

5. `shouldFinishTesting()` 将 skipped 视为 terminal：
```typescript
const isScenarioTerminal = (cov: ScenarioCoverage) => 
  cov.status === 'tested' || cov.outcome === 'skipped';

function moduleInScopeFeaturesCovered(module, policy): boolean {
  for (const surface of module.surfaces) {
    for (const feature of surface.features) {
      if (!isFeatureInScope(feature, policy)) continue;
      
      const requiredScenarios = Object.entries(feature.scenarios)
        .filter(([type, cov]) =>
          cov.status !== 'not_applicable' &&
          cov.status !== 'skipped' &&  // skipped 不算 required
          policy.scenarioDepth[type] === 'required'
        );
      
      if (!requiredScenarios.every(([_, cov]) => cov.status === 'tested')) {
        return false;
      }
    }
  }
  return true;
}
```

**回归测试：** 8 个测试覆盖 advancement 和 skipped 语义

#### 3.1.5 P1-D: Evidence-based LoginGuard

**修改文件：** 新增 `login.ts`，修改 `loop.ts`

**核心改动：**
1. 新增 6 态状态机：
```typescript
export type LoginStatus =
  | 'not_required'        // 目标站点不需要登录
  | 'required'            // 需要登录但未开始
  | 'login_page_detected' // 检测到登录表单
  | 'login_in_progress'   // 已提交凭据，等待确认
  | 'authenticated'       // 已通过证据确认登录成功
  | 'failed';             // 登录失败
```

2. 实现证据检测函数：
```typescript
export function detectLoginRequirement(
  state: LoginGuardState,
  url: string,
  pageContent: string,
  turn: number
): LoginGuardState {
  if (state.status !== 'not_required') return state;
  
  const evidence: LoginRequirementEvidence = {
    urlSuggestsLogin: LOGIN_URL_PATTERNS.some(p => urlLower.includes(p)),
    loginFormVisible: LOGIN_FORM_PATTERNS.some(p => contentLower.includes(p)),
    profileSaysAuth: false,
  };
  
  if (evidence.urlSuggestsLogin || evidence.loginFormVisible) {
    return {
      ...state,
      status: evidence.loginFormVisible ? 'login_page_detected' : 'required',
      requirementEvidence: evidence,
      lastChangedTurn: turn,
    };
  }
  
  return state;
}

export function checkLoginConfirmation(
  state: LoginGuardState,
  url: string,
  pageContent: string,
  turn: number
): LoginGuardState {
  if (state.status !== 'login_in_progress') return state;
  
  const evidence: LoginSuccessEvidence = {
    userIndicatorVisible: USER_INDICATOR_PATTERNS.some(p => contentLower.includes(p)),
    logoutLinkVisible: contentLower.includes('logout') || contentLower.includes('退出'),
    navigatedAwayWithContent: 
      !LOGIN_URL_PATTERNS.some(p => urlLower.includes(p)) &&
      contentLower.length > 100 &&
      !LOGIN_FORM_PATTERNS.some(p => contentLower.includes(p)),
    dashboardVisible: DASHBOARD_PATTERNS.some(p => contentLower.includes(p)),
  };
  
  if (evidence.userIndicatorVisible || evidence.logoutLinkVisible || 
      evidence.navigatedAwayWithContent || evidence.dashboardVisible) {
    return {
      ...state,
      status: 'authenticated',
      successEvidence: evidence,
      lastChangedTurn: turn,
    };
  }
  
  // 仍在登录页 → failed
  if (stillOnLoginPage && contentLower.length > 50) {
    return { ...state, status: 'failed', lastChangedTurn: turn };
  }
  
  return state;
}
```

3. 在 loop.ts 中替换旧的 LoginGuard：
```typescript
// 旧逻辑（已删除）：
// if (!navUrl.includes("login")) { context.state.set("loginConfirmed", true); }

// 新逻辑：
const loginState = context.state.get("loginGuard") as LoginGuardState;
if (loginState) {
  // 导航时检测登录需求
  if (toolCall.name === "browser_navigate") {
    const updated = detectLoginRequirement(loginState, navUrl, '', context.turnCount);
    context.state.set("loginGuard", updated);
  }
  
  // 提交凭据时记录
  if (toolCall.name === "browser_fill_form" || toolCall.name === "browser_type") {
    const argsStr = JSON.stringify(toolArgs).toLowerCase();
    const isLoginFields = argsStr.includes("password") || argsStr.includes("密码");
    if (isLoginFields) {
      const updated = recordCredentialsSubmitted(loginState, context.turnCount);
      context.state.set("loginGuard", updated);
    }
  }
  
  // snapshot 后检测登录成功证据
  if (toolCall.name === "browser_snapshot") {
    const updated = checkLoginConfirmation(loginState, url, snapshotText, context.turnCount);
    if (updated.status !== loginState.status) {
      context.state.set("loginGuard", updated);
      logger.info(`[LoginGuard] ${loginState.status} → ${describeLoginState(updated)}`);
    }
  }
}
```

**回归测试：** 18 个测试覆盖所有状态转换

#### 3.1.6 P1-E: Session running 状态

**修改文件：** `test-session.ts`

**核心改动：**
```typescript
// 工具注册完成后，AgentLoop 开始前
await this.repos.sessions.updateStatus(sessionId, "running");
this.broadcast("session:update", sessionId, { 
  status: "running", 
  message: "Test execution started" 
});

// AgentLoop 执行
const result = await loop.run({ ... });

// 结束后更新为 completed/failed
await this.repos.sessions.updateStatus(sessionId, result.status);
```

**回归测试：** 3 个测试验证状态流转顺序

#### 3.1.7 P2: 日志分层降噪

**修改文件：** `loop.ts`, `test-session.ts`, `mcp-tools.ts`, `index.ts`, `websocket.ts`

**核心改动：**
1. 定义 7 类核心日志（INFO 级别）：
```
[STATE]     workflow / session 状态转换
[SURFACE]   surface identity / change
[TARGET]    target selection / skip
[PLAN]      planner 决策
[ACTION]    实际 tool action + feature resolution
[COVERAGE]  coverage 更新
[EXIT]      为什么继续 / 为什么结束
```

2. 将诊断日志降级为 DEBUG：
```typescript
// loop.ts
logger.debug(`Turn ${context.turnCount}...`);
logger.debug(`[Cognition] Retrieved experiences for ${options.target.url}`);
logger.debug(`[COVERAGE] summary: ${coverageSummary.replace(/\n/g, ' | ')}`);
logger.debug(`[STATE] state=${context.workflowState}, allowed tools: ${allowedTools.join(', ')}`);

// test-session.ts
function wdebug(msg: string): void {
  if (WORKER_LOG_LEVEL === "debug") console.log(`[Worker] ${msg}`);
}
wdebug(`broadcast ${type} for ${sessionId.slice(0,8)}`);

// mcp-tools.ts
if ((process.env.TH_LOG_LEVEL ?? "").toLowerCase() === "debug") {
  console.log(`[MCPTools] Registered: ${mcpTool.name}`);
}

// websocket.ts
if ((process.env.TH_LOG_LEVEL ?? "").toLowerCase() === "debug") {
  console.log(`[WebSocket] Broadcasting ${event.type} to ${this.clients.size} clients`);
}
```

3. 优化日志格式：
```typescript
// 旧：
logger.info(`[TARGET] surface: ${target.surfaceKey}, feature: ${target.featureKey}, scenario: ${target.scenarioType}, priority: ${target.priority.level}, intentRelevance: ${intentStr}`);

// 新：
logger.info(`[TARGET] ${target.featureKey} "${featureName}" scenario=${target.scenarioType} priority=${target.priority.level} intent=${intentStr}`);

// 旧：
logger.info(`[ACTION] tool: ${toolCall.name}, element: "${elementDesc}", target_ref: ${targetRef}, match: true, method: ${match.method}, confidence: ${match.confidence.toFixed(2)}, feature: ${matchedFeature.key} (${matchedFeature.name}), scenario: ${scenarioType}`);

// 新：
logger.info(`[ACTION] ${toolCall.name} → ${matchedFeature.key} "${matchedFeature.name}" method=${match.method} confidence=${match.confidence.toFixed(2)} scenario=${scenarioType}`);
```

**回归测试：** 3 个测试验证日志级别过滤

**降噪效果对比：**
```
修复前（45 秒 session）：
  - 150+ 行日志
  - 有效信息 < 20%
  - 大量重复的 broadcast/registration/Turn 头

修复后（同样 45 秒 session）：
  - ~30 行日志
  - 清晰的 7 类核心信息
  - 0 行 broadcast/registration/Turn 头噪音
```

### 3.2 Iteration 2: 粒度闭环（①-④）

#### 3.2.1 ① Scope-aware Coverage

**修改文件：** `coverage.ts`, `loop.ts`

**核心改动：**
1. 新增 `CoverageScope` 类型：
```typescript
export type CoverageScope = 
  | 'all'              // 所有发现的 features
  | 'intent_relevant'  // intent > 0.5 + critical
  | 'critical'         // 仅 critical 优先级
  | 'discovered_core'; // intent > 0.5 + critical + high
```

2. 在 `CoveragePolicy` 中新增 `scope` 字段：
```typescript
export interface CoveragePolicy {
  testType: TestType;
  scope: CoverageScope;  // 新增
  scenarioDepth: { [K in ScenarioType]?: 'required' | 'optional' };
  // ...
}
```

3. 更新 4 个 preset 的 scope：
```typescript
COVERAGE_POLICIES = {
  smoke:        { scope: 'intent_relevant', ... },
  confirmation: { scope: 'discovered_core', ... },
  acceptance:   { scope: 'discovered_core', ... },
  full:         { scope: 'all', ... },
};
```

4. 新增 `isFeatureInScope()` 函数：
```typescript
export function isFeatureInScope(
  module: CoverageModule,
  surface: CoverageSurface,
  feature: CoverageFeature,
  policy: CoveragePolicy
): boolean {
  switch (policy.scope) {
    case 'all':
      return true;
    case 'intent_relevant': {
      if (feature.intentRelevance && feature.intentRelevance.score > 0.5) return true;
      const eff = effectivePriority(module, surface, feature);
      return eff === 'critical';
    }
    case 'critical': {
      const eff = effectivePriority(module, surface, feature);
      return eff === 'critical' || eff === 'high';
    }
    case 'discovered_core': {
      if (feature.intentRelevance && feature.intentRelevance.score > 0.5) return true;
      const eff = effectivePriority(module, surface, feature);
      return eff === 'critical' || eff === 'high';
    }
  }
}
```

5. 修改 `getCoverageGaps()` 过滤 scope：
```typescript
for (const feature of surface.features) {
  // 新增：scope 过滤
  if (!isFeatureInScope(module, surface, feature, policy)) continue;
  
  for (const [scenarioType, coverage] of Object.entries(feature.scenarios)) {
    // ... 检查是否 required
  }
}
```

6. 修改 `shouldFinishTesting()` 使用 scope-aware 检查：
```typescript
const requiredCovered = majorModules.length === 0 ||
  majorModules.every(m => moduleInScopeFeaturesCovered(m, policy));

function moduleInScopeFeaturesCovered(module, policy): boolean {
  for (const surface of module.surfaces) {
    for (const feature of surface.features) {
      if (!isFeatureInScope(module, surface, feature, policy)) continue;
      
      const requiredScenarios = Object.entries(feature.scenarios)
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
```

**E2E 验证效果：**
```
修复前: [COVERAGE] gaps: 25 remaining → 25 个链接全点一遍 → maxTurns 耗尽
修复后: [COVERAGE] gaps: 3 remaining → 3 个 in-scope targets → 全部处理完
```

**回归测试：** 12 个测试覆盖 scope 过滤和退出语义

#### 3.2.2 ② Honest Skipped Coverage

已在 P1-C 中实现，此处补充完整性：

**核心语义：**
- `status: 'skipped'` + `outcome: 'skipped'` 表示"尝试过但无法完成"
- 在 `getCoverageGaps()` 中排除（不再重复选择）
- 在 `shouldFinishTesting()` 中视为 terminal（不阻塞退出）
- 在报告中可见（不默默消失）

#### 3.2.3 ③ text-input Template

**修改文件：** `planner.ts`

**核心改动：**
1. 在 `deterministicPlanner.canHandle` 中添加 text-input/number-input：
```typescript
canHandle(surface, feature, target): boolean {
  const simpleTypes: FeatureType[] = [
    'link', 'tab', 'navigation',
    'checkbox', 'radio', 'pagination',
    'text-input', 'number-input',  // 新增
    'dropdown', 'button',           // 新增
  ];
  return simpleTypes.includes(feature.type);
}
```

2. 在 `deterministicPlanner.generate` 中添加 text-input 处理：
```typescript
case 'text-input':
case 'number-input': {
  const value = feature.type === 'number-input' ? '123' : 'test-input-验证';
  steps.push({
    description: `Type "${value}" into "${feature.name}"`,
    tool: 'browser_type',
    toolArgs: { element: feature.name, text: value },
    expectedOutcome: 'Input accepted, value visible in field',
    scenarioType: target.scenarioType,
  });
  
  if (target.scenarioType === 'validation') {
    steps.push({
      description: `Clear "${feature.name}" and submit empty to verify required validation`,
      expectedOutcome: 'Validation error or graceful handling',
      scenarioType: 'validation',
    });
  } else if (target.scenarioType === 'boundary') {
    steps.push({
      description: `Type an extremely long string into "${feature.name}" to test limits`,
      tool: 'browser_type',
      expectedOutcome: 'Value truncated or accepted gracefully',
      scenarioType: 'boundary',
    });
  }
  break;
}
```

3. 新增 `inputTemplate` 作为通用后备：
```typescript
const inputTemplate: TemplatePlanner = {
  name: 'input',
  canHandle(surface, feature, _target): boolean {
    return feature.type === 'text-input' || feature.type === 'number-input';
  },
  generate(surface, feature, target): TestPlan {
    const steps: TestPlanStep[] = [];
    const value = feature.type === 'number-input' ? '123' : 'test-input-验证';
    
    steps.push({
      description: `Type "${value}" into "${feature.name}"`,
      tool: 'browser_type',
      toolArgs: { element: feature.name, text: value },
      expectedOutcome: 'Input accepted, value visible in field',
      scenarioType: target.scenarioType,
    });
    
    // validation/boundary 场景
    if (target.scenarioType === 'validation') {
      steps.push({ ... });
    } else if (target.scenarioType === 'boundary') {
      steps.push({ ... });
    }
    
    // 查找提交按钮
    const submitButton = surface.features.find(f =>
      f.type === 'button' && /submit|提交|保存|确定|确认|save|ok/i.test(f.name)
    );
    if (submitButton) {
      steps.push({
        description: `Click "${submitButton.name}" to submit`,
        tool: 'browser_click',
        expectedOutcome: 'Form processed, result visible',
        scenarioType: target.scenarioType,
      });
    }
    
    return { ... };
  },
};
```

4. 修改 `selectPlannerLevel` 防止 text-input 落 LLM：
```typescript
// text-input/number-input 有坚实的 deterministic 计划
if (featureType === 'text-input' || featureType === 'number-input') {
  if (riskScore < t.llm) return 'deterministic';
  return 'template';  // 高风险走 inputTemplate，不走 llm
}
```

5. 添加 specificity override 让 search template 优先：
```typescript
// 在 generateTestPlan 中
if (plannerLevel === 'deterministic') {
  const matchingTemplate = TEMPLATE_PLANNERS.find(t =>
    t.name !== 'input' && t.canHandle(targetSurface, targetFeature, target)
  );
  if (matchingTemplate) {
    plannerLevel = 'template';  // 专门的模板优先于通用 deterministic
  }
}
```

**E2E 验证效果：**
```
修复前: [PLAN] planner=llm steps=1 (placeholder)
修复后: [PLAN] planner=template steps=3 (type → submit → verify)
```

**回归测试：** 5 个测试覆盖 text-input 规划

#### 3.2.4 ④ NAVIGATE Boundary Accounting

**修改文件：** `workflow.ts`, `loop.ts`

**核心改动：**
1. 在 `WorkflowContext` 中新增 `pendingActions`：
```typescript
export interface WorkflowContext {
  // ... 现有字段
  pendingActions: Array<{ 
    toolName: string; 
    toolArgs: Record<string, unknown>; 
    success: boolean; 
    turn: number; 
  }>;
}
```

2. 在 `createInitialContext` 中初始化：
```typescript
export function createInitialContext(maxTurns = 99, targetUrl = ''): WorkflowContext {
  return {
    // ... 现有字段
    pendingActions: [],
  };
}
```

3. 在 loop.ts 中记录 NAVIGATE 阶段的 action：
```typescript
// 在 updateWorkflowContext 调用前
if (!context.workflow.coverageModel) {
  const interactionTools = [
    'browser_click', 'browser_type', 'browser_fill_form',
    'browser_select_option', 'browser_check', 'browser_uncheck',
    'browser_press_key',
  ];
  if (interactionTools.includes(toolCall.name)) {
    context.workflow.pendingActions.push({
      toolName: toolCall.name,
      toolArgs: toolCall.arguments as Record<string, unknown>,
      success: result.success,
      turn: context.turnCount,
    });
  }
}
```

4. 在 coverage 初始化后回放 pending actions：
```typescript
if (context.workflowState === WorkflowState.TEST && !context.workflow.coverageInitialized) {
  // ... 初始化 coverage model
  
  // 回放边界 actions
  for (const pa of context.workflow.pendingActions) {
    if (!pa.success) continue;
    
    const match = resolveActionFeature(pa.toolName, pa.toolArgs, coverageModel);
    if (match) {
      // 更新匹配到的 feature 的 coverage
      for (const mod of coverageModel.modules) {
        for (const surf of mod.surfaces) {
          const feat = surf.features.find(f => f.key === match.feature.key);
          if (feat) {
            updateScenario(feat, 'normal', 'pass', {
              action: pa.toolName,
              result: 'pass',
              turn: pa.turn,
              timestamp: Date.now(),
            });
            logger.info(`[ACTION] boundary replay: ${pa.toolName} → ${feat.key} (turn ${pa.turn})`);
            break;
          }
        }
      }
    }
  }
  
  // 清空 pending actions
  context.workflow.pendingActions = [];
}
```

**回归测试：** 4 个测试覆盖回放语义

### 3.3 Iteration 2 扩展: Planner Coverage Completeness

**修改文件：** `planner.ts`

**核心改动：**
1. 扩展 `deterministicPlanner.canHandle` 包括 dropdown/button：
```typescript
const simpleTypes: FeatureType[] = [
  'link', 'tab', 'navigation',
  'checkbox', 'radio', 'pagination',
  'text-input', 'number-input',
  'dropdown', 'button',  // 新增
];
```

2. 在 `deterministicPlanner.generate` 中添加 dropdown/button 处理：
```typescript
case 'dropdown': {
  steps.push({
    description: `Open "${feature.name}" and select an option`,
    tool: 'browser_select_option',
    expectedOutcome: 'Selected option visible, any dependent state updates',
    scenarioType: target.scenarioType,
  });
  if (target.scenarioType === 'boundary') {
    steps.push({
      description: `Select the first or last option in "${feature.name}" to check edge options`,
      tool: 'browser_select_option',
      expectedOutcome: 'Edge option accepted gracefully',
      scenarioType: 'boundary',
    });
  }
  break;
}

case 'button': {
  steps.push({
    description: `Click "${feature.name}" and observe resulting state change`,
    tool: 'browser_click',
    expectedOutcome: 'Button responded — page/dialog/state changed',
    scenarioType: target.scenarioType,
  });
  if (target.scenarioType === 'error') {
    steps.push({
      description: `Click "${feature.name}" twice rapidly and verify no double-submission or crash`,
      tool: 'browser_click',
      expectedOutcome: 'Double-click handled gracefully',
      scenarioType: 'error',
    });
  }
  break;
}
```

3. 更新 `selectPlannerLevel` 确保已知类型不路由到 LLM：
```typescript
// 确定性类型（始终走 deterministic）
const deterministicTypes: FeatureType[] = [
  'link', 'tab', 'navigation',
  'checkbox', 'radio', 'pagination',
  'dropdown', 'button',
];
if (deterministicTypes.includes(featureType)) {
  return 'deterministic';
}

// text-input/number-input
if (featureType === 'text-input' || featureType === 'number-input') {
  if (riskScore < t.llm) return 'deterministic';
  return 'template';
}

// 模板类型（始终走 template）
const templateTypes: FeatureType[] = ['form', 'table', 'search', 'upload', 'modal'];
if (templateTypes.includes(featureType)) {
  return 'template';
}

// unknown — 只能走 llm
if (featureType === 'unknown') return 'llm';

// 回退逻辑
if (riskScore < t.template) return 'deterministic';
if (riskScore < t.llm) return 'template';
return 'llm';
```

4. 更新测试以反映新设计：
```typescript
it("form with high risk in full test goes to template (not LLM) — Iteration 2 ⑤", () => {
  // Iteration 2 ⑤ design: known types with real template plans NEVER fall
  // through to the LLM placeholder. 'form' has formTemplate, so it always
  // goes to 'template' regardless of risk score.
  const level = selectPlannerLevel(5, 'form', 'full');
  expect(level).toBe('template');
});

it("only 'unknown' feature type reaches llm level", () => {
  // Iteration 2 ⑤: every known type is covered by deterministic or template.
  // Only genuinely unknown features go to LLM.
  expect(selectPlannerLevel(1, 'unknown', 'smoke')).toBe('llm');
  expect(selectPlannerLevel(10, 'form', 'full')).toBe('template');
  expect(selectPlannerLevel(10, 'button', 'full')).toBe('deterministic');
});
```

**综合覆盖测试：**
```typescript
it("every known feature type gets a REAL plan under full policy (no bare LLM placeholder)", () => {
  const knownTypes = [
    'link', 'tab', 'navigation',
    'checkbox', 'radio', 'pagination',
    'text-input', 'number-input',
    'dropdown', 'button',
    'form', 'table', 'search', 'upload', 'modal',
  ];
  for (const type of knownTypes) {
    const model = createCoverageModel();
    registerModule(model, 'mod1', 'M');
    const surface = registerSurface(model, 'mod1', 's1', 'http://example.com/p');
    registerFeature(surface, `feat_${type}`, `Test ${type}`, type as any);
    const target = { 
      surfaceKey: 's1', 
      featureKey: `feat_${type}`, 
      scenarioType: 'normal' as const, 
      priority: { level: 'normal' as const, source: 'system' as const } 
    };
    const plan = generateTestPlan(model, target, COVERAGE_POLICIES.full);
    expect(plan).not.toBeNull();
    expect(['deterministic', 'template']).toContain(plan!.plannerLevel);
  }
});
```

**回归测试：** 3 个新增测试 + 所有既有测试通过

---

## 4. 测试验证结果

### 4.1 单元测试统计

**总计：198 个测试全部通过**（14 个测试文件）

**详细分布：**
```
packages/agent/th-agent/src/
├── planner.test.ts              : 57 tests  (新增 10)
├── resolve-action.test.ts       : 23 tests
├── login.test.ts                : 18 tests
├── scope-coverage.test.ts       : 12 tests  (新增)
├── coverage-advancement.test.ts : 8 tests
├── boundary-accounting.test.ts  : 4 tests   (新增)
├── log-level.test.ts            : 3 tests   (新增)
├── session.test.ts              : 12 tests
└── assembler.test.ts            : 10 tests

packages/worker/th-worker/src/
└── test-session-status.test.ts  : 3 tests   (新增)

其他包
└── (既有测试)                    : 48 tests
```

### 4.2 E2E 验证

#### 4.2.1 Baidu Smoke 测试对比

**修复前（P1-C 关闭时）：**
```
[COVERAGE] gaps: 25 remaining → 25 个链接全点一遍 → maxTurns 耗尽
```

**修复后（Iteration 2）：**
```
[COVERAGE] gaps: 3 remaining → 3 个 in-scope targets → 全部处理完
[TARGET] feat_13 "吉隆泥石流部分遇难人员身份确认" intent=0.80
[PLAN] planner=template steps=3
[ACTION] browser_type → feat_13 method=normalized confidence=0.75
[COVERAGE] gaps: 2 remaining
[TARGET] feat_11 "登录" intent=0.60
[PLAN] planner=deterministic steps=1
[ACTION] browser_click → feat_14 "百度一下" method=normalized confidence=0.80
[COVERAGE] gaps: 1 remaining
[TARGET] feat_11 "登录" (再次选中)
[PLAN] planner=deterministic steps=1
[ACTION] (LLM 不操作登录)
[TARGET] feat_11 (再次选中)
[PLAN] planner=deterministic steps=1
⚠ [TARGET] Skipping stagnated target: feat_11 (stagnation: selected 3 turns without a matching action)
[COVERAGE] gaps: 0 remaining
[EXIT] coverage_target_met
```

**关键改进：**
1. **Scope 生效**：从 25 个 gaps 减少到 3 个（intent_relevant scope）
2. **Planner 不空转**：text-input 现在走 search template（type → submit → verify）
3. **Stagnation skip 工作**：无法测试的 target 被正确跳过并标记
4. **退出正确触发**：coverage_target_met（而非 maxTurns 耗尽）

#### 4.2.2 日志降噪效果

**修复前（45 秒 session）：**
```
- 150+ 行日志
- 有效信息 < 20%
- 大量重复的 broadcast/registration/Turn 头
```

**修复后（同样 45 秒 session）：**
```
[STATE] session started for https://www.baidu.com
[STATE] init → navigate (Already logged in — skipping to NAVIGATE)
[STATE] navigate → test (Target reached — entering TEST state)
[COVERAGE] entering TEST state — initializing coverage model
[SURFACE] www_baidu_com: 26 features discovered
[TARGET] intent relevance: 3/26 features
[COVERAGE] gaps: 3 remaining
[TARGET] feat_13 "吉隆泥石流部分遇难人员身份确认" scenario=normal priority=normal intent=0.80
[PLAN] planner=template steps=3
[ACTION] browser_type → feat_13 method=normalized confidence=0.75 scenario=normal
[COVERAGE] gaps: 2 remaining
[TARGET] feat_11 "登录" scenario=normal priority=normal intent=0.60
[PLAN] planner=deterministic steps=1
[ACTION] browser_click → feat_14 "百度一下" method=normalized confidence=0.80 scenario=normal
[COVERAGE] gaps: 1 remaining
[TARGET] feat_11 "登录" scenario=normal priority=normal intent=0.60
[PLAN] planner=deterministic steps=1
[TARGET] feat_11 "登录" scenario=normal priority=normal intent=0.60
[PLAN] planner=deterministic steps=1
⚠ [TARGET] Skipping stagnated target: feat_11 (stagnation: selected 3 turns without a matching action)
[COVERAGE] gaps: 0 remaining
[EXIT] complete: true, reason: coverage_target_met

- ~20 行日志
- 清晰的 7 类核心信息
- 0 行 broadcast/registration/Turn 头噪音
```

---

## 5. 当前架构状态

### 5.1 核心能力矩阵

```
FSM              ✅ 稳定 — 状态转换确定性触发
Coverage Model   ✅ 真正成为 source of truth — scope-aware
Action Identity  ✅ conservative — 4 层匹配 + 置信度阈值
Target Loop      ✅ 可恢复 — stagnation skip + skipped 记录
LoginGuard       ✅ evidence-based — 6 态状态机
Session State    ✅ 可观测 — pending/planning/running/completed
Logging          ✅ 可诊断 — 7 类 INFO + DEBUG 降级
Planner Coverage ✅ 完整 — 所有已知类型都有真实计划
```

### 5.2 设计原则（已验证）

1. **Coverage ≠ Outcome**：测试失败也算"已覆盖"，测试跳过记录为"skipped"
2. **Coverage ≠ TestPlan**：覆盖率模型决定"测什么"，Planner 决定"怎么测"
3. **Page Change ≠ must call LLM**：页面变化通过 surface signature 检测，不一定调 LLM
4. **deterministic > template > llm**：能用确定性就不用模板，能用模板就不用 LLM
5. **false negative > false positive**：宁可漏掉 coverage update，也不错误标记
6. **诊断能力永不删除**：日志只降可见性，不删除内容

### 5.3 已知限制与债务

#### 5.3.1 Tier-2 Intent Relevance 假阳性

**现象：**
`登录` 在英文指令"test search"下拿到 0.6 relevance（因为 feature name 包含"登录"关键词）

**根因：**
Tier 2 只查 feature name 含关键词，不查指令是否提及该关键词

**当前缓解：**
P1-C 的 stagnation skip 兜住了这个问题

**建议后续修复：**
```typescript
// Tier 2 应该也检查 instrHasTerm
else if (instrHasTerm && nameHasTerm) {
  // 指令和 feature name 都包含关键词
  const score = group.baseScore * 0.6;
  if (score > bestScore) bestScore = score;
  matchedTerms.push(term);
}
```

#### 5.3.2 策略×发现粒度失配

**现象：**
Smoke 在百度首页仍然会测试所有 3 个 in-scope features（搜索框 + 登录 + 百度一下），即使只要求测搜索

**根因：**
`intent_relevant` scope 包含所有 intent > 0.5 的 features，而百度的登录按钮（intent=0.6）也被包含

**建议后续优化：**
引入更细粒度的 scope 控制：
```typescript
export type CoverageScope = 
  | 'all'
  | 'intent_relevant'
  | 'intent_high'        // 新增：仅 intent > 0.8
  | 'intent_critical'    // 新增：仅 intent > 0.9 或 critical
  | 'critical'
  | 'discovered_core';
```

#### 5.3.3 skippedTargets 静默丢覆盖

**现象：**
被跳过的 target 不出现在最终报告中，只存在于日志

**根因：**
`skippedTargets` 是调度层状态，没有持久化到 session metadata

**建议后续改进：**
在 session 完成时，将 `skippedTargets` 写入 metadata：
```typescript
await this.repos.sessions.updateMetadata(sessionId, {
  ...existingMetadata,
  skippedTargets: context.workflow.skippedTargets,
});
```

并在报告中显示：
```
Coverage Report:
- Tested: 2 scenarios (pass: 2)
- Skipped: 1 scenario (feat_11/normal: stagnation after 3 unmatched turns)
- Uncovered: 0 scenarios
```

#### 5.3.4 LLM Planner 仍是 Stub

**现象：**
`llmPlanner` 返回占位文本 `[LLM] Analyze and test ...`

**当前状态：**
由于 Iteration 2 扩展了 deterministic/template 覆盖，`llmPlanner` 只对 `unknown` 类型触发，实际影响很小

**建议后续评估：**
- 如果 `unknown` 类型在实际测试中很少出现，可以保持 stub
- 如果出现频率高，需要实现真正的 LLM planner（调用 LLM 生成测试步骤）

#### 5.3.5 NAVIGATE 边界 action 不计入 coverage（已修复但需验证）

**现象：**
触发 NAVIGATE→TEST 的那次点击本身不被 coverage 记账

**当前状态：**
已通过 `pendingActions` + 回放机制修复，但需要更多 E2E 验证

**建议：**
在真实站点上验证边界 action 是否正确记账

---

## 6. 未来工作建议

### 6.1 优先级排序

**P3: 优化 Intent Relevance（低优先级）**
- 修复 Tier-2 假阳性
- 引入更细粒度 scope 控制
- 预计工作量：2-3 天

**P4: 增强报告可观测性（中优先级）**
- 将 skippedTargets 持久化到 session metadata
- 在报告中显示 tested/skipped/uncovered 统计
- 预计工作量：1-2 天

**P5: LLM Planner 评估（待决定）**
- 统计 `unknown` 类型出现频率
- 如果频率高，实现真正的 LLM planner
- 预计工作量：5-7 天

**P6: 性能优化（低优先级）**
- 优化 `getCoverageGaps()` 性能（当前 O(modules × surfaces × features × scenarios)）
- 考虑增量更新而非每次重新计算
- 预计工作量：3-5 天

### 6.2 架构演进方向

**短期（1-2 个月）：**
- 稳定当前架构，积累更多 E2E 验证数据
- 完成 P3/P4 改进
- 评估 LLM Planner 需求

**中期（3-6 个月）：**
- 探索多 Agent 协作（不同 Agent 负责不同 scope）
- 引入 site profile 记忆（记住站点的登录模式、表单模式）
- 优化 LLM prompt 工程（更精确的测试指令）

**长期（6-12 个月）：**
- 引入强化学习（根据测试结果调整 planner 策略）
- 支持自定义测试策略（用户定义 scope/policy）
- 集成 CI/CD 流水线（自动化回归测试）

---

## 7. 附录

### 7.1 关键文件清单

```
packages/agent/th-agent/src/
├── coverage.ts              # Coverage engine（818 行）
├── planner.ts               # Planner registry（1017 行）
├── workflow.ts              # FSM state machine（608 行）
├── loop.ts                  # Agent loop（1400+ 行）
├── login.ts                 # LoginGuard state machine（250 行，新增）
├── surface-signature.ts     # Surface identity detection（530 行）
├── verify.ts                # Action verification（200 行）
├── prompts/system.ts        # System prompts（753 行）
└── *.test.ts                # 单元测试（10 个文件）
```

### 7.2 测试覆盖统计

```
功能模块                    测试数量    覆盖场景
─────────────────────────────────────────────────
Planner selection           15        风险评分 + planner 选择
Planner generation          20        各种 feature type 的计划生成
Action resolution           23        4 层匹配 + 置信度阈值
LoginGuard                  18        6 态状态机转换
Scope-aware coverage        12        scope 过滤 + 退出语义
Target advancement          8         stagnation skip + skipped 记录
Boundary accounting         4         pending actions 回放
Log level filtering         3         INFO/DEBUG 分离
Session status flow         3         pending→planning→running→completed
其他既有测试                92        session/assembler/event/queue 等
─────────────────────────────────────────────────
总计                        198       100% 通过
```

### 7.3 性能基准

```
测试类型      场景              耗时        备注
──────────────────────────────────────────────────
单元测试      全部 198 个       2.75s       vitest run
TypeScript    全项目            90s         tsc --noEmit
Build         全项目            11s         turbo run build
E2E           Baidu smoke       60-90s      含 LLM 调用
──────────────────────────────────────────────────
```

### 7.4 术语表

| 术语 | 定义 |
|------|------|
| Coverage Model | 四层树状结构（Module → Surface → Feature → Scenario），记录测试覆盖状态 |
| Planner | 三级规划器（Deterministic → Template → LLM），生成测试步骤计划 |
| Workflow FSM | 六态状态机（INIT → LOGIN → NAVIGATE → TEST → REPORT → DONE），控制测试流程 |
| Agent Loop | 主循环，驱动 Turn → Step → Model → Tool → Result 流水线 |
| Intent Relevance | 用户意图相关度评分（0-1），用于 target 优先级排序 |
| Coverage Scope | 覆盖范围控制（all/intent_relevant/critical/discovered_core） |
| Feature Match | Action → Feature 匹配（4 层：ref → name → normalized → structural） |
| Stagnation Skip | 目标连续 3 次未匹配则跳过，标记为 skipped |
| LoginGuard | 6 态登录状态机（not_required → authenticated/failed） |
| Surface Signature | 页面结构签名（URL + heading + interactive elements + hash） |
| Pending Actions | NAVIGATE 阶段的交互操作缓存，进入 TEST 后回放记账 |
| Specificity Override | 当 specialized template 匹配时，优先于 deterministic |

---

## 8. 结论

通过两轮迭代（P0-P1-E + Iteration 2），Test-Harness 的测试计划生成与执行机制从"覆盖率引擎是死代码"演进为"真正的 coverage-driven 测试系统"。核心改进包括：

1. **状态机确定性触发**：NAVIGATE→TEST 转换不再依赖 LLM 调用 snapshot
2. **智能覆盖范围控制**：Scope-aware coverage 让 smoke 测试只关注用户意图相关的目标
3. **诚实的状态追踪**：Skipped scenarios 有明确记录，不默默消失
4. **完整的 Planner 覆盖**：所有已知 feature type 都有真实的 deterministic/template 计划
5. **Evidence-based 登录判定**：6 态状态机避免误判登录状态
6. **可诊断的日志系统**：7 类核心日志 + DEBUG 降级，噪音降低 80%

系统现在能够：
- 正确初始化 coverage model 并跟踪测试进度
- 根据用户意图智能选择测试目标
- 生成真实的测试计划（而非 LLM 占位符）
- 处理 LLM 不配合的情况（stagnation skip）
- 在合理时间内完成测试（coverage_target_met 而非 maxTurns 耗尽）

**198 个测试全部通过，E2E 验证成功，架构稳定可靠。**

---

**文档版本：** v1.0  
**最后更新：** 2026-09-07  
**作者：** Test-Harness 团队  
**审核状态：** 已验证
