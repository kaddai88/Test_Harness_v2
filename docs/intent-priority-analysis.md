# Intent 打分与 Priority 定义：完整流程分析（历史参考）

> **状态**: 本文档描述的分析框架已被 commit `5f6eacf` 的 **Intent Model 重构**取代。
> 保留作为问题发现记录。当前架构见 [STATE-MACHINE.md](./STATE-MACHINE.md) 与 `coverage.ts` 的
> `TestIntent` / `IntentRole` / `CoverageScope` 实现。
>
> 下文 "改进方向" 中以下方案已被明确否决，不要再提出：
> 1. LLM 逐 feature 打 priority（与 Coverage = source of truth 冲突）
> 2. 正则硬编码中文句式识别模块（表达太多样）
> 3. 80% 覆盖率定义 Acceptance scope（80% 是结果不是语义）
> 4. 降低 resolver 阈值换 skip 数量（false positive 比效率损失危险）
>
> 已验证的正确方向：Intent Role 语义化、pending intent 持久化、
> ALIGN 四 verdict 决策树、deterministic→template→LLM 逐级下沉。

---

# Intent 打分与 Priority 定义：完整流程分析

## 📊 完整流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        1. Feature Discovery                              │
│                    (discoverFeaturesFromSnapshot)                        │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ARIA Snapshot 解析                                                      │
│                                                                         │
│  [ref=e12] button "创建项目"                                             │
│  [ref=e13] textbox "项目名称"                                            │
│  [ref=e14] link "项目列表"                                               │
────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
─────────────────────────────────────────────────────────────────────────
│  2. Feature 注册 (registerFeature)                                       │
│                                                                         │
│  每个 feature 获得默认 priority:                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ priority: { level: 'normal', source: 'llm' }                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ⚠️ 问题 1: 所有 features 都是 normal priority！                         │
│     没有机制区分真正重要的功能                                            │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. Intent Relevance 计算                                                │
│     (calculateAllIntentRelevance)                                        │
│                                                                         │
│  输入: 用户指令 "使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试"      │
────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. 关键词匹配 (INTENT_KEYWORD_GROUPS)                                   │
│                                                                         │
│  12 组关键词，每组有:                                                    │
│  - terms: 关键词列表 (如 ['搜索', 'search', ...])                        │
│  - featureTypes: 匹配的功能类型                                          │
│  - baseScore: 基础分 (0.6-1.0)                                           │
│                                                                         │
│  示例:                                                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Group: '登录'                                                     │  │
│  │ terms: ['登录', 'login', 'signin', '认证', 'auth']                │  │
│  │ featureTypes: ['form', 'text-input', 'button']                    │  │
│  │ baseScore: 1.0                                                    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. 分层打分 (Tiered Scoring)                                            │
│                                                                         │
│  Tier 1: Direct name match (score = baseScore)                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 指令包含关键词 AND feature.name 包含关键词                         │  │
│  │ 例：指令="测试搜索", name="搜索框" → "搜索" in both → 1.0          │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  Tier 2: Name contains keyword (score = baseScore × 0.6)              │
│  ──────────────────────────────────────────────────────────────────┐  │
│  │ feature.name 包含关键词（指令不一定包含）                           │  │
│  │ 例：指令="测试功能", name="登录按钮" → 1.0 × 0.6 = 0.6             │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  Tier 3: Type-only match (score = baseScore × 0.3)                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 指令包含关键词 AND feature.type 匹配                               │  │
│  │ 例：指令="测试搜索", name="用户名", type="text-input" → 0.3        │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  6. Scope 过滤 (isFeatureInScope)                                        │
│                                                                         │
│  根据 testType 选择 scope:                                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ smoke        → intent_relevant                                    │  │
│  │ confirmation → discovered_core                                    │  │
│  │ acceptance   → discovered_core (或 comprehensive)                 │  │
│  │ full         → all                                                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  discovered_core 定义:                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ ✓ intentRelevance.score > 0.5                                    │  │
│  │ ✓ effectivePriority = critical/high                              │  │
│  │ ✓ feature.type ∈ {button, form, text-input, search, table, ...} │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  7. Target Selection (selectNextTarget)                                  │
│                                                                         │
│  对 gaps 按 composite score 排序:                                        │
│  score = priorityScore + intentScore                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ priorityScore: critical=4, high=3, normal=2, low=1                │  │
│  │ intentScore: relevance × 4 (0-4)                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## ️ 发现的问题

### 问题 1: Priority 全是 normal

**现象：**
```typescript
// registerFeature 默认值
priority: { level: 'normal', source: 'llm' }
```

**影响：**
- 51 个 features 中，所有都是 `normal` priority
- `effectivePriority` 无法区分重要功能
- scope 过滤只能依赖 intent relevance

