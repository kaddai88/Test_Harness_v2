# P4 Streaming Implementation Plan

> **Status:** Conditionally approved — Plan-R1 pending  
> **Milestone:** P4 Phase 1 — implementation planning only  
> **Design baseline:** [P4-STREAMING-CONTRACT.md](P4-STREAMING-CONTRACT.md) (APPROVED / CLOSED)  
> **Code status:** no streaming production-code changes are authorized until this plan is approved

## 1. Scope

### In scope

- Protocol/wire type for accumulated stream envelopes and final assistant commits.
- AgentLoop generation identity, generation ordinal, and per-generation sequence allocation.
- Worker and WebSocket envelope propagation without semantic transformation.
- Dashboard transport normalization and per-session/per-generation replace reducer.
- Final assistant-message handoff and idempotency.
- Narrow legacy envelope normalization boundary.
- S1–S18 conformance coverage and end-to-end integration validation.

### Out of scope

- P5 session/job cancellation and terminal-state FSM.
- P6 persistence ownership or durable stream replay storage.
- Changing `StreamAssembler` from accumulated to delta.
- Broad UI redesign, context/window management, or unrelated dashboard behavior.
- P2-E/P3 changes, repository hygiene, auth, or network policy.

## 2. Frozen P4 contract

```text
payloadMode = accumulated
consumer mutation = replace
freshness = logicalTurn → generationOrdinal → seq
generation identity = generationId
session isolation = sessionId
retry = new generation
reconnect = idempotent accumulated replay
terminality = generation-local
final handoff = generation-bound FinalAssistantCommit
legacy/incomplete envelope = normalize at boundary or reject
session/job terminal FSM = P5
```

`generationOrdinal` is authoritative only within `(sessionId, logicalTurn)`. `generationId` identifies a generation but does not order generations. `seq` orders the complete generation event stream, including status transitions; terminal events require a greater sequence.

## 3. Current implementation gap

- `StreamAssembler.partialContent` is accumulated.
- AgentLoop emits accumulated `partialContent` without generation ID/ordinal/seq.
- Worker forwards `partial` with session/turn only.
- WebSocket is pass-through.
- Dashboard has one global `streamText` and appends incoming accumulated text.
- No final assistant commit event/normalizer exists.
- Existing `{sessionId, turn, partial, done}` payloads are incomplete under P4 v1.

## 4. Target ownership and data flow

```text
LLM provider chunks
        ↓
StreamAssembler (accumulated only)
        ↓
AgentLoop stream-generation owner
  ├── logicalTurn
  ├── generationId
  ├── generationOrdinal
  └── seq (content and terminal events)
        ↓
P4 StreamEnvelope / FinalAssistantCommit
        ↓
Worker forwards unchanged
        ↓
WebSocket forwards unchanged
        ↓
Dashboard transport normalizer validates complete v1 envelope
        ↓
per-session/per-turn/per-generation reducer
        ↓
active stream pointer + final committed assistant presentation
```

### 4.1 Single producer owner (G1)

The AgentLoop stream-generation owner is the only component allowed to allocate or advance `logicalTurn`, `generationId`, `generationOrdinal`, and `seq`.

- Worker, WebSocket, and Dashboard MUST transport/consume these fields unchanged.
- `generationOrdinal` is ordered only within `(sessionId, logicalTurn)`.
- `seq` is ordered only within one generation and includes content and terminal status transitions.
- Terminal events and final assistant commits use the same generation identity and producer-owned ordering context.
- No downstream component may generate a replacement ID, client sequence, or arrival-time ordering surrogate.

### 4.2 Logical-turn mapping gate (G2)

Before Phase 1A is complete, implementation MUST prove whether existing AgentLoop `turnNumber` is the frozen P4 `logicalTurn`:

```text
same logical request retry
→ logicalTurn SAME
→ generationOrdinal increases

new logical turn
→ logicalTurn increases
→ generationOrdinal namespace starts fresh
```

If current `turnNumber` increments on retry, it MUST NOT be reused as `logicalTurn`; Phase 1A must introduce an explicit logical-turn field/allocator. The mapping and increment boundary require a conformance test before producer fields are emitted.

No layer may infer logical-turn identity merely because a field is named `turn`.

### 4.3 Transport/version rollout gate (G3)

P4 v1 uses explicit `streamContractVersion = 1` at the transport normalization boundary. The reducer accepts only complete normalized v1 envelopes and never guesses missing legacy identity fields.

The rollout sequence is:

```text
Phase A: ship protocol types + normalization support; legacy producer path remains available
Phase B: ship Dashboard v1 reducer/normalizer while legacy events normalize safely or are rejected
Phase C: enable v1 producer envelopes
Phase D: after compatibility evidence, review legacy normalization retirement separately
```

If deployment is proven strictly atomic across worker, transport, and web, a coordinated cutover MAY replace this sequence, but that assumption must be documented and tested. The reducer MUST NOT contain ad hoc legacy fallback.

### 4.4 Reconnect recovery source gate (G4)

P4 must explicitly choose a replay source before claiming runtime reconnect recovery:

- **Preferred:** worker/server retains the latest envelope per active generation and replays it on reconnect/session hydration; or
- **Equivalent:** an existing session hydration source supplies the same complete envelope; or
- **Bounded v1:** only idempotent reducer handling is guaranteed, and loss recovery is explicitly out of scope.

S9/S10 therefore require reducer tests plus a source/replay integration test if runtime reconnect recovery is claimed. No client offset or append-count inference is allowed.

No implementation phase may begin until G1–G4 are satisfied.

## 5. Implementation sequence

### Phase 1A — Protocol types and producer primitives

Files:

- `packages/protocol/th-protocol/src/events.ts`
- `packages/protocol/th-protocol/src/index.ts`
- `packages/agent/th-agent/src/loop.ts`
- focused protocol/agent tests

Tasks:

1. Define typed `StreamEnvelope` semantics: sessionId, logicalTurn, generationId, generationOrdinal, seq, payloadMode, content, status.
2. Define generation-local status union: streaming/completed/errored/cancelled.
3. Define generation allocator owned by the AgentLoop request boundary.
4. Define per-generation seq allocator; every emitted content/status event consumes the next seq.
5. Define `FinalAssistantCommit` with sessionId/logicalTurn/generationId/generationOrdinal/finalSeq/content.
6. Ensure a retry of the same logical turn receives a new generation and greater ordinal.
7. Keep `StreamAssembler` accumulated semantics unchanged.

Gate: protocol types compile; producer primitives have unit tests; no worker/dashboard behavior changes yet.

### Phase 1B — Worker/WebSocket envelope propagation

Files:

- `packages/worker/th-worker/src/processors/test-session.ts`
- `packages/api/th-api/src/websocket.ts`
- protocol event consumers/tests

Tasks:

1. Map AgentStreamChunkEvent to complete P4 `StreamEnvelope` without converting accumulated content.
2. Forward identity, payloadMode, seq, and status unchanged through worker broadcast.
3. Emit/forward generation-bound `FinalAssistantCommit`.
4. Preserve sessionId on every event.
5. Do not add arrival timestamps as ordering authority.
6. Treat missing/invalid producer metadata as a producer/transport diagnostic, not as a reducer fallback.

Gate: worker/transport propagation tests verify field preservation and no payload transformation.

### Phase 1C — Dashboard normalization and reducer

Files:

- `apps/web/th-dashboard/src/api/websocket.ts`
- `apps/web/th-dashboard/src/stores/sessionStore.ts`
- `apps/web/th-dashboard/src/types/index.ts`
- dashboard tests

Tasks:

1. Normalize wire events at the WebSocket boundary into a complete typed v1 envelope.
2. Reject legacy/incomplete/unknown envelopes before reducer mutation; retain diagnostic only.
3. Replace global `streamText` with per-session/per-turn/per-generation stream records containing generationOrdinal, latestSeq, content, and status.
4. Maintain `activeStreamBySession` with logicalTurn/generationId/generationOrdinal.
5. Implement lexicographic freshness: turn → ordinal → seq.
6. For same generation, replace accumulated content only when seq is greater.
7. Ignore idempotent duplicates, protocol violations at same seq, lower seq, old turns, and old generations.
8. Accept seq gaps.
9. Keep session switching isolated.

Gate: S1–S14 and S18 pass in dashboard reducer/normalizer tests.

### Phase 1D — Final assistant handoff

Files:

- `packages/agent/th-agent/src/loop.ts`
- worker event bridge
- dashboard reducer/UI types and tests

Tasks:

1. Emit final assistant commit bound to the generation that produced the response.
2. Final commit content is the authoritative final presentation; it need not equal the latest provisional stream content.
3. For active generation, retire/hide stream presentation and render one final assistant message.
4. FinalAssistantCommit is idempotent: same generation + same final seq + same content is ignored as a duplicate; same generation + same final seq + different content is a protocol violation and MUST NOT create a second assistant message.
5. Stale generation final commit cannot retire or overwrite newer generation.
6. Terminal stream status and final assistant handoff remain generation-local; do not set authoritative session status (P5).

