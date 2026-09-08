# 主要问题与风险修复方案

> 分析基线：`main` / `6ad94ab`
>
> 文档日期：2026-09-09
>
> 范围：安全边界、任务生命周期、实时流、持久化、Cognition、Agent 规划与上下文、测试和文档一致性。

## 1. 目的与结论

Test-Harness 已经具备完整的产品原型骨架：React Dashboard、REST/WebSocket、异步 Worker、Agent Loop、浏览器工具、覆盖率模型和报告链路都已连接。但当前实现仍以可信单机环境为前提，安全、持久化和任务状态还不满足公开部署要求。

建议不要一次性重写所有子系统，而是按以下顺序推进：

1. **先封住安全边界和数据损坏路径**：认证、Settings、SSRF、原子 JSON 写入、损坏文件处理。
2. **再保证任务状态正确**：取消、终态竞争、定时器与关机生命周期。
3. **统一持久化事实源**：以数据库为唯一事实源，移除 Cognition/SiteProfile 的运行时双写同步。
4. **补齐 Agent 行为与验证**：修复 SessionLog 上下文丢失、流式契约、LLM Planner，并建立集成测试。
5. **最后更新能力声明**：README、API 文档和部署配置必须描述真实实现。

推荐的近期产品边界是：

- 默认作为**单节点、单进程**服务运行；
- HTTP 和 WebSocket 使用同一个管理员 Bearer Token；
- 默认仅允许公网 HTTP(S) 目标，私网目标通过显式 allowlist 开放；
- Settings 写入端点默认禁用；
- 短期保留 JSON 后端但增加单写者锁和原子写，中期迁移至 SQLite；
- 数据库成为 Cognition 和 SiteProfile 的唯一事实源。

## 2. 风险优先级总览

| 优先级 | 问题 | 当前影响 | 目标状态 |
|---|---|---|---|
| P0 | HTTP/WS 无认证、CORS 为 `*` | 任意客户端可创建任务、删除数据、读取实时活动 | HTTP/WS 统一认证，精确 Origin allowlist |
| P0 | Settings 可覆写 `.env` | 未认证修改密钥和 LLM Base URL，可导致配置注入与凭证泄露 | 默认禁用；启用时仅管理员可用并严格校验、原子写 |
| P0 | 目标 URL 与出站请求无安全策略 | 可访问内网、metadata 服务或非 HTTP(S) 资源 | API、工具、DNS、重定向与浏览器网络层统一策略 |
| P0 | JSON 文件直接覆盖、损坏后自动空库 | 崩溃或磁盘错误可造成全量数据丢失 | 原子替换、备份、启动失败关闭、保存错误向上传播 |
| P0 | Cognition 在 ESM 中使用 `require` 且吞错 | 跨 Session 学习实际上可能从未落盘 | ESM I/O、显式错误、统一事实源 |
| P1 | 排队/运行取消和终态存在竞争 | 已取消任务仍执行，取消可能变 failed/completed | 队列取消、直接 abort、终态 CAS、幂等取消 |
| P1 | SIGINT/SIGTERM 重复注册 | 第二个 handler 可能提前 `process.exit()` | 入口独占信号，服务类只管理资源 |
| P1 | 流式累计文本被前端再次追加 | UI 文本重复，活动元数据可能平方增长 | 保留累计协议，前端替换并按 session/turn 隔离 |
| P1 | Cognition/SiteProfile 多套存储相互同步 | 重复记录、跨站污染、删除后复活 | DB 唯一事实源，一次性迁移旧文件 |
| P1 | SessionLog 忽略 `system/note` | 恢复、覆盖率、工作流提示未进入下一轮模型上下文 | 明确区分可见/审计 note，并正确派生消息 |
| P1 | API、Persistence、Cognition、Dashboard 缺测试 | 关键行为缺少回归保护 | 建立边界与端到端集成测试 |
| P2 | LLM Planner 是占位实现 | 分层 Planner 并未真正调用 LLM | 实现结构化规划并保留模板 fallback |
| P2 | 文档与代码漂移 | 部署者会误判 SQLite、BullMQ、限流和 API 能力 | CI 校验文档示例，声明真实成熟度 |

