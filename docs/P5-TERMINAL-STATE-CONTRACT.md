# P5 Phase 1 — Terminal State Contract

**Status**: APPROVED / CLOSED
**Formal verdict**: APPROVED
**Date**: 2026-09-14
**Revision**: R7 (terminalization control-flow closure, explicit quiescence precondition, CAS-only lifecycle writes, and consistency synchronization)
**Next milestone**: P5 Phase 2 — Implementation Planning (AUTHORIZED)

**Production implementation remains NOT AUTHORIZED.**

## Revision History

### R0 (2026-09-14) — Initial proposal
First 13-section draft submitted for review.

### R1 (2026-09-14) — Correctness review response
**Verdict on R0**: `CHANGES REQUIRED` (7 correctness blockers). All 7 addressed.

### R2 (2026-09-14) — Correctness follow-up
**Verdict on R1**: `CHANGES REQUIRED` (4 new correctness blockers + 4 consistency). All 8 addressed.

### R3 (2026-09-14) — Final narrow corrections
**Verdict on R2**: `CHANGES REQUIRED` (4 narrow correctness blockers + 3 consistency). All 7 addressed.

### R4 (2026-09-14) — Last race closure + contract hygiene
**Verdict on R3**: `CHANGES REQUIRED` (1 runtime race + 1 type-ownership + 2 consistency)

| ID | Issue | Section(s) touched | Invariants affected |
|----|-------|-------------------|---------------------|
| R4-1 | Terminal CAS rejected with currentState=cancelling at worker quiescence boundary → worker must terminalize cancelling→cancelled (third instance of R3-1 pattern) | §3.3, §10.3, §10.5 | F1, F9 |
| R4-2 | `SessionStatusReason` type ownership not closed — AgentResult.reason needs it but can't depend on th-persistence | §4.1.2, §5.2, §12.4 | — (type hygiene) |
| R4-3 | §6.2 lifecycle diagram still shows old order (PP before terminal CAS) | §6.2 | F11 |
| R4-4 | §4.3 has `queued → cancelled` (forbidden by §2.3 transition table) + `queue_removed` reason with no Phase-2 valid edge | §4.3 | — (edge hygiene) |

Additional R4 wording fix:
- §7.5 "barring process crash" widened to include infrastructure/DB failures (matches §3.5 deferral)

### R5 (2026-09-14) — Terminalization control-flow closure
**Verdict on R4**: `CHANGES REQUIRED` (document consistency + terminalization control flow)

| ID | Issue | Section(s) touched | Invariants affected |
|----|-------|-------------------|---------------------|
| R5-1 | Terminal CAS rejection still had incomplete cancellation convergence and §9.4 did not gate PP on CAS result | §3.3, §9.4, §10.3, §10.5 | F1, F9, F11 |
| R5-2 | Cancel intent was still described as sufficient for `user_cancel_quiesced`; actual execution-stop precondition was not explicit | §3.3, §4.4.1, §4.4.4, §5.5 | F4, F9 |
| R5-3 | Legacy non-terminal `updateStatus` remained an allowed lifecycle-write bypass | §4.5, §12 | F1, F2, F6 |
| R5-4 | Status/reason matrix, lifecycle diagram, and terminal examples were not fully synchronized | §4.3, §4.6, §6.2, §9.4 | F1, F6, F11 |

### R6 (2026-09-14) — Final execution-boundary closure
**Verdict on R5**: `CHANGES REQUIRED` (1 runtime race + 1 consistency + 2 contract-hygiene items)

| ID | Issue | Section(s) touched | Invariants affected |
|----|-------|-------------------|---------------------|
| R6-1 | Terminal CAS loss to `cancelling` must converge only after real quiescence proof; the proof and follow-up CAS must be one normative flow | §3.3, §4.4.1, §10.3, §10.5 | F1, F9 |
| R6-2 | `SessionStatusReason` must have one unambiguous shared owner and `AgentResult.reason` must use that type without persistence dependency | §5.2, §5.10, §12.4 | F4, F5 |
| R6-3 | Legacy lifecycle `updateStatus` must not remain an independent bypass, even for active states | §4.5, §12.1–§12.3 | F1, F2, F6 |
| R6-4 | Normative terminalization flow, API/queue edges, and PP permission language must be synchronized | §4.3, §4.6, §6.2, §9.4, §10.3, §10.5 | F6, F10, F11 |

R6 does not reopen the state-machine shape, queue role, P4 boundary, or post-processing architecture.

### R7 (2026-09-14) — Final control-flow and contract consistency closure
**Verdict on R6**: `CHANGES REQUIRED` (1 runtime race + 1 type/ownership clarification + 2 consistency fixes)

| ID | Issue | Section(s) touched | Invariants affected |
|----|-------|-------------------|---------------------|
| R7-1 | Terminal CAS loss to `cancelling` must converge only after explicit execution-stop proof, and follow-up CAS must be part of the normative flow | §3.3, §4.4.1, §4.4.4, §10.3, §10.5 | F1, F9 |
| R7-2 | `SessionStatusReason` shared ownership and `AgentResult.reason` dependency route must be explicit | §4.1.2, §5.2, §5.10, §12.4 | F4, F5 |
| R7-3 | All lifecycle writes, including active-state writes, must use the transition primitive; legacy `updateStatus` cannot remain an independent setter | §4.5, §12 | F1, F2, F6 |
| R7-4 | Lifecycle diagram, valid edge table, terminal examples, and PP gating must describe one identical flow | §4.3, §4.6, §6.2, §9.4, §10.3, §10.5 | F6, F10, F11 |

R7 preserves the approved architecture and is limited to closing the above control-flow and consistency issues.

---

## Table of Contents

