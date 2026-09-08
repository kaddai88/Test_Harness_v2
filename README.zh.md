# Test-Harness

> AI 驱动的网站测试平台（DSH 风格架构）。用自然语言描述你要测什么——LLM 智能体自主规划、
> 执行浏览器操作、实时流式推送结果。

![CI](https://github.com/kaddai88/Test_Harness_v2/actions/workflows/ci.yml/badge.svg)
![Tests](https://img.shields.io/badge/tests-173%20passing-brightgreen)
![Packages](https://img.shields.io/badge/packages-18-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933)
![pnpm](https://img.shields.io/badge/pnpm-10-F69220)
![License](https://img.shields.io/badge/license-MIT-blue)

🌐 [English](README.md)

---

## 概述

Test-Harness 是一个生产级的、AI 驱动的网站测试平台，采用 TypeScript monorepo 构建。
架构设计灵感来源于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 及其
[Cordis](https://github.com/cordiverse/cordis) 插件框架：

**一切皆插件** — LLM 适配器、工具、存储后端都通过类型化的*服务定义*注册，
并通过 *waterfall* 扩展点进行拦截。

### 核心特性

- **AI Agent Loop** — LLM 智能决定测什么、按什么顺序、如何解读结果（DSH 风格架构：SessionLog、Waterfall 事件、Turn→Step 管线）
- **Session Log** — 仅追加的事件日志；所有模型可见内容均可从日志中重建
- **Waterfall 事件** — 每个管线阶段都支持 around-middleware 拦截（pre-step、request、pre/post-execute）
- **LLM 流式输出** — 测试过程中的实时终端和 WebSocket 进度推送
- **浏览器自动化** — navigate、click、fill、screenshot、assert（通过 Playwright MCP 或本地）
- **Playwright MCP** — 连接 @playwright/mcp 服务器进行标准化浏览器自动化
- **泛化层** — 无需硬编码选择器即可跨站点测试：DOM 降采样（50k→200-500 元素）、SmartLocator（5 级降级）、SiteProfile（自学习站点知识）、observe→find→act 范式
- **自学习站点画像** — 从历史会话中自动发现认证/表单/导航模式；跨 session 持久化，使后续测试更快更可靠
- **多 LLM 提供商** — OpenAI 兼容 API、Ollama（本地）、DeepSeek，支持故障转移
- **完整 Web 平台** — REST API + WebSocket + React Dashboard
- **生产就绪** — 优雅停机、速率限制、Docker 部署、CI/CD

### Coverage-Driven 测试架构

> **Coverage Model 决定"测什么"，Planner 决定"怎么测"，Policy 决定"何时结束"。**
> （commit 5f6eacf — 详见 [STATE-MACHINE.md](./docs/STATE-MACHINE.md)）

核心四概念严格分离：

| 概念 | 回答的问题 | 类型 |
|------|-----------|------|
| **Intent Role** | 本次任务与 feature 的关系 | `primary/prerequisite/supporting/incidental/irrelevant` |
| **Intrinsic Priority** | Feature 本身的重要性 | `critical/high/normal/low` |
| **Coverage Scope** | 测多少 | `intent/comprehensive/core/all` |
| **Target Selection** | 先测谁 | 分层：scope → role → priority → gap → risk |

`TestIntent.primaryModules`（如 `"项目集"`）在页面未出现时保持 pending，目标 surface 出现后通过 `assignIntentRoles()` 晋升为 primary（已 E2E 验证：登录页 primary=0 → 业务页 primary=18）。

### 当前配置

| 组件 | 值 |
|------|-----|
| **LLM 提供商** | OpenAI 兼容 API |
| **模型** | minimax/minimax-m2.7-free |
| **浏览器模式** | Playwright MCP (`BROWSER_MODE=mcp`) |
| **MCP 服务器** | `@playwright/mcp` 运行在 `http://localhost:3001/mcp` |

### 系统架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             客户端层                                      │
│   CLI (th test)    React Dashboard    REST API    WebSocket (实时推送)    │
└──────────┬──────────────┬──────────────────┬───────────────┬────────────┘
           │              │                  │               │
           ▼              ▼                  ▼               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                        th-agent  (Agent Loop)                            │
│                                                                          │
│  ┌─────────┐   ┌─────────┐   ┌───────────┐   ┌──────────┐              │
│  │  Turn   │──▶│  Step   │──▶│   Model   │──▶│  Tool    │──┐           │
│  │  Start  │   │  Start  │   │  Request  │   │  Calls   │  │           │
│  └─────────┘   └─────────┘   └───────────┘   └──────────┘  │           │
│       ▲                                               │      │           │
│       │            ┌───────────┐                      │      │           │
│       └────────────│  Tool     │◀─────────────────────┘      │           │
│                    │  Results  │                              │           │
│                    └───────────┘                              │           │
│  Waterfall: pre_step → request → stream → pre_execute → post_execute    │
│  Session Log: 仅追加、deriveMessages()、完全可重放                         │
└──────────┬──────────────────────────────────────────────────────────────┘
           │
     ┌─────┬─────────────┬──────────┐
     ▼     ▼             ▼          ▼
┌────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐
│  LLM   │ │ Tools    │ │Browser │ │  Report  │
│Provider│ │ Registry │ │ Driver │ │Generator │
│        │ │          │ │        │ │          │
│┌──────┐│ │┌──────┐ │ │┌──────┐│ │┌───────┐│
││Ollama││ ││nav   │ │ ││Play- ││ ││ JSON  ││
││OpenAI││ ││click │ │ ││wright││ ││  MD   ││
││Qwen  ││ ││fill  │ │ ││ MCP  ││ ││ HTML  ││
││Stub  ││ ││assert│ │ │└──────┘│ │└───────┘│
│└──────┘│ ││screen│ │ │        │ │          │
│        │ ││http  │ │ │        │ │          │
│        │ ││report│ │ │        │ │          │
│        │ │└──────┘ │ │        │ │          │
└────────┘ └──────────┘ └────────┘ └──────────┘
     ┌─────────────────────────────────────────────────┐
     │              th-core  (插件框架)                 │
     │  ┌───────────┐ ┌────────┐ ┌───────┐ ┌────────┐ │
     │  │ Container │ │ Events │ │ Effect│ │ Plugin │ │
     │  │   (DI)    │ │  Bus   │ │ Stack │ │ Loader │ │
     │  │           │ │4 模式   │ │       │ │        │ │
     │  └───────────┘ └────────┘ └───────┘ └────────┘ │
     ─────────────────────────────────────────────────┘
     ┌─────────────────────────────────────────────────┐
     │              存储与传输                            │
     │  th-persistence   th-queue    th-worker         │
     │  (JSON/内存)       (进程内)   (任务处理器)        │
     └─────────────────────────────────────────────────
```

## 快速开始

### CLI 命令行

```bash
# 安装依赖
pnpm install

# 启动 Ollama（或设置 OPENAI_API_KEY / DEEPSEEK_API_KEY）
ollama pull llama3.1

# 启动测试会话
pnpm --filter @test-harness/th-cli test https://example.com --instructions "测试登录功能"

# 探索整个站点
pnpm --filter @test-harness/th-cli test https://example.com --instructions "探索整个站点"

# 使用不同的 LLM 提供者
pnpm --filter @test-harness/th-cli test https://example.com --provider openai --model gpt-4o
```

### 服务器 + Dashboard

```bash
# 启动服务器（API + Worker + 数据库）
node apps/server/th-server/dist/index.js
# → REST API: http://localhost:3000/api/v1
# → 健康检查: http://localhost:3000/api/v1/health

# 启动 React Dashboard（开发模式）
pnpm --filter @test-harness/th-dashboard dev
# → Dashboard: http://localhost:5173

# 通过 API 发起测试会话
curl -X POST http://localhost:3000/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"targetUrl":"https://example.com","scanConfig":{"instructions":"测试登录功能"}}'

# 通过 WebSocket 观看实时进度
# ws://localhost:3000/ws
```

### Docker 部署

```bash
docker compose up -d            # 服务器在 :3000，Ollama 在 :11434
docker compose logs -f server
```

### 运行测试

```bash
npx vitest run                  # 运行所有测试
```

完整 REST + WebSocket 端点参考请查看 [docs/API.md](docs/API.md)。

## 包清单

### 应用层

| 包名 | 路径 | 说明 |
|---|---|---|
| `@test-harness/th-server` | `apps/server/th-server` | 生产服务器（REST + WebSocket + Worker） |
| `@test-harness/th-dashboard` | `apps/web/th-dashboard` | React 18 单页应用（Vite + Tailwind + Zustand） |
| `@test-harness/th-cli` | `packages/cli/th-cli` | 命令行工具：`th test <url>` |

### 框架核心

| 包名 | 路径 | 说明 |
|---|---|---|
| `@test-harness/th-protocol` | `packages/protocol/th-protocol` | 共享类型 + 事件定义（零运行时依赖） |
| `@test-harness/th-core` | `packages/core/th-core` | 插件框架：DI 容器、4 模式事件总线、效果系统 |
| `@test-harness/th-agent` | `packages/agent/th-agent` | Agent Loop + Session Log + Stream Assembler |

### LLM 适配器

| 包名 | 提供者 | 特性 |
|---|---|---|
| `@test-harness/th-llm` | 抽象接缝 | 路由、能力协商 |
| `@test-harness/th-llm-ollama` | [Ollama](https://ollama.ai) | 本地模型、流式输出、工具调用 |
| `@test-harness/th-llm-openai` | OpenAI | GPT-4o、流式输出、函数调用 |
| `@test-harness/th-llm-deepseek` | DeepSeek | V3/R1、OpenAI 兼容接口 |

### 工具与浏览器

| 包名 | 说明 |
|---|---|
| `@test-harness/th-tools` | 工具框架 + 16 个内置工具：浏览器/HTTP + 泛化工具（observe_page、find_element、extract_data、explore_site、configure_site） |
| `@test-harness/th-browser` | 浏览器能力接缝 + Playwright MCP + 泛化层（DOM 降采样、SmartLocator、SiteProfile、跨 session 缓存持久化） |

### 基础设施

| 包名 | 路径 | 说明 |
|---|---|---|
| `@test-harness/th-persistence` | `packages/persistence/th-persistence` | 会话存储（JSON 文件 / 内存） |
| `@test-harness/th-queue` | `packages/queue/th-queue` | 进程内任务队列（test:execute、test:report 任务类型） |
| `@test-harness/th-worker` | `packages/worker/th-worker` | 测试会话任务处理器 |
| `@test-harness/th-report` | `packages/report/th-report` | 报告生成器（JSON / Markdown / HTML） |
| `@test-harness/th-api` | `packages/api/th-api` | REST API（sessions、reports、health）+ WebSocket 网关 |

## 文档

| 文档 | 说明 |
|---|---|
| [贡献指南](CONTRIBUTING.md) | 环境搭建、编码规范、如何添加插件 |
| [API 参考](docs/API.md) | REST + WebSocket 端点完整文档与示例 |
| [插件开发指南](docs/PLUGIN-DEV.md) | 编写工具 / LLM 适配器 / 存储后端 |
| [DSH 架构分析](docs/DSH-ANALYSIS.md) | DeepSeek Harness 架构深度剖析 |
| [实现计划](docs/PROGRESS-REPORT.md) | 实现计划与进度报告 |

## 开发

```bash
pnpm install                 # 安装依赖
pnpm run build               # 构建所有包
pnpm run typecheck           # 类型检查所有包
npx vitest run               # 运行所有测试（70 个测试，6 个套件）
pnpm run clean               # 清理所有 dist/ 目录
```

需要 **Node 20+** 和 **pnpm 10**（由 corepack 管理）。

## 项目状态

全部 5 个阶段完成 — **生产就绪**：

| 阶段 | 范围 | 包数 | 状态 |
|---|---|---|---|
| **Phase 1** | 基础架构 | 10 | ✅ 完成 |
| **Phase 2** | 核心增强 | 16 | ✅ 完成 |
| **Phase 3** | Web 平台 | 21 | ✅ 完成 |
| **Phase 4** | 生产就绪 | 22 | ✅ 完成 |
| **Phase 5** | 泛化层 | 18 | ✅ 完成 |

### 已完成

- ✅ 插件框架（DI 容器、4 模式事件总线、效果系统）
- ✅ Agent Loop（Session Log、Waterfall 事件、LLM 流式输出）
- ✅ 三阶段工具执行管线 + 超时控制
- ✅ 3+ 个 LLM 适配器（Ollama、OpenAI、DeepSeek）+ 故障转移
- ✅ 16 个内置工具，含 5 个泛化工具（observe_page、find_element、extract_data、explore_site、configure_site）
- ✅ 泛化层：DOM 降采样、SmartLocator（5 级降级）、SiteProfile 自学习
- ✅ 跨 session 缓存持久化 — 一次会话中学到的选择器在下次会话中复用
- ✅ observe→find→act 范式 — Agent 用语义方式发现页面元素，替代硬编码 CSS/XPath
- ✅ REST API（sessions/reports/health 端点）+ WebSocket 实时网关
- ✅ React Dashboard（6 个页面，实时测试进度）
- ✅ JSON 文件持久化（Repository 模式）
- ✅ 任务队列（优先级 + 重试）
- ✅ 报告生成（JSON / Markdown / HTML）
- ✅ 优雅停机、速率限制、Docker 部署
- ✅ GitHub Actions CI/CD（Node 20 + 22 矩阵）
- ✅ 70 个通过测试
- ✅ 完整文档（API、插件开发指南、贡献指南）

### 未来规划

- 📋 PostgreSQL 持久化提供者（生产数据库）
- 📋 BullMQ + Redis（分布式任务队列）
- 📋 JWT 认证 + 多租户支持
- 📋 Kubernetes 部署 + Helm Charts
- 📋 定时测试 + 结果对比
- 📋 白标报告
- 📋 测试意图 DSL / 自然语言测试用例解析
- 📋 自适应探索策略（WebProber 模式）
- 📋 反爬虫 / 代理支持

## 许可证

MIT