## 3. P0：安全边界

### 3.1 HTTP 与 WebSocket 认证

#### 已证实问题

- `APIServer.handleRequest()` 在路由分发前没有认证：`packages/api/th-api/src/server.ts`。
- 服务监听时没有指定 host，不能把“本地工具”当作安全边界。
- CORS 对所有 Origin 返回 `*`：`packages/api/th-api/src/http.ts`。
- WebSocket upgrade 不校验 `/ws` 路径、Origin 或身份：`packages/api/th-api/src/websocket.ts`。
- WebSocket 订阅信息没有参与广播过滤，所有客户端可收到所有 Session 活动。

#### 推荐实现

1. 在 `th-api` 定义独立的 `AuthPolicy`，由 Server 注入：
   - 从 `TEST_HARNESS_API_TOKEN` 读取预共享管理员 Token；
   - 使用恒定时间比较；
   - `/api/v1/health` 默认匿名，其余 REST 端点要求 `Authorization: Bearer ...`；
   - 不在日志、响应或前端持久化中输出 Token。
2. WebSocket 使用相同凭据：
   - 只接受 `/ws` upgrade；
   - 校验 Origin allowlist；
   - 浏览器端通过首条认证消息或受约束的 WebSocket subprotocol 传递凭据，不把 Token 放入 URL 查询串；
   - 认证成功前不允许订阅。
3. CORS 改为 `TEST_HARNESS_ALLOWED_ORIGINS` 精确列表：
   - 仅对匹配 Origin 返回 `Access-Control-Allow-Origin`；
   - 返回 `Vary: Origin`；
   - methods 与真实接口保持一致，包含 `PUT`；
   - CORS 只作为浏览器隔离，不能替代认证。
4. WebSocket 广播按 `sessionId` 订阅过滤；订阅前校验 Session 存在。
5. Server 增加 `HOST` 配置；开发环境默认 `127.0.0.1`，Docker 显式设置 `0.0.0.0` 并要求 Token。

#### 关键文件

- `packages/api/th-api/src/server.ts`
- `packages/api/th-api/src/http.ts`
- `packages/api/th-api/src/websocket.ts`
- `apps/server/th-server/src/app.ts`
- `apps/server/th-server/src/index.ts`
- `apps/web/th-dashboard/src/api/client.ts`
- `apps/web/th-dashboard/src/api/websocket.ts`

#### 验收标准

- 无 Token 的受保护 REST 请求返回 401。
- 非 allowlist Origin 不得到 CORS 授权。
- WS 错误路径、错误 Origin、未认证连接均被拒绝。
- 客户端只收到已订阅 Session 的事件。
- 日志和浏览器存储中不存在 API Token。

### 3.2 Settings 写入 `.env`

#### 已证实问题

`PUT /api/v1/settings` 当前会读取并整文件覆盖 `.env`：`packages/api/th-api/src/routes/settings.ts`。

具体风险包括：

- 未认证即可修改密钥；
- `apiKey`、`baseUrl` 可通过换行注入额外变量；
- 前端支持 DeepSeek，但后端未处理，仍返回成功并可能删除旧配置；
- 值包含 `=` 时，运行时 `process.env` 更新会被截断；
- 启动读取的项目根 `.env` 与设置接口按 cwd 写入的 `.env` 可能不是同一文件；
- 前端把 API Key 长期存入 `localStorage`；
- UI 未等待服务端成功就显示“已保存”；
- LLM Provider 已在启动时实例化，修改 `process.env` 不会使当前实例立即生效。

#### 推荐实现

1. 增加 `ENABLE_SETTINGS_WRITE=false`，默认不注册或返回 404；部署配置继续由环境变量/Secret 管理。
2. 如果显式启用：
   - 必须通过管理员认证；
   - 使用运行时 schema 校验 provider、字段类型和长度；
   - 拒绝 CR、LF、NUL；
   - 支持的 provider 必须前后端一致；
   - 明确定义空 API Key 是“保留”还是“删除”，推荐保留；
   - 只写预先解析的绝对配置路径；
   - 使用与数据库相同的原子写工具；
   - 写入成功后提示“重启生效”，不修改已构造 Provider 的假状态。
