# P4 Phase 1E Closure and Legacy Ownership

> **Status:** Complete / Awaiting review  
> **Scope:** P4 streaming E2E closure and ownership classification. No P5/P6 work.

## Full-chain evidence

```text
AgentLoop StreamEnvelope v1
  → worker stream activity mapping
  → WebSocket JSON transport/normalization
  → dashboard normalized reducer
  → generation-bound FinalAssistantCommit
  → final presentation state
```

The verified path preserves accumulated payload semantics and producer-owned identity/order fields. The actual reconnect replay source is not implemented in this milestone; P4 guarantees correct handling when a duplicate/newer replayed envelope arrives, not guaranteed recovery after connection loss.

## E1-E6 evidence

- E1: `H → He → Hello` through normalization/reducer/final handoff renders one committed `Hello`.
- E2: Session A and B stream/final state remain isolated.
- E3: late G1 packet/commit cannot affect active G2.
- E4: duplicate, lower sequence, and sequence-gap behavior remains correct through normalization and reducer.
- E5: completed envelope precedes matching final commit; final content retires only its generation's provisional presentation.
- E6: errored/cancelled generation final commits are rejected and produce no final presentation.

## Legacy ownership classification

### A — P4 v1 authoritative runtime

- AgentLoop `StreamEnvelope` producer state.
- Worker pass-through `streamEnvelope` field.
- Dashboard `StreamEnvelope` normalizer and per-session/per-generation reducer.
- Generation-bound `FinalAssistantCommit` normalization and reducer.
- `streamState` and `streamsBySession` authoritative presentation state.

### B — Active legacy compatibility

- Activity fields `partial`, `done`, and `turn` during the migration window.
- Legacy-only activity presentation behavior where no v1 envelope is present.
- Existing `streamText` compatibility selector consumed by current `SessionDetail` UI; it is derived from selected v1 active state and is not authoritative storage.

### C — Diagnostics only

- Reducer protocol-violation diagnostics.
- Invalid/incomplete envelope rejection diagnostics.
- Existing activity timestamps/local activity IDs for display/audit only; they are not freshness authority.

### D — Migration/compatibility

- Transport-boundary legacy envelope recognition/rejection behavior.
- Compatibility tests and old activity shape support until the coordinated cutover review.

### E — Dead/unreachable

No P4 legacy item is proven dead in this milestone. Legacy-only activity remains an intentional compatibility path until Phase 1E/cutover evidence proves it unused. No deletion is authorized from this classification alone.

## Terminal and reconnect boundary

- `StreamEnvelope(status=completed)` closes a generation-local stream lifecycle.
- `FinalAssistantCommit` commits final presentation only for the matching completed generation.
- Stream terminal status never sets session/job terminal state; P5 owns that FSM.
- Reducer handles replayed duplicate/newer envelopes idempotently/correctly.
- A replay source/cache is not claimed; guaranteed loss recovery remains explicitly deferred.

## Closure constraints

- No P5 cancellation changes.
- No P6 persistence changes.
- No broad legacy deletion.
- No dashboard visual redesign.
