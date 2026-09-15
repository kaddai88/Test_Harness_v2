# P5 Phase 2 — Implementation Plan

**Status**: APPROVED / CLOSED
**Formal verdict**: APPROVED
**Production implementation**: NOT AUTHORIZED
**Prerequisite**: `docs/P5-TERMINAL-STATE-CONTRACT.md` — APPROVED / CLOSED (R7)
**Date**: 2026-09-14
**Revision**: R1 (implementation-plan closure fixes; formally approved)
**Next gate**: P2-G8 — Production Implementation Start (NOT YET AUTHORIZED)

---

## 1. Purpose and Boundary

This document decomposes the approved P5 terminal-state contract into an implementation sequence. It does not change the approved state machine, ownership model, or F1–F12 invariants.

Phase 2 may produce code only after a separate implementation-milestone approval. Until then:

- no production status writes may be changed;
- no schema migration may be applied;
- no AgentLoop, tool, worker, API, queue, or dashboard source may be edited;
- no dependency/configuration changes may be made under this planning milestone.

### 1.1 Approved contract being implemented

```text
queued → planning → running
                         ├→ completed
                         ├→ failed
                         └→ cancelling → cancelled
```

The implementation must preserve:

- `cancelling` as durable cancel intent, not terminal cancellation;
- CAS success as the only permission to advance lifecycle phases;
- terminal transition + required side-effects as one repository operation;
- `cancelled` only after worker-managed execution reaches the defined stop boundary;
- no normal post-processing after `cancelled`;
- post-processing only after the same worker's terminal CAS succeeds with initial state `pending`;
- all lifecycle writes through the transition primitive;
- P4 stream-generation state remaining outside session terminal ownership.

---

## 2. Current Runtime and Deployment Facts

These facts were read-only verified before planning.

### 2.1 Current composition

- `apps/server/th-server/src/app.ts:243-289` is the sole runtime composition point.
- It creates one repository aggregate with `createDatabase(dbPath)` and one in-memory queue with concurrency 4.
- It injects those exact references into both `APIServer` and `WorkerBootstrap`.
- API and worker are libraries, not independently executable packages.
- The Docker image runs one `th-server` Node process; compose has one server service (plus Ollama).

### 2.2 Queue boundary

- `packages/queue/th-queue` is an in-memory scheduler.
- Jobs, processors, and active counters are process-local Maps/fields.
- A second process would have a separate empty queue; API enqueue would not reach a separately started worker.
- P5 therefore does **not** introduce a queue split or queue backend migration.
- Cancel remains session-persistence-owned; queued cancellation is handled by worker dequeue short-circuit.

### 2.3 Repository boundary

- No database path selects process-shared durable storage by itself.
- In-memory repositories are process-local.
- JSON-file repositories load an in-memory snapshot per process, autosave periodically, and currently perform direct whole-file writes without cross-process locks or conditional updates.
- A shared JSON path is not a supported cross-process CAS backend for P5.

### 2.4 CAS coordination decision for Phase 2

Phase 2 supports the current single-process topology first:

1. Implement the transition primitive in the repository abstraction.
2. Implement provider-level atomic read/validate/mutate behavior.
3. Use a process-local mutex for JSON provider serialization as a supplementary guard.
4. Treat the repository primitive, not the mutex, as the correctness boundary.
5. Add a deployment verification gate before any API/worker process split or multi-replica deployment.

**Cross-process rule**: if API and worker are later deployed separately, the JSON provider and process-local mutex are insufficient. That future milestone must introduce a shared backend transaction/conditional update (for example, a SQL `UPDATE ... WHERE status IN (...)`) and a shared queue/claim protocol. P9 physical persistence and any deployment split are not silently pulled into P5 Phase 2.

### 2.5 Required topology gate

Before implementation approval, record one of:

- **Supported now**: one `th-server` process, one repository aggregate, one in-memory queue; process-local serialization is supplementary and repository CAS is tested.
- **Future split**: blocked until shared persistence CAS and shared queue are separately implemented and verified.

No implementation plan step may assume two independent process-local mutexes constitute one CAS.

---

## 3. Implementation Order and Phase Gates

Implementation is ordered to prevent higher layers from depending on an unverified state primitive.

### Phase 2-A — Shared lifecycle types and contract constants

**Goal**: make the approved domains available without dependency inversion.

Planned changes:

- Add `AbortReason` and `SessionStatusReason` to `packages/protocol/th-protocol` (or the already-approved shared lifecycle contract location in that package).
- Export the canonical status/reason types from protocol.
- Add the shared `PostProcessingStatus` type if it is not already present in the protocol contract.
- Update package dependency edges so `th-agent`, `th-tools`, `th-worker`, `th-api`, and `th-persistence` consume shared types as needed.
- Confirm `th-agent` does not depend on `th-persistence`; `th-tools` does not depend on `th-agent`.

**Gate A**:

- package graph has no cycle;
- typecheck passes for protocol, persistence, agent, tools, worker, and API;
- canonical reason literals are exhaustive and have no stringly-typed terminal alternative;
- no runtime behavior has changed yet.

### Phase 2-B — Persistence schema and repository transition primitive

**Goal**: establish the single lifecycle authority before changing callers.

Planned changes:

1. Extend session model/schema with:
   - `cancelRequestedAt`;
   - `terminalAt`;
   - `statusReason`;
   - `postProcessingStatus`;
   - `postProcessingError`;
   - temporary `completedAt` mirror compatibility.
2. Define `TransitionSideEffects` without generic metadata and without caller-provided `statusReason` or `completedAtCompat`.
3. Define `transitionStatus(sessionId, { expected, target, reason, sideEffects })`.
4. Implement provider validation for:
   - legal `(from, target, reason)` edge;
   - terminal irreversibility;
   - required side-effects per exact edge;
   - forbidden side-effects per exact edge;
   - write-once `cancelRequestedAt` and `terminalAt`;
   - automatic `statusReason = options.reason`;
   - automatic `completedAt = terminalAt` mirror;
   - atomic read/validate/write within the provider's supported coordination scope.
5. Keep legacy `updateStatus` only as a compatibility facade that cannot perform an unconditional lifecycle write. It must delegate to the transition primitive or be removed from runtime lifecycle paths.

**Provider scope**:

- In-memory provider: synchronous read/validate/mutate section with no intervening `await`.
- JSON provider: mutex-protected read/validate/mutate/write for the current single-process deployment; do not claim cross-process safety.
- SQLite placeholder: do not silently activate or redesign it in this milestone.

**Gate B**:

- persistence unit suite passes for all legal/illegal transition edges;
- F1, F2, F3, F8 pass against every supported provider;
- required-side-effect omission is rejected;
- `terminalAt` and mirror land together in the in-memory/JSON logical operation;
- concurrent same-process transition attempts produce one authoritative winner;
- no API/worker caller has been migrated yet, so the old runtime remains available only for controlled compatibility during the next phase.

### Phase 2-C — Agent/tool abort and execution-stop evidence

**Goal**: make AgentResult and tool abort behavior distinguishable and establish the quiescence proof boundary.

Planned changes:

- Add `reason: SessionStatusReason` to terminal `AgentResult` values.
- Introduce one shared `classifyAbortOutcome(reason: AbortReason)` mapping in `th-agent`.
- Update turn-level catch to inspect abort cause before generic failure handling.
- Add post-complete abort re-check.
- Make tool dispatch return typed `aborted` + `abortReason` data.
- Stop remaining tools and propagate abort through `executeTurn` to the single classifier.

#### 2-C.1 Normative execution-stop evidence boundary (P2-G5)

The production location of quiescence evidence is fixed before worker implementation:

```text
running: AgentLoop.run() settled + no worker-managed tool/LLM operation active
       + execution observer/abort cleanup completed
    → ExecutionStopEvidence.confirmed
queued: queued→planning CAS never applied + no planning setup started
    → ExecutionStopEvidence.never_started
planning cancel: all started planning operations returned/reached unwind boundary
       + planning→running CAS not applied
    → ExecutionStopEvidence.confirmed
```

The sole producer is the worker's unified terminalization helper, immediately after the relevant execution path settles and before it proposes `cancelling → cancelled` or any terminal transition claiming quiescence. The helper consumes evidence for normal result, catch unwind, terminal CAS loss, and queued/planning short-circuit. No API or other worker path may construct `user_cancel_quiesced` directly.

Evidence must never be created from `cancelRequestedAt`, `AbortReason=user_cancel`, `AgentResult.status='cancelled'`, a pre-read, or an active/unknown planning operation. It covers only worker-managed quiescence and does not undo external effects.

- Define an explicit worker-facing execution-stop evidence object/helper. Its contract must state:
  - no new business tool/LLM/enrichment work can begin;
  - every worker-managed operation has reached its documented stop/unwind boundary;
  - already-committed external effects are not undone;
  - `AgentResult.status === 'cancelled'` alone is not evidence.

**Gate C**:

- F4 and F5 unit/conformance tests pass;
- abort mappings cover user cancel, deadline/execution timeout, worker shutdown, and system;
- tool abort does not continue the remaining tool loop;
- quiescence evidence type and negative cases compile/test;
- **C does not claim full terminalization behavior**: worker CAS convergence, cancellation terminalization, and PP gating are deferred to 2-D/G.

### Phase 2-D — Worker processor and unified terminalization helper

**Goal**: have exactly one semantic terminalization flow for normal result, catch, queued short-circuit, and CAS conflict.

Planned changes:

1. Add cancellation observer at processor entry, before any lifecycle write.
2. Wrap the entire processor lifecycle in `try/finally` observer cleanup.
3. At dequeue:
   - inspect `cancelling`/`cancelled` before setup;
   - use the approved short-circuit path;
   - do not invent `queued → cancelled`.
4. Replace `queued → planning` and `planning → running` writes with CAS gates and check `applied === true` before continuing.
5. Build one shared semantic helper for:
   - execution result + quiescence evidence;
   - legal target/reason selection;
   - terminal CAS;
   - CAS-loss-to-cancelling follow-up;
   - terminal CAS result handling;
   - post-processing permission.
6. Route both normal AgentLoop return and outer catch through that helper.
7. Map timeout/maxTurns to `failed` + `execution_timeout`.
8. Make cancelled terminalization atomically set PP `not_applicable` and skip normal PP.
9. Start normal PP only when the original terminal CAS applied and its submitted initial PP state was `pending`.
10. Do not implement recovery watchdog or process-startup recovery scan.

**Gate D**:

- worker has no runtime lifecycle call to an unconditional status setter;
- F6, F7, F9, F10, F11 pass;
- normal completion/cancel, catch/cancel, queued cancel, planning cancel, and terminal CAS loss all use the same helper;
- terminal CAS loss with `currentState='cancelling'` converges only after quiescence evidence;
- terminal CAS loss with an existing terminal state does not rewrite or start PP;
- observer cleanup is verified on success, throw, abort, early return, and CAS rejection.

### Phase 2-E — API cancellation intent

**Goal**: make the HTTP endpoint record intent truthfully and idempotently.

Planned changes:

- Replace direct `updateStatus(..., 'cancelled')` with CAS `active → cancelling`.
- Atomically write `cancelRequestedAt` and `statusReason='user_cancel_requested'` through the primitive.
- Do not call `queue.remove()`.
- Return the disambiguated responses from the contract:
  - newly accepted;
  - already cancelling;
  - already cancelled;
  - already completed/failed with `accepted: false`;
  - unknown state fail-closed.