**根因：**
- Feature discovery 时没有分析功能重要性
- 没有 site profile 或历史数据支持 priority 判断
- LLM 没有参与 priority 评估

---

### 问题 2: Intent Relevance 过于宽松

**现象：**
```typescript
// Tier 2: 只要 feature name 包含关键词就得分
// 即使指令完全没有提及该功能！

// 例：
指令 = "测试项目集模块"
feature.name = "登录按钮"
→ "登录" 在关键词组中
→ Tier 2 匹配：1.0 × 0.6 = 0.6  ← 假阳性！
```

**影响：**
- 不相关的 features 获得高 intent score
- scope 过滤选中了不该测的功能
- 测试资源浪费

**根因：**
- Tier 2 没有验证指令是否真的提及该关键词
- 关键词匹配太简单（子串匹配）
- 没有上下文理解

---

### 问题 3: Scope 定义不合理

**现象：**
```typescript
// acceptance 测试使用 discovered_core
// 但 discovered_core 只包含:
// - intent > 0.5 (可能只有 2-3 个)
// - priority critical/high (0 个，全是 normal)
// - core types (约 20-25 个)

// 结果：51 个中只选 25 个 (49%)
// 用户期望：验收测试至少 80%
```

**影响：**
- 验收测试覆盖不足
- 用户不满意

**根因：**
- `discovered_core` 定义太窄
- 没有为 acceptance 设计专门的 scope
- 缺少 percentage-based 的 scope 选项

---

### 问题 4: 没有用户意图的细粒度理解

**现象：**
```
指令："使用 admin/Abcd.1234 登录系统，对模块"项目集"进行测试"

当前理解:
- "登录" → 登录相关 features (intent=1.0)
- 其他所有 → intent=0 或很低

缺失理解:
- "项目集" 是核心测试目标
- 项目集相关的 CRUD 功能应该高优先级
- 导航到项目集的路径应该被测试
```

**影响：**
- 只测了登录，没测项目集
- 测试偏离用户真实意图

**根因：**
- 关键词匹配无法理解模块/功能关系
- 没有实体识别（"项目集" 是一个模块名）
- 没有功能依赖分析

---

##  建议的改进方向

### 改进 1: LLM-assisted Priority Assignment

```typescript
// 在 feature discovery 后，调用 LLM 评估优先级
async function assignFeaturePriorities(
  features: CoverageFeature[],
  instructions: string
): Promise<void> {
  const prompt = `
    分析以下 features，根据用户指令评估优先级:
    
    指令: ${instructions}
    
    Features:
    ${features.map(f => `- ${f.name} (${f.type})`).join('\n')}
    
    返回 JSON:
    {
      "featureName": { "level": "critical|high|normal|low", "reason": "..." }
    }
  `;
  // 调用 LLM...
}
```

### 改进 2: 更严格的 Intent Matching

```typescript
// Tier 2 应该要求指令也包含相关上下文
Tier 2 (修正): 
  指令包含关键词 OR 指令包含相关上下文
  AND feature.name 包含关键词
  
// 例：
指令 = "测试项目集"
feature.name = "登录按钮"
→ "登录" 不在指令中，也没有相关上下文
→ 不匹配 ✓

指令 = "测试登录和项目集"
feature.name = "登录按钮"  
→ "登录" 在指令中
→ 匹配 ✓
```

### 改进 3: 添加 comprehensive scope

```typescript
case 'comprehensive': {
  // 包含 80%+ features
  // 排除: 纯导航链接、重复功能、明显无关的
  
  const excludeTypes = new Set(['navigation', 'tab']);
  if (excludeTypes.has(feature.type)) {
    return feature.intentRelevance?.score > 0.7;  // 只有高 intent 才包含
  }
  
  return true;  // 其他都包含
}
```

### 改进 4: 模块/功能依赖分析

```typescript
// 识别指令中的模块名
const modulePattern = /模块["\s](\w+)["\s]/;
const match = instructions.match(modulePattern);
if (match) {
  const targetModule = match[1];  // "项目集"
  
  // 提升目标模块相关 features 的 priority
  for (const feature of features) {
    if (feature.name.includes(targetModule) || 
        feature.parentModule === targetModule) {
      feature.priority.level = 'critical';
    }
  }
}
```

---

## 📈 期望的改进效果

| 指标 | 当前 | 改进后 |
|------|------|--------|
| Priority 分布 | 100% normal | critical: 10%, high: 20%, normal: 60%, low: 10% |
| Intent 假阳性率 | ~30% | <10% |
| Acceptance 覆盖率 | 49% | 80%+ |
| 目标模块识别 | 无 | 有（基于指令解析） |

---

**文档版本:** v1.0  
**生成时间:** 2026-09-08  
**目的:** 分析 intent 打分和 priority 定义的问题，为改进提供依据