3. Dashboard 不保存服务端 API Key；输入框只接受新值，保存成功后立即清空。
4. Dashboard 必须检查 `response.ok` 后再显示成功。

#### 验收标准

- 默认部署无法通过 API 修改 `.env`。
- 未认证、未知 provider、非法字符均不会改变文件。
- 写失败时旧文件保持完整，UI 显示失败。
- API Key 不出现在 `localStorage`。

### 3.3 SSRF 与浏览器网络隔离

#### 已证实问题

Session 创建只检查 `targetUrl` 非空：`packages/api/th-api/src/routes/sessions.ts`。随后 URL 可通过以下路径访问网络：

- `http_request` → `undici.request()`；
- `navigate_to` / `measure_performance` → Playwright `page.goto()`；
- Playwright MCP 的 `browser_navigate` 及未过滤工具；
- 浏览器页面重定向和子资源请求。

仅在 API 使用 `new URL()` 或 Zod URL 校验不能防止 DNS 解析到私网、重定向到私网、IPv6 变体和浏览器子资源绕过。

#### 推荐实现

1. 在 `th-tools` 或独立基础包中实现共享 `OutboundUrlPolicy`：
   - 只允许 `http:`、`https:`；
   - 拒绝 userinfo；
   - 规范化 hostname；
   - 解析全部 A/AAAA 记录；
   - 默认拒绝 loopback、private、link-local、unspecified、multicast、IPv4-mapped IPv6 和 metadata 地址；
   - 支持 `TEST_HARNESS_TARGET_ALLOWLIST` 的 hostname/CIDR 显式放行。
2. 在以下边界重复执行策略，而不只在 Session 创建时校验：
   - `POST /sessions`；
   - `http_request` 实际请求前及每次 redirect；
   - 本地 Playwright 顶层导航和 request interception；
   - MCP `browser_navigate` 参数适配层。
3. 对不可信远程任务禁用 `browser_run_code_unsafe` 等可绕过策略的 MCP 工具；MCP 工具注册改为 allowlist。
4. 浏览器请求拦截应允许目标页面所需的公网 CDN/SSO，同时阻止私网目标；跨域行为不应仅按主域名判断。
5. DNS 检查与连接之间仍有 rebinding 窗口。公开部署应同时在容器/主机网络层禁止访问 metadata 与管理网段，应用策略不是唯一防线。

#### 验收标准

- `file:`、`data:`、localhost、RFC1918、link-local、metadata 和私网 DNS 解析均被拒绝。
- 公网 URL 重定向到私网时被拒绝。
- API、HTTP Tool、本地 Playwright、MCP 使用同一策略测试集。
- allowlist 能有意放行受信任内网站点，不会全局关闭保护。

### 3.4 Rate Limiter

#### 已证实问题

`RateLimiter` 在 `apps/server/th-server/src/app.ts` 被创建和定时清理，但没有传入 `APIServer`，全仓没有调用 `check()`。入口也没有提供 rate limit 配置，所以当前限流完全不生效。

#### 推荐实现

- 将限流抽象作为 `APIServerOptions` 依赖，在认证后、路由前执行；
- 默认按认证主体计数，无身份的 health 请求按 remote address 计数；
- 不无条件信任 `X-Forwarded-For`，只有配置 trusted proxy 时才读取；
- OPTIONS 和 health 可豁免，创建 Session、Settings、WebSocket upgrade 使用更严格的独立桶；
- 429 返回 `Retry-After` 和 limit/reset 信息；
- 校验配置必须大于 0；
- Server stop 时显式清理 limiter 生命周期。

## 4. P0/P1：持久化可靠性

### 4.1 当前真实后端

`createDatabase()` 目前只有两条路径：

- 未配置 `DB_PATH`：In-Memory；
- 配置 `DB_PATH`：`JsonFileDatabase`。