**Gate E**:

- API tests cover F1, F3, F8 and all response branches;
- double cancel preserves the first request time;
- API never claims terminal cancellation synchronously;
- API has no direct terminal status setter.

### Phase 2-F — Dashboard compatibility and presentation

**Goal**: expose the approved intent/terminal distinction without changing P4 stream ownership.

Planned changes:

- Add canonical `cancelling` and `PostProcessingStatus` types.
- Preserve `pending`/`executing` as compatibility aliases until consumer audit; do not remove them in P5.
- Change optimistic cancel state from `cancelled` to `cancelling`.
- Render cancelling state and PP lifecycle appropriately.
- Keep stream reducer/final commit logic independent from session terminal FSM.

**Gate F**:

- dashboard typecheck/build passes;
- existing P4 tests remain green;
- F12 regression confirms stream status cannot mutate session terminal state;
- no API consumer compatibility break is introduced.

### Phase 2-G — Implementation closure / rollout gate

**Goal**: prove all invariants, close the full-repository writer audit, and establish rollback readiness before production enablement or Phase 2 closure.

Phase 2-G occurs **after** P2-G8 implementation-start approval and after Phases 2-A through 2-F have been implemented and tested. It is not the permission to begin code edits.

Required G evidence:
- full F1–F12 verification;
- full build/typecheck/test/lint verification;
- complete lifecycle-writer inventory and static audit (see §5.8);
- supported-topology/CAS coordination verification;
- rollback readiness and operational notes.

**Phase 2-G is the closure/rollout gate**, requiring a separate approval before behavioral enablement or declaring Phase 2 closed.

---

## 4. Migration and Compatibility Strategy

### 4.1 Data compatibility

- New fields are nullable/defaulted for existing records during migration.
- Active records initialize `postProcessingStatus = not_started`.
- Existing `completedAt` remains readable and is mirrored from `terminalAt` for the compatibility window.
- No `cancelReason` field is introduced.
- Existing `pending`/`executing` values remain accepted at compatibility boundaries; new authoritative writes use canonical names only after the consumer audit gate.

### 4.2 Implementation slices are not deployable migrations

Phases 2-A through 2-F are **code/test slices**, not independently deployable runtime migrations. They may be implemented incrementally in one branch, but behavioral enablement is coordinated:

```text
A–F code can be developed incrementally
        ≠
A–F behavior can be enabled incrementally
```

Before coordinated lifecycle cutover, the old production behavior remains intact. At cutover, the API, worker normal path, worker catch path, persistence provider, and shared lifecycle types switch as one compatibility unit. Unconditional lifecycle writes cease at that boundary.

Do not deploy an intermediate state in which API uses the new CAS contract while any worker lifecycle path still uses an independent unconditional setter. If a temporary compatibility facade is required for compilation, it must be explicitly non-deployable and must delegate to the transition primitive with an explicit expected state and typed reason; the old two-argument `updateStatus(sessionId, status)` cannot be inferred or translated losslessly on its own.

### 4.3 Phase 2-A–F gates are implementation evidence gates

The gates below certify only the slice that exists at that point. They do not authorize production behavior or imply that later-layer invariants are already proven.

- **Gate B** proves persistence transition/irreversibility behavior (including the persistence portion of F3). It does **not** claim API cancel response semantics, because the API has not yet migrated.
- **Gate C** proves abort classification, tool propagation, and the evidence contract/negative cases. It does **not** claim full worker terminalization or cancellation-race behavior, which belongs to Gate D and final Gate G.
- **Gate D/E/F** prove their respective worker/API/dashboard behavior after those layers are actually migrated.

These are implementation slices, not independent rollout checkpoints. Full behavioral enablement begins only after P2-G8.

### 4.4 Rollout order

Recommended rollout:

1. shared types and compile-only changes;
2. persistence schema/provider behind tests;
3. AgentLoop/tool classification and quiescence evidence;
4. worker unified terminalization;
5. API cancellation intent;
6. dashboard presentation;
7. integrated verification;
8. enablement only after Gate G.

### 4.4 Rollback boundary

Rollback must be defined before production implementation:

- Before API/worker enablement: revert code and leave additive nullable fields unused.
- After schema migration but before new writers: old readers remain supported by `completedAt` mirror.
- After new writers are enabled: do not roll back only one writer layer; API, worker, persistence primitive, and protocol types must roll back as one compatibility unit.
- If a runtime invariant test fails, disable the new cancel path or stop rollout; do not restore unconditional status writes as a hotfix.
- Recovery of sessions left in `cancelling` by process/DB failure is deferred and requires an explicit operational/recovery procedure; it is not an automatic rollback behavior.

---

## 5. Test Matrix

### 5.1 Persistence tests (new)

Recommended location: `packages/persistence/th-persistence/src/transition-status.test.ts`.

Run against in-memory and JSON providers through a shared provider contract harness:

- legal transition table and per-edge reason validation;
- illegal `queued → cancelled` rejection;
- terminal irreversibility (F2/F3);
- cancel intent side-effects and write-once `cancelRequestedAt` (F8);
- required terminal side-effects rejected when missing (R3-3);
- automatic `statusReason` and `completedAt` mirror;
- no generic metadata side channel;
- same-process concurrent API/worker transition winner behavior (F1/F2/F3).

### 5.2 Agent/tool tests (new)

Recommended locations:

- `packages/agent/th-agent/src/cancellation.conformance.test.ts`;
- `packages/tools/th-tools/src/cancellation.conformance.test.ts` if tool behavior is tested in its own package.

Cover:

- abort in LLM stream → user cancel outcome;
- abort in tool dispatch → typed aborted result and no remaining tools;
- post-complete abort re-check;
- deadline/limit → `failed` + `execution_timeout`, never completed;
- worker shutdown/system mappings;
- typed reason exhaustiveness;
- `cancelled` AgentResult cannot be used without execution-stop evidence (F4/F5).

### 5.3 Worker tests (new/replace status suite)

Recommended locations:

- replace or extend `packages/worker/th-worker/src/test-session-status.test.ts`;
- add `packages/worker/th-worker/src/cancellation.conformance.test.ts`;
- add a focused terminalization-helper test module if the helper is extracted.

Cover:

- queued cancellation short-circuit (F10);
- queued→planning CAS loss to cancelling and follow-up terminalization;
- planning→running CAS loss and follow-up terminalization (F6);
- observer starts before planning and always stops in finally (F7);
- abort during LLM/tool and catch path (F4/F9);
- normal terminal CAS loss to cancelling and convergence (R7/F1/F9);
- terminal CAS loss to existing terminal does not rewrite or run PP;
- cancelled skips PP; completed PP failure leaves completed (F11);
- timeout maps to failed/execution_timeout (F5);
- worker does not call an unconditional lifecycle setter.

### 5.4 API tests (new)

Recommended location: `packages/api/th-api/src/routes/sessions.test.ts`.

Cover:

- newly accepted cancel returns accepted true / cancelling;
- already cancelling is idempotent;
- already cancelled reports alreadyCancelled;
- completed/failed reports accepted false / alreadyTerminal;
- unknown state fails closed;
- original `cancelRequestedAt` is preserved;
- API does not remove queue jobs or write terminal cancelled directly.

### 5.5 Dashboard and P4 regression tests

Dashboard tests currently require explicit invocation because the root test glob does not automatically include the dashboard tests and the dashboard package has no test script.

Run explicit P4/P5 dashboard tests for:

- cancelling presentation and optimistic state;
- post-processing lifecycle display;
- P4 stream status isolation (F12);
- final commit and stream reducer regressions.

### 5.6 Cross-layer race tests

