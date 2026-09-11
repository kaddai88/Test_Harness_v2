# P3 Session Visibility Contract

> **Status:** Proposed / Awaiting review  
> **Milestone:** P3 Phase 0.5 — design only  
> **Baseline:** P3 Phase 0 Session Visibility Contract Audit (APPROVED / CLOSED)  
> **Code status:** no `SessionLog`, `deriveMessages()`, or production behavior change is authorized

## 1. Purpose and scope

P3 Phase 0 established that `system/note` currently mixes model guidance, recovery instructions, workflow bookkeeping, cognition context, and diagnostics. This document defines the visibility semantics needed before changing `SessionLog` or `deriveMessages()`.

In scope:

- Separate model visibility from audit/persistence retention.
- Define semantic kinds for currently observed producers.
- Define context lifetime/scope.
- Define model-safe projection versus audit payload.
- Assign visibility at the producer boundary.
- Define V1–V8 implementation invariants.

Out of scope:

- Code changes to `session.ts` or `deriveMessages()`.
- Tool protocol/result redesign.
- SessionLog storage redesign.
- P4 streaming, P5 cancellation, P6 persistence ownership, or other P2/P3+ work.
- Making every existing `system/note` immediately model-visible.

## 2. Core model

Audit retention and model visibility are independent dimensions:

```text
SessionEntry
├── auditPayload                 always retained according to SessionLog policy
├── semanticKind                 producer-assigned meaning
├── modelVisibility              conversation | context | none
├── contextLifetime              only for context entries
└── modelProjection              optional model-safe payload
```

`AUDIT_ONLY` is shorthand for:

```text
modelVisibility = none
+ retained in SessionLog/audit
```

It is not a third model information sink.

### 2.1 Model visibility

```text
modelVisibility:
  conversation  → normal conversation history
  context       → controlled model context, subject to lifetime
  none          → never included in derived model messages
```

A producer MUST assign semantic kind, model visibility, lifetime where applicable, and model projection before appending an entry. `deriveMessages()` MUST serialize explicit model-visible entries only; it MUST NOT infer visibility from role, event name, content prefix, or string pattern.

`role = system` does not imply visibility. `role = note` does not imply audit-only.

### 2.2 Context lifetime

Only `modelVisibility = context` uses a lifetime and a request/turn binding:

```text
next_turn
  → bound to one logical model turn/request generation
  → retries of that same logical request MAY reuse it
  → once that logical turn successfully advances, it no longer appears in later turns

until_superseded
  → requires a `supersessionKey`
  → a newer active entry with the same key replaces the prior entry in model context
  → entries with different keys MAY coexist

session_persistent
  → requires a `supersessionKey` or explicit retirement operation
  → remains eligible throughout the session until superseded, retired, or session termination
```

A `next_turn` entry is not consumed merely when `deriveMessages()` is called for an attempt. A failed network/model attempt and its retry belong to the same logical request generation and MAY see the same context. Once the logical turn successfully advances, the entry is expired for later turns. The concrete `turnId`/`requestGenerationId` representation is an implementation decision; the logical boundary is normative.

`until_superseded` and `session_persistent` entries MUST NOT use “same semantic kind” alone as a replacement key. A `supersessionKey` identifies the guidance channel/target, for example:

```text
coverage:checkout-flow
recovery:browser-navigation
strategy:search
cognition:site-x
```

Same key → newest active projection supersedes the previous projection. Different key → entries may coexist. Expiry/retirement is represented in audit history without deleting prior audit entries.

A context entry MUST NOT be replayed indefinitely merely because it remains in the audit log. Derivation needs an explicit request/turn boundary and lifetime evaluation.

### 2.3 Model projection boundary

The audit payload MAY contain raw results, headers, timings, internal metadata, credentials, cookies, diagnostic traces, or other data that must not reach the model. A model-visible context entry MUST provide a model-safe projection; the projection is the only payload `deriveMessages()` may serialize for model use.

**Hard fail-closed rule:**

```text
modelVisibility = context
+ modelProjection missing/invalid
→ model message absent
→ explicit contract error MAY be retained in audit
→ NEVER fallback to auditPayload
```

`modelProjection ?? auditPayload` is forbidden for `context` entries. `user_message` and `assistant_message` preserve their existing conversation-content serialization. `tool_result` preserves current protocol behavior in the first P3 slice; this exception does not authorize raw audit payload fallback for new context kinds.

For existing `user/message`, `assistant/message`, and `tool/result`, the current model-visible behavior is preserved in P3 Phase 1. This document does not authorize a tool-result protocol rewrite. Future field-level tool-result projection requires a separate scoped decision.

## 3. Semantic kinds

The initial finite vocabulary covers current producers:

```text
user_message
assistant_message
tool_result
coverage_continuation
recovery_guidance
tool_failure_strategy
workflow_guidance
cognition_guidance
audit_diagnostic
execution_trace
request_config
workflow_transition
unknown_custom
```