SQLite Provider 是无条件抛错的占位实现，PostgreSQL 只有未接入的 schema 字符串。即使文件名为 `testharness.db`，当前写入内容仍是 JSON。

### 4.2 JSON 后端缺陷

`packages/persistence/th-persistence/src/providers/json-file.ts` 当前：

- 每次字段变化都 `JSON.stringify` 并同步覆盖整个文件；
- 没有临时文件、原子 rename、fsync、备份、文件锁或事务；
- 保存失败只记日志，调用方仍返回成功；
- 已存在文件解析失败时从空数据继续，五秒定时保存可能把损坏文件覆盖成空库；
- 定时器句柄未保存，`close()` 后仍可继续写并阻止事件循环退出；
- 多实例各持有旧快照，周期保存会相互覆盖。

### 4.3 短期修复：可靠的单写者 JSON

1. 将 JSON 后端明确限制为单进程、单写者：
   - 生命周期内持有同目录 lock；
   - 第二个实例对同一文件启动时明确失败；
   - 不通过“写前重读再 merge”伪造并发数据库语义。
2. 删除五秒周期保存；Repository 变更已经立即提交。
3. 引入共用的原子 JSON writer：
   - 在目标目录创建唯一临时文件；
   - 写入并同步临时文件；
   - 保留上一版备份；
   - 原子替换正式文件；
   - 在 Windows 和 Linux 上测试替换行为。
4. 已存在数据库解析失败时 fail closed：
   - 不启动空库；
   - 不覆盖原文件；
   - 输出文件路径及解析错误；
   - 只能通过显式恢复流程使用备份。
5. 保存失败向 Repository 调用方抛出，不允许 API/Worker报告已持久化成功。
6. 增加 `schemaVersion` 和一次性兼容迁移：
   - 顶层 `scans` → `sessions`；
   - Report `scanId` → `sessionId`。
7. 默认 JSON 路径和扩展名改为 `data/testharness.json`；启动时检查文件 magic，避免把历史 JSON `.db` 当作 SQLite。
8. Session 删除应同时删除关联 Report，并定义 Cognition 引用处理规则，使内存、JSON 和未来 SQL 后端语义一致。

### 4.4 中期修复：SQLite 唯一事实源

单节点目标下，推荐实现完整 SQLite Provider：

- 使用 WAL、foreign keys、busy timeout；
- 实现现有 Session、Report、Site、Cognition Repository；
- 加 migration/version 表；
- 多步状态更新放入 transaction；
- Site `base_url`、Cognition 稳定 ID 等使用唯一约束；
- 从 JSON、`.cognition`、`.site-profiles` 提供显式离线迁移命令；
- 迁移完成后停止运行时双写和目录扫描。

如果未来需要多个 API/Worker 实例，应直接设计 PostgreSQL 加持久队列；仅替换数据库但继续使用进程内队列，不能提供分布式任务可靠性。

### 4.5 大对象与敏感数据

当前 Session metadata 可保存完整 activity、累计 stream 快照、base64 screenshot；上传图片还可能同时存在 `scanConfig.images` 与 `metadata.uploadedImages`。

应调整为：

- metadata 只保存结构化索引和最终事件；
- stream 中间快照不长期保存，或只保存 delta/最终文本；
- screenshot/upload 放入独立对象存储或文件目录，数据库仅存引用；
- 定义 retention、大小上限和删除级联；
- 运行数据目录加入 `.gitignore`，已被 Git 跟踪的数据需单独审查并决定是否清理历史。

## 5. P0/P1：Cognition 与 SiteProfile

### 5.1 已证实问题

Cognition package 声明 ESM，但 8 个文件存储类在 `load()/save()` 内调用 `require("fs")`/`require("path")`，异常又被空 `catch` 吞掉。标准 Node ESM 下这会使读写静默失败。

同时存在四套相互重叠的数据源：

1. `.cognition/*.json`；
2. 主数据库 `cognition_*`；
3. `.site-profiles/*.json`；
4. 主数据库 `sites`。

API 和 Worker 各有一份文件到数据库同步代码，且映射规则不同。已确认的后果包括：

