# 平台实现进度报告

> 最后更新: 2026-09-08 | Iteration: Coverage-Driven Agent P0–P2 Phase 1 完成 | 18 个包 | 173 测试

---

## 一、项目概览

Test-Harness 是一个 **AI 驱动的网站质量检测平台**，灵感来源于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Cordis 插件架构。

**核心设计理念**:
- **一切皆插件** — LLM 适配器、检测模块、工具、存储后端都通过类型化的 Service Definition 注册
- **Coverage Model = source of truth** — 测什么由 Coverage 决定，怎么测由 Planner 决定，何时结束由 Policy 决定
- **Append-only Session Log** — 所有模型可见内容写入日志，消息历史从日志投影
- **概念分离** — Intent（任务相关性）/ Priority（业务重要性）/ Scope（覆盖语义）/ Target Selection（分层选择）四个概念严格独立

---

## 二、当前基线（commit 5f6eacf）

### 测试与构建

| 指标 | 状态 |
|------|------|
| 单元测试 | **173/173 通过**（12 个文件） |
| TypeScript | ✅ |
| Build | ✅ turbo 全绿 |
| E2E 验证 | ✅ Zentao 验收测试 / Baidu smoke |

### 测试分布

```
planner.test.ts               52   风险评分/planner 选择/全类型计划生成
resolve-action.test.ts        23   四层匹配 + 置信度阈值 + structural fallback
login.test.ts                 18   LoginGuard 六态 + evidence 语义
intent-model.test.ts          19   Intent 提取/role 分配/scope/分层选择
scope-coverage.test.ts        12   scope 过滤 + 退出语义
coverage-advancement.test.ts   8   gap 排除 + skipped 不阻塞退出
boundary-accounting.test.ts    4   边界 action 回放
action-alignment.test.ts       ?   ALIGN 四 verdict 判定
snapshot-lifecycle.test.ts     5   snapshotVersion 时序一致性
intent-reconciliation.test.ts  5   pending intent 晋升 + semantic 匹配
session/assembler 等          12+  基础设施
test-session-status.test.ts    3   状态流转（worker）
log-level.test.ts              3   日志分层
```

---

## 三、演进史（两轮大迭代）

### Iteration 1：激活 DSH 架构（commit 4c602d3）

发现 coverage.ts / planner.ts / surface-signature.ts 共 ~2400 行是**死代码**——状态机从未进入 TEST 状态。修复链：

| 阶段 | 内容 |
|------|------|
| P0 | NAVIGATE→TEST 确定性触发；NAVIGATE 工具限制；LLM 停止≠完成 |
| P1-A | Intent Relevance（关键词三层打分）→ 后被 Intent Model 取代 |
| P1-B | resolveActionFeature 四层匹配（ref/name/normalized/structural） |
| P1-C | Target Advancement（planned 死锁修复、stagnation skip） |
| P1-D | LoginGuard 六态 evidence-based 状态机 |
| P1-E | Session running 状态（pending→planning→running→completed） |
| P2 | 日志七类 INFO + DEBUG 分层 |

### Iteration 2：Intent Model 重构（commit 5f6eacf）

E2E 暴露四概念混淆（Intent/Priority/Scope/Target 混在一起），结构性重构：

| 阶段 | 内容 |
|------|------|
| Intent Model | `TestIntent`（primaryModules/prerequisites/actions/depth）+ `IntentRole`（primary/prerequisite/supporting/incidental/irrelevant）——role 是语义，score 只是派生 |
| Scope 重定义 | `all/comprehensive/core/intent`——scope 消费 role，不解释意图 |
| P0-A | Module/Surface/Feature resolver + pending intent 持久化（"没找到 ≠ 不存在"） |
| P0-B | Major Surface Reconciliation（只失效局部 target，不 reset Coverage） |
| P1 | ALIGN 诊断链（no_ref/ref_unknown/ref_drift/resolver_miss 四 verdict，排他性判定） |
| P2-1 | snapshotVersion + decided@vN（temporal consistency 实证） |

---

## 四、E2E 验证成果

### Zentao 验收测试（登录→项目集）

| 指标 | Intent Model 前 | 后 |
|------|---------------|-----|
| 登录页 primary | 0 | 0（但 pending 保留）|
| 项目页面 primary | —（永远选不中）| **18** |
| Target 进入业务 feature | ❌ 永远"添加待办" | ✅ 项目集/列表/看板/CRUD |
| Stagnation skip | 14 | **3** |
| 退出 | maxTurns 耗尽 | **coverage_target_met** |

### Baidu smoke

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| Coverage gaps | 25（全链接遍历）| **3**（intent scope）|
| Planner | LLM 占位符空转 | template 3 步（type→submit→verify）|
| Action 匹配 | name 失配 → 0% | normalized/structural 0.75-0.85 |

### ALIGN 诊断实证

```
[ALIGN] v7 (decided@v7) target=feat_60("×",ref=-) verdict=resolver_miss
```
icon "×" 安全拒绝——排除 snapshot 问题/stale ref，确认 identity 不足时保守拒绝正确。保留为 negative control。

---

## 五、当前架构能力矩阵

```
FSM                ✅ 确定性转换 + invariant 告警
Intent Model       ✅ pending 持久化 + surface reconciliation
Coverage Model     ✅ source of truth（scope-aware）
Action Identity    ✅ 四层 conservative 匹配
Target Loop        ✅ reconciliation 主导 + stagnation 兜底
LoginGuard         ✅ evidence-based 六态
Session State      ✅ pending/planning/running/completed
Planner            ✅ 全类型真实计划（仅 unknown 落 LLM）
Observability      ✅ 7 类 INFO 日志 + ALIGN + snapshotVersion
```

---

## 六、路线图（等待真实证据触发）

| 项 | 进入条件 |
|----|---------|
| P2 Phase 2: snapshotHash | 需证明 content identity（version 同但内容异）|
| P2 Phase 3: Feature.ref binding lifecycle | E2E 自然出现 `v==decided@v + ref_drift` |
| 新 Surface action resolution 对齐 | skip 偏高且 verdict 为 ref 系列 |
| llmPlanner 实装 | unknown 类型频率统计后评估 |

**设计红线**：不降 resolver 阈值换 skip 数量；不 reset Coverage 换简化；scope 是结果语义不是百分比配额。

---

## 七、文档索引

- [STATE-MACHINE.md](./STATE-MACHINE.md) — 状态机 + LoginGuard + ALIGN 诊断
- [test-plan-generation-execution-analysis.md](./test-plan-generation-execution-analysis.md) — Iteration 1 完整演进记录
- [intent-priority-analysis.md](./intent-priority-analysis.md) — 四概念分离前的旧分析（历史参考）
- [DSH-ANALYSIS.md](./DSH-ANALYSIS.md) — DeepSeek Harness 架构分析
- 记忆库：架构决策红线、否决方案清单、E2E 环境坑位
