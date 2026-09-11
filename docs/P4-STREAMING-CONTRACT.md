# P4 Streaming Contract

> **Status:** Proposed / Conditionally approved — R1 pending  
> **Milestone:** P4 Phase 0.5 — design only  
> **Baseline:** [P4-STREAMING-CONTRACT-AUDIT.md](P4-STREAMING-CONTRACT-AUDIT.md) (Phase 0 APPROVED / CLOSED)  
> **Implementation status:** worker/dashboard/WebSocket changes are not authorized

## 1. Scope and decision summary

P4 adopts **accumulated / replace** transport semantics:

```text
producer payload: accumulated
H → He → Hel → Hell → Hello
consumer reducer: replace
rendered text:    Hello
```

The existing `StreamAssembler` already produces accumulated content. P4 changes must preserve that producer contract and make the consumer and identity contract explicit.

P4 owns stream-generation transport and UI state. P5 owns authoritative session/job cancellation and terminal-state correctness. A stream status of `cancelled` does not itself set `session.status = cancelled`.

## 2. Normative envelope

Every stream progress event MUST carry a `StreamEnvelope` equivalent to:

```text
StreamEnvelope
├── sessionId
├── logicalTurn
├── generationId
├── generationOrdinal
├── seq
├── payloadMode = accumulated
├── content
└── status
    ├── streaming
    ├── completed
    ├── errored
    └── cancelled
```

Concrete field names and wire serialization can be selected during implementation, but these semantic fields cannot be omitted.

### 2.1 Identity dimensions

- `sessionId` isolates sessions.
- `logicalTurn` identifies the logical model turn, not an arrival counter or UI activity counter. Its producer and increment boundary MUST be the AgentLoop logical-turn boundary.
- `generationId` uniquely identifies one actual model request/stream generation.
- `generationOrdinal` orders generations within one session/logical turn. A retry of the same logical turn MUST receive a greater ordinal than the prior generation.
- `seq` is a producer-assigned monotonic sequence within one generation. It need not be contiguous.

Ordering is determined by:

```text
logicalTurn → generationOrdinal → seq
```

Arrival time, client receive time, random local activity ID, or wall-clock timestamp MUST NOT determine freshness or authority.

### 2.2 Payload semantics

`payloadMode = accumulated` is explicit in the contract. Every accepted content payload replaces the stored accumulated content for the same active stream key; it is never appended by the consumer.

A sequence gap is valid: receiving seq 3 and then seq 7 accepts seq 7 because the payload is an accumulated snapshot.

## 3. Producer and consumer ownership

```text
LLM/provider chunks
        ↓
StreamAssembler (accumulates provider content)
        ↓
AgentLoop assigns generation identity + producer seq
        ↓
Worker forwards StreamEnvelope
        ↓
WebSocket passes envelope without semantic reinterpretation
        ↓
Dashboard reducer validates identity/seq and replaces content
        ↓
UI renders active stream for selected session
```

### 3.1 Agent/worker producer

The AgentLoop/worker producer owns:

- generation creation and ordinal;
- logical-turn identity;
- producer sequence assignment;
- accumulated payload semantics;
- generation-local terminal status.

A retry must create a new generation even when `logicalTurn` is unchanged.

### 3.2 Transport

The worker and WebSocket transport MUST pass through the envelope fields without converting accumulated content to deltas, appending content, or replacing identity with arrival metadata.

### 3.3 Dashboard state

Dashboard state MUST be keyed by at least:

```text
sessionId + logicalTurn + generationId
```

Each session MUST have an active-stream pointer. Selecting Session A, Session B, then Session A again MUST read each session's own active stream state.

## 4. Reducer rules

For an incoming envelope:

1. Reject it if required identity fields or `payloadMode` are missing/invalid.
2. Reject it if `sessionId` is not the currently routed subscription/session when the handler is session-scoped.
3. A newer logical turn supersedes an older turn; old-turn packets MUST NOT overwrite newer active state.
4. For the same logical turn, a greater `generationOrdinal` supersedes an older generation; old-generation packets MUST NOT overwrite the newer generation.
5. For the same generation:
   - `seq > stored.seq` → accept and **replace** accumulated content;
   - `seq == stored.seq` + identical content/status → ignore as idempotent duplicate;
   - `seq == stored.seq` + different content/status → ignore and retain protocol-violation diagnostic;
   - `seq < stored.seq` → ignore as late/out-of-order.
6. A seq gap is accepted.
7. Once a generation is terminal, later partial events for that same generation are ignored.
8. A greater generation ordinal may start normally after an errored/cancelled generation.
9. A terminal event for an old generation MUST NOT terminate or mutate a newer generation.
10. Reducer updates MUST replace accumulated content; `+=` is forbidden for accumulated payloads.

## 5. Retry and reconnect semantics

### 5.1 Retry

```text
S / T17 / G1 / ordinal=1
        ↓ failure before logical turn advances
S / T17 / G2 / ordinal=2
```

G2 is a new generation. Once G2 is active, late G1 packets cannot overwrite it. Same-turn retries may still receive context associated with the same logical turn, but stream generation identity remains distinct.

### 5.2 Reconnect

Replayed envelopes are idempotent:

```text
stored S/T17/G2/seq=14/content=Hello world
replayed S/T17/G2/seq=14/content=Hello world
→ ignore
```

A reconnect carrying a newer accumulated snapshot replaces the stored content:

```text
stored seq=9
replayed seq=14/content=Hello world
→ replace
```

No character-offset or append-count recovery is permitted.

### 5.3 Session switching

Session state is isolated by `sessionId`. An event from Session A MUST NOT mutate Session B's stream or active pointer. UI selection changes do not clear or merge stored streams for other sessions.

## 6. Stream → Final Assistant Message Handoff

A completed stream and the final assistant message are two representations of the same generation and MUST have an explicit handoff contract.

`FinalAssistantCommit` MUST identify:

```text
sessionId
logicalTurn
generationId
```

The generation's `generationOrdinal` and final `seq` MUST also be available at the normalization boundary so a consumer can verify that the commit belongs to the active generation.

For the active generation:

```text
stream terminal/completed accumulated content = "Hello"
final assistant commit content = "Hello"
        ↓
render exactly one final "Hello"
retire/hide the corresponding streaming presentation
retain the final assistant message as ordinary history
```

The reducer MUST NOT render the same final content simultaneously as both active stream overlay and final assistant message. Handoff is an identity transition, not an append operation.

A final commit for a stale generation MUST NOT retire, overwrite, or mutate a newer generation:

```text
T17/G1 terminal or final commit arrives after T17/G2 is active
        ↓
G2 remains unchanged
```

A final commit with missing or invalid generation identity is not eligible to retire or overwrite any authoritative stream state.

## 7. Terminal sequence semantics

`seq` orders the entire generation event stream, including content and status transitions; it is not only a text-change counter.

Every observable status transition MUST use a strictly greater sequence:

```text
seq=14, status=streaming, content="Hello"
seq=15, status=completed, content="Hello"
        → valid terminal transition
```

The following is invalid and MUST be ignored/diagnosed:

```text
seq=14, status=streaming, content="Hello"
seq=14, status=completed, content="Hello"
```

The same rule applies to `errored` and `cancelled`. A terminal event with unchanged content still consumes a new sequence. Once terminal, later same-generation partial/status events cannot change the generation.

## 8. Incomplete envelope policy

P4 v1 stream state requires a complete, recognized envelope:

```text
sessionId
logicalTurn
generationId
generationOrdinal
seq
payloadMode = accumulated
content
status
```

An incoming event missing or carrying an unknown/invalid required identity or contract field MUST:

```text
not mutate authoritative P4 stream state
not create an active generation
not infer a generation from the current UI/session
be retained only as a diagnostic/audit event where appropriate
```

Legacy `{ sessionId, turn, partial, done }` events are not P4 v1 state updates. If a short-lived compatibility adapter is required during migration, it belongs at the transport normalization boundary and MUST produce a complete valid v1 envelope before the reducer sees it. The reducer MUST NOT perform ad hoc fallback.

Unknown `payloadMode`, status, generation ordinal, or sequence is likewise rejected. A missing `generationId` cannot be replaced with a local random activity ID for authority purposes.

## 9. Invariant matrix S1-S18
|---|---|---|
| S1 | accumulated `H → He → Hello` | rendered content is `Hello`, never `HHeHello` |
| S2 | same-generation duplicate | idempotent; no content duplication |
| S3 | same-generation lower seq | ignored as late/out-of-order |
| S4 | seq gap | newer accumulated snapshot accepted |
| S5 | newer logical turn | old-turn packet cannot overwrite |
| S6 | newer generation in same turn | old generation packet cannot overwrite |
| S7 | Session A/B simultaneous streams | isolated by sessionId |
| S8 | UI A → B → A | each active stream retained independently |
| S9 | reconnect duplicate replay | ignored idempotently |
| S10 | reconnect newer snapshot | replaces to latest accumulated content |
| S11 | terminal generation then partial | later same-generation partial ignored |
| S12 | errored/cancelled generation then higher generation | higher generation allowed by P4 stream reducer; P5 controls session permission |
| S13 | old-generation terminal after new generation starts | cannot terminate/mutate new generation |
| S14 | stream terminal status | does not decide authoritative session completed/failed/cancelled |
| S15 | active G2 stream + final assistant commit for G2 | final message is authoritative, corresponding stream presentation retires, and content renders once |
| S16 | active G2 + stale final commit for G1 | G2 remains unaffected; G1 cannot retire or overwrite G2 |
| S17 | same content with streaming → completed | terminal event uses a greater seq and is accepted once |
| S18 | missing/unknown generation metadata | event cannot update authoritative P4 stream state; diagnostic/audit only |

## 10. Acceptance gates before implementation

P4 Phase 1 may begin only after approval of:

1. accumulated/replace payload contract;
2. identity tuple and generation ordering;
3. producer seq and gap/duplicate policy;
4. retry/reconnect/session-switch/late-event rules;
5. generation-local terminality versus P5 session terminality;
6. S1-S18 matrix;
7. explicit classification of the current `turn` field as AgentLoop logical turn;
8. no change to P5 cancellation or P6 persistence.

Approval authorizes a separate implementation plan; it does not authorize code changes automatically.