These are design acceptance tests, not claims about tests already run:

| Race | Required result |
|------|-----------------|
| API cancel vs worker completed CAS | exactly one CAS winner; loser follows current-state rule |
| terminal CAS loss with cancelling | confirmed stop → cancelled; unconfirmed stop → no fake cancelled; zero PP |
| API cancel during queued→planning | planning CAS rejected; no setup; normal available path terminalizes cancellation |
| API cancel during planning→running | running CAS rejected; AgentLoop never starts |
| double cancel | first timestamp preserved; idempotent response |
| post-processing throw after completed | status remains completed; PP becomes failed |
| stream envelope status changes | session terminal state unchanged |
| two transition writers in supported topology | one repository authority determines winner |

### 5.8 Full-repository lifecycle-writer closure audit

The approved contract requires **all** production session lifecycle writes — active and terminal — to use the same transition authority. Before implementation, freeze the complete writer inventory from the Phase 0 audit plus a fresh repository-wide search. After implementation, repeat the search and inspect every hit.

Closure evidence must prove:

- no production unconditional `Session.status` writer remains;
- no runtime lifecycle path calls an independent unconditional `updateStatus`;
- any retained legacy `updateStatus` is either a safe delegate to `transitionStatus` or unreachable from lifecycle runtime;
- active-state writes (`queued → planning`, `planning → running`, `→ cancelling`) and terminal writes use the same authority;
- API, worker normal path, worker catch path, dequeue short-circuit, and any bootstrap/recovery writer are accounted for;
- the audit includes source, generated/runtime entrypoints where relevant, and package-level callsites — not only the files listed in the plan.

This is a Gate G closure check, not a new milestone. A missed lifecycle writer blocks rollout even if the F1–F12 targeted tests pass.

### 5.9 Verification commands

Focused package commands follow package scripts and root Turbo dependencies. Before implementation, verify exact package names/scripts from each `package.json`.

Expected categories:

```bash
pnpm --filter @test-harness/th-persistence test
```

```bash
pnpm --filter @test-harness/th-agent test
```

```bash
pnpm --filter @test-harness/th-worker test
```

```bash
pnpm --filter @test-harness/th-queue test
```

Explicit dashboard/P4 tests are required because they are outside the root automatic glob:

```bash
pnpm exec vitest run apps/web/th-dashboard/src/stores/p4-e2e.conformance.test.ts
```

Full verification before Gate G:

```bash
pnpm run build
```

```bash
pnpm run typecheck
```

```bash
pnpm run test
```

```bash
pnpm run lint
```

Do not claim a test pass until the command has actually run after the corresponding implementation changes.

---

## 6. Deployment and CAS Verification Gate

Before implementation approval, document the supported topology:

### Current supported topology

```text
one th-server Node process
  ├─ one APIServer
  ├─ one WorkerBootstrap
  ├─ one repository aggregate
  └─ one process-local in-memory queue
```

For this topology:

- repository CAS is still the correctness boundary;
- a process-local mutex may serialize JSON provider operations as supplementary protection;
- tests must exercise concurrent async callers through the same repository instance;
- no claim of cross-process JSON safety is permitted.

### Future split topology (not in Phase 2)

Requires all of:

- separately executable API and worker bootstraps;
- shared queue with claim/visibility semantics;
- shared durable repository backend;
- backend-enforced conditional update/transaction;
- deployment test proving two writers cannot both apply a transition.

A second process reading the same JSON file does not satisfy this gate.

---

## 7. Quiescence-Proof Implementation Gate (P2-G5)

P2-G5 is resolved in this plan at the contract/control-flow level. The concrete function name remains an implementation detail, but its unique production position and evidence shapes are fixed:

```text
worker unified terminalization helper
  ├─ running path:
  │    AgentLoop.run() settled
  │    + no worker-managed tool/LLM operation active
  │    + execution observer/abort cleanup completed
  │    → ExecutionStopEvidence.confirmed
  │
  ├─ queued path:
  │    queued→planning CAS never applied
  │    + no planning setup started
  │    → ExecutionStopEvidence.never_started
  │
  └─ planning-cancel path:
       all started planning operations returned/reached documented unwind boundary
       + planning→running CAS not applied
       → ExecutionStopEvidence.confirmed
```

**Single producer**: the worker's unified terminalization helper, immediately after the relevant execution path settles and before it proposes `cancelling → cancelled` or any terminal transition claiming quiescence.

**Consumers**: that same helper consumes evidence for normal AgentLoop return, AgentLoop/catch unwind, terminal CAS loss to `cancelling`, and queued/planning short-circuit. No API or other worker path may construct `user_cancel_quiesced` directly.

**Negative rules**: evidence MUST NOT be created from cancel intent, `AbortReason=user_cancel`, `AgentResult.status='cancelled'`, a pre-read, or an active/unknown planning operation. Evidence covers only worker-managed quiescence; it does not undo external effects.

This resolves P2-G5 as a planning gate. Gate C tests only the evidence/classification contract and negative cases. Gate D/G tests the helper's complete terminalization behavior and races.

---

## 8. Approval Gates for Phase 2 Implementation

The plan has two distinct approval boundaries:

### P2-G8 — Implementation Start Gate

P2-G8 occurs **before any production-code edit**. It requires approval of:

- P2-G1: implementation sequence and coordinated cutover strategy;
- P2-G2: current single-process topology as the only supported deployment;
- P2-G3: repository/provider CAS scope and P9 boundary;
- P2-G4: shared protocol type ownership and dependency changes;
- P2-G5: concrete quiescence-proof producer/consumer boundary defined in §7;
- P2-G6: phase-local F1–F12 test strategy and explicit dashboard test invocation;
- P2-G7: rollback boundary and compatibility policy.

P2-G8 authorizes the implementation milestone start, not production rollout or Phase 2 closure.

```text
P2-G8 approved → production implementation may begin
```

### Phase 2-G — Implementation Closure / Rollout Gate

Phase 2-G occurs **after** Phases 2-A through 2-F and their tests. It requires:

- full F1–F12 verification;
- full build/typecheck/test/lint verification;
- full-repository lifecycle-writer closure audit (§5.8);
- supported-topology/CAS coordination verification;
- rollback readiness and operational notes.

Phase 2-G is the separate approval boundary before behavioral enablement or declaring P5 Phase 2 closed. It cannot be satisfied before implementation exists.

Until P2-G8 is explicitly approved:

```text
Production code changes — NOT AUTHORIZED
```

---

## 9. Scope Exclusions

Not part of Phase 2 implementation:

- process-crash recovery scan;
- cancelling watchdog or automatic stuck-session repair;
- physical JSON atomic-write redesign (P9);
- Redis/Postgres queue backend;
- API/worker process split;
- retry semantics;
- removal of legacy dashboard aliases before consumer audit;
- P4 stream contract changes;
- unrelated persistence ownership work.

---

## 10. Final Planning State

```text
P4                       — APPROVED / CLOSED
P5 Phase 0 Audit         — APPROVED / CLOSED
P5 Phase 1 Contract      — APPROVED / CLOSED
P5 Phase 2 Plan          — APPROVED / CLOSED
P2-G1                    — APPROVED
P2-G2                    — APPROVED
P2-G3                    — APPROVED
P2-G4                    — APPROVED
P2-G5                    — APPROVED
P2-G6                    — APPROVED
P2-G7                    — APPROVED
P2-G8 Implementation Start — NOT YET AUTHORIZED
Production code          — NOT AUTHORIZED
```

The five Plan-R1 closure items are approved and do not require resubmission. The only remaining gate is P2-G8. Until explicit P2-G8 authorization:

```text
no production edits
no schema migration
no caller cutover
```