- Episode/Knowledge 创建时不保留原始 ID，下一次同步仍判定不存在，持续生成重复记录；
- Worker 读取全部 Cognition 文件后写到当前 Site，可能产生跨站污染；
- Procedure/Pattern 对 general scope 使用 `""` 查询，但存储值是 `null`，会重复导入；
- DB 删除或降低 confidence 不回写文件，后续同步会让数据复活或分叉；
- 文件模型字段比数据库丰富，导入发生有损压缩；
- 每个 Agent Session 新建 CognitiveEngine，并发 Session 对同一文件整写，修复 ESM 后反而会暴露 lost update。

### 5.2 推荐修复

1. **短期止血**：
   - 改用 ESM `node:fs`/`node:path` import；
   - 文件不存在可视为正常，解析/权限/ENOSPC 错误必须显式报告；
   - 复用原子 JSON writer；
   - 在统一存储前，文件后端运行时将 Cognition 写入串行化。
2. **停止重复污染**：
   - Cognition Repository 支持稳定外部 ID 或 upsert；
   - Worker 仅同步当前 `sessionId` 与规范化 `targetUrl` 所属数据；
   - API 与 Worker 的同步逻辑合并为一个迁移服务；
   - general scope 统一使用 `null`；
   - 迁移必须幂等并记录 schema/checkpoint。
3. **确定唯一事实源**：
   - 推荐数据库为唯一事实源；
   - `.cognition` 和 `.site-profiles` 只作为旧数据导入或导出格式；
   - 不长期维护双向同步。
4. Cognition 快速演进阶段，SQL 表建议采用“稳定索引字段 + versioned JSON payload”，避免当前简化 schema 丢失 provenance、Q value、recovery、usage、expiry 等信息。
5. SiteProfile 如果要兑现 auth/form/navigation/constraint 的跨 Session 学习，应将这些字段纳入统一数据库模型；否则应删除相关产品声明。

### 5.3 验收标准

- 新 CognitiveEngine 写入后，新实例可以读取。
- 文件损坏或写失败不会静默成功。
- 同一旧数据迁移两次不会增加记录。
- 站点 A 的认知数据不会进入站点 B。
- DB 中删除或修改的数据不会被旧文件自动复活。

## 6. P1：任务状态与资源生命周期

### 6.1 取消语义

#### 已证实问题

取消接口只把 Session 状态写成 `cancelled`，没有移除 Queue Job 或中止 Worker。Worker 启动后又无条件把状态改为 `planning/running`。运行中依赖两秒轮询数据库后 `abort()`，且 streaming abort 可能被映射为 `failed`。完成和失败路径也会盲写终态，覆盖刚发生的取消。

`cancelCheck` 只在正常返回或检测到 cancelled 时清除；AgentLoop 抛异常时 interval 会泄漏。Queue retry 也不区分取消异常。

#### 推荐状态规则

终态：`completed | failed | cancelled`。终态一旦提交不可被覆盖。

允许转换：

```text
pending  -> planning | cancelled
planning -> running  | cancelled | failed
running  -> completed | failed | cancelled
```

取消与完成竞争采用**原子先提交者获胜**：

- cancel 先完成：Worker 不得再写 completed/failed；
- complete 先完成：cancel 返回 409；
- 重复 cancel 幂等返回当前 cancelled 状态，不刷新首次 completedAt。

#### 推荐实现

1. Repository 新增条件状态转换，例如 `transitionStatus(id, from[], to)`，内存/JSON 中同步执行，SQLite 中使用条件 UPDATE。
2. 创建 Session 时保存 Queue Job ID；Queue 增加语义化 `cancel(jobId)`：
   - waiting/delayed Job 移除或进入 cancelled；
   - cancelled Job 不重试。
3. Worker 从处理开始就创建并注册 `AbortController`，维护 `sessionId → controller` 活动映射。
4. API cancel：先原子提交 Session cancelled，再取消排队 Job/abort 活动 Job。
5. Worker 开始前及进入 planning/running 前均做条件转换；已 cancelled 立即 no-op。
6. AgentLoop 检测 `signal.aborted`，将 LLM stream/tool abort 映射为 cancelled，不映射为 failed。
7. poll 仅作为数据库层容错，所有 interval、event listener、浏览器资源放入 `finally`。
8. 部分 findings/summary 是否保留：推荐保留已产生的结果，但标记 Session cancelled，报告明确“结果不完整”。