Unknown or unapproved kinds MUST default to:

```text
modelVisibility = none
retained in audit according to retention policy
```

A custom event may become model-visible only after its producer explicitly uses an approved semantic kind and supplies the required projection/lifetime.

## 4. Normative visibility policy

| Semantic kind | Model visibility | Lifetime | Audit retention | Producer responsibility |
|---|---|---|---|---|
| `user_message` | `conversation` | history | yes | Append the user-facing task content; existing behavior preserved |
| `assistant_message` | `conversation` | history | yes | Append assistant content/tool calls; existing behavior preserved |
| `tool_result` | preserve current model-visible behavior | history/protocol | yes | Preserve current protocol projection in P3; raw audit data remains separate |
| `coverage_continuation` | `context` | `next_turn` | yes | Supply only the next-turn continuation guidance |
| `recovery_guidance` | `context` | `next_turn` | yes | Supply actionable recovery guidance for the next model request |
| `tool_failure_strategy` | `context` | `next_turn` or `until_superseded` | yes | Supply strategy change, never raw internal trace |
| `workflow_guidance` | `context` | `next_turn` | yes | Project user/model-relevant next action from a transition |
| `cognition_guidance` | `context` | `next_turn` | yes | Supply approved recovery/strategy guidance only |
| `workflow_transition` | `none` | — | yes | Retain state transition/bookkeeping as audit; derive guidance separately |
| `audit_diagnostic` | `none` | — | yes | Never enter model messages |
| `execution_trace` | `none` | — | yes | Never enter model messages |
| `request_config` | `none` | — | yes | Never enter model messages |
| `unknown_custom` | `none` | — | yes | Fail closed until explicitly approved |

### 4.1 Special cases

- A workflow transition such as `TEST → REPORT`, retry count, or internal phase change is `workflow_transition` and remains audit-only by default. If the model needs guidance, the producer appends a separate `workflow_guidance` entry.
- A cognition history dump is not automatically guidance. Raw historical cognition is `none` by default; only a bounded, model-safe `cognition_guidance` projection may be visible.
- A tool failure's internal error, stack, timing, and transport data remain audit-only. A concise strategy change is `tool_failure_strategy`.
- `ALIGN`, stale-action, execution, and request diagnostics are `audit_diagnostic`, never model context.
- Existing `tool/result` behavior remains unchanged in the first implementation slice; the event's model projection must not accidentally include audit-only fields.

## 5. Producer ownership

```text
Producer
  → classifies semantic kind
  → assigns modelVisibility
  → assigns contextLifetime when context
  → creates modelProjection when model-visible
  → appends audit entry

SessionLog
  → retains and orders entries

DeriveMessages
  → filters by explicit visibility/lifetime
  → serializes modelProjection
  → does not infer policy
```

Each semantic kind has one producer owner. Downstream consumers MUST NOT reclassify an entry based on role, event name, or content text.

### 5.1 Current producer mapping

| Current producer/area | Proposed kind | Proposed visibility | Notes |
|---|---|---|---|
| Initial task append in `loop.ts` | `user_message` | conversation | Existing behavior |
| Assistant response append | `assistant_message` | conversation | Existing behavior |
| Tool result append | `tool_result` | preserve current | Do not redesign in P3 first slice |
| Cognition history at session start | `cognition_guidance` only if bounded projection; otherwise `none` | context or none | Raw history is not automatically visible |
| Coverage complete/incomplete notes | `coverage_continuation` | context | `next_turn`; no indefinite replay |
| Verification recovery note | `recovery_guidance` | context | `next_turn` |
| Repeated tool failure note | `tool_failure_strategy` | context | `next_turn` or explicitly superseded |
| Cognition recovery suggestion/strategy adjustment | `cognition_guidance` | context | `next_turn` |
| Workflow transition note | `workflow_transition` | none | Separate guidance if needed |
| ALIGN/ref diagnostics | `audit_diagnostic` | none | Audit only |
| Request config | `request_config` | none | Audit only |
| Tool call bookkeeping | `execution_trace` | none | Audit only |
| Custom/unclassified event | `unknown_custom` | none | Fail closed |

## 6. Derived-message rules

The future `deriveMessages()` implementation MUST follow these rules:

1. `conversation` entries are emitted according to existing conversation ordering and protocol rules.
2. `context` entries are selected only when their lifetime is active for the specific logical turn/request generation.
3. Active model context is placed after the chronological conversation/protocol history and immediately before the model request's new decision boundary, using a deterministic context serialization (the serializer MAY encode context as a `system` message, but role does not determine inclusion).
4. The default context serialization order is **SessionLog append sequence ascending**. No implicit priority or wall-clock ordering is used in this contract. If priority is introduced later, it requires an explicit field and contract revision.
5. Context entries are ordered by append sequence ascending. For equal `supersessionKey`, the entry with the greatest append sequence is the active winner; different keys retain their own append-sequence order and may coexist.
6. `next_turn` context is eligible for one logical model turn/request generation. A failed attempt and retry of that same logical generation MAY reuse it; after the logical turn successfully advances it is expired for later turns.
7. `until_superseded` context is keyed by `supersessionKey`; a newer active entry replaces the prior entry with the same key while both remain in audit history. Different keys may coexist.
8. `session_persistent` context remains only while its key is active and until explicit retirement or session termination.
9. `none` entries are never emitted, regardless of role or text.
10. Only `modelProjection` is serialized for new context entries; audit payload is never implicitly serialized.
11. Missing/invalid visibility, kind, projection, lifetime, or supersession key fails closed to model-invisible (with a contract error retained in audit where applicable).
12. Derivation is a pure/read-only projection: `deriveMessages(log, logicalTurn)` MUST NOT mark context consumed, append synthetic events, delete entries, mutate lifetime state, or otherwise mutate the append-only audit log. Expiry is derived from metadata and logical-turn identity.
13. Existing `user/message`, `assistant/message`, and `tool/result` behavior is a compatibility constraint for the first P3 implementation slice.

## 7. Regression invariants

### V1 — Audit-only exclusion

```text
audit-only entry
→ never appears in derived model messages
```

This includes ALIGN diagnostics, execution traces, request/config records, workflow transitions, and unknown/custom entries.

### V2 — Bounded context lifetime

```text
next_turn context
→ appears exactly in its eligible next request
→ does not persist indefinitely
```

Expired context remains auditable but is not serialized into future model requests.

### V3 — Unknown fail closed

```text
unknown/custom or missing classification
→ modelVisibility = none
```

No role/name/content heuristic may make it model-visible.

### V4 — Existing protocol compatibility

```text
user/message, assistant/message, tool/result
→ preserve current model-visible behavior in first implementation slice
```

P3 Phase 1 must not redesign the tool-result protocol.

### V5 — Semantic kind, not role, decides visibility

Two entries may both have `role = system` while producing different visibility:

```text
coverage_continuation → context / next_turn
ALIGN diagnostic      → none / audit-only
```

Their behavior must differ because their producer-assigned semantic kinds differ, not because of role or content string matching.

### V6 — Logical-turn retry lifetime

```text
append next_turn context G1
→ first attempt of logical turn R17 may see G1
→ network/model failure
→ retry R17' may still see G1
→ logical turn successfully advances
→ later turn must not see G1 unless producer re-emits it
```

A derivation attempt does not prematurely consume a next-turn entry.

### V7 — Keyed supersession

```text
same supersessionKey
→ newest active model projection replaces prior projection

different supersessionKey
→ entries may coexist
```

Same semantic kind alone never supersedes an entry. `session_persistent` follows the same explicit-key/retirement rule.

### V8 — Missing model projection fails closed

```text
modelVisibility = context
+ modelProjection missing/invalid
→ audit entry retained
→ model entry absent or explicit contract error only
→ auditPayload never serialized as fallback
```

### V9 — Deterministic append-sequence context order

```text
multiple active MODEL_CONTEXT entries
→ serialized in SessionLog append-sequence ascending order
```

Context order MUST NOT depend on wall-clock timestamps, object insertion order, map iteration, or an undeclared priority system. For equal supersession keys, the greatest append sequence is the active winner.

### V10 — Pure repeated derivation

```text
deriveMessages(log, logicalTurn=T17)
→ deriveMessages(log, logicalTurn=T17)
→ identical context projection
→ no SessionLog or lifetime-state mutation
```

A `next_turn` entry remains eligible across retries of the same logical request generation. Expiry is derived when the logical turn advances, not by destructive consumption during derivation.

## 8. Implementation gates

P3 Phase 1 may begin only after this contract is approved. Its minimum gates are:

1. Entry model can represent audit payload independently from model projection.
2. Producer assigns semantic kind and explicit model visibility.
3. Context lifetime is evaluated at request/turn boundary.
4. `deriveMessages()` performs serialization/filtering only and contains no semantic inference.
5. V1–V8 have executable tests.
6. Existing session tests and user/assistant/tool-result behavior remain green.
7. No P4/P5/P6 changes are included.

## 9. Explicitly deferred

- Final TypeScript names and storage schema.
- Whether `until_superseded` is implemented as a channel/key or another equivalent mechanism.
- Full tool-result field-level redaction/projection beyond preserving current behavior.
- SessionLog persistence/retention redesign.
- Streaming, cancellation, auth, repository hygiene, and other milestones.

## 10. Design acceptance

This document is a design artifact only. Approval means the visibility contract is sufficiently defined to plan P3 Phase 1 implementation. It does not authorize edits to `SessionLog`, `deriveMessages()`, or any production code.