Gate: S15–S17 pass plus final-message duplicate/stale-generation tests.

### Phase 1E — Legacy normalization and end-to-end closure

Files:

- transport normalization boundary
- existing dashboard/worker tests
- new end-to-end harness tests

Tasks:

1. Keep legacy payload handling outside the reducer.
2. If legacy compatibility is required, normalize only when all v1 identity/order fields can be supplied by an authoritative source; otherwise reject/fail closed.
3. Do not synthesize generationId, generationOrdinal, or seq from local arrival metadata.
4. Verify P4 runtime does not silently re-enable the old global append path.
5. Preserve P5 session/job status ownership.
6. Confirm no legacy event is allowed to mutate authoritative v1 stream state without normalization.

Gate: S1–S18 and compatibility tests pass; final diff and scope review complete.

## 6. S1–S18 test mapping

Each case must be tested at the stated layer; S9/S10 are not satisfied by reducer-only fixtures if the implementation claims runtime replay.

| Contract case | Primary implementation gate |
|---|---|
| S1 accumulated → rendered final | 1C, 1D |
| S2 same-generation duplicate | 1C |
| S3 lower seq ignored | 1C |
| S4 seq gap accepted | 1C |
| S5 old turn cannot overwrite | 1C |
| S6 old generation cannot overwrite | 1C |
| S7 session isolation | 1C |
| S8 UI A/B/A retention | 1C |
| S9 reconnect duplicate | 1C; plus source/replay integration test if runtime replay is claimed |
| S10 reconnect newer snapshot | 1C; plus source/replay integration test if runtime replay is claimed |
| S11 terminal then partial ignored | 1C |
| S12 higher generation after error/cancel | 1A, 1C; P5 controls session permission |
| S13 stale old-generation terminal | 1C, 1D |
| S14 stream terminal ≠ session terminal | 1D |
| S15 active final commit retires stream once | 1D |
| S16 stale final commit cannot affect newer generation | 1D |
| S17 terminal status uses higher seq | 1A, 1C |
| S18 incomplete/unknown envelope rejected | 1B, 1C |

Every case must be executable and pass before its owning phase is complete. Tests must assert state mutations and rendered content, not only event receipt.

## 7. Compatibility and migration constraints

- `StreamAssembler` remains accumulated.
- Existing P3/P2-E behavior is unchanged.
- No reducer fallback from missing v1 metadata to `sessionId`/turn/current UI state.
- Legacy payload compatibility, if needed, is a transport normalization concern only.
- `generationId` and `generationOrdinal` are not generated by Dashboard.
- P4 stream `cancelled`/`errored` statuses do not directly mutate session/job terminal status.
- No P6 persistence changes are included; reconnect replay semantics are in-memory/transport contract only unless separately approved.

## 8. Rollout and rollback boundary

P4 implementation must first run in test/harness validation with the new envelope emitted and reducer receiving normalized events. Activation strategy should be explicit:

1. Add protocol and producer fields.
2. Verify worker/transport pass-through.
3. Enable normalized reducer for a controlled environment.
4. Observe duplicate/late/rejected-envelope diagnostics.
5. Expand only after S1–S18 and compatibility checks pass.

Rollback must not mix contracts within one active stream generation. An active v1 stream is drained/retired at a generation boundary before reverting to a legacy consumer. P5 owns session cancellation if rollback requires cancellation.

## 9. Acceptance gates

Before P4 Phase 1 is marked complete:

- [ ] Protocol envelope and final commit types compile.
- [ ] AgentLoop generates generation identity/ordinal and seq correctly.
- [ ] Worker/WebSocket preserve envelope fields.
- [ ] Dashboard normalizer rejects incomplete/unknown envelopes.
- [ ] Dashboard replaces accumulated content rather than appending it.
- [ ] Session/turn/generation isolation works.
- [ ] Duplicate, late, out-of-order, gap, and reconnect policies pass.
- [ ] Final handoff is generation-bound and idempotent.
- [ ] Terminal seq is greater than all prior generation events.
- [ ] P5 session terminal semantics remain untouched.
- [ ] S1–S18 pass.
- [ ] Existing relevant tests pass.
- [ ] Typecheck and package-level tests pass.
- [ ] Final diff contains no P5/P6/unrelated UI changes.

## 10. Explicitly not authorized by this plan

- Direct production-code changes before plan approval.
- P5 cancellation/terminal FSM.
- P6 stream persistence/replay storage.
- Broad WebSocket routing/auth redesign.
- Dashboard visual redesign.
- Changing accumulated producer semantics to delta.