### 6.2 优雅关闭与信号

#### 已证实问题

`apps/server/th-server/src/index.ts` 和 `TestHarnessServer.start()` 各注册一套 SIGINT/SIGTERM handler。第一次 `stop()` 设置 `shuttingDown` 后，第二次调用立即返回并可能先执行 `process.exit()`，提前终止真正的关闭流程。

此外：

- package 的 `main` 与 `bin` 指向同一个有启动副作用的入口；
- Queue close 不等待 active processor；
- Server 日志称等待 active jobs，但实现没有 drain；
- JSON/Cancellation interval 会阻止自然退出。

#### 推荐实现

1. `TestHarnessServer` 只负责资源 `start()/stop()`，不注册进程信号、不调用 `process.exit()`。
2. 单独 CLI/bin 入口负责直接运行检测和唯一信号处理。
3. 使用共享 `shutdownPromise` 保证多个信号只执行一次。
4. Queue 实现 `drain()` 或 `close({ timeout, abortActive })`，明确等待与强制取消策略。
5. 关闭顺序：停止接收 HTTP/WS新工作 → 停止调度 → 等待/取消 active jobs → 关闭浏览器/MCP → 保存并关闭 DB → 清除 timer/listener。
6. 程序化 start/stop 后事件循环应自然结束。

## 7. P1：流式事件契约

### 7.1 已证实问题

Provider 发出 delta，`StreamAssembler` 将其累积；协议中的 `partialContent` 明确定义为“截至当前的累计文本”。Worker 原样广播为 `activity.partial`，Dashboard 却执行：

```ts
streamText + activity.partial
```

因此后端依次发送 `H`、`He`、`Hello` 时，UI 会显示 `HHeHello`。

同时：

- 前端没有按 `sessionId` 过滤活动；
- 切换 Session 时不清理旧 stream/activity；
- Worker 持久化每个累计快照，长输出可能产生近似 O(N²) 的 metadata；
- Provider EOF 未显式标记 done 时，最后不足 200ms 的文本可能没有广播。

### 7.2 推荐实现

保持现有累计 wire contract，避免破坏外部客户端：

1. Dashboard 直接赋值 `streamText = activity.partial`。
2. 使用 `sessionId + turn` 作为流边界；新 Session、新 Turn 时重置。
3. Store 只接受当前 Session 事件；WebSocket 服务端也按订阅过滤。
4. Agent stream 循环结束后保证发送一次最终累计内容和 `done=true`。
5. Worker 的持久活动只保存最终文本或 delta，不保存全部累计快照。
6. 增加 Store 单元测试覆盖多 Session、重连和切换页面。

## 8. P1/P2：Agent 规划与模型上下文

### 8.1 SessionLog `system/note` 丢失

代码注释和 README 声称所有 model-visible 内容可由 append-only SessionLog 重建，但当前 `deriveMessages()` 忽略 `system/note`。主循环会把以下指令写成 note：

- Cognition 历史；
- 工具连续失败后的换策略指令；
- verification recovery；
- coverage “继续测试”提示；
- workflow 状态转换提示。

如果 note 不进入下一轮消息，这些控制策略只留在审计日志里，不能影响模型行为。

#### 推荐实现

1. 为日志条目增加明确可见性语义，而不是让所有 note 自动暴露：
   - `system/context`：可派生为模型可见 system message；
   - `system/audit`：只用于审计；
   - 或在 note payload 增加 `modelVisible: boolean`。
2. `deriveMessages()` 按日志顺序合并相邻系统上下文，确保 replay 与在线执行一致。
3. 审核所有 `system/note` 调用点，逐个标明可见性，避免把内部错误、敏感数据或纯日志意外送给 LLM。
4. 添加 replay 测试：原 SessionLog 派生出的消息必须包含 recovery/coverage/workflow 指令，且不包含 audit-only note。

