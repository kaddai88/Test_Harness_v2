# P5 Phase 0 — Cancellation / Terminal-State Audit Report

**Date**: 2026-09-14
**Status**: READ-ONLY AUDIT COMPLETE — **APPROVED / CLOSED**
**Production-code changes**: NOT AUTHORIZED
**Phase 1 mandate**: `docs/P5-PHASE1-DESIGN-BRIEF.md` (AUTHORIZED for design)

---

## Executive Summary

Trace of the cancel chain confirmed **both predicted risks are real, reproducible, and located at specific line numbers**. In addition, 6 further risks were uncovered that were not on the original P5 list. The current architecture has no single authority for terminal state, no CAS, no abort-aware classification, and cancel bypasses the queue entirely.

**Chain under audit**:
```
Dashboard Cancel → POST /sessions/:id/cancel
  → API handler writes status='cancelled' + completed_at (DB authoritative write #1)
  → Worker 2s-poll detects → AbortController.abort()
  → AgentLoop observes signal
  → AgentLoop returns AgentResult
  → Worker maps result → updateStatus (DB write #2, blind overwrite)
  → updateCompletedAt (overwrites API's timestamp)
  → updateMetadata (overwrites any prior metadata)
  → broadcast session:completed {status}
```

---

## Answers to the 8 Key Questions

### Q1. 谁拥有 authoritative session terminal state？

**Answer: NO SINGLE OWNER — multiple writers, no coordination.**

| Writer | Location | Trigger |
|---|---|---|
| API HTTP handler | `packages/api/th-api/src/routes/sessions.ts:193` | User cancel click |
| Worker process() | `packages/worker/th-worker/src/processors/test-session.ts:344` | After `AgentLoop.run()` returns |
| Worker catch block | `test-session.ts:431` | Any throw in the try body |

The persistence layer (`packages/persistence/th-persistence/src/providers/in-memory.ts:74-77` and json-file equivalent) provides unconditional setters — no `WHERE status NOT IN (...)` guard, no CAS token, no optimistic concurrency.

---

### Q2. `cancelled` 什么时候成为不可逆终态？

**Answer: NEVER — currently `cancelled` is fully reversible.**

Sequence that overwrites `cancelled`:
1. T=0: API writes `status='cancelled'` + `completed_at=T0`.
2. T=0–2s: Worker is mid-`loop.run()`, hasn't polled yet.
3. T≈2s: Worker's poll sees `cancelled`, fires `abort()`.
4. T≈2s+ε: AgentLoop returns — but if the abort arrived during LLM streaming, the return is `{status: 'failed'}` (see Q5).
5. Worker maps `failed` → `updateStatus(sessionId, 'failed')` — **overwrites `cancelled`**.

Even on the happy path (AgentLoop returns `{status: 'cancelled'}`), the worker redundantly re-writes `cancelled` AND overwrites `completed_at` with a later timestamp, losing the user's actual cancel moment.

---

### Q3. `completed/failed/cancelled` 是否存在多个 writer？

**Answer: YES — 3 independent write sites, no coordination.**

- API handler: writes any of {`cancelled`}
- Worker happy-path (test-session.ts:344): writes any of {`completed`, `failed`, `cancelled`} based on `result.status`
- Worker catch (test-session.ts:431): writes `failed` unconditionally

No CAS, no read-before-write, no state machine.

---

### Q4. Worker cancel polling interval 是否所有路径都在 `finally` 清理？

**Answer: NO — leaks on throw path, absent during planning.**

