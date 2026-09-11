# P4 Phase 0 — Streaming Contract Audit

> **Status:** Audit complete / awaiting review  
> **Scope:** read-only trace of LLM stream → AgentLoop → worker event → WebSocket → dashboard store → rendered text. No streaming code changes authorized.

## 1. Executive finding

The current producer/consumer contract is mismatched:

```text
AgentLoop / StreamAssembler:
  emits accumulated partial content
  H → He → Hel → Hell → Hello

Worker:
  forwards `partial` unchanged in `agent:activity`
  includes sessionId and turn, but no generation/request identity

WebSocket:
  pass-through JSON broadcast

Dashboard sessionStore:
  appends each partial to one global streamText
  streamText = streamText + activity.partial

Result:
  HHeHelHellHello
```

This is the original P4 streaming risk. The current implementation does not yet establish a safe delta/accumulated contract.

## 2. Trace by layer

### 2.1 LLM → AgentLoop

**Files:**

- `packages/agent/th-agent/src/loop.ts`
- `packages/agent/th-agent/src/assembler.ts`
- `packages/protocol/th-protocol/src/llm.ts`

`StreamAssembler.push()` appends each `content` chunk to `contentParts`; `partialContent` returns `contentParts.join("")`. Therefore the AgentLoop stream event receives an **accumulated** string, not a delta.

The AgentLoop emits `AgentStreamChunkEvent` with:

```text
sessionId
turnNumber
partialContent: assembler.partialContent
chunkCount/toolCallCount
 done
```

The current event does not include a request/generation identity or a monotonically increasing stream sequence.

### 2.2 AgentLoop → worker

**Files:**

- `packages/worker/th-worker/src/processors/test-session.ts`
- `packages/protocol/th-protocol/src/events.ts`

The worker subscribes to `AgentStreamChunkEvent` and broadcasts:

```text
agent:activity {
  sessionId,
  kind: "stream",
  partial: d.partialContent,
  done: d.done,
  turn: d.turnNumber,
  timestamp
}
```

The worker does not transform accumulated content into deltas, and does not add generation/request/sequence identity.

### 2.3 Worker → WebSocket

**Files:**

- `packages/worker/th-worker/src/processors/test-session.ts`
- `packages/api/th-api/src/websocket.ts`

The WebSocket handler serializes and broadcasts the event without changing payload semantics. It does not add ordering, deduplication, session routing, turn generation, or reconnect replay semantics.

### 2.4 WebSocket → dashboard handler

**Files:**

- `apps/web/th-dashboard/src/api/websocket.ts`
- `apps/web/th-dashboard/src/types/index.ts`

The client parses flat WebSocket messages and maps the stream event to `AgentActivity`:

```text
partial: string
turn: number
done: boolean
sessionId?: string
```

There is no request/generation ID, stream sequence, or event ID from the producer. The client creates a random local activity ID, which cannot provide cross-reconnect deduplication or ordering guarantees.

### 2.5 Dashboard handler → sessionStore reducer

**File:** `apps/web/th-dashboard/src/stores/sessionStore.ts`

Current reducer:

```text
if activity.kind === "stream" && activity.partial:
  streamText = streamText + activity.partial
```

`streamText` is a single global string, not keyed by:

```text
sessionId + turn + generation/request identity
```

`turn_started` resets the global string, but late packets, reconnects, session switching, duplicate events, and out-of-order delivery are not guarded.

### 2.6 Store → rendered UI

**File:** `apps/web/th-dashboard/src/pages/SessionDetail.tsx`

The page renders `streamText` as the current assistant stream. No additional identity or reducer semantics are applied at render time.

## 3. Current contract matrix