### 8.2 LLM Planner 占位

`packages/agent/th-agent/src/planner.ts` 中 `llmPlanner.generate()` 当前只返回一条带 `[LLM]` 前缀的通用步骤，并未调用 LLM。

推荐在安全和状态修复完成后实施：

1. 将 Planner 的 `generate` 改为异步接口或新增 `generateWithModel()`，由已存在的 LLM Provider 注入。
2. 复用 `buildLLMPlannerPrompt()`，要求结构化 JSON 输出并进行 schema 校验。
3. 模板 Planner 仍作为常见场景的确定性快速路径。
4. LLM 超时、解析失败时 fallback 到 generic template；这是系统边界错误，必须有日志与指标。
5. Planner 输出只描述计划，不直接执行工具；仍由 Coverage/Agent Loop 决定下一步。
6. 加入预算：最大 token、超时、一次重试和可观测事件。

## 9. P1：测试策略

当前根 Vitest 只收集 `packages/**/*.{test,spec}.ts`，并启用 `passWithNoTests`。Dashboard 和 Server 应用测试不会自动纳入，API、Persistence、Cognition、Browser/MCP、Report 也缺少关键集成测试。

### 9.1 第一批必须补齐的测试

#### API / 安全

- REST 认证、权限、CORS、OPTIONS；
- WS path、Origin、认证和 Session 订阅隔离；
- Settings 默认禁用、schema、注入字符、原子写失败；
- SSRF 公网/私网、IPv4/IPv6、DNS、redirect；
- Rate limit 阈值、reset、代理头处理。

#### Persistence / Cognition

- JSON round-trip、原子替换、备份恢复；
- malformed JSON 启动失败且不覆盖；
- write failure 向上传播；
- lock 与 close 生命周期；
- legacy `scans`/`scanId` 迁移；
- Cognition ESM 写后重载、损坏文件、并发和幂等迁移；
- Site 隔离与删除不复活。

#### Queue / Worker / Agent

- waiting/delayed/running cancel；
- cancel 与 complete 原子竞争；
- streaming abort 返回 cancelled；
- cancelled job 不 retry；
- 所有路径清理 interval/controller/listener；
- Queue close/drain；
- SessionLog model-visible 与 audit-only replay。

#### Dashboard

- 累计流 `H → He → Hello` 最终显示 `Hello`；
- 新 Turn、Session 切换和重连重置；
- 其他 Session 事件不污染当前页面；
- Settings 失败不显示成功，API Key 不持久化。

### 9.2 测试配置调整

- 根配置纳入 `apps/**/*.test.{ts,tsx}`；
- Dashboard 增加 jsdom 与 React 测试依赖；
- 移除关键 package 的 `passWithNoTests`；
- CI 增加 Windows job 验证原子文件替换与路径行为；
- MCP/真实浏览器测试分为可重复的本地集成测试与可选端到端 job；
- 不使用固定 sleep，使用 deferred promise/fake timer 控制竞态。

## 10. P2：文档和部署一致性

应在每个阶段同步修改：

- `README.md`、`README.zh.md`；
- `docs/API.md`；
- `.env.example`；
- `docker-compose.yml`；
- Package 注释和 migration script。

必须修正：

- `/api/v1/scans` → `/api/v1/sessions`；
- 测试数量冲突；
- 当前存储是 JSON/Memory，而非可用 SQLite/PG；
- 当前 Queue 是进程内实现，而非 BullMQ；
- 限流在接入前不能宣称完成；
- “production-ready” 改为明确部署前提；
- Docker 挂载应覆盖所有仍在使用的数据目录；
- `.db` JSON 文件改成 `.json` 或通过 magic 检测迁移。

建议新增简单的文档契约测试，从路由清单生成或校验 API 路径，减少再次漂移。

## 11. 分阶段实施计划

### Phase 0：冻结与基线

- 备份当前数据库、`.cognition` 和 `.site-profiles`；
- 清点已跟踪运行数据是否包含敏感页面、截图或指令；
- 建立当前 REST、WS、Session 状态和数据条数基线；
- 先为即将修改的缺陷写失败测试。

