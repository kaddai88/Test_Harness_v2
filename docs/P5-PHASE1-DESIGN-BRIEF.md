# P5 Phase 1 — Terminal-State Contract Design Brief

**Status**: APPROVED / CLOSED (design only — production code NOT YET AUTHORIZED)
**Created**: 2026-09-14
**Based on**: `docs/P5-PHASE0-AUDIT.md` (APPROVED / CLOSED)
**Produced design**: `docs/P5-TERMINAL-STATE-CONTRACT.md` (APPROVED / CLOSED, R7)
**Next milestone**: `docs/P5-PHASE2-IMPLEMENTATION-PLAN.md` (planning authorized; production implementation remains unauthorized)
**Review status**: R0–R6 received CHANGES REQUIRED; R7 approved.

---

## Purpose

This brief is the authoritative mandate for P5 Phase 1. The design document produced under this phase must address every section, hard contract, and invariant listed below. Implementation work is explicitly out of scope until the design document is reviewed and approved.

---

## Core Insight (from Phase 0)

The current system conflates three distinct concepts that must be separated:

```
1. Control intent
   → Cancel requested

2. Execution stopping
   → Abort / worker quiescence

3. Persisted finality
   → cancelled / completed / failed
```

Example: today the API does `POST cancel → session.status=cancelled → completed_at=now`, but the worker may still be planning/running and producing side effects. "DB shows cancelled" and "execution actually stopped" are NOT the same fact.

---

## 7 Hard Contracts (must all be addressed in design)

### 1. Single terminal transition authority

Not necessarily "only one module can call" — rather, ALL writers must go through the same atomic transition primitive:

```ts
transitionSessionState(
  sessionId: string,
  expectedStates: SessionStatus[],
  targetState: SessionStatus,
  reason: TransitionReason
) → { applied: true } | { applied: false; currentState: SessionStatus }
```

Example rules:
- `running → completed` ONLY IF current == running
- `running/cancelling → cancelled` ONLY IF transition contract permits
- `cancelled → failed` NEVER
- `cancelled → completed` NEVER

API, worker normal result, worker catch MUST NOT call bare `updateStatus(...)` anymore.

### 2. Cancellation intent vs terminal state

Preferred model:

```
queued / planning / running
      ↓ user cancel accepted
cancel_requested / cancelling
      ↓ worker observes + aborts + stops execution
cancelled
```

API returns `cancel accepted`, not `execution already cancelled`.

If a public intermediate status is undesirable, at minimum introduce independent durable fields:
- `cancelRequestedAt`
- `cancelRequestedBy`

Terminal `cancelled` is produced AFTER worker confirms execution stopped.

This also naturally resolves R1 (timestamp clobbering):
- `cancelRequestedAt` → user's actual click/request time
- `terminalAt` / `completedAt` → worker's actual stop time

Do not let one field carry two facts.

### 3. All terminal states are irreversible

Explicit state set (minimum):
```
queued
planning
running
cancelling

completed
failed
cancelled
```

`timeout` MUST be explicitly handled — either as independent terminal state `timed_out`, or as `failed` with `reason = timeout`.

MUST NOT continue:
```
maxTurns exhausted → completed
```
This disguises "did not achieve goal, hit resource ceiling" as success.

### 4. Abort classification by cause, not exception shape

AgentLoop must check:
1. `signal.aborted?`
2. `abort reason?` (typed)

Before entering generic exception classification.

Minimum taxonomy:
```
user cancellation → cancelled path
timeout/deadline abort → timeout/failed(timeout)
ordinary exception → failed
```

Do NOT:
```
catch AbortError → cancelled
```

Because the same AbortController may later be used for deadline, shutdown, etc. Abort source should carry typed reason:
```
user_cancel | deadline | worker_shutdown | ...
```

### 5. Cancellation observation covers planning phase

R5 finding: planning phase has no cancel detection.

Contract requires cancellation watcher lifecycle covers the ENTIRE processor:

```
job accepted
→ start cancellation observation
→ planning
→ running
→ post-run
→ finally stop watcher
```

All exit paths (success / failure / abort / throw / early return) MUST release the interval/listener in `finally`.

Phase 1 design may defer polling vs event-driven decision, but the observation window MUST start at processing lifecycle begin, not after `running` is written.

### 6. Queue role clarity

Queue is currently bypassed by cancel. Cleanest design is likely:

```
Session persistence → cancellation / terminal authority
Queue               → scheduling substrate
```

But two cases must be covered:

**Case A**: job still queued + user cancels
→ job MUST NOT later begin normal execution

**Case B**: job already running + user cancels
→ AbortSignal

At minimum, need a correlation: `sessionId ↔ jobId`, OR worker must check durable cancellation intent before dequeue.

Phase 1 must choose:
- cancel queued job / remove from queue; OR
- keep queue job, but worker short-circuits on dequeue

"Absolutely no contract" is not acceptable.

### 7. Post-processing failure does not reverse successful core execution

R4 finding:
```
AgentLoop completed successfully
→ report/cognition/summary post-processing throws
→ session failed
```

Must be explicitly designed. Most reasonable model:

```
execution outcome           (primary, immutable after terminalization)
post-processing outcome     (secondary, can fail independently)
```

Example: if core task is `completed`, report-generation failure can be recorded as:
- `session.status = completed`
- `warning = post_processing_failed`

NOT:
- `completed → failed`

UNLESS the post-processing itself is defined in the product contract as "necessary part of task completion". Phase 1 must make this explicit.

---

## 12 Invariants (F1–F12) — must be in the invariant matrix

| # | Invariant |
|---|-----------|
| F1 | cancel accepted while active → later completed cannot overwrite cancellation path |
| F2 | cancelled terminal → failed/completed transition rejected |
| F3 | completed terminal → later cancel does not rewrite completion; API returns already-terminal result |
| F4 | user abort during LLM/tool execution → cancelled, not failed |
| F5 | deadline/maxTurns → never completed |
| F6 | cancel during planning → observed before execution proceeds materially |
| F7 | cancellation watcher → always cleaned in finally |
| F8 | double cancel → idempotent; original cancelRequestedAt preserved |
| F9 | worker exception after cancellation request → cannot overwrite cancellation terminalization |
| F10 | queued cancelled session → cannot later begin normal execution |
| F11 | post-processing exception after successful core run → obeys explicit post-processing policy; never accidental generic overwrite |
| F12 | P4 stream-generation cancelled/errored/completed → cannot directly set session terminal state |

F12 specifically protects the P4 boundary that was just closed.

---

## Required Document Structure (13 sections)

```
1.  Scope / current failures
2.  Session state machine
3.  Cancellation intent vs terminal cancellation
4.  Atomic transition/CAS contract
5.  Abort reason taxonomy
6.  Worker cancellation-observation lifecycle
7.  Queue interaction contract
8.  Terminal timestamp ownership
9.  Core execution vs post-processing outcome
10. Retry/idempotency semantics
11. Invariant matrix (F1–F12)
12. Current implementation mapping
13. Approval gates
```

### Section 8 (terminal timestamp) guidance

Current schema has only `completed_at`. Phase 1 must decide:
- Expand schema to include `cancelRequestedAt` + `terminalAt`; OR
- Store cancel request time in metadata

Do NOT continue letting one field carry two facts.

---

## Authorization Boundary

### AUTHORIZED (Phase 1 scope)
- Design state machine (including whether to introduce `cancelling` / `cancel_requested` intermediate state)
- Define cancellation intent vs terminal cancellation semantic boundary
- Define CAS primitive signature and semantics
- Define abort reason taxonomy
- Define queue/cancel relationship
- Define terminal timestamp policy
- Define F1–F12 invariant matrix
- Produce the 13-section design document

### NOT AUTHORIZED (still blocked on design approval)
- Production status writes
- AgentLoop catch changes
- Polling / cancel-observation changes
- Queue changes
- Schema migration
- Any edits to `packages/persistence/...`, `packages/api/...`, `packages/worker/...`, `packages/agent/...`, `packages/queue/...`

---

## Exit Criteria for Phase 1

Phase 1 closes when:
1. 13-section design document is complete
2. All 7 hard contracts have an explicit design decision
3. All 12 invariants (F1–F12) have a formal statement and a verification strategy
4. Current implementation mapping (section 12) identifies every code site that must change
5. Approval gates (section 13) are explicit about what requires user approval before Phase 2 implementation begins

---

## References

- Phase 0 audit: `docs/P5-PHASE0-AUDIT.md`
- P4 frozen contract: `project-roadmap-status` memory
- FSM prior art: `fsm-improvements` memory
