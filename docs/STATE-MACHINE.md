# Test-Harness 状态机 — 状态转换表

基于 FSM（有限状态机）模型测试理论，参考：[状态转换测试技术及其示例](https://www.testwo.com/article/1843)

> **最后更新**: 2026-09-08 — 反映 Intent Model / Coverage 驱动架构（commit 5f6eacf）。
> 历史版本见 git 历史。

## 状态定义

| 状态 | 含义 | 允许的工具 |
|------|------|----------|
| `INIT` | 初始阶段 — 判断是否需要登录 | 全部 |
| `LOGIN` | 登录阶段 — 填写凭据并验证 | MCP 全工具（LoginGuard 证据驱动，见下） |
| `NAVIGATE` | 导航阶段 — 前往目标测试模块 | **仅导航/观察工具**: browser_navigate, browser_navigate_back, browser_snapshot, browser_evaluate, browser_click（导航用途）, browser_wait_for, browser_tabs |
| `TEST` | 测试阶段 — 执行功能测试 | MCP 全工具 + report_finding |
| `REPORT` | 报告阶段 — 总结发现 | report_finding, browser_evaluate, browser_snapshot |
| `DONE` | 结束 | 无 |

**NAVIGATE 职责边界**：NAVIGATE = 找到测试目标，TEST = 测试目标。NAVIGATE 允许 browser_click 仅因部分站点需要点菜单才能到达目标页——这类点击属于导航，不是 coverage action。

## 状态转换表

| # | 起始状态 | Guard 条件 | 目标状态 | 说明 |
|---|---------|-----------|---------|------|
| 1 | INIT | URL 含 login/signin/auth 或页面含 password 字段（LoginGuard: `not_required → required/login_page_detected`） | LOGIN | 证据驱动检测，不是 URL 猜测 |
| 2 | INIT | 无登录证据（LoginGuard 保持 `not_required`） | NAVIGATE | 跳过登录 |
| 3 | LOGIN | 凭据提交 + 登录成功证据（logout 链接/用户菜单/离开登录页+实质内容/dashboard） | NAVIGATE | LoginGuard: `login_in_progress → authenticated` |
| 4 | LOGIN | 页面仍含登录表单 | **LOGIN（自环）** | LoginGuard: `→ failed`，Agent 重试 |
| 5 | NAVIGATE | `targetReached = true`（URL 匹配目标 或 snapshot 内容 > 200 字符） | TEST | **确定性触发**，不依赖 LLM 再调 snapshot |
| 6 | TEST | `coverageComplete = true`（coverage 已初始化时以此为准） | REPORT | 退出权属于 `shouldFinishTesting()`，LLM 停止 ≠ 完成 |
| 7 | TEST | 操作成功 → coverage 更新 | **TEST（自环）** | 继续测试 |
| 8 | REPORT | always | DONE | 会话结束 |

## 关键机制（P0-P2 新增）

### 确定性 NAVIGATE→TEST

`targetReached` 通过两条确定性路径设置：
1. `browser_navigate` 成功且当前 URL 归一化后匹配目标 URL（`normalizeUrlForCompare`）
2. `browser_snapshot` 内容 > 200 字符（原逻辑保留）

**绝不依赖 LLM 主动多调一次 snapshot**——"目标 URL 本身就是测试目标"的场景（如百度首页）曾因此永久卡在 NAVIGATE。

### LLM 停止 ≠ 会话完成

LLM 无 tool call 时，若处于 TEST 且 coverage 已初始化：
- `shouldFinishTesting()` 判定完成 → `coverageComplete = true` → REPORT
- 判定未完成 → 注入 "Continue testing" 指引，强制继续

**最终完成权属于 Coverage Model，不属于 LLM。**

### Target Stagnation（最后防线）

```
target 被选中但 3 turns 内无匹配 action
    → skippedTargets 记录 + markScenarioSkipped（诚实覆盖：status/outcome=skipped + reason evidence）
    → 永不静默消失，报告可见
```

这是**防死锁最后防线**，不是正常 target advancement 机制。正常推进靠 Major Surface Reconciliation。

### Major Surface Reconciliation（P0-B）

Surface major change 时：
```
注册新 Surface → assignIntentRoles() 重新绑定 → 失效 currentCoverageTarget（局部）
→ 重置 stagnation → 重新 selectNextTarget()
```
**绝不 reset 整个 CoverageModel**——已 covered/skipped 状态是持久资产。

`getCoverageGaps(model, policy, instructions, currentSurfaceOnly)`：
- target selection 传 `true`（限定当前 surface，防止旧 surface target 竞争）
- exit criteria 用默认 `false`（全局 coverage 判定）

## 无效转换（Invariant 告警）

| 起始状态 | 违规条件 | 说明 |
|---------|---------|------|
| NAVIGATE | 当前页含登录表单 | 不应在导航阶段停留在登录页 |
| TEST | 未到达目标或仍在登录页 | 测试阶段必须已就绪 |
| REPORT | 无测试执行记录 | 报告阶段必须有测试依据 |

Invariant 违反记录到 `invariantViolations` 并告警，**不阻断执行**（non-fatal）。

## 关键转换覆盖率

`traversedTransitions: string[]` 追踪每次触发的转换，DEBUG 级日志可见：
```
[STATE] transitions traversed: [INIT→NAVIGATE, NAVIGATE→TEST, TEST→REPORT]
```

## LoginGuard 旁路状态机（login.ts）

独立于主 FSM，六态、证据驱动：

```
not_required ──登录证据──► required ──表单可见──► login_page_detected
                                                          │ 凭据提交
                                                          ▼
                                                  login_in_progress
                                                    │           │
                                              成功证据      仍在登录页
                                                    ▼           ▼
                                             authenticated   failed
```

**核心原则**："URL 不是登录页" ≠ "已登录"。导航永远不推进登录状态；只有显式证据（logout 链接、用户菜单、离开登录页+实质内容、dashboard 内容）才确认认证。仅在 `authenticated` 时阻止回访登录页 URL。

## ALIGN 诊断（unmatched action 时）

```
[ALIGN] v7 (decided@v7) target=feat_x(...) action.ref=... verdict=<四选一>
```

| verdict | 含义 | 修复方向 |
|---------|------|---------|
| `no_ref` | action 无 ref，name-matching only | name/type resolver |
| `ref_unknown` | action ref ∉ 当前 snapshot refs | snapshot 获取/注入时机 |
| `ref_drift` | feature.ref 已过期（action ref 是新的） | Feature.ref 绑定生命周期（P2 Phase 3） |
| `resolver_miss` | refs 一致但 identity 不充分 | **安全拒绝，不修**（如 icon "×"） |

`v != decided@v`：LLM 基于旧 snapshot 决策（temporal skew 实证）。

## 设计红线

1. 永不为降低 stagnation 而降低 resolution threshold——false positive 假覆盖比效率损失危险
2. Coverage ≠ Outcome：fail 也算 covered；skipped 有独立语义（status/outcome/reason）
3. target selection ≠ planned：只有 action 成功 resolve 才推进 scenario 状态
4. Coverage Model = source of truth：不因 surface 变化 reset，不由 LLM 单方面改写