### Phase 1：安全止血

- HTTP/WS 管理员 Token；
- CORS allowlist 与 HOST 配置；
- Settings 默认禁用并移除浏览器 API Key 持久化；
- Outbound URL policy 接入 API、HTTP Tool、本地 Playwright 和 MCP allowlist；
- Rate limiter 真正接入请求和 WS upgrade。

### Phase 2：状态与生命周期

- Repository 条件状态转换；
- Queue Job ID 与 cancel；
- 活动 AbortController Registry；
- Agent abort 映射；
- 所有资源 `finally` 清理；
- 单一信号所有者与 Queue drain。

### Phase 3：可靠文件存储

- 单写者 lock；
- 原子 JSON writer、backup、fail-closed load；
- 删除周期 timer；
- schema version 与旧数据迁移；
- 大对象拆分和 retention。

### Phase 4：统一数据源

- 修复 Cognition ESM I/O，作为迁移前过渡；
- stable ID/upsert 和站点过滤；
- SQLite 完整 Provider；
- 离线迁移 JSON、Cognition、SiteProfile；
- DB 成为唯一事实源；
- 删除 API/Worker 运行时目录同步。

### Phase 5：Agent 正确性与能力

- 修复 SessionLog model-visible context；
- 修复累计流消费和存储；
- 实现真正的异步 LLM Planner；
- 补齐覆盖率、恢复与 replay 测试。

### Phase 6：发布验证与文档

- 全量 build、typecheck、unit/integration/e2e；
- 浏览器验证 Dashboard golden path 和边界情况；
- Linux/Windows 文件持久化验证；
- Docker 重建后数据与配置验证；
- 安全回归：未认证、SSRF、WS 隔离、限流；
- 更新能力声明和运维指南。

## 12. 关键架构决策记录

开始改代码前建议确认并固定以下决策；本文给出推荐默认值：

| 决策 | 推荐值 |
|---|---|
| 部署模型 | 近期单节点单进程；公开访问必须开启认证 |
| 认证 | 单管理员 Bearer Token；未来多用户时再引入身份/授权模型 |
| 匿名端点 | 仅 `/health`；`/status` 需认证 |
| Settings | 默认禁用；仅显式开启的管理员部署可写 |
| API Key 浏览器存储 | 禁止 |
| 私网目标 | 默认拒绝，通过 hostname/CIDR allowlist 显式开放 |
| WS 文本协议 | 保持累计快照语义 |
| 取消竞争 | 原子先提交者获胜；重复取消幂等 |
| 取消后的结果 | 保留已产生 findings，明确标记不完整 |
| 近期持久化 | 加固 JSON，仅承诺单写者 |
| 中期持久化 | SQLite |
| Cognition/SiteProfile 事实源 | 数据库 |
| 多实例未来方案 | PostgreSQL + durable queue，不长期扩展 JSON/内存 Queue |
| 保存失败 | 主业务数据失败则 Session/API 失败；非关键学习数据可标记 degraded，不得静默 |

## 13. Definition of Done

本轮“主要问题与风险”只有在以下条件全部满足后才可视为解决：

- 未认证客户端无法调用受保护 REST/WS 能力；
- Settings 默认不可写，Secret 不进入浏览器持久存储；
- 所有出站路径执行统一 URL 策略，应用和网络层共同阻止私网滥用；
- 限流真实接入并有测试；
- 取消不会被 planning/running/completed/failed 覆盖，且资源无泄漏；
- SIGINT/SIGTERM 只触发一次完整关闭；
- JSON 损坏不会被自动覆盖，写入具备原子替换和错误传播；
- Cognition 不再静默丢失、重复导入或跨站污染；
- 数据库是唯一事实源，旧文件迁移可验证、可重放且幂等；
- Dashboard 流式文本不重复、不跨 Session 串流；
- model-visible SessionLog 上下文可以正确 replay；
- API、Persistence、Cognition、Queue/Worker、Dashboard 都有关键回归测试；
- README、API 文档、Docker 和配置示例与运行时事实一致。