- Interval started at `test-session.ts:289` (after `running` write).
- Cleared only on: happy path at `test-session.ts:320`, or cancel-detected inside the callback at `test-session.ts:295`.
- **Not cleared in `finally`** — if `loop.run()` throws, execution jumps to the catch at `test-session.ts:427`, interval keeps firing against a now-failing session.
- **No cancel detection exists during the planning phase** (interval hasn't been created yet) — user cancel during planning is written to DB but the worker cannot observe it until after it writes `running` and sets up the poll.

---

### Q5. AgentLoop 的 Abort 是否可能进入 generic `failed` catch？

**Answer: YES — this is the Abort→failed misclassification you predicted.**

The turn-level catch at `packages/agent/th-agent/src/loop.ts:508-529` has NO `err.name === "AbortError"` branch. Abort during a turn always returns `{status: "failed"}`.

Full misclassification table:

| Where abort fires | How it surfaces | Terminal status caller sees |
|---|---|---|
| Between turns (while condition) | `signal.aborted` branch at `loop.ts:540` | `"cancelled"` ✅ |
| Inside `llm.stream()` | thrown → `loop.ts:508` catch | `"failed"` ❌ |
| Inside `eventBus.emit/waterfall` | thrown → `loop.ts:508` catch | `"failed"` ❌ |
| Inside `sessionPersistenceStore.load` (startup) | thrown out of `run()` → worker catch | `"failed"` ❌ |
| Inside `registry.dispatch` (tool execution) | swallowed to `{success: false, error: "Tool execution cancelled"}` at `packages/tools/th-tools/src/registry.ts:182` | INCONSISTENT (see below) |
| After LLM returns `complete:true` but before return | not re-checked; `loop.ts:495` returns immediately | `"completed"` ❌ |

Tool execution path is worst: abort during a tool is swallowed as a normal tool failure, the per-tool `for` loop continues, and the eventual status depends on timing (cancelled / failed / completed).

---

### Q6. Queue job cancellation 与 session cancellation 是否一致？

**Answer: NO — cancel bypasses queue entirely.**

- Custom in-memory queue (`packages/queue/th-queue/src/in-memory-queue.ts`) has `JobStatus = "waiting" | "active" | "completed" | "failed" | "delayed"` — **no "cancelled" state**.
- API cancel handler never calls `queue.remove()` — no sessionId → jobId index exists to look up the job.
- `queue.remove()` only removes from the internal Map; it does NOT abort a running `process()` promise.
- After cancel, the job's status will still end up as `completed` in the queue (benign in-memory, broken in any future Redis/Postgres swap).

---

### Q7. Worker 重试/异常是否可能覆盖 terminal state？

**Answer: YES — multiple overwrite paths.**

- All terminal writes are blind overwrites (see Q3).
- **`timeout` is silently mapped to `completed`** at `test-session.ts:325-330`: the ternary has no `timeout` branch, so `maxTurns` exit looks like success in the DB.
- **Post-processing throw overwrites success with failed**: summary LLM, site-profile enrichment, cognition sync all run before the terminal `updateStatus` at line 344. If any throws, the catch at line 427 writes `failed` — even though `AgentLoop.run()` succeeded.
- Worker has no retry loop around `loop.run()`, but a single run can produce different terminal states based on where throws happen.

---

### Q8. P4 的 `stream.status=cancelled` 是否完全没有越界修改 session terminal state？

**Answer: YES — P4 层实际上完全隔离，没有越界。**

关键事实（第四路审计修正了 earlier 判断）：

1. **StreamEnvelope 的 `status='cancelled'` 在类型上存在但从未被生产者 emit**。`packages/agent/th-agent/src/loop.ts:899-902` 的 `emitStreamEnvelope` 调用只传入 `'completed'` 或 `'streaming'`。`grep emitStreamEnvelope.*cancelled` 全仓零命中。
2. **三套类型完全分离**：
   - `StreamGenerationStatus`（`events.ts:98`）：`'streaming' | 'completed' | 'errored' | 'cancelled'` — 仅用于 stream UI
   - `SessionStatus`（`apps/web/th-dashboard/src/types/index.ts:1`）：`'pending' | 'planning' | ... | 'completed' | 'failed' | 'cancelled'` — DB 持久状态
   - `AgentResult.status`（`packages/agent/th-agent/src/context.ts:60`）：`'completed' | 'failed' | 'cancelled' | 'timeout'` — loop 返回值
3. **没有代码从 `streamEnvelope.status` 读值写入 session status**。`streamReducer.ts:90` 只把 envelope status 存到 `StreamGenerationState.status`（UI 瞬态），不写 DB。
4. **FinalAssistantCommit 根本没有 status 字段**（`events.ts:117-127`），只有 finalSeq + content。`sessionStore.ts:215-217` 注释明确："P4 1D does not create session terminal status; it only makes final content available as the authoritative presentation for that generation."
5. **Session terminal status 的唯一数据源是 `AgentResult.status`**（`test-session.ts:325-330`），由 AgentLoop 显式分支（completed/failed/cancelled/timeout）返回，与 stream envelope 无关。

结论：P4 contract 的 "session/job terminal FSM → NOT owned by P4" 在实现上被严格遵守。P4 不是 P5 的问题；P5 必须从 AgentResult → session status 的翻译层开始接管。

---

## Additional Risks Uncovered (outside original P5 scope)

| # | Risk | Location | Impact |
|---|---|---|---|
| R1 | `completed_at` timestamp clobber | `test-session.ts:345` | API's cancel moment lost; DB shows worker's later write time |
| R2 | Double cancel overwrites `completed_at` | `sessions.ts:186` only blocks completed/failed | Second cancel re-stamps completion |
| R3 | `timeout` mapped to `completed` | `test-session.ts:325-330` | `maxTurns` exit looks like success |
| R4 | Post-processing throw overwrites success | `test-session.ts:427` catch | Summary/site-profile/cognition errors mis-classify successful loop as failed |
| R5 | No cancel detection during `planning` | `test-session.ts:289` (interval starts too late) | User cancel during container build is invisible to worker |
| R6 | Queue job status is `completed` after cancel | `in-memory-queue.ts:152-188` | Broken accounting; would break any Redis/Postgres queue swap |

---

## Invariants P5 Must Establish

```
planning/running
      ├→ completed
      ├→ failed
      └→ cancelled   ← IRREVERSIBLE once authoritative
```

1. **Single authority**: exactly one writer path per terminal transition, OR all writers go through a CAS primitive with `expectedPrevious` semantics.
2. **`cancelled` irreversibility**: once `cancelled` is written, no path may transition to `completed` or `failed`.
3. **Abort classification**: AbortError must be distinguishable from generic error at every catch boundary that produces a terminal status.
4. **Cancel detection coverage**: cancel must be observable from the moment a session is accepted, including the planning phase.
5. **Cancel signal must flow through queue** OR queue must be explicitly documented as not participating in cancel semantics.
6. **`completed_at` must be write-once** for terminal transitions, or updated only by the authoritative writer.
7. **Post-processing errors must not change terminal status** — the terminal status must be written before summary/enrichment steps.
8. **Stream abort → session terminal state**: the translation must be atomic with the API's cancel write, or the API must be the sole writer.

---

## Recommended P5 Phase Plan (not yet authorized)

| Phase | Scope | Blocks implementation? |
|---|---|---|
| **Phase 1 — Design** | Write a Terminal State Contract document: single-authority model, CAS primitive signature, invariants, abort classification rules. **No code changes.** | N/A |
| **Phase 2 — CAS primitive** | Add `expectedPrevious` / `WHERE status = ?` to `updateStatus` in persistence interfaces and all providers. | Yes |
| **Phase 3 — Abort classification** | Add AbortError branch at `loop.ts:508`. Re-check signal after `executeTurn` returns `{complete: true}`. | Yes |
| **Phase 4 — Single authority** | Decide: API is sole terminal writer, OR worker is sole terminal writer with CAS. Implement. | Yes |
| **Phase 5 — Cleanup** | `clearInterval` in finally. Move terminal write before post-processing. Fix `timeout` mapping. Cancel detection during planning. | Yes |
| **Phase 6 — Queue semantics** | Either add `cancelled` job state + cancel propagation, or document queue as orthogonal to cancel. | Deferred if in-memory-only |

---

## Files to Modify (when authorized)

- `packages/persistence/th-persistence/src/repositories/interfaces.ts` — add CAS argument to `updateStatus`
- `packages/persistence/th-persistence/src/providers/{in-memory,json-file}.ts` — implement CAS
- `packages/api/th-api/src/routes/sessions.ts` — single-authority decision
- `packages/worker/th-worker/src/processors/test-session.ts` — CAS writes, finally cleanup, terminal write ordering, timeout mapping
- `packages/agent/th-agent/src/loop.ts` — AbortError branch at turn catch, post-complete abort re-check
- `packages/tools/th-tools/src/registry.ts` — rethrow AbortError or expose `cancelled: true` flag

---

## Current State

```
P4 — APPROVED / CLOSED

Current active milestone:
P5 Phase 0 — Cancellation / Terminal-State Audit
Status: COMPLETE (read-only)

Production-code changes:
NOT YET AUTHORIZED

Next gate:
P5 Phase 1 — Terminal State Contract design document
```