1. [Scope / Current Failures](#1-scope--current-failures)
2. [Session State Machine](#2-session-state-machine)
3. [Cancellation Intent vs Terminal Cancellation](#3-cancellation-intent-vs-terminal-cancellation)
4. [Single-Authority CAS Transition Primitive](#4-single-authority-cas-transition-primitive)
5. [Abort Reason Taxonomy](#5-abort-reason-taxonomy)
6. [Worker Cancellation-Observation Lifecycle](#6-worker-cancellation-observation-lifecycle)
7. [Queue / Session Cancellation Relationship](#7-queue--session-cancellation-relationship)
8. [Terminal Timestamp Ownership](#8-terminal-timestamp-ownership)
9. [Core Execution vs Post-Processing Outcome](#9-core-execution-vs-post-processing-outcome)
10. [Retry / Idempotency Semantics](#10-retry--idempotency-semantics)
11. [Invariant Matrix (F1–F12)](#11-invariant-matrix-f1f12)
12. [Current Implementation Mapping](#12-current-implementation-mapping)
13. [Approval Gates](#13-approval-gates)

---

## 1. Scope / Current Failures

### 1.1 Problem Statement

The current system conflates three distinct concepts that must be separated:

| Concept | Meaning | Example |
|---------|---------|---------|
| **Control intent** | User/system requested a change | Cancel button clicked |
| **Execution quiescence** | Worker actually stopped producing side effects | AbortController fired, loop exited |
| **Persisted terminal state** | Durable record of how the session ended | `status = cancelled` in DB |

Today these are treated as the same moment. The API handler for cancel writes `status = 'cancelled'` and `completed_at = now()` before the worker has observed anything. The DB therefore claims "session is cancelled" while execution continues for up to 2 seconds (or longer if the worker is in a long tool call).

### 1.2 Failures identified in Phase 0 audit

Two predicted risks confirmed:

| ID | Failure | Location |
|----|---------|----------|
| P1 | Abort → `failed` misclassification | `packages/agent/th-agent/src/loop.ts:508-529` — turn-level catch has no AbortError branch; mid-turn abort returns `{status: 'failed'}` |
| P2 | Cancel / terminal race — `cancelled` overwritten by `completed`/`failed` | `packages/worker/th-worker/src/processors/test-session.ts:344` — blind `updateStatus` with no CAS |

Six additional risks uncovered:

| ID | Failure | Impact |
|----|---------|--------|
| R1 | `completed_at` clobber | API's cancel moment lost; DB shows worker's later write time |
| R2 | Double cancel overwrites `completed_at` | Second cancel re-stamps completion |
| R3 | `timeout` mapped to `completed` | `maxTurns` exit looks like success |
| R4 | Post-processing throw overwrites success | Summary/site-profile/cognition errors mis-classify successful loop as failed |
| R5 | No cancel detection during `planning` | User cancel during container build is invisible to worker |
| R6 | Queue job status is `completed` after cancel | Broken accounting; would break any Redis/Postgres queue swap |

### 1.3 Non-failures (boundaries to preserve)

- **P4 streaming contract is NOT part of this phase.** Phase 0 Q8 confirmed: `StreamEnvelope.status` never writes through to session terminal state. F12 invariant below explicitly protects this boundary.
- **Workflow FSM** (`packages/agent/th-agent/src/workflow.ts` — NAVIGATE/LOGIN/TEST/REPORT) operates at a different level (turn-level agent workflow) and is out of scope. P5's CAS primitive is for **session terminal state**, not workflow state.

### 1.4 Out of scope

- P6 Persistence Ownership (Cognition/SiteProfile dual-write)
- P7 Authentication
- P8 SSRF
- P9 Atomic JSON persistence
- P10 Cross-layer integration
- LLM Planner
- Replacing the in-memory queue with Redis/Postgres

---

## 2. Session State Machine

### 2.1 Canonical State Set

```
queued        ← job accepted, not yet picked up by worker
planning      ← worker building container, tool registry, site profile
running       ← AgentLoop actively executing turns
cancelling    ← cancel intent durable; worker has not yet quiesced

completed     ← terminal: loop finished successfully
failed        ← terminal: loop or startup failed (includes timeout)
cancelled     ← terminal: worker quiesced in response to cancel intent
```

**Seven states. Three terminal. Four active.**

### 2.2 State Classification

| Category | States |
|----------|--------|
| Active | `queued`, `planning`, `running`, `cancelling` |
| Terminal | `completed`, `failed`, `cancelled` |
| Cancel-intent | `cancelling` (active but signals intent) |

### 2.3 Transition Rules

```
              ┌──────────────────────────────────────────┐
              │                                          │
              ▼                                          │
         ┌─────────┐                                    │
    ┌───►│ queued  │                                    │
    │    └─────────┘                                    │
    │         │                                         │
    │         ▼                                         │
    │    ┌─────────┐                                    │
    │    │planning │                                    │
    │    └─────────┘                                    │
    │         │                                         │
    │         ▼                                         │
    │    ┌─────────┐                                    │
    │    │ running │──────┐                             │
    │    └─────────┘      │                             │
    │         ▲           │                             │
    │         │           ▼                             │
    │    ┌──────────┐  ┌────────────┐                   │
    │    │cancelling│◄─┤ cancel req │                   │
    │    └──────────┘  └────────────┘                   │
    │         │           │                             │
    │         │           │ from any active state       │
    │         │           │                             │
    │         ▼           ▼                             │
    │    ┌──────────────────────────┐                   │
    │    │  terminal states         │                   │
    │    │  completed | failed |    │───── no exit ─────┘
    │    │  cancelled               │
    │    └──────────────────────────┘
    │
    └── only from non-terminal (re-queue on worker crash, future work)
```

**Transition table** (rows = from-state, columns = to-state):

| from \ to         | queued | planning | running | cancelling | completed | failed | cancelled |
|-------------------|:------:|:--------:|:-------:|:----------:|:---------:|:------:|:---------:|
| **queued**        |   –    |    ✓     |    –    |     ✓      |     –     |   –    |     –     |
| **planning**      |   –    |    –     |    ✓    |     ✓      |     –     |   ✓    |     –     |
| **running**       |   –    |    –     |    –    |     ✓      |     ✓     |   ✓    |     –     |
| **cancelling**    |   –    |    –     |    –    |     –      |     –     |   ✓    |     ✓     |
| **completed**     |   –    |    –     |    –    |     –      |     –     |   –    |     –     |
| **failed**        |   –    |    –     |    –    |     –      |     –     |   –    |     –     |
| **cancelled**     |   –    |    –     |    –    |     –      |     –     |   –    |     –     |

### 2.4 Irreversibility Rule

> **Once a session enters a terminal state, no transition out of it is permitted. The terminal transition is atomic with any timestamp write and any reason write.**

Enforcement mechanism: the CAS primitive in Section 4.

### 2.5 Status Aliases (legacy reconciliation)

Current `SessionStatus` in `apps/web/th-dashboard/src/types/index.ts:1` includes `'pending'` and `'executing'`. These are not in the canonical set.

**Decision**:
- `pending` is an alias for `queued` — to be unified in Phase 2
- `executing` is an alias for `running` — to be unified in Phase 2
- Phase 2 must either rename all occurrences or explicitly document them as deprecated aliases. This contract uses the canonical names.

### 2.6 Non-Canonical States Rejected

- **`timed_out`** as a separate terminal state: **REJECTED**. Timeout is a *reason* for failure, not a distinct outcome category. See Section 9.
- **`paused` / `suspended`**: out of scope; would be a separate milestone.
- **`retrying`**: out of scope; see Section 10.

---

## 3. Cancellation Intent vs Terminal Cancellation

### 3.1 Three-Phase Model

Cancellation is not atomic. It proceeds through three observable phases:

```
  ┌────────────────────────────────────────────────────────────────────┐
  │ Phase A: REQUEST                                                   │
  │   User clicks Cancel / API receives cancel request                 │
  │   → DB: session.status = 'cancelling'                              │
  │   → DB: session.cancelRequestedAt = now()                          │
  │   → API response: { accepted: true }  (not { cancelled: true })    │
  │                                                                    │
  │ Phase B: ACKNOWLEDGEMENT / QUIESCENCE                              │
  │   Worker's cancellation-observer detects intent                    │
  │   → Worker fires AbortController                                   │
  │   → AgentLoop observes signal, begins unwind                       │
  │   → Tool execution / LLM streaming abort in progress               │
  │   Session status remains 'cancelling' during this phase            │
  │                                                                    │
  │ Phase C: TERMINALIZATION                                           │
  │   AgentLoop returns with status reflecting cancel                  │
  │   Worker writes terminal state via CAS primitive                   │
  │   → DB: session.status = 'cancelled'                               │
  │   → DB: session.terminalAt = now()                                 │
  │   → DB: session.statusReason = 'user_cancel_quiesced'              │
  │   → DB: session.postProcessingStatus = 'not_applicable'            │
  │     (cancelled implies quiescence — no normal post-processing;     │
  │      see §9.3)                                                     │
  └────────────────────────────────────────────────────────────────────┘
```

### 3.2 API Behavior on Cancel Accept

**Current behavior** (broken):
```ts
await repos.sessions.updateStatus(id, 'cancelled');        // premature terminal
await repos.sessions.updateCompletedAt(id);                // wrong timestamp
```

**New behavior** — atomic transition with typed side-effects, disambiguated response:

```ts
const result = await repos.sessions.transitionStatus(id, {
  expected: ['queued', 'planning', 'running'],
  target: 'cancelling',
  reason: 'user_cancel_requested',
  sideEffects: {
    cancelRequestedAt: now(),
    // NOTE: statusReason is written automatically by the primitive from `reason`.
  },
});

if (result.applied) {
  return sendJson(res, 202, { accepted: true });
}

// Transition rejected — session is in some other state.
// Disambiguate for the client rather than lying with a uniform "accepted".
switch (result.currentState) {
  case 'cancelling':
    // Already in flight. Idempotent; original cancelRequestedAt preserved (F8).
    return sendJson(res, 202, { accepted: true, alreadyCancelling: true });
  case 'cancelled':
    // Terminal-cancelled. Cancel cannot apply; truthfully report.
    return sendJson(res, 202, { accepted: true, alreadyCancelled: true });
  case 'completed':
  case 'failed':
    // Terminal non-cancelled. Cancel cannot apply; truthfully report `accepted: false`.
    return sendJson(res, 202, {
      accepted: false,
      alreadyTerminal: true,
      terminalStatus: result.currentState,
    });
  default:
    // Unknown / unrecognized state. Fail closed — do NOT pretend cancel accepted.
    logger.error(`Cancel request for session ${id} in unrecognized state: ${result.currentState}`);
    return sendJson(res, 500, { error: 'unknown_session_state' });
}
```

All `202` responses carry `accepted` as a truthful boolean:

| Current session state | Response | Meaning |
|----------------------|----------|---------|
| `queued` / `planning` / `running` (transition applied) | `202 {accepted: true}` | Cancel newly accepted; session is now `cancelling` |
| `cancelling` (transition rejected) | `202 {accepted: true, alreadyCancelling: true}` | Cancel already in flight; idempotent, original `cancelRequestedAt` preserved (F8) |
| `cancelled` (transition rejected) | `202 {accepted: true, alreadyCancelled: true}` | Session already terminal-cancelled; no action needed |
| `completed` / `failed` (transition rejected) | `202 {accepted: false, alreadyTerminal: true, terminalStatus: '...'}` | Session already terminal-non-cancelled; cancel cannot apply. `accepted: false` is truthful — cancel did NOT take effect |
| unknown / unrecognized state | `500 {error: 'unknown_session_state'}` | **Fail closed.** Do not pretend cancel was accepted when the session's state is not in the canonical set. Investigate the unexpected state before claiming success |

The key contract: **`accepted: true` is asserted only when the cancel intent is now durably recorded** (either by this request or a prior one). For `completed`/`failed`, the cancel request cannot apply — the API truthfully reports `accepted: false`. For unknown states, the API fails closed rather than lying.

### 3.3 Worker Behavior on Quiescence

The worker is the **sole writer of terminal `cancelled` state** (subject to §4.4 cancellation-precedence policy and §7.4 dequeue-time short-circuit). Terminalization is permitted only at an explicit **worker quiescence boundary**: the worker has completed or abandoned `AgentLoop.run()`, starts no new business tools, LLM calls, or enrichment, and all worker-managed operations have reached their specified stop/unwind boundary. This proves that this worker cannot produce further normal execution side effects; it does not undo effects already committed externally.

A durable cancel intent (`status = cancelling`) alone is **not** quiescence proof. `classifyAbortOutcome('user_cancel')` is only a reason-to-outcome mapping; its `cancelled` result may be used for terminalization only after the execution-stop precondition above is satisfied.

After that boundary, the terminal write is a SINGLE atomic transition carrying status, reason, terminal timestamp, and initial post-processing status:

```ts
const terminalStatus = mapAgentResultToTerminalStatus(result);
const reason = mapAgentResultToReason(result);     // SessionStatusReason
const now = new Date().toISOString();

// Initial postProcessingStatus per terminal status (see §9.3):
//   cancelled   → 'not_applicable'  (no post-processing — quiescence is final)
//   completed   → 'pending'         (post-processing will run)
//   failed      → per §9.3 policy   ('pending' or 'not_applicable')
const initialPostProcessingStatus =
  terminalStatus === 'cancelled' ? 'not_applicable' :
  terminalStatus === 'completed' ? 'pending' :
  /* failed */                    mapFailedToPostProcessingStatus(result);

const terminalResult = await repos.sessions.transitionStatus(sessionId, {
  expected: ['running', 'cancelling'],
  target: terminalStatus,
  reason,
  sideEffects: {
    terminalAt: now,
    postProcessingStatus: initialPostProcessingStatus,
    // NOTE: statusReason is written automatically by the primitive from `reason`.
    // NOTE: completedAt is mirrored automatically by the primitive from `terminalAt`.
  },
});

if (!terminalResult.applied && terminalResult.currentState === 'cancelling') {
  // The execution-stop boundary was already confirmed above. Complete the
  // cancellation terminalization rather than leaving `cancelling` stuck.
  const cancelResult = await repos.sessions.transitionStatus(sessionId, {
    expected: ['cancelling'],
    target: 'cancelled',
    reason: 'user_cancel_quiesced',
    sideEffects: {
      terminalAt: new Date().toISOString(),
      postProcessingStatus: 'not_applicable',
    },
  });
  if (!cancelResult.applied) {
    // Another path already terminalized; current state remains authoritative.
    return;
  }
}

// Normal post-processing is authorized ONLY when this worker's original
// terminal CAS applied and the committed initial state was 'pending'.
if (terminalResult.applied && initialPostProcessingStatus === 'pending') {
  await runPostProcessingAfterTerminalCommit(sessionId, result, terminalStatus);
}
```

**Edge constraint**: a `cancelled` target is valid only when the current state is `cancelling` (or the queued-cancel short-circuit, which first persists `cancelling`). A worker that receives `AgentResult.status = 'cancelled'` while the session still reads `running` MUST NOT invent a `running → cancelled` transition; it must reconcile the durable cancel intent and then use the `cancelling → cancelled` path. The primitive rejects any target/reason/edge combination not listed in §4.3.

The CAS primitive applies `status`, `statusReason` (derived from `reason`, see §4.1), `terminalAt`, `completedAt` (auto-mirrored), and `postProcessingStatus` in a single repository-level atomic operation (see §4.1, §4.2). There is no crash window where `status` is terminal but `terminalAt` / `postProcessingStatus` are stale.

**Critical invariant**: when `target === 'cancelled'`, `postProcessingStatus` is atomically set to `'not_applicable'`. **No post-processing runs after a cancelled terminalization.** This is not optional — it follows from the definition of `cancelled` as "worker has quiesced and stopped producing side effects" (§3.1). See §9.3 for the full rule.

### 3.4 Why `cancelling` is a First-Class Status

1. **UI visibility**: the dashboard can show "Cancelling…" instead of silently lying with "Running" or prematurely claiming "Cancelled".
2. **Deterministic API response**: the API never claims a terminal state it cannot guarantee.
3. **Race immunity**: the worker cannot "overwrite" `cancelling` with `completed` because the CAS primitive forbids `cancelling → completed`. Only `cancelling → cancelled` or `cancelling → failed` are allowed.
4. **Observability**: the duration between `cancelRequestedAt` and `terminalAt` is a measurable quiescence latency — useful for debugging.

### 3.5 What Happens If Worker Never Quiesces

A bug in the worker or AgentLoop could leave a session in `cancelling` forever. This is a liveness concern, not a safety concern — safety (no invalid terminal state) is preserved by the CAS primitive.

Possible mitigations (conceptually):
- Worker startup checks for any sessions in `cancelling` assigned to it and re-quiesces them.
- Watchdog: if `cancelRequestedAt + threshold < now()` and status is still `cancelling`, mark as `failed` with reason `cancellation_quiescence_failure`.

**Status: EXPLICITLY DEFERRED.** P5 Phase 2 scope is safety — it establishes the CAS primitive, the state machine, and the cancel semantics. Crash recovery / liveness watchdogs are a separate milestone (likely P9 or a dedicated recovery milestone). Phase 2 does NOT implement either mitigation above. If a session gets stuck in `cancelling` after Phase 2, the resolution is operational (manual DB fix or future recovery tool), not automatic.

---

## 4. Single-Authority CAS Transition Primitive

### 4.1 Interface Signature

Add to `packages/persistence/th-persistence/src/repositories/interfaces.ts`:

```ts
/**
 * Typed side-effects that travel with a status transition.
 *
 * Callers pass ONLY the fields the primitive cannot derive. The primitive
 * validates that required side-effects are present per transition edge
 * (§4.2 invariant 7) and rejects the transition otherwise.
 *
 * `completedAtCompat` is NOT in this struct. When the caller passes
 * `terminalAt`, the primitive automatically mirrors it to `completedAt`
 * (during the backward-compat window). This eliminates any possibility of
 * the two timestamps disagreeing.
 *
 * `statusReason` is NOT in this struct. It is written automatically by the
 * primitive from `TransitionStatusOptions.reason` (§4.1.1).
 *
 * Callers MUST NOT use this as a generic key-value dump.
 */
export interface TransitionSideEffects {
  /** When the session entered a terminal state. REQUIRED on terminal transitions. */
  terminalAt?: string;

  /** When cancel was requested. REQUIRED on the cancelling transition. */
  cancelRequestedAt?: string;

  /**
   * Initial post-processing lifecycle state. REQUIRED on terminal transitions.
   * Value is constrained by target status:
   *   cancelled → 'not_applicable'
   *   completed → 'pending'
   *   failed    → 'pending' | 'not_applicable'
   */
  postProcessingStatus?: PostProcessingStatus;
}

export interface TransitionStatusOptions {
  expected: SessionStatus[];                 // current state must be one of these
  target: SessionStatus;                     // new state to set
  reason: SessionStatusReason;               // REQUIRED — machine-readable reason code
  sideEffects?: TransitionSideEffects;       // atomic side-effects tied to this transition
}

export interface TransitionStatusResult {
  applied: boolean;
  currentState: SessionStatus;               // actual state at time of check
  previousState?: SessionStatus;             // state before transition (set iff applied)
}

export interface SessionRepository {
  // ... existing methods ...

  transitionStatus(
    sessionId: string,
    options: TransitionStatusOptions
  ): Promise<TransitionStatusResult>;
}
```

#### 4.1.1 Single source of truth for the persisted reason

The CAS primitive writes `session.statusReason = options.reason` atomically with every successful transition. There is no `statusReason` field in `TransitionSideEffects`. This eliminates the R2-5 inconsistency where `reason` and `sideEffects.statusReason` could disagree:

```
options.reason            →  primitive writes  →  session.statusReason
(single input)                                        (single persisted field)
```

Callers supply ONE reason. The primitive persists it. There is no second writer and no aliasing.

#### 4.1.2 `SessionStatusReason` type

`SessionStatusReason` is the durable reason-code enum. Its canonical values are defined in §4.3. It is imported by both the persistence layer (which writes it) and the API/worker layers (which supply it).

#### 4.1.3 `completedAt` auto-mirror

During the backward-compat window, when a caller passes `sideEffects.terminalAt`, the **persistence transition primitive itself** automatically writes `completedAt = terminalAt` in the same atomic operation. Callers do NOT pass `completedAt` separately — there is no input that could disagree with `terminalAt`.

This is a normative ownership rule, not an implementation choice: `completedAt` mirroring belongs inside `transitionStatus`, not in a wrapper or caller. P9 may later improve the physical durability of that same repository operation, but may not split the two facts into separate writes.

**Design rationale for typed side-effects over `metadata: Record<string, unknown>`**:
A generic metadata map would let callers smuggle arbitrary fields through the CAS primitive, re-conflating ownership and defeating the whole point of §8's timestamp ownership rules. The typed `TransitionSideEffects` struct forces each caller to declare exactly which canonical fields it is writing, and the primitive can validate required fields per transition edge (see §4.2 invariant 7).

### 4.2 Invariants Enforced by the Primitive

The primitive itself (not just callers) must enforce:

1. **Terminal irreversibility**: if `currentState ∈ {completed, failed, cancelled}`, any transition is rejected regardless of `expected` list.
2. **`expected` match**: if `currentState ∉ options.expected`, rejected with `{applied: false, currentState}`.
3. **Atomicity**: the read-of-current + write-of-new + application of `sideEffects` + write-of-`statusReason` must be atomic with respect to concurrent calls. Concretely:
   - **In-memory provider**: single-threaded JS guarantees this if no `await` between read and write.
   - **JSON-file provider**: mutex around the read → mutate → write sequence.
   - **Future Postgres provider**: `UPDATE ... WHERE status = ANY($expected)` in a single statement; side-effects applied in the same UPDATE.
4. **Forbidden transitions** (encoded as a transition-table check): see Section 2.3.
5. **Forbidden side-effects**: the primitive rejects any side-effect field that is not legitimate for the requested transition. E.g., `cancelRequestedAt` is forbidden unless `target === 'cancelling'`; `terminalAt` is forbidden unless `target ∈ {completed, failed, cancelled}`.
6. **Reason is required and authoritative**: every successful status transition MUST have `options.reason` (typed as `SessionStatusReason`, validated per transition edge per §4.3). The primitive writes `session.statusReason = options.reason` atomically. Callers MUST NOT bypass this by any other means.
7. **Required side-effects per transition edge (R3-3)**: the primitive rejects the transition if required side-effects are missing. The required-set depends on the exact transition edge (the primitive validates the edge before applying the write):

| Transition edge | Required `sideEffects` |
|-----------------|------------------------|
| `queued/planning/running → cancelling` | `cancelRequestedAt` |
| `running → completed` | `terminalAt`, `postProcessingStatus = 'pending'` |
| `running → failed` | `terminalAt`, `postProcessingStatus ∈ {pending, not_applicable}` |
| `planning → failed` | `terminalAt`, `postProcessingStatus ∈ {pending, not_applicable}` |
| `cancelling → cancelled` | `terminalAt`, `postProcessingStatus = 'not_applicable'` |
| `queued → planning` | (none required) |
| `planning → running` | (none required) |

The primitive MUST reject a terminal transition that is missing `terminalAt` or `postProcessingStatus`. There is no "lenient" mode that leaves timestamps null. This is the R3-3 fix.

8. **Reason validation is per-transition-edge (R3-4)**: the primitive validates `options.reason` against the `(currentState, target, reason)` triple, not just against `target`. The canonical edge → reason mapping is defined in §4.3. E.g., `queued → planning` requires `reason = 'lifecycle_start'`; `queued → cancelling` requires `reason = 'user_cancel_requested'`. The primitive rejects `running → cancelling` with `reason = 'lifecycle_start'` as semantically invalid, even though both source and target are in the "active" set.

#### 4.2.1 Atomicity scope — P5 vs P9

This contract specifies **repository-level logical and concurrency atomicity**: concurrent writers cannot interleave, and all fields of a transition land together or none do.

This is **not** the same as crash-durable physical atomicity:
- A JSON-file provider with mutex gives concurrency atomicity.
- A crash mid-write can still leave a partially-written file on disk.

Physical durability (write-ahead logs, atomic file rename, fsync guarantees) is the responsibility of **P9 Atomic Persistence + Durability**, a separate milestone. P5's atomicity claim stops at "within a single live process, no interleaving". P9 will later upgrade the physical guarantees without changing this contract.

Callers must be written assuming the CAS primitive can lose in-flight transitions on process crash. P5 does not provide automatic recovery for such a loss; recovery/watchdog behavior is deferred per §3.5. The `§7.4` dequeue path handles normal queued cancellation, not process-crash recovery.

### 4.3 `SessionStatusReason` Code Space

`SessionStatusReason` is the durable reason-code enum. Its values are machine-readable strings; UI may localize them later. The CAS primitive persists exactly this value as `session.statusReason` on every successful transition.

```ts
export type SessionStatusReason =
  | 'lifecycle_start'                    // active-state progression (queued→planning, planning→running)
  | 'user_cancel_requested'              // API accepted cancel, wrote cancelling
  | 'user_cancel_quiesced'               // Worker quiesced in response to user cancel
  | 'completion_success'                 // AgentLoop finished normally
  | 'execution_timeout'                  // Session hit execution limit (maxTurns OR per-operation deadline)
  | 'failure_exception'                  // Unhandled exception in loop or startup
  | 'failure_startup'                    // Exception before loop could run
  | 'worker_shutdown'                    // Worker process terminating, session abandoned
  | 'system_error'                       // Catch-all for infrastructure failure
  | 'cancellation_quiescence_failure';   // Reserved: recovery authority could not prove safe quiescence (see §4.4)
```

There is no `queue_removed` reason in the Phase 2 canonical enum: Phase 2 makes no queue removal call (§7). If a future queue contract adds a removal-based quiescence proof, it must extend the enum and define its edge in a future revision.

**Note on `execution_timeout` (R3-4)**: this single code covers any "session ran out of allowed execution" scenario — currently AgentLoop's `maxTurns` cap, and (in future) per-operation deadlines. The old R0-R2 code `completion_timeout` was ambiguous: it sounded like it covered only maxTurns but the AbortReason mapping also used it for operation deadlines. The rename makes the scope explicit.

**Per-transition-edge validity** (primitive enforces per §4.2 invariant 8):

| Transition edge | Valid `reason` |
|-----------------|----------------|
| `queued → planning` | `lifecycle_start` |
| `planning → running` | `lifecycle_start` |
| `queued → cancelling` | `user_cancel_requested` |
| `planning → cancelling` | `user_cancel_requested` |
| `running → cancelling` | `user_cancel_requested` |
| `cancelling → cancelled` | `user_cancel_quiesced` |
| `cancelling → failed` | `cancellation_quiescence_failure` (reserved; no Phase 2 caller) |
| `running → completed` | `completion_success` |
| `running → failed` | `execution_timeout` \| `failure_exception` \| `worker_shutdown` \| `system_error` |
| `planning → failed` | `failure_startup` \| `failure_exception` \| `worker_shutdown` \| `system_error` |

The primitive rejects any `(currentState, target, reason)` triple not in this table. This eliminates the R3-4 bug where e.g. `running → cancelling` with `reason = 'lifecycle_start'` was previously allowed because both source and target were "active".

### 4.4 Cancellation-vs-Failure Precedence

Section 2.3 permits the transition `cancelling → failed`. That permission is necessary (a worker can genuinely lose the ability to quiesce safely) but **must not be exercised for ordinary unwind errors**. Otherwise the original "Cancel shows Failed" bug survives through a different door:

```
user presses Cancel
  → status = cancelling
  → abort/unwind throws an ordinary AbortError
  → worker catch → failed   ❌
```

#### 4.4.1 Precedence rule

When the worker is about to write a terminal status and the current session status is `cancelling`, **both** conditions are required before writing `cancelled`:

1. `cancelRequestedAt` is set (cancel intent is durable), AND
2. the worker has reached the execution-stop boundary defined in §3.3 (`executionStopBoundary.confirm() === true`).

If both hold:
- **Outcome MUST be `cancelled` with `reason: 'user_cancel_quiesced'`.**
- Any ordinary unwind error (AbortError from LLM stream, tool, eventBus, etc.) is diagnostic noise and MUST NOT flip the outcome to `failed`. Attach it to a diagnostic field (`cancellationDiagnostic` or similar) but do not change `status`.

If cancel intent is durable but the execution-stop boundary has NOT been confirmed:
- The worker MUST NOT write `user_cancel_quiesced` or claim `cancelled`.
- It MUST stop starting new work, release what it can, and leave resolution to the future recovery authority (§3.5). It MUST NOT start normal post-processing.

The `cancelling → failed` edge remains reserved exclusively for that recovery authority; the ordinary Phase 2 worker path does not produce `cancellation_quiescence_failure`.

#### 4.4.2 What counts as ordinary unwind error (must NOT flip to failed)

- `AbortError` from `llm.stream()` during cancel unwind
- `AbortError` from `eventBus.emit` / `eventBus.waterfall` during cancel unwind
- Tool returning `{success: false, aborted: true}` during cancel unwind
- Any throw whose `err.name === 'AbortError'` AND `signal.aborted === true` AND `abortReason === 'user_cancel'`

#### 4.4.3 What counts as quiescence failure (reserved for future recovery authority)

The code `cancellation_quiescence_failure` and the transition `cancelling → failed` are **reserved** for a future recovery/liveness authority that has POSITIVE EVIDENCE that quiescence could not be achieved. The current worker terminal path (Phase 2 scope) does NOT produce this code.

Cases that would belong to such an authority (out of scope for Phase 2):
- Watchdog detects `cancelRequestedAt + threshold < now()` with session still `cancelling`
- A separate recovery process (not the original worker) has evidence that the original worker died before quiescing
- Infrastructure-level abort with `reason: 'worker_shutdown'` (but note: if the worker itself observes this signal, it can still write `failed` via the standard `worker_shutdown` code path — `cancellation_quiescence_failure` is only for cases where the worker itself cannot perform any terminal write)

Cases that are **NOT** quiescence failure (and must NOT produce `cancellation_quiescence_failure`):
- Worker process killed externally — the worker cannot write in this case; this is a liveness problem for the watchdog, not a terminal write the worker performs
- Database connection lost — same: the worker cannot write; liveness problem
- Ordinary AbortError during cancel unwind — by §4.4.2, this is diagnostic noise that must NOT flip to `failed`

**Phase 2 implementation rule**: the worker's terminal-write logic only produces `user_cancel_quiesced` (when cancel intent is durable and unwind was clean) or the standard non-cancel mapping. The `cancellation_quiescence_failure` code path has no production caller in Phase 2; the reason code exists in the enum for future use.

#### 4.4.4 Implementation shape

The normative worker terminalization flow is defined in §3.3. This section does not provide a competing implementation. The required precondition is explicit:

```ts
// This helper is callable only after executionStopBoundary.confirm() === true.
// Cancel intent alone is not sufficient evidence.
const outcome = terminalizeAtQuiescenceBoundary({ result, quiesced: true });
```

`terminalizeAtQuiescenceBoundary`:
1. Computes a legal `(currentState, target, reason)` edge.
2. Performs the single terminal CAS with all required side-effects.
3. If that CAS loses to `currentState === 'cancelling'`, performs the follow-up `cancelling → cancelled` CAS.
4. Grants normal post-processing permission only if the original terminal CAS applied and its committed initial PP state is `pending`.

The Phase 2 worker has **no** `cancelling → failed` production branch. `cancellation_quiescence_failure` remains reserved for a future recovery authority.

### 4.5 Caller Contract

All callers (API, worker normal path, worker catch path) MUST use `transitionStatus` for **every production session lifecycle state change**, whether the target is active or terminal. A bare unconditional `updateStatus(sessionId, status)` is not an allowed lifecycle path.

The legacy `updateStatus` method may remain as a compatibility facade, but it MUST either:
1. Delegate to the same transition primitive with an explicit expected state and canonical reason; or
2. Be removed from all runtime session lifecycle paths and retained only for non-lifecycle compatibility use.

It MUST NOT remain an independent unconditional setter. A non-terminal target is not automatically safe: a late `updateStatus('planning')` could otherwise revert an already-terminal `cancelled` session. This is the R5-3 safety closure.

### 4.6 Return Value Handling

Every transition example, including non-terminal transitions, must provide the required edge-valid `reason` and required side-effects for terminal targets:

```ts
const result = await repos.sessions.transitionStatus(sessionId, {
  expected: ['running'],
  target: 'completed',
  reason: 'completion_success',
  sideEffects: {
    terminalAt: now(),
    postProcessingStatus: 'pending',
  },
});
if (!result.applied) {
  // Current state is authoritative; do not retry or continue any work
  // that depends on this transition having committed.
  logger.warn(`Terminal transition rejected: ${JSON.stringify({expected, target, currentState: result.currentState})}`);
}
```

For a successful terminal transition, the caller retains the side-effect decision it submitted (`initialPPStatus`) and may start normal post-processing only when `result.applied === true` and that committed decision was `'pending'` (§10.5). The current `TransitionStatusResult` does not claim to return a post-processing snapshot.

---

## 5. Abort Reason Taxonomy and Domain Mapping

### 5.1 The Problem

Today `AbortError` is a single exception type, but it can be raised for multiple reasons:
- User clicked Cancel
- Worker is shutting down
- Per-operation deadline exceeded
- System-wide abort (e.g., out-of-memory)

The AgentLoop turn-level catch cannot distinguish these and currently classifies all as `failed`.

### 5.2 Two Distinct Domains

There are two separate type domains in play. They are NOT the same and must not be conflated:

| Domain | Purpose | Where it lives |
|--------|---------|----------------|
| **`AbortReason`** | Classifies the input abort signal — what triggered the abort | Shared lifecycle contract in `packages/protocol/th-protocol`; both `th-agent` and `th-tools` may depend on it without creating a dependency cycle |
| **`SessionStatusReason`** | Classifies the durable persisted reason for the session's current status | **Same shared lifecycle contract in `packages/protocol/th-protocol`**; persistence owns storing the value, not defining the type |

```ts
// Input-side: why the abort signal fired
export type AbortReason =
  | 'user_cancel'        // user clicked Cancel
  | 'worker_shutdown'    // worker process is terminating
  | 'deadline'           // operation deadline exceeded
  | 'system';            // catch-all (OOM, infra failure)

// Persisted-side: why the session is in its current status
// (Canonical values defined in §4.3)
export type SessionStatusReason =
  | 'lifecycle_start' | 'user_cancel_requested' | 'user_cancel_quiesced'
  | 'completion_success' | 'execution_timeout'
  | 'failure_exception' | 'failure_startup' | 'worker_shutdown'
  | 'system_error' | 'cancellation_quiescence_failure';
```

The taxonomy for `AbortReason` is intentionally closed (discriminated union) to force exhaustive handling. New reasons require a contract revision.

### 5.3 How Abort Signal Carries Reason

Node.js `AbortController.abort(reason)` accepts a reason parameter. The codebase must use this consistently:

```ts
// User cancel (worker polling detects cancelling status)
abortController.abort({ reason: 'user_cancel' });

// Worker shutdown
abortController.abort({ reason: 'worker_shutdown' });

// Deadline (future; not in current scope)
abortController.abort({ reason: 'deadline' });
```

The reason is readable via `signal.reason` (Node ≥ 18) or by reading the `abort` event's argument.

### 5.4 Canonical Mapping `AbortReason` → `SessionStatusReason`

There is exactly **one** mapping between the two domains. Every code path that needs to translate an abort signal into a terminal outcome uses this mapping — no parallel implementations:

| `AbortReason` (input) | `AgentResult.status` | `SessionStatusReason` (persisted) |
|----------------------|---------------------|-----------------------------------|
| `user_cancel` | `cancelled` | `user_cancel_quiesced` |
| `deadline` | `failed` | `execution_timeout` |
| `worker_shutdown` | `failed` | `worker_shutdown` |
| `system` | `failed` | `system_error` |

Note the non-obvious mappings:
- `deadline` → `execution_timeout` (covers any "session ran out of allowed execution", including per-operation deadline; R3-4)
- `system` → `system_error` (not `'system'` — the session layer uses `system_error`)

The mapping is total (covers all `AbortReason` cases) and injective on the `SessionStatusReason` side (no two abort reasons collapse to the same status reason).

### 5.5 `classifyAbortOutcome` — the Single Bridge Function

All code paths that need to translate an abort into an `AgentResult` MUST go through the same function. The function takes a **reason**, not a signal — signal extraction happens at the boundary:

```ts
interface AbortOutcome {
  status: 'cancelled' | 'failed';
  reason: SessionStatusReason;
}

function classifyAbortOutcome(reason: AbortReason): AbortOutcome {
  switch (reason) {
    case 'user_cancel':
      return { status: 'cancelled', reason: 'user_cancel_quiesced' };
    case 'deadline':
      return { status: 'failed', reason: 'execution_timeout' };
    case 'worker_shutdown':
      return { status: 'failed', reason: 'worker_shutdown' };
    case 'system':
    default:
      return { status: 'failed', reason: 'system_error' };
  }
}
```

Two input boundaries, one classifier:

```
signal boundary:
  AbortSignal → extractAbortReason(signal) → AbortReason → classifyAbortOutcome(reason)

tool boundary:
  ToolResult.abortReason → AbortReason → classifyAbortOutcome(reason)
```

There is no `syntheticSignal as AbortSignal` fabrication — the tool path already carries an `AbortReason` directly and feeds it to the classifier. This is the R2-4 fix.

### 5.6 AgentLoop Turn-Catch Logic

At `packages/agent/th-agent/src/loop.ts:508` (the turn-level catch), the new logic extracts reason at the signal boundary, then delegates to the classifier:

```ts
} catch (err) {
  // Check abort BEFORE generic error classification.
  if (context.abortSignal.aborted) {
    const abortReason = extractAbortReason(context.abortSignal);
    const outcome = classifyAbortOutcome(abortReason);
    return {
      sessionId,
      turns: context.turnCount,
      status: outcome.status,
      reason: outcome.reason,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }

  // Generic error classification (no abort involved).
  const error = err instanceof Error ? err : new Error(String(err));
  return {
    sessionId,
    status: 'failed',
    turns: context.turnCount,
    reason: 'failure_exception',
    error,
  };
}
```

### 5.7 Post-Complete Abort Re-Check

At `packages/agent/th-agent/src/loop.ts:495`, after `executeTurn` returns `{complete: true}`, the loop must re-check abort **through the same classifier**:

```ts
if (turnResult.complete) {
  if (context.abortSignal.aborted) {
    const abortReason = extractAbortReason(context.abortSignal);
    const outcome = classifyAbortOutcome(abortReason);
    return { sessionId, turns: context.turnCount, status: outcome.status, reason: outcome.reason };
  }
  return { sessionId, status: 'completed', turns: context.turnCount, reason: 'completion_success' };
}
```

This guarantees the mapping is identical whether abort lands between turns, during the LLM stream, or after `complete:true` but before return.

### 5.8 Tool Execution Abort Propagation

At `packages/tools/th-tools/src/registry.ts:182`, abort during tool execution surfaces via a typed flag:

```ts
interface ToolResult {
  success: boolean;
  error?: string;
  aborted?: boolean;           // NEW: true if the tool was aborted
  abortReason?: AbortReason;   // NEW: why — same AbortReason type from shared package
  duration: number;
}
```

AgentLoop's per-tool loop at `loop.ts:1032` must do **more than just `break`**:

```ts
for (const toolCall of turn.toolCalls) {
  const result = await registry.dispatch(toolCall, context);

  if (result.aborted) {
    // 1. Stop remaining tools in this turn.
    // 2. Surface abort to executeTurn's return value so the outer
    //    loop can run classifyAbortOutcome() on it.
    return {
      complete: false,
      aborted: true,
      abortReason: result.abortReason ?? 'system',
      response: { content: '' },
      toolResults: collectedSoFar,
    };
  }

  collectedSoFar.push(result);
  // ... existing bookkeeping ...
}
```

Then `executeTurn`'s return shape includes `aborted?: boolean`, and the main while-loop in `run()` handles it before the next iteration:

```ts
const turnResult = await this.executeTurn(context);

if (turnResult.aborted) {
  // Abort came through the tool path. The tool result already carries
  // an AbortReason — feed it directly to the classifier (no signal fabrication).
  const outcome = classifyAbortOutcome(turnResult.abortReason);
  return { sessionId, turns: context.turnCount, status: outcome.status, reason: outcome.reason };
}

if (turnResult.complete) { ... }
```

The invariant is: **every abort path — catch, post-complete re-check, or tool propagation — reaches the same classifier with an `AbortReason` and produces the same `AbortOutcome` (status + `SessionStatusReason`).** There are no parallel mappings anywhere in the codebase.

### 5.9 `extractAbortReason` Helper

This is the single boundary function that extracts an `AbortReason` from an `AbortSignal`:

```ts
function extractAbortReason(signal: AbortSignal): AbortReason {
  const reason = signal.reason;
  if (reason && typeof reason === 'object' && 'reason' in reason) {
    const r = (reason as { reason: string }).reason;
    if (['user_cancel', 'worker_shutdown', 'deadline', 'system'].includes(r)) {
      return r as AbortReason;
    }
  }
  // Default: caller doesn't know; classify as system
  return 'system';
}
```

### 5.10 Shared Type Ownership (Implementation Note)

To prevent dependency cycles between `th-tools` and `th-agent`:

- `AbortReason` and `SessionStatusReason` type definitions live in `packages/protocol/th-protocol`, the shared lower-level lifecycle contract package. Both are imported by `th-agent`, `th-worker`, `th-api`, and `th-persistence` as needed; `th-tools` imports `AbortReason` only. **Persistence owns persisting `SessionStatusReason`, not defining the type.**
- `classifyAbortOutcome` function lives in `th-agent` (it produces an agent-specific `AbortOutcome` / `AgentResult`).
- `th-tools` depends on the protocol package for `AbortReason` but NOT on `th-agent`.

---

## 6. Worker Cancellation-Observation Lifecycle

### 6.1 Current Gap

The cancel-poll interval at `test-session.ts:289` is started AFTER `running` is written. The entire `planning` phase is a blind spot.

### 6.2 New Lifecycle

```
job accepted by worker
    │
    ▼
START cancel-observer  ←── BEFORE any status write
    │
    ▼
queued → planning CAS  ←── applied:true is the only permission for planning
    │
    ▼
(container build, tool registry, site profile)
    │
    ▼
planning → running CAS ←── applied:true is the only permission to start AgentLoop
    │
    ▼
AgentLoop.run()
    │
    ▼
terminal CAS            ←── status + reason + timestamps + initial PP state atomically
    │                         (if CAS loses to cancelling, converge cancelling→cancelled)
    ├──────────────────────────────────────────┐
    │ target=cancelled                         │ target=completed/failed
    │ PP=not_applicable                        │ PP=pending (or not_applicable)
    │ NO normal post-processing                │
    │                                         ▼
    │                                  if PP=pending:
    │                                  post-processing
    │                                         │
  │ Post-processing only after successful terminal CAS + PP=pending │
  │ cancelled: no normal PP                                  │
  └───────────────────────────────────────────────────────────┴──► finally: STOP cancel-observer
```

The order is intentional: terminal CAS precedes any post-processing. A cancelled terminalization skips normal post-processing entirely (§9.3).

### 6.3 Observer Implementation

```ts
class CancellationObserver {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController;

  constructor(
    private sessionId: string,
    private repos: Repositories,
    private pollIntervalMs: number = 2000,
  ) {
    this.abortController = new AbortController();
  }

  get signal(): AbortSignal { return this.abortController.signal; }

  start(): void {
    this.intervalId = setInterval(async () => {
      try {
        const session = await this.repos.sessions.findById(this.sessionId);
        if (session?.status === 'cancelling' || session?.status === 'cancelled') {
          if (!this.abortController.signal.aborted) {
            this.abortController.abort({ reason: 'user_cancel' });
          }
        }
      } catch { /* ignore transient DB errors */ }
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
```

Usage in processor:

```ts
const observer = new CancellationObserver(sessionId, this.repos);
try {
  observer.start();
  // ... entire processing pipeline ...
} finally {
  observer.stop();   // ← guaranteed cleanup
}
```

### 6.4 Queued-Session Check

Before any setup, the worker must check if the session was cancelled while queued:

```ts
const session = await this.repos.sessions.findById(sessionId);
if (!session) throw new Error('session not found');
if (session.status === 'cancelling' || session.status === 'cancelled') {
  // Short-circuit: do not enter planning at all.
  // The session is already in cancelling (API wrote it) or cancelled (defensive).
  // For the cancelling case, terminalize now. For already-cancelled, this is a no-op.
  if (session.status === 'cancelling') {
    await this.repos.sessions.transitionStatus(sessionId, {
      expected: ['cancelling'],    // current state IS cancelling (not queued)
      target: 'cancelled',
      reason: 'user_cancel_quiesced',
      sideEffects: {
        terminalAt: now(),
        postProcessingStatus: 'not_applicable',   // cancelled implies quiescence (R2-1)
        // NOTE: statusReason written automatically by primitive from `reason`.
        // NOTE: completedAt mirrored automatically by primitive from `terminalAt`.
      },
    });
  }
  return;
}
// Otherwise proceed with queued → planning.
// The CAS for queued → planning is the permission to proceed; see §6.5.
```

This addresses the queued case of R5 completely.

### 6.5 The Planning Cancellation Contract (F6 refined)

**Critical distinction**: "observer started before planning" does **not** equal "planning operations respond to abort".

If container build takes 45 seconds and doesn't read the abort signal, the observer will flip `signal.aborted = true` after 2 seconds — but container build will continue for 43 more seconds regardless.

Therefore F6 is refined to a weaker, achievable guarantee:

> **F6 (revised)**: Once `cancelling` intent is durable, the session MUST NOT transition `planning → running`, and AgentLoop.run() MUST NOT start. The exact speed at which in-flight planning operations unwind is operation-specific and may be non-instant.

#### 6.5.1 Successful CAS transition is the ONLY permission to advance (R2-2)

Neither `planning` nor `AgentLoop` may start merely because a pre-transition read was clean. **Progression is authorized ONLY by a successful CAS transition.**

A pre-read that says "current state is `planning`" is STALE the moment it's read — API could have won the race to `cancelling` in the microsecond between read and CAS. The CAS itself is the race-free boundary.

**Before `queued → planning`:**

```ts
const planningTransition = await this.repos.sessions.transitionStatus(sessionId, {
  expected: ['queued'],
  target: 'planning',
  reason: 'lifecycle_start',
});
if (!planningTransition.applied) {
  // CAS rejected. Current state is authoritative.
  // If cancelling: API won the race. Worker has dequeued the job but has NOT
  // yet done any planning work, so this is a clean quiescence — worker MUST
  // terminalize to cancelled. If we just returned here, the session would
  // be stuck in `cancelling` with no future writer. (R3-1 fix.)
  if (planningTransition.currentState === 'cancelling') {
    await this.repos.sessions.transitionStatus(sessionId, {
      expected: ['cancelling'],
      target: 'cancelled',
      reason: 'user_cancel_quiesced',
      sideEffects: {
        terminalAt: now(),
        postProcessingStatus: 'not_applicable',
        // NOTE: statusReason written automatically by primitive from `reason`.
        // NOTE: completedAt mirrored automatically by primitive from `terminalAt`.
      },
    });
  }
  // For cancelled: already terminalized elsewhere; nothing to do.
  // For unexpected state: log error.
  if (planningTransition.currentState !== 'cancelling' &&
      planningTransition.currentState !== 'cancelled') {
    logger.error(`queued→planning rejected with currentState=${planningTransition.currentState}`);
  }
  return;   // regardless: do NOT proceed with planning setup
}
// planningTransition.applied === true: worker has permission to do planning setup.
```

**Before `planning → running` (the original re-check):**

```ts
// After planning setup completes, BEFORE starting AgentLoop:
const runningTransition = await this.repos.sessions.transitionStatus(sessionId, {
  expected: ['planning'],
  target: 'running',
  reason: 'lifecycle_start',
});
if (!runningTransition.applied) {
  // API won the race. Current state is authoritative. Do NOT start AgentLoop.
  if (runningTransition.currentState === 'cancelling') {
    // Terminalize (symmetric with the queued→planning case above).
    await this.repos.sessions.transitionStatus(sessionId, {
      expected: ['cancelling'],
      target: 'cancelled',
      reason: 'user_cancel_quiesced',
      sideEffects: {
        terminalAt: now(),
        postProcessingStatus: 'not_applicable',
      },
    });
  }
  return;   // regardless of currentState, do NOT start AgentLoop
}
// runningTransition.applied === true: worker has permission to start AgentLoop.
await loop.run(...);
```

**Invariant**: the transition's `applied: true` return value is the sole contract that authorizes the next phase. Pre-reads of session status are informative but never authorizing.

This is the R2-2 fix. It eliminates the narrow race where:

```
worker re-read → sees planning
            API cancel happens here → cancelling
worker transitionStatus(planning → running) → rejected
worker still starts AgentLoop   ❌
```

Under the new contract, if `transitionStatus` returns `{applied: false}`, the worker does not start AgentLoop regardless of what it read earlier.

This re-check is the **contract-level boundary** that makes F6 true. Even if every planning operation is uninterruptible, the session cannot advance past the CAS point once `cancelling` is observed.

#### 6.5.2 Best-effort abort forwarding to planning operations

For planning operations that accept an `AbortSignal` (HTTP calls, subprocess spawns, DB queries that support cancellation), pass `observer.signal`:

```ts
await buildContainer({ signal: observer.signal });
await registry.initialize({ signal: observer.signal });
```

But this is **best-effort**, not a contract requirement. Operations that do not accept a signal will run to completion. The contract only requires that **after** such operations finish, the re-check in §6.5.1 prevents the session from proceeding into `running`.

#### 6.5.3 What F6 does NOT promise

- F6 does not promise that `planning` operations are interrupted instantly.
- F6 does not promise that no side effects occur after `cancelling` is written.
- F6 promises only that **the session does not advance to `running`** and **AgentLoop does not start** once `cancelling` is observed at the re-check point.

This distinction matches the contract's opening thesis: control intent ≠ execution quiescence. The observer records intent; the re-check enforces the quiescence boundary.

### 6.6 All Exit Paths Go Through Finally

The `finally` block is the ONLY place the observer is stopped. Every exit path (success, failure, abort, throw, early return) must pass through it. No alternative cleanup sites.

### 6.7 Polling Interval

Hard-coded `2000` ms is acceptable for now. Configurable polling interval is out of scope; if needed, it becomes a Phase 2 implementation detail.

---

## 7. Queue / Session Cancellation Relationship

### 7.1 Role Decision

| Concern | Owner |
|---------|-------|
| Cancellation intent + terminal state | Session persistence |
| Job scheduling + dequeue | Queue |

**The queue does NOT model cancellation as a first-class job state.** This is a deliberate choice: the queue is a scheduling substrate, and adding `cancelled` to `JobStatus` would require every future queue backend (Redis, Postgres) to implement cancel semantics correctly.

### 7.2 Queue Interface — No Changes Required

Under this contract, the queue does not need new methods for cancellation. The API does not remove jobs on cancel (§7.3.1), and the worker reads session state directly on dequeue (§7.4) rather than relying on a reverse sessionId → jobId lookup.

The queue continues to expose its existing `add / process / getJob / getJobs / remove / close` surface. The `remove` method exists but is not used by the cancel flow.

**Operational note**: for diagnostics (e.g., "which queue job corresponds to this session?"), a future phase MAY add a sessionId → jobId reverse index. P5 does not require it.

### 7.3 Cancel Flow With Queue Awareness

When API accepts a cancel:

```ts
// 1. Session persistence writes cancelling + cancelRequestedAt atomically.
const result = await repos.sessions.transitionStatus(id, {
  expected: ['queued', 'planning', 'running'],
  target: 'cancelling',
  reason: 'user_cancel_requested',
  sideEffects: {
    cancelRequestedAt: now(),
    // NOTE: statusReason is written automatically by the primitive from `reason`.
  },
});

// 2. No queue.remove() call.
//    The job stays in the queue. The worker is the sole authority for
//    terminal `cancelled` (see §3.3). If the API were to remove the job
//    here, the worker would never dequeue and no one would terminalize
//    the session — producing a permanent `cancelling` state.
//
//    Instead: the worker's dequeue-time check (§7.4) handles the
//    queued-cancel case, and the running-session observer (§6) handles
//    the running-cancel case. Both paths end with the worker writing
//    the terminal state.

return disambiguatedCancelResponse(res, result);
```

#### 7.3.1 Why the queue is not shortened at API time

The API is not in a position to prove execution quiescence. `queue.remove(jobId)` would remove the job from the queue's in-memory map, but:

1. **TOCTOU race**: between `findJobIdBySessionId` and `queue.remove`, the worker could dequeue the same job. The remove then no-ops or fails, and the worker proceeds.
2. **Quiescence authority**: even if remove succeeded, the session would be stranded in `cancelling` with no party able to prove quiescence. The contract in §3.3 assigns terminalization to whoever can observe the session's execution reaching a fixed point — that's the worker (running case) or the worker at dequeue (queued case).
3. **Single writer invariant**: permitting the API to short-circuit to `cancelled` would create a second writer of terminal state, breaking the invariant.

The job therefore always flows through the worker, and the worker's first action on dequeue (§7.4) handles the already-cancelled case cheaply.

### 7.4 Dequeue-Time Cancel Check

When the worker dequeues a job, the FIRST action (before any `transitionStatus` to `planning`) is to re-read the session:

```ts
const session = await repos.sessions.findById(sessionId);
if (session.status === 'cancelling' || session.status === 'cancelled') {
  // If cancelling: this is the queued-cancel case. Terminalize now.
  // If cancelled: defensive — someone already terminalized; nothing to do.
  if (session.status === 'cancelling') {
    await repos.sessions.transitionStatus(sessionId, {
      expected: ['cancelling'],
      target: 'cancelled',
      reason: 'user_cancel_quiesced',
      sideEffects: {
        terminalAt: now(),
        postProcessingStatus: 'not_applicable',   // cancelled implies quiescence (R2-1)
        // NOTE: statusReason written automatically by primitive from `reason`.
        // NOTE: completedAt mirrored automatically by primitive from `terminalAt`.
      },
    });
  }
  return;  // job complete, no execution
}
// Otherwise proceed with queued → planning CAS (see §6.5.1 — CAS is the permission).
```

This is the sole path by which a queued-then-cancelled session reaches terminal `cancelled`. It preserves the single-writer invariant: the worker writes the terminal state, having observed the cancel intent and confirmed no execution began.

### 7.5 Guarantees

- **Case A (job still queued)**: cancel → session enters `cancelling` with `cancelRequestedAt`. Job remains in queue. On dequeue, worker observes `cancelling`, does not enter planning, and writes terminal `cancelled`.
- **Case B (job running)**: cancel → session enters `cancelling`. Worker's observer detects within 2s, aborts, and writes terminal `cancelled` (subject to §4.4 cancellation-precedence policy).
- **Case C (job already terminal)**: cancel rejected by CAS primitive at API; response is `202 {accepted: false, alreadyTerminal: true, terminalStatus: ...}` for `completed`/`failed`, or `202 {accepted: true, alreadyCancelled: true}` for `cancelled`.

All three cases end with a single deterministic terminal state on the normal successful Phase 2 execution path. Infrastructure failures, database errors, and process crashes may leave `cancelling` unresolved; crash recovery and liveness watchdogs are explicitly deferred (§3.5).

### 7.6 Queue Job Status After Cancel (R6 reclassified)

Phase 0 listed R6 as a risk:

> Queue job status is `completed` after cancel — broken accounting; would break any Redis/Postgres queue swap.

After design analysis, R6 is **RECLASSIFIED / ACCEPTED BY DESIGN**:

The queue's `JobStatus` semantically means "the processor finished its work", not "the session succeeded". A cancelled session that goes through the worker's short-circuit path at dequeue still produces `JobStatus = completed` — this is correct from the queue's perspective: the processor did its job (of deciding not to execute).

Session-level semantics are authoritative for session state. The queue is a scheduling substrate. The two are decoupled by design.

**Implication for future Redis/Postgres queue backends**: if accurate job-count metrics are needed, they must be derived from the session's terminal status, not from `JobStatus` alone. The contract does not require the queue to know about session cancellation.

This reclassification is consistent with §7.1's role decision.

---

## 8. Terminal Timestamp Ownership and Durable Reason

### 8.1 Problem

The current schema has only `completedAt`, which is used for two different facts:
- When the user requested cancel
- When the session actually terminated

This conflation causes R1 (worker overwrites API's cancel timestamp) and R2 (double cancel overwrites).

Additionally, the R0 contract introduced `reason` as a CAS argument and mentioned a `cancelReason` schema field, but:
- There was no unified durable field for "why did the session reach this status".
- The names `cancelReason` and `reason` risked conflating "why cancellation was requested" with "why the terminal transition happened".
- `failure_post_processing` appeared in the terminal reason space, contradicting §9's rule that post-processing failure does not change status.

### 8.2 Schema Extension

Add the following fields to the session schema:

```ts
interface Session {
  // ... existing fields ...

  // NEW: when cancel was requested (set by API on cancel accept; write-once)
  cancelRequestedAt: string | null;    // ISO timestamp

  // NEW: when the session entered a terminal state (set by CAS primitive; write-once)
  terminalAt: string | null;           // ISO timestamp

  // NEW: durable machine-readable reason for the CURRENT status.
  // Updated by the CAS primitive on every status transition.
  // Examples: 'user_cancel_requested', 'user_cancel_quiesced',
  //           'completion_success', 'execution_timeout',
  //           'failure_exception', 'worker_shutdown',
  //           'cancellation_quiescence_failure', 'system_error'.
  // See §4.3 for the canonical code space.
  statusReason: string | null;

  // EXISTING: deprecated; kept for backward compatibility
  completedAt: string | null;          // to be removed in a future phase
}
```

**Design note — what is NOT in the schema**:
- There is no `cancelReason` field. The reason the cancel was requested is recorded in `statusReason` at the moment of the `cancelling` transition (value: `'user_cancel_requested'`). The reason the terminal `cancelled` state was reached is recorded in `statusReason` at the moment of the `cancelled` transition (value: `'user_cancel_quiesced'`). These are two different facts at two different times; they share one field that is updated atomically with each transition.
- There is no separate `terminalReason`. The terminal reason is just `statusReason` as of the terminal transition. This avoids field sprawl and keeps the reason model uniform.

### 8.3 Write Rules

| Field | Writer | When |
|-------|--------|------|
| `cancelRequestedAt` | API cancel handler via `transitionStatus.sideEffects` | On `queued/planning/running → cancelling` transition |
| `terminalAt` | Worker (or any writer) via `transitionStatus.sideEffects` | On terminal transition (`→ completed/failed/cancelled`) |
| `completedAt` | Deprecated; written atomically with `terminalAt` as mirror | Being phased out |
| `postProcessingStatus` | Worker via `transitionStatus.sideEffects` | On terminal transition; initial value per §9.3 |
| `statusReason` | **CAS primitive itself, automatically from `options.reason`** | Always — every successful transition writes `statusReason = options.reason` |

**`statusReason` has a single source of truth** (R2-5): the CAS primitive writes `statusReason = options.reason` atomically with every successful transition. Callers MUST NOT supply `statusReason` via any other mechanism — it is not in `TransitionSideEffects`. This eliminates the possibility of `reason` (the audit code) disagreeing with `statusReason` (the persisted field).

**`cancelRequestedAt` is write-once.** The CAS primitive enforces: if `cancelRequestedAt` is already set and a new value is passed in `sideEffects`, the write is rejected (or idempotent with the original value preserved — implementation choice, but the original value is always retained, F8).

**`terminalAt` is write-once.** Set only via the CAS primitive when a terminal transition is applied. If already set, the transition is rejected (terminal irreversibility).

**`postProcessingStatus` on terminal transitions**: written atomically with the status. Value per §9.3:
- `cancelled` → `'not_applicable'`
- `completed` → `'pending'`
- `failed` → `'pending'` or `'not_applicable'` per policy

### 8.4 Double Cancel Behavior

Second cancel request:
1. API reads session. Current status is `cancelling` (first cancel is in flight) or `cancelled` (first cancel completed).
2. API calls `transitionStatus({expected: [...], target: 'cancelling'})` — CAS rejects because current state is not in `expected`.
3. API returns `202 {accepted: true, alreadyCancelling: true}` — idempotent.
4. **`cancelRequestedAt` is NOT modified** — original request time preserved (F8).

### 8.5 Migration Strategy

Phase 2 implementation adds the new fields without removing `completedAt`. For one phase, both are written:
- `terminalAt` = source of truth
- `completedAt` = mirror of `terminalAt` (for backward-compat readers)

Future phase removes `completedAt` after all readers are migrated.

---

## 9. Core Execution vs Post-Processing Outcome

### 9.1 Problem

Today, post-processing (summary LLM, site-profile enrichment, cognition sync) runs BEFORE the terminal status write. If any post-processing step throws, the worker's catch block writes `failed` — even if the AgentLoop completed successfully.

### 9.2 Decision: Separate Outcomes

**Core execution outcome** = `session.status`. Immutable after terminal write.

**Post-processing outcome** = separate field `postProcessingStatus` with an **explicit lifecycle**:

```ts
type PostProcessingStatus =
  | 'not_started'      // session not yet terminal (active states: queued/planning/running/cancelling)
  | 'pending'          // terminal state reached, post-processing not yet started
  | 'running'          // post-processing in progress
  | 'success'          // all post-processing completed successfully
  | 'partial'          // some post-processing succeeded, some failed
  | 'failed'           // all post-processing failed
  | 'not_applicable';  // terminal state reached but no post-processing applies

interface Session {
  status: SessionStatus;                         // core outcome
  postProcessingStatus: PostProcessingStatus;    // NEW: enrichment lifecycle
  postProcessingError?: string;                  // NEW: most recent error, if any
}
```

`null` is **not** a valid value. Every session has a defined post-processing state at all times:
- Active sessions (`queued`, `planning`, `running`, `cancelling`) have `postProcessingStatus = 'not_started'`.
- Terminal transitions atomically set the initial value per §9.3.

### 9.3 Per-Terminal-Status Post-Processing Policy

| Core `status` | Post-processing behavior | Initial `postProcessingStatus` (set atomically with terminal transition) | Subsequent lifecycle |
|---------------|-------------------------|------------------------------------------|----------------------|
| `completed` | Run full post-processing (summary, cognition, site-profile, score). | `pending` | `pending → running → success / partial / failed` |
| `failed` | Run partial post-processing where meaningful. Skip steps that require success data. | `pending` OR `not_applicable` (if nothing meaningful can be produced) | `pending → running → success / partial / failed`, OR remain `not_applicable` |
| **`cancelled`** | **NO normal post-processing.** `cancelled` implies quiescence — the worker has stopped producing side effects. Restarting LLM/DB/network enrichment would violate the quiescence guarantee. | **`not_applicable`** (atomic with terminal transition) | **Remains `not_applicable` permanently** |

**Critical invariant (R2-1)**: a `cancelled` terminalization MUST NOT trigger any post-processing that produces side effects (LLM calls, DB writes, network enrichment). The definition of `cancelled` as "worker has quiesced and stopped producing side effects" (§3.1) demands this.

If a future product decision requires producing partial artifacts after cancellation (e.g., a lightweight "what happened before cancel" summary), that must be:
1. A separate, explicitly authorized "cleanup/finalization" contract, AND
2. Clearly distinguished from the normal post-processing pipeline, AND
3. Implemented without violating the quiescence guarantee (likely as an asynchronous offline job with its own audit trail, not as in-band post-processing)

Until such a contract exists, `cancelled → postProcessingStatus = not_applicable` is the only rule.

What matters for this contract:
1. **Post-processing never changes `session.status`** (R4 fix).
2. **The core status and the initial `postProcessingStatus` are written atomically in the same CAS transition** (R2-6 fix) — there is no window where `status = completed` and `postProcessingStatus = not_started` persists beyond the atomic commit.
3. **Each terminal status has a defined post-processing policy** — no ambiguity about whether post-processing should run at all.

### 9.4 Write Ordering and CAS-Bound Post-Processing

The worker terminalization helper in §3.3 is the normative control flow. This section states the post-processing consequence explicitly:

```ts
// Terminal CAS is the first write and carries the initial PP state atomically.
const terminalResult = await repos.sessions.transitionStatus(sessionId, {
  expected: ['running', 'cancelling'],
  target: terminalStatus,
  reason,
  sideEffects: {
    terminalAt: now(),
    postProcessingStatus: initialPPStatus,
  },
});

if (!terminalResult.applied) {
  // Current state is authoritative. If cancellation won at this worker's
  // quiescence boundary, §10.3/§10.5 performs cancelling → cancelled.
  // In every rejected-CAS case, this execution path has NO PP permission.
  return;
}

// Only the side-effects successfully committed by THIS CAS can authorize PP.
if (initialPPStatus !== 'pending') {
  // In particular: cancelled → not_applicable, so no normal PP.
  return;
}

await repos.sessions.setPostProcessingStatus(sessionId, 'running');
try {
  const ppResult = await runPostProcessing(sessionId, result, terminalStatus);
  await repos.sessions.setPostProcessingStatus(sessionId, ppResult.outcome);
  if (ppResult.error) {
    await repos.sessions.setPostProcessingError(sessionId, ppResult.error);
  }
} catch (err) {
  // Log but do NOT change session.status.
  logger.error(`Post-processing failed: ${err}`);
  await repos.sessions.setPostProcessingStatus(sessionId, 'failed');
  await repos.sessions.setPostProcessingError(sessionId, String(err));
}
```

The `terminalResult.applied` check is mandatory; checking only the precomputed `initialPPStatus` is insufficient. A CAS rejection means this worker did not commit the terminal transition and therefore has no normal post-processing authority. A separate recovery job would require a separate, explicitly authorized recovery contract.

### 9.5 Product Semantics — What `completed` Means

> **`status = completed` means "core execution completed successfully". It does NOT mean "all artifacts are available".**

Consumers (dashboard, reports API, downstream integrations) must check `postProcessingStatus` before assuming enrichment is ready:

- `postProcessingStatus = not_started` → session is still active (queued/planning/running/cancelling); no terminal outcome yet.
- `postProcessingStatus = pending` → core is done, post-processing has not started (typically a brief window between terminal write and post-processing kickoff).
- `postProcessingStatus = running` → core is done, artifacts still being generated. UI may show a progress indicator.
- `postProcessingStatus ∈ {success, partial}` → artifacts are available.
- `postProcessingStatus = failed` → core succeeded but enrichment failed. Some artifacts may be missing.
- `postProcessingStatus = not_applicable` → terminal state reached but no post-processing applies (e.g., cancelled session, or failed session with no meaningful artifacts).

This is the explicit product semantics. Any consumer that assumes "completed = all artifacts ready" is in violation of this contract.

### 9.6 What Counts as Post-Processing (Current)

| Step | Category |
|------|----------|
| Summary LLM call | Post-processing |
| Site-profile enrichment | Post-processing |
| Cognition sync | Post-processing |
| Score calculation | Post-processing |
| Execution summary | Post-processing |

All current post-processing is **enrichment**, not core. None of it is contractually required for a session to be considered "completed".

### 9.7 Future Exception

If a future product decision makes some post-processing contractually required (e.g., audit log that must succeed), that step can be reclassified as core. Until then, the rule is: post-processing never changes `session.status`.

---

## 10. Retry / Idempotency Semantics

### 10.1 Terminal States Are Immutable

Once a session reaches a terminal state, no retry is permitted. This is enforced by the CAS primitive (Section 4.2 invariant 1).

### 10.2 Double Cancel Idempotency

Second cancel request:
- CAS primitive rejects transition (current state not in expected)
- API returns `202 {accepted: true, alreadyCancelling: true}`
- `cancelRequestedAt` is NOT modified
- No error, no state change
- **F8 invariant satisfied**

### 10.3 Concurrent Cancel + Completion

If worker writes `completed` (or `failed`) and API writes `cancelling` concurrently, exactly one wins the first CAS. Two outcomes are possible, and both converge to a terminal state:

**Case A — `completed` (or `failed`) wins the CAS**:
- Session is terminal. API's subsequent `cancelling` transition is rejected.
- API returns 202 with `alreadyTerminal: true` per §3.2.
- Worker proceeds with post-processing per §9.4 (if target was `completed` and PP status is `pending`).

**Case B — `cancelling` wins the CAS (R5-1 fix)**:
- Session is in `cancelling`. Worker's terminal transition (`running → completed` / `running → failed`) is rejected.
- Worker may converge to `cancelled` **only if** its execution-stop boundary is confirmed (§3.3). Cancel intent alone is insufficient.
- If the boundary is confirmed, worker MUST attempt `cancelling → cancelled` via CAS. If that follow-up CAS is rejected because another path already terminalized, the current terminal state remains authoritative.
- No normal post-processing runs (original terminal CAS was rejected; per §10.5, PP is CAS-bound).

```ts
const terminalResult = await repos.sessions.transitionStatus(sessionId, {
  expected: ['running', 'cancelling'],
  target: terminalStatus,       // 'completed' or 'failed'
  reason,
  sideEffects: { terminalAt: now(), postProcessingStatus: initialPPStatus },
});

if (!terminalResult.applied) {
  if (terminalResult.currentState === 'cancelling') {
    // Only after executionStopBoundary.confirm() === true may this worker
    // claim user_cancel_quiesced. If it is false, do not fabricate a
    // cancellation terminal state; leave recovery to the future authority.
    if (await executionStopBoundary.confirm()) {
      const cancelResult = await repos.sessions.transitionStatus(sessionId, {
        expected: ['cancelling'],
        target: 'cancelled',
        reason: 'user_cancel_quiesced',
        sideEffects: {
          terminalAt: now(),
          postProcessingStatus: 'not_applicable',
        },
      });
      if (!cancelResult.applied) {
        // Another path already terminalized; current state is authoritative.
        return;
      }
    } else {
      // Intent exists, but quiescence is unconfirmed. Stop this worker
      // without claiming cancellation terminalization.
      return;
    }
  }
  // No normal post-processing after a rejected original terminal CAS.
  return;
}

// terminalResult.applied === true: proceed with post-processing only when
// initialPPStatus === 'pending'.
```

This rule is the third instance of the "CAS rejection at quiescence boundary → terminalize cancelling" pattern:
1. `queued → planning` CAS rejected with `cancelling` → terminalize (§6.5.1)
2. `planning → running` CAS rejected with `cancelling` → terminalize (§6.5.1)
3. `running/cancelling → completed/failed/cancelled` CAS rejected with `cancelling` → terminalize (§10.3, this section)

After this rule, **no normal successful Phase 2 execution path leaves the session in `cancelling` indefinitely** — every quiescence boundary converges to a terminal state.

### 10.4 Worker Retry Loop

There is no retry loop around `AgentLoop.run()` in the current code, and this contract does NOT introduce one. Retry semantics are out of scope. If needed, they would be a separate milestone and would require:
- Non-terminal failure states (e.g., `failed_retryable`)
- Retry count limits
- Backoff strategy

All of these are explicitly deferred.

### 10.5 CAS Conflict Handling

When CAS returns `{applied: false}`:
- Caller logs the conflict with `{expected, target, currentState}`
- Caller does NOT retry the original transition
- **The current state is authoritative.**

At a worker quiescence boundary, a rejected terminal CAS with `currentState === 'cancelling'` follows the single normative flow in §3.3:
1. Confirm the execution-stop boundary.
2. If confirmed, attempt `cancelling → cancelled` with `user_cancel_quiesced` and `postProcessingStatus = not_applicable`.
3. If not confirmed, do not claim `cancelled` and do not start post-processing; leave later resolution to the deferred recovery authority.
4. If the follow-up CAS is rejected because another path already terminalized, preserve that current terminal state.

**Post-processing permission is CAS-bound** (R5-1):

```
terminal CAS applied === true
  AND the same successful commit carried postProcessingStatus = 'pending'
    → normal post-processing MAY start

otherwise
    → NO post-processing from this execution path
```

A precomputed `initialPPStatus === 'pending'` is not sufficient. The original CAS result must have `applied === true`. This eliminates the race where the worker loses to `running → cancelling` and nevertheless starts enrichment.

Caller-specific behavior on rejection:
- **API cancel**: return the disambiguated response from §3.2
- **Worker terminal write**: follow §3.3; no PP after rejected original CAS
- **Worker `queued → planning` or `planning → running`**: follow §6.5.1; successful cancellation convergence requires the same quiescence precondition

---

## 11. Invariant Matrix (F1–F12)

| ID | Invariant | Verification | Enforced By | Code Sites |
|----|-----------|--------------|-------------|------------|
| **F1** | Cancel accepted while session active → later `completed` cannot overwrite cancellation path | Unit test: API cancels → worker attempts `completed` → CAS rejects | CAS primitive: `cancelling → completed` forbidden | `transitionStatus` at API + worker |
| **F2** | `cancelled` terminal → `failed`/`completed` transition rejected | Unit test: attempt `cancelled → failed` → rejected | CAS primitive: terminal → any forbidden | `transitionStatus` primitive |
| **F3** | `completed` terminal → later cancel does not rewrite completion; API returns already-terminal result | Unit test: `completed` + cancel → 202 `alreadyTerminal` | CAS primitive: terminal → any forbidden | API cancel handler |
| **F4** | User abort during LLM/tool execution → `cancelled`, not `failed` | Unit test: inject abort mid-LLM-stream → result.status = 'cancelled' | AgentLoop turn catch + post-complete re-check + tool abort propagation, all delegating to `classifyAbortOutcome()` | `loop.ts:508`, `loop.ts:495`, `loop.ts:1032`, `registry.ts:182` |
| **F5** | Deadline / maxTurns → never `completed` | Unit test: AgentLoop returns maxTurns → worker writes `failed` with reason `execution_timeout` | AgentLoop returns status='failed' with reason='execution_timeout'; worker maps to `failed` | `loop.ts:554-559`, `test-session.ts:325-330` |
| **F6** | Cancel during planning → session MUST NOT transition `planning → running`, and AgentLoop.run() MUST NOT start. Progression is authorized ONLY by a successful CAS transition — a pre-read that sees `planning` does NOT authorize the next step (R2-2). If `queued → planning` CAS is rejected with `currentState='cancelling'`, worker MUST converge `cancelling → cancelled` (R4-1/R3-1). | Unit test: (a) cancel during planning → CAS `planning → running` rejected, AgentLoop not started; (b) cancel during queued → CAS `queued → planning` rejected, worker terminalizes `cancelling → cancelled`, no setup begins | Mandatory CAS gate at both progression edges (§6.5.1), rejected-CAS convergence, queued-session check (§6.4), observer started at job accepted (§6.2) | `test-session.ts` processor entry and both progression boundaries |
| **F7** | Cancellation watcher → always cleaned in `finally` | Unit test: every exit path (success/fail/throw/abort) → observer.stop() called | finally-block pattern (§6.6) | `test-session.ts` processor |
| **F8** | Double cancel → idempotent; original `cancelRequestedAt` preserved | Unit test: two cancel requests → `cancelRequestedAt` = first request time | CAS primitive rejects second; `cancelRequestedAt` write-once in `sideEffects` | API cancel handler, persistence |
| **F9** | Worker exception after user cancellation request → terminal outcome is `cancelled`, NOT `failed`, unless execution-stop cannot be confirmed. If a worker terminal CAS loses to `cancelling` at any quiescence boundary, it MUST confirm the stop boundary before attempting `cancelling → cancelled`; if follow-up CAS loses, preserve the already-authoritative terminal state. | Unit test: session in `cancelling` with `cancelRequestedAt`, unwind throws ordinary AbortError → after stop-boundary confirmation status = `cancelled` with diagnostic; terminal CAS rejected with currentState=`cancelling` → confirmed follow-up CAS produces `cancelled`; unconfirmed boundary does not claim `user_cancel_quiesced` | Cancellation-precedence policy (§4.4), normative terminalization flow (§3.3), rejected-CAS convergence (§10.3), CAS primitive, `classifyAbortOutcome()` | `test-session.ts:427` catch block, all worker terminal write paths |
| **F10** | Queued cancelled session → cannot later begin normal execution | Unit test: job dequeued with session status `cancelling`/`cancelled` → short-circuit, no setup | Dequeue-time cancel check (§7.4) | Worker processor entry |
| **F11** | Post-processing exception after successful core run → obeys explicit post-processing policy; never accidental generic overwrite. Post-processing is CAS-bound: it runs ONLY if the terminal CAS succeeded and the committed initial `postProcessingStatus = 'pending'`. A rejected terminal CAS triggers cancellation convergence when applicable, and never starts PP. In particular: `cancelled` terminalization atomically sets `postProcessingStatus = not_applicable` and no post-processing runs. | Unit test: (a) AgentLoop succeeds, post-processing throws → `status = completed`, `postProcessingStatus = failed`; (b) AgentLoop cancelled → `status = cancelled`, `postProcessingStatus = not_applicable`, no post-processing invoked; (c) terminal CAS rejected with cancelling → confirmed follow-up `cancelled`, no PP; (d) terminal CAS rejected with existing terminal → unchanged, no PP | Terminal transition atomically sets initial `postProcessingStatus` via `sideEffects` (§9.4); CAS-bound PP permission (§10.5); quiescence convergence (§10.3); lifecycle states (§9.2) | `test-session.ts` terminal write + post-processing pipeline |
| **F12** | P4 stream-generation status → cannot directly set session terminal state | Unit test: StreamEnvelope status changes do NOT write to session DB | Already true by construction (Phase 0 Q8); enforced by type separation | N/A (no new code) |

### 11.1 Invariant Relationships

- **F1 + F2 + F3** = terminal irreversibility (Section 2.4)
- **F4 + F5** = abort classification correctness (Section 5)
- **F6 + F7** = cancellation observation lifecycle (Section 6)
- **F8 + F9** = idempotency and conflict handling (Section 10)
- **F10** = queue/session cancel contract (Section 7)
- **F11** = post-processing isolation (Section 9)
- **F12** = P4 boundary preservation (Section 1.3)

### 11.2 Test Strategy Per Invariant

Each invariant requires:
1. **Unit test** in the module where enforcement lives (persistence for F1/F2/F3/F8, AgentLoop for F4/F5, worker processor for F6/F7/F9/F10/F11)
2. **Integration test** that exercises the end-to-end chain
3. **Regression suite** that runs after any Phase 2 implementation change

---

## 12. Current Implementation Mapping

This section maps each code site that must change to the contract section and invariant it addresses.

### 12.1 Persistence Layer

| File | Current State | Required Change | Contract Section | Invariants |
|------|---------------|-----------------|------------------|------------|
| `packages/persistence/th-persistence/src/repositories/interfaces.ts` | `updateStatus(sessionId, status)` — no CAS | Add `transitionStatus(sessionId, options): Promise<Result>` with typed `sideEffects` (terminalAt, cancelRequestedAt, postProcessingStatus). `reason` is a separate required field. `statusReason` is written automatically by the primitive from `reason`. `completedAt` is auto-mirrored from `terminalAt` by the primitive (callers never pass it). Primitive enforces required-side-effects per transition edge (§4.2 invariant 7) and per-edge reason validation (§4.2 invariant 8). Remove `setCancelRequestedAt` / `setTerminalAt` as separate methods — those concerns move into `sideEffects`. | §4.1, §4.2, §8 | F1–F3, F8, F9 |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | Unconditional setter | Implement `transitionStatus` with atomic read+write; enforce terminal irreversibility; enforce write-once timestamps; validate `sideEffects` keys against transition | §4.1, §4.2 | F1–F3, F8 |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | Unconditional setter | Same as in-memory; add mutex for atomicity | §4.1, §4.2 | F1–F3, F8 |
| `packages/persistence/th-persistence/src/schema.ts` | `completedAt` only | Add `cancelRequestedAt`, `terminalAt`, `statusReason`, `postProcessingStatus`, `postProcessingError`. Keep `completedAt` for backward-compat mirror. **Do NOT add `cancelReason`** (reasoning in §8.2). | §8, §9 | F8, F11 |

### 12.2 API Layer

| File | Current State | Required Change | Contract Section | Invariants |
|------|---------------|-----------------|------------------|------------|
| `packages/api/th-api/src/routes/sessions.ts:168-196` | `handleCancelSession` writes `cancelled` + `completedAt` directly | Write `cancelling` via `transitionStatus` (including `cancelRequestedAt` in sideEffects). `statusReason` is written automatically from `reason`. **No queue.remove() call** (§7.3.1). Return disambiguated 202 response per §3.2. | §3.2, §7.3, §8 | F1, F3, F8, F10 |

### 12.3 Worker Layer

| File | Current State | Required Change | Contract Section | Invariants |
|------|---------------|-----------------|------------------|------------|
| `packages/worker/th-worker/src/processors/test-session.ts:139` | Unconditional `planning` write | Use `transitionStatus` | §4 | F1 |
| `packages/worker/th-worker/src/processors/test-session.ts:175` | Unconditional `running` write | Use `transitionStatus`; the returned `applied: true` is the only permission to start AgentLoop (§6.5.1). | §4, §6.5 | F1, F6 |
| `packages/worker/th-worker/src/processors/test-session.ts:286-300` | Cancel-poll interval started after `running`; not in `finally` | Move observer start to job accepted (BEFORE any status write); wrap entire processing pipeline in `try/finally` | §6.2, §6.6 | F6, F7 |
| `packages/worker/th-worker/src/processors/test-session.ts:325-330` | `timeout` mapped to `completed` | Map `timeout` to `failed` with reason `execution_timeout` | §4.3, §9 | F5 |
| `packages/worker/th-worker/src/processors/test-session.ts:344-354` | Terminal write AFTER post-processing; unconditional; uses `setTerminalAt` separately | Use the normative flow in §3.3: confirm execution-stop boundary; submit terminal CAS with required side-effects; if CAS loses to `cancelling`, perform cancellation convergence only after confirmed quiescence; start PP only when this CAS applied and committed PP state is `pending`; otherwise exit without PP. | §3.3, §4.4, §9, §10.3, §10.5 | F1, F2, F9, F11 |
| `packages/worker/th-worker/src/processors/test-session.ts:427-438` | Catch writes `failed` unconditionally | Use the same terminalization helper as normal results; apply cancellation precedence and execution-stop proof; CAS loss to `cancelling` follows the same follow-up convergence flow | §3.3, §4.4, §10.3 | F2, F9 |
| Processor entry (NEW) | No check for queued-cancel | Short-circuit if session already `cancelling`/`cancelled` before any setup; use §6.4/§6.5.1 worker transition flow | §6.4, §7.4 | F10 |
| Planning→running boundary (NEW) | Unconditional transition | Mandatory CAS gate; `applied !== true` means AgentLoop MUST NOT start; `currentState='cancelling'` follows cancellation convergence with quiescence proof | §6.5.1 | F6 |
| Post-processing (NEW location) | Runs BEFORE terminal write | Split: terminal CAS first; PP only after successful CAS with committed `pending`; cancelled and CAS-rejected paths invoke zero normal PP | §9.4, §10.5 | F11 |

### 12.4 Agent Layer

| File | Current State | Required Change | Contract Section | Invariants |
|------|---------------|-----------------|------------------|------------|
| `packages/agent/th-agent/src/loop.ts:508-529` | Turn-level catch has no abort branch | Check `signal.aborted` first; delegate to `classifyAbortOutcome()` for reason → outcome mapping | §5.4, §5.5 | F4 |
| `packages/agent/th-agent/src/loop.ts:495` | No post-complete abort re-check | Re-check abort via `classifyAbortOutcome()` before returning `completed` | §5.4, §5.6 | F4 |
| `packages/agent/th-agent/src/loop.ts:554-559` | `timeout` returns `{status: 'timeout'}` | Return `{status: 'failed', reason: 'execution_timeout'}` with typed `SessionStatusReason` | §4.3, §5, §9 | F5 |
| `packages/agent/th-agent/src/loop.ts:1032` (tool loop) | Continues after tool failure | Check `result.aborted`; propagate via `executeTurn.aborted` to main loop which calls `classifyAbortOutcome()` | §5.4, §5.7 | F4 |
| `packages/agent/th-agent/src/context.ts:58-64` | `AgentResult.status` has no reason field | Add `reason: SessionStatusReason` to AgentResult; REQUIRED (not optional) when `status ∈ {completed, failed, cancelled}` (R3-4 type closure) | §5 | F4, F5 |
| NEW `classifyAbortOutcome` | No single classifier | Introduce as the single AbortReason → AgentResult mapping; called from loop catch, post-complete re-check, and tool-abort propagation | §5.4 | F4 |

### 12.5 Tool Layer

| File | Current State | Required Change | Contract Section | Invariants |
|------|---------------|-----------------|------------------|------------|
| `packages/tools/th-tools/src/registry.ts:182-187` | Swallows abort as `{success: false}` | Add `aborted?: boolean` and `abortReason?: AbortReason` to ToolResult | §5.7 | F4 |

### 12.6 Queue Layer

| File | Current State | Required Change | Contract Section | Invariants |
|------|---------------|-----------------|------------------|------------|
| `packages/queue/th-queue/src/*` | No cancel-related methods | **No changes required** (§7.2). The queue's role is scheduler-only; cancellation is owned by session persistence. | §7 | F10 (via dequeue-time check in worker, not queue) |

### 12.7 Dashboard Layer

| File | Current State | Required Change | Contract Section | Invariants |
|------|---------------|-----------------|------------------|------------|
| `apps/web/th-dashboard/src/types/index.ts:1` | `SessionStatus` has `pending`, `executing`, no `cancelling` | Add `cancelling`; document `pending` as alias for `queued`, `executing` as alias for `running`. Add `PostProcessingStatus` type. | §2.5, §9 | N/A (cosmetic) |
| `apps/web/th-dashboard/src/stores/sessionStore.ts:141-156` | `cancelSession` optimistically sets `cancelled` | Optimistically set `cancelling` (not `cancelled`) | §3.2 | F1 |
| `apps/web/th-dashboard/src/types/index.ts` | No post-processing representation | Add `postProcessingStatus` to `Session` type. UI must check this field before assuming artifacts are available (§9.5). | §9 | F11 |
| UI components | No `cancelling` display | Show "Cancelling…" state for sessions in `cancelling`. Show post-processing progress indicator when `postProcessingStatus = 'running'`. | §3.4, §9.5 | N/A (cosmetic) |

---

## 13. Approval Gates

### 13.1 Decisions Requiring Explicit Approval Before Phase 2

Before any Phase 2 implementation begins, the following design decisions must receive explicit `APPROVED` verdict. Gates marked (R1–R4) were added or materially changed during review.

| Gate | Decision | Risk if wrong |
|------|----------|---------------|
| **G1** | The canonical state set is exactly `{queued, planning, running, cancelling, completed, failed, cancelled}`. | Too few states → conflation persists. Too many → unnecessary complexity. |
| **G2** | `cancelling` is a first-class public status (visible to UI and API). | If kept internal, UI loses visibility; API loses determinism. |
| **G3** | The CAS primitive signature in §4.1, with typed `TransitionSideEffects` (no generic `metadata` map), required side-effects per edge, and required per-edge reason. (R1, R2, R3) | Insufficient shape validation would permit terminal records with missing timestamps/PP state or semantically false reasons. |
| **G4** | `AbortReason` and `SessionStatusReason` are distinct closed types owned by the shared protocol/lifecycle contract package; canonical mapping is `classifyAbortOutcome(reason)`. (R2, R3, R4) | Persistence ownership could create agent→persistence coupling or dependency cycles; parallel mappings could diverge. |
| **G5** | Tool abort propagation via `aborted` flag on `ToolResult`; abort reaches `executeTurn` and the shared classifier. | Not propagating abort would leave tool-loop aborts unclassified. |
| **G6** | Queue role as scheduler-only; no `cancelled` job state; no `queue.remove()` call in cancel flow. | If queue must own cancel, this decision is wrong. If API removes job, stuck-`cancelling` returns. |
| **G7** | Schema extension with `cancelRequestedAt` + `terminalAt` + `statusReason` + `postProcessingStatus` + `postProcessingError`. `completedAt` is a temporary auto-mirror of `terminalAt`. (R1, R2, R3) | Missing lifecycle/reason fields would force facts into logs or conflate timestamps. |
| **G8** | Post-processing outcome separated from core execution outcome; explicit lifecycle `not_started | pending | running | success | partial | failed | not_applicable`; cancelled always `not_applicable` and skips normal PP. (R1–R3) | If some post-processing becomes contractually required, this decision needs revision. |
| **G9** | `pending` and `executing` aliases are compatibility boundaries only; canonical persisted states are `queued`/`running`; alias removal requires consumer audit first. | External API compatibility break. |
| **G10** | Cancellation-precedence policy (§4.4): `cancelling` + user cancel intent + quiescence → `cancelled`, NOT `failed`; ordinary worker path does not produce `cancellation_quiescence_failure`. (R1, R2) | Without this, "Cancel shows Failed" survives through unwind errors. |
| **G11** | F6: progression is authorized only by successful CAS; queued→planning CAS loss and planning→running CAS loss converge `cancelling → cancelled`; planning operations may be non-instant to unwind. (R1–R4) | Pre-read-only gates would leave race windows and stuck cancellation. |

### 13.2 Phase 2 Implementation Scope (after approval)

Phase 2 is NOT authorized yet. When authorized, scope will be:

1. **Schema migration**: add `cancelRequestedAt`, `terminalAt`, `statusReason`, `postProcessingStatus`, `postProcessingError`; keep `completedAt` as a temporary primitive-generated mirror
2. **CAS primitive**: implement in interfaces + both providers with typed `TransitionSideEffects`, required-side-effect validation, per-edge reason validation, terminal irreversibility, and P5 repository atomicity
3. **Abort taxonomy**: define shared types in `packages/protocol/th-protocol`; introduce `classifyAbortOutcome()` in `th-agent`; update AgentLoop turn catch, post-complete re-check, and tool-loop propagation
4. **Worker processor**:
   - Rewrite all status writes through `transitionStatus`
   - Treat successful CAS as the only phase-advancement permission
   - On any worker quiescence-boundary CAS rejection with `currentState='cancelling'`, converge `cancelling → cancelled`
   - Move terminal write BEFORE post-processing
   - Apply cancellation-precedence policy (§4.4) in terminal write logic
   - Fix timeout mapping (`timeout` → `failed` with reason `execution_timeout`)
   - Add queued-session check at processor entry
   - Add mandatory cancel re-check before `planning → running`
   - Wrap observer in `try/finally` covering entire processing pipeline
   - Drive post-processing through its lifecycle states; skip it for cancelled
5. **API cancel handler**: rewrite to write `cancelling` via `transitionStatus.sideEffects` (no separate `setCancelRequestedAt`); no queue.remove(); return disambiguated 202 response
6. **Queue**: **no changes** (scheduler-only role; cancel is session-persistence-owned)
7. **Dashboard types**: add `cancelling`; add `PostProcessingStatus`; optimistically set `cancelling` on cancel; preserve legacy aliases pending consumer audit
8. **Tests**: unit + integration per F1–F12, including CAS-loss convergence and CAS-rejected PP gating

**Explicitly NOT in Phase 2**: worker-startup recovery scan, liveness watchdog, automatic resolution of sessions stuck after process/DB failure. These remain deferred per §3.5.

- Retry semantics
- `paused` / `suspended` states
- Configurable polling interval
- Event-driven cancel propagation (replacing polling)
- `completedAt` removal (after all readers migrated)
- Redis/Postgres queue backend
- Liveness watchdog for stuck `cancelling` sessions (mentioned in §3.5)
- Optional sessionId → jobId reverse index for diagnostics (§7.2)

---

## Appendix A: Relation to Existing FSM Work

The codebase has prior art for state-machine discipline in `packages/agent/th-agent/src/workflow.ts`, which implements a turn-level FSM (NAVIGATE/LOGIN/TEST/REPORT) with `tryTransition()`, transition coverage tracking, and state invariants.

P5's CAS primitive operates at a DIFFERENT level:
- **Workflow FSM** = turn-level agent behavior (what the agent is doing right now)
- **Session terminal FSM** = session-level lifecycle (how the session ended)

These are orthogonal. The workflow FSM is not changed by P5. The session terminal FSM is what P5 introduces.

The implementation style (explicit transitions, invariant checks, forbidden transitions) should be consistent with the existing workflow FSM to reduce cognitive load, but the primitives are separate.

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **CAS** | Compare-and-swap. Atomic read-modify-write that succeeds only if current state matches expectation. |
| **Terminal state** | A state from which no further transitions are permitted (`completed`, `failed`, `cancelled`). |
| **Active state** | A state in which the session is still progressing (`queued`, `planning`, `running`, `cancelling`). |
| **Cancel intent** | The durable record that cancel was requested; represented by `cancelling` status + `cancelRequestedAt`. |
| **Quiescence** | The process by which the worker stops producing side effects in response to cancel intent. |
| **Terminalization** | The atomic transition from active to terminal state, including all `sideEffects` (timestamp, reason). |
| **Core execution** | The AgentLoop.run() invocation itself, excluding post-processing. |
| **Post-processing** | Enrichment steps (summary, cognition, site-profile) that run after core execution, with their own lifecycle. |
| **TransitionSideEffects** | Typed fields that travel atomically with a status transition (§4.1). |

---

## End of Document

**Status**: APPROVED / CLOSED
**Revision**: R7 (2026-09-14) — terminalization control-flow closure, explicit quiescence precondition, CAS-only lifecycle writes, and consistency synchronization
**Formal verdict**: `APPROVED`
**Next milestone**: P5 Phase 2 — Implementation Planning (AUTHORIZED)

**Production implementation remains NOT AUTHORIZED.**