| Layer | Current payload semantics | Current identity key | Mutation semantics | Risk |
|---|---|---|---|---|
| LLM provider | provider chunks, contract varies by provider | none in protocol | provider stream | provider-specific chunk assumptions |
| `StreamAssembler` | accumulated content | local assembler instance only | append content chunks | no external generation/sequence identity |
| AgentLoop event | accumulated `partialContent` | `sessionId + turnNumber` only | emits progress | same-turn retry/request collision possible |
| Worker | pass-through accumulated `partial` | `sessionId + turn` | broadcast | no sequence/dedup metadata |
| WebSocket | pass-through flat JSON | no enforced key | broadcast | reconnect/late packet ambiguity |
| Dashboard websocket client | `AgentActivity.partial` | local random activity ID | maps payload | local ID cannot deduplicate producer events |
| `sessionStore` | receives accumulated partial | one global `streamText` | **append** | HHeHel... corruption; session bleed |
| `SessionDetail` | current global string | none | render | stale/out-of-order text visible |

## 4. Contract conclusions

### 4.1 Producer semantics

The current producer semantics are **accumulated**, not delta:

```text
H → He → Hel → Hell → Hello
```

This is established by `StreamAssembler.partialContent`, not inferred from the field name.

### 4.2 Consumer semantics

The current dashboard reducer is **append**, not replace:

```text
streamText = streamText + incoming partial
```

This is incompatible with accumulated producer payloads and produces duplicated text.

### 4.3 Identity insufficiency

The current stream identity is insufficient for reconnect/retry/session isolation:

- `sessionId` is present in the worker event but not used as the reducer key;
- `turn` is present but does not distinguish retry/request generations within one logical turn;
- no generation/request identity exists;
- no monotonic producer sequence exists;
- local random activity IDs are not suitable for deduplication;
- no explicit event ordering or late-packet policy exists.

## 5. Boundary audit

| Boundary | Current behavior | Finding |
|---|---|---|
| Normal completion | `done=true` is forwarded; accumulated text remains | no explicit commit/replace contract |
| Reconnect | client reconnects; no replay/dedup protocol | duplicate or late packets can corrupt state |
| Retry same logical turn | no generation ID | retry can collide with prior stream |
| New logical turn | `turn_started` clears global text | late prior-turn packet can append after reset |
| Session switch | one global `streamText` | previous session text can bleed into next session |
| Late/out-of-order event | no sequence comparison | stale partial can overwrite/append incorrectly |
| Duplicate event | no producer event ID/sequence | duplicate content can be appended |
| Cancel/error termination | error/close handling does not define stream reducer finalization | partial state semantics unclear |

## 6. Existing tests and coverage

Current `th-agent` assembler tests cover accumulation inside `StreamAssembler`, which is compatible with its role as a final-response assembler but does not define the external UI transport contract.

The current repository does not provide an end-to-end conformance suite proving:

- accumulated producer + replace consumer;
- delta producer + append consumer;
- session/turn/generation isolation;
- retry/reconnect deduplication;
- late/out-of-order event rejection;
- cancellation/error finalization.

## 7. Risks

### Confirmed correctness risk

```text
accumulated producer + append reducer → duplicated assistant text
```

### Confirmed isolation risk

```text
single global streamText + late/session-switched event → session/turn bleed
```

### Confirmed protocol gap

No generation/request/sequence contract exists to distinguish retries, duplicates, late events, or out-of-order delivery.

## 8. P4 Phase 0 recommendations (design-only)

No implementation is authorized by this audit. The next design decision must choose one coherent contract:

### Option A — Preserve accumulated transport

```text
worker payload: accumulated text
reducer: replace current text
```

Requires identity at least:

```text
sessionId + turn + generationId/requestId + sequence
```

### Option B — Change transport to deltas

```text
worker payload: delta text
reducer: append delta
```

Still requires:

```text
sessionId + turn + generationId/requestId + sequence
```

The current system is Option A at the producer and Option B at the consumer; that mismatch must be resolved before code changes.

## 9. Scope boundary

This Phase 0 audit did not modify:

- worker stream payloads;
- AgentLoop streaming events;
- WebSocket protocol;
- dashboard reducer;
- P5 cancellation;
- P6 persistence;
- any unrelated UI behavior.

## 10. Stopping condition

P4 Phase 0 audit is complete. Before implementation, approve:

1. delta versus accumulated transport contract;
2. identity tuple and sequence semantics;
3. reducer mutation semantics;
4. retry/reconnect/late-event policy;
5. cancellation/error terminal semantics.
