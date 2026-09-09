# P2-E Identity Semantics Design

> **Status:** Proposed / Design-only / Awaiting review  
> **Date:** 2026-09-09  
> **Current-state baseline:** working tree at `4b40c27` plus the already validated P2-A～P2-D closure changes  
> **Implementation status:** no production-code or test change is authorized by this document

## 1. Decision summary

P2-A～P2-D are **CLOSED / PASS**. They form a regression constraint and MUST NOT be reopened unless new, reproducible regression evidence appears.

P2-E proposes the following semantic model:

1. There are two content-identity domains plus a distinct occurrence locator:
   - **Observation content identity** answers whether the model-visible browser evidence is the same.
   - **Observation occurrence identity** identifies the exact recognized observation event, including repeated content-equal observations.
   - **Structural identity** answers whether the page's identity-bearing semantic and actionable structure is equivalent.
2. **Decision snapshot provenance is not a third hash domain.** It binds a model decision to the exact observation occurrence supplied to that model request and carries/references that occurrence's observation content identity.
3. Both identities are produced from the same immutable raw snapshot through separate, explicit projections. Neither identity is derived from the other.
4. Observation content identity MUST cover exactly the normalized observation presented to the model. Hidden hash-only normalization is forbidden.
5. Structural normalization MUST remove action-addressing refs and non-structural volatility, but MUST preserve changes that alter semantic navigation, roles, visibility, interactivity, identity-bearing labels, or meaningful order.
6. Lifecycle sequence/version and content identity answer different questions. A version cannot substitute for an identity, and equality across identity domains has no meaning.

These are proposed normative semantics. Concrete TypeScript names, data shapes, digest algorithms, hash lengths, persistence, migration, and rollout remain deliberately undecided until this document is approved.

## 2. Scope

### 2.1 In scope

- Definitions of raw snapshot, model-visible observation, observation content identity, observation occurrence identity, structural identity, and decision snapshot provenance.
- The two normalization boundaries and their relationship.
- Identity ownership and consumer boundaries.
- The invariant matrix for relevant snapshot changes.
- A descriptive mapping of the current implementation to the proposed contract.
- Product decisions and approval gates required before implementation.

### 2.2 Out of scope

- Any production-code, type, test, schema, or runtime behavior change.
- Choosing a hash/digest algorithm or truncation length.
- Naming final interfaces or fields.
- Migration, compatibility, persistence, telemetry, and rollout mechanics.
- Defining adapter APIs or transport mechanics for authoritative observation outcomes; their lifecycle participation semantics are defined by this document.
- P2-F Repository Hygiene.
- P3 Session/model-context contract through P10 cross-layer hardening.
- Refactoring or revalidating P2-A～P2-D without new regression evidence.

## 3. Normative language

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` describe the proposed contract. Sections explicitly labeled **Current implementation** are descriptive only and do not define the target semantics.

## 4. Terminology

### 4.1 Raw browser snapshot

The immutable browser-tool result from which snapshot-scoped model evidence and structural evidence are projected. It is evidence, not itself an identity contract.

Acquisition metadata MAY accompany the raw snapshot, but whether metadata belongs to either identity envelope is an explicit normalization decision; it MUST NOT enter an identity accidentally.

### 4.2 Model-visible observation

The canonical snapshot-scoped browser evidence actually supplied to a model request. Its normative envelope is defined in §6.2: typed outcome, normalized snapshot body, canonical effective document location, browsing-context identity, ref-namespace metadata, and partial-completeness metadata where applicable.

This is not the entire model prompt. Instructions, conversation history, coverage guidance, and unrelated context have their own contracts and are outside P2-E.

### 4.3 Observation content identity

A domain-scoped identity of the complete model-visible observation envelope.

It answers:

> Did the model receive the same snapshot-scoped browser evidence?

If two values are different in the model-visible observation, their observation content identities MUST be different. Conversely, values normalized out of observation content identity MUST also be absent or identically canonicalized in the payload presented to the model.

Observation content identity is therefore suitable for:

- binding model requests and decisions to browser evidence;
- detecting ref/action skew;
- replay and audit correlation;
- explaining whether two decisions used equivalent observation content.

### 4.4 Structural projection

A field-aware representation of identity-bearing page structure. It is separately derived from the raw snapshot and approved navigation context. It retains roles, actionable elements, semantic landmarks, identity-bearing labels, state that changes the usable view, and meaningful ordering. It excludes action-addressing refs and non-structural volatile values.

It MUST NOT be produced by deleting arbitrary substrings from an observation hash or by treating all extracted arrays as unordered sets.

### 4.5 Structural identity

A domain-scoped identity of the structural projection.

It answers:

> Is this the same semantic and actionable page/view structure for surface reconciliation purposes?

Structural equality does not imply that the model saw the same observation. Two structurally equivalent snapshots can have different refs, record data, timestamps, or other model-visible values.

### 4.6 Observation occurrence identity

A unique lifecycle locator for one recognized observation occurrence. It distinguishes repeated observations even when their model-visible content is equal:

```text
observation content equality
        ≠
observation occurrence identity
        ≠
decision provenance
```

Every recognized observation occurrence that may be bound to a model request MUST have an occurrence identity distinct from every other occurrence. The final implementation MAY encode this as a snapshot sequence/version or another stable locator; the concrete field name is deferred, but uniqueness is a semantic requirement rather than an implementation option.

Observation content identity answers whether normalized model-visible evidence is equal. Observation occurrence identity answers which acquisition/lifecycle event supplied it. Neither substitutes for the other.

### 4.7 Decision snapshot provenance

A binding from a model decision to the exact observation occurrence used to construct the corresponding model request.

It answers:

> Which observation occurrence was this decision based on?

It MUST carry or reference both:

- the exact observation occurrence identity; and
- that occurrence's observation content identity under its normalization-contract version.

It MUST NOT compute an independently normalized “decision hash.” Two equal observations MAY share one observation content identity, but their occurrence identities MUST remain distinct, and each decision provenance MUST point to the occurrence actually bound to its model request.

Conceptually—not as an approved TypeScript shape—the required information is:

```text
Observation occurrence = occurrence locator + observation content identity
Decision provenance    = exact request-bound occurrence locator
                         + its observation content identity
```

### 4.8 Lifecycle sequence/version

Monotonic metadata may implement or support observation occurrence identity and lifecycle ordering. It answers “which occurrence/when,” not “what content.”

- Each recognized observation occurrence MUST be uniquely locatable, including repeated content-equal observations.
- Sequence/version equality MUST NOT be used as the sole proof of content equality.
- Content identity equality MUST be interpreted only within the same identity domain and normalization-contract version.
- Repeated equal observations retain the same observation content identity but MUST have distinct occurrence identities.

## 5. Required identity topology

```text
                         immutable raw browser snapshot
                                      │
                   ┌──────────────────┴──────────────────┐
                   │                                     │
       observation projection                  structural projection
   (exact model-visible evidence)          (semantic/actionable structure)
                   │                                     │
                   ▼                                     ▼
         observation content identity              structural identity
                   +                                     │
         observation occurrence identity                 └─ surface/change consumers
                   │
            model request binding
                   │
                   ▼
              model decision
                   │
                   ▼
       decision snapshot provenance
       (references exact occurrence
        and its observation content identity)
                   │
                   └─ ALIGN/ref-skew/replay/audit consumers
```

Required invariants:

- Both branches MUST start from the same immutable acquisition result and explicitly selected metadata.
- Observation content identity MUST NOT be derived from structural identity.
- Structural identity MUST NOT be derived from observation content identity.
- Every recognized observation occurrence MUST have a unique occurrence identity even when its observation content identity equals another occurrence's.
- Decision provenance MUST reference the exact request-bound occurrence and its observation content identity; it MUST NOT introduce independent content normalization or hashing.
- Every model decision that can produce a browser action MUST be bound to the observation occurrence used for that request, including an explicit “no observation” state where applicable.
- A later current observation MUST NOT rewrite the provenance of an earlier decision.
- Structural identity MUST NOT substitute for observation content identity or observation occurrence identity at any correctness-critical boundary.
- ALIGN and stale-action/ref validation MUST compare decision provenance with current observation provenance. Structural equality MUST NOT suppress a provenance mismatch.

## 6. Observation normalization contract

### 6.1 Boundary rule

The observation projection and its identity are one artifact with two representations: the canonical model-visible payload and its identity. They MUST be produced together by one owner.

For any candidate field or substring:

```text
Visible to the model and different
        ⇒ observation content identity DIFFERENT

Canonicalized/removed before content identity
        ⇒ the model receives that same canonicalized/removed form
```

The following is forbidden:

```text
model receives snapshot containing ref/timestamp/value A
hash silently removes or changes A
model receives snapshot containing ref/timestamp/value B
hash treats A and B as identical
```

That pattern would claim equal evidence while the model actually saw different evidence.

### 6.2 Normative observation envelope

Every successfully recognized observation MUST produce one canonical model-visible envelope containing:

- the typed outcome kind: `complete`, `empty`, or `partial`;
- the canonical snapshot body, including action-addressing refs when present;
- the canonical effective document location defined below;
- the browsing-context identity needed to distinguish page/tab/frame scope;
- the ref-namespace metadata needed to interpret action addresses;
- completeness metadata for a partial observation.

Each envelope field MUST be supplied to the model in the same canonical form used by observation content identity. A field that is unavailable MUST use an explicit unavailable/not-applicable marker rather than silently disappearing. Credentials and transport-only secrets MUST never enter the envelope.

A successful empty page is represented by an `empty` envelope with an intentionally empty body. It is not equivalent to partial, unavailable, or failed acquisition.

### 6.3 Normative field policy

Classification is schema/field-semantic, not lexical. An unclassified value uses the conservative row until an approved classifier assigns another class.

| Field class | Observation projection policy | Structural projection policy | Occurrence effect | Correctness relevance |
|---|---|---|---|---|
| Canonical origin | Include and show to model | Include | Every successful recognition creates a new occurrence | Defines browsing/security context |
| URL path | Include; preserve view/entity path semantics | Include by default | New occurrence | Defines semantic route/view |
| Semantic query parameter | Include | Include | New occurrence | Defines filter, tab, mode, entity, or workflow state |
| Tracking/telemetry query parameter | Remove before model input | Exclude | New occurrence still created when recognition succeeds | Never used for action alignment |
| Semantic fragment/router state | Include | Include | New occurrence | Defines client-side semantic view |
| Non-semantic fragment | Remove before model input | Exclude | New occurrence still created | Never used for correctness |
| Unknown URL component | Include and classify as semantic until an approved schema says otherwise | Include conservatively | New occurrence | Prevents false equality |
| Action-addressing ref / ref namespace | Include exactly | Exclude | New occurrence | Correctness-critical for ALIGN/stale-action validation |
| Semantic view/entity identifier | Include | Include | New occurrence | Identifies the actionable business view/entity |
| Ordinary record identifier/data value | Include when model-visible | Exclude | New occurrence | Observation evidence, not structural equality |
| Non-action framework/runtime identifier | Remove before model input only when schema-classified as non-semantic | Exclude | New occurrence | Must not be inferred from random-looking text |
| Session/transport/debug identifier | Remove before model input | Exclude | New occurrence | Transport evidence only; secrets never enter envelope |
| Unknown identifier | Include | Include conservatively | New occurrence | Remains identity-bearing until classified |
| Identity-bearing role/heading/tab/form/action label | Include | Include | New occurrence | Defines semantic/actionable structure |
| Ordinary body/record text | Include | Exclude | New occurrence | Model evidence, but not view structure |
| User input or selected value that controls view/actions | Include | Include as semantic/action state | New occurrence | Can change valid actions or interpretation |
| User/business data that does not control structure | Include | Exclude | New occurrence | Model-visible evidence only |
| Business state/date/time | Include | Include when it defines current semantic/action state | New occurrence | Classification comes from field role, not date syntax |
| Generated timestamp/telemetry metadata | Remove before model input when schema-classified as generated metadata | Exclude | New occurrence | `generatedAt` is not inferred from date syntax alone |
| Unknown visible value | Include | Include conservatively | New occurrence | Prevents unapproved normalization |
| Semantic DOM/accessibility/action/workflow order | Preserve | Preserve | New occurrence | Can change action relationships and meaning |
| Explicitly unordered collection | Preserve actual model-visible order | Canonicalize as a set | New occurrence | Structural order is non-semantic only by schema |
| Presentation/paint order absent from the observation | Absent | Exclude | A later successful recognition still creates a new occurrence | Cannot substitute for accessibility/interaction evidence |
| Unknown ordering | Preserve | Preserve conservatively | New occurrence | Prevents false structural equality |

URL canonicalization MUST use a declared URL-field schema. Unknown query/fragment fields default to semantic inclusion; only explicitly classified tracking, session, telemetry, or non-semantic fields may be removed. Canonical origin/path representation may normalize transport-equivalent syntax, but the canonical value shown to the model and the value used by observation content identity MUST remain identical.

Localization or copy-only changes to identity-bearing labels remain the one permitted structural `CONDITIONAL`: each product/domain schema must choose whether localized/copy variants denote the same structure. Regardless of that choice, visible copy differences always change observation content identity, and structural equality MUST NOT be used at a correctness-critical boundary.

## 7. Structural normalization contract

### 7.1 Included information

The structural projection MUST retain information whose change can alter the semantic or actionable view, including:

- interactive roles and availability;
- visible/hidden, enabled/disabled, selected/expanded states where they affect usable behavior;
- addition or removal of actionable elements;
- identity-bearing headings, tabs, navigation landmarks, form labels, table headers, and action labels;
- semantic route/view state;
- order where order communicates workflow, priority, hierarchy, navigation, or relationship.

### 7.2 Excluded information

The structural projection MUST exclude values classified by the approved field schema as non-structural, including:

- Playwright/action-addressing refs and their occurrence-local namespace;
- schema-classified framework, session, transport, telemetry, or debug identifiers;
- schema-classified generated timestamps and ordinary record values that do not control semantic/action state;
- explicitly classified tracking or non-semantic URL fields;
- presentation-only differences not represented in accessibility, visibility, role, state, order, or interaction behavior.

Unknown fields MUST NOT be excluded because their text merely resembles a timestamp, random identifier, count, or other volatile value. They remain structural identity-bearing until an approved semantic classifier places them in an excluded class. This conservative default avoids false structural equality; schema refinement may later narrow it under a new structural contract version.

### 7.3 Field-aware semantic classification

Structural projection MUST be derived from the semantics of known parsed fields and relationships—not primarily from regexes that guess volatility from the textual shape of a value.

For example:

| Value | Default classification | Why shape alone is insufficient |
|---|---|---|
| `generatedAt=2026-09-10` | Usually ephemeral metadata | It describes generation time, not page structure |
| `bookingDate=2026-09-10` | Potentially semantic state | The same date shape can define the user's selected booking |
| framework/runtime element ID | Usually ephemeral | It may be regenerated without changing the view |
| product SKU or domain entity ID | Potentially semantic | An ID can identify the product/entity being viewed |
| CSS paint/order difference absent from accessibility output | Usually presentation-only | It may not alter model-visible or actionable structure |
| DOM/accessibility action order | Potentially semantic | Order can encode workflow, ranking, hierarchy, or navigation |

Regex or lexical canonicalization MAY be used as a low-level parser aid only after the field/category semantics have been established. It MUST NOT be the authority for deciding whether a value is structural.

### 7.4 Identity-contract boundary

**Observation domain.**  
Observation content identities belong to an explicit normalization contract. Equality is a three-valued relation:

```text
same contract + equal content identity        → SAME
same contract + unequal content identity      → DIFFERENT
different or unknown contract                 → NOT COMPARABLE
```

Matching digest text across contract versions MUST NOT be treated as equality. A migration may establish an explicit equivalence mapping, but until such a mapping exists the identities remain `NOT COMPARABLE`.

**Structural domain.**  
Structural equality is determined by a single **StructuralEvidence** record, not by a bare hash:

```text
StructuralEvidence
├── contractVersion
├── completenessScope        (comparison provenance / evidence scope)
└── structuralIdentity       (within that scope)
```

- `contractVersion` identifies the structural projection and normalization semantics.
- `completenessScope` identifies which portion of the browser state the evidence claims to cover. It is comparison provenance, not content, and MUST NOT be folded into the structural hash or encoded as a pseudo contract version.
- `structuralIdentity` describes the structure observed within that scope under that contract.

Structural comparison is a three-valued relation with two incomparability reasons:

```text
contract compatible  +  scope compatible  +  equal identity    → SAME
contract compatible  +  scope compatible  +  unequal identity  → DIFFERENT
contract incompatible                       → NOT COMPARABLE (reason: contract incomparability)
scope incompatible                          → NOT COMPARABLE (reason: evidence/scope incomparability)
```

The concrete contract identifier, scope descriptor, digest, and migration representation are implementation decisions. Carrying enough provenance to enforce the three-valued comparison and distinguish the two incomparability reasons is a semantic requirement. Diagnostics such as surface reconciliation, alignment, and audit MAY expose the incomparability reason but MUST preserve the same public SAME/DIFFERENT/NOT COMPARABLE result.

Equality within each domain is valid only inside one contract version and one compatible completeness scope. `NOT COMPARABLE` never collapses into `SAME` or `DIFFERENT`.

**Structural outcome-independence invariant.** Structural comparison is determined exclusively by the two structural projections and their comparison provenance (contract + completeness scope). Observation outcome labels — `complete`, `partial`, `empty`, `non-empty`, `failure`, `unavailable` — never directly set a Structural verdict. When a Structural comparison cannot be completed because the evidence scopes are incompatible, the result is `NOT COMPARABLE` (reason: evidence/scope incomparability); it is never a `DIFFERENT` inferred from the outcome label.

## 8. Current Observation Lifecycle

### 8.1 Authoritative states

`current observation` means the latest fully ingested observation occurrence that is still authoritative for the browser state being validated. It does not mean “the latest snapshot value stored somewhere.”

```text
NoCurrentObservation

Current(Oₙ)
  Oₙ = unique occurrence identity
     + observation content identity and contract
     + structural identity and contract
     + typed outcome/completeness metadata

CurrentUnavailable(Uₙ)
  Uₙ = unique lifecycle event explaining why no observation
       is currently authoritative
```

`CurrentUnavailable` has no observation content or structural identity. It MUST NOT be represented by hashing empty text. The implementation representation of these states is deferred; their semantics are normative.

### 8.2 Recognition and atomic update point

A successful acquisition becomes a **recognized observation occurrence** only after all of the following complete successfully:

1. its outcome is classified as `complete`, `empty`, or accepted `partial`;
2. its canonical model-visible envelope is constructed;
3. its observation content identity and identity contract are assigned;
4. its structural projection, identity, and contract are assigned;
5. a unique occurrence identity is assigned; and
6. the complete occurrence is atomically ingested into the authoritative lifecycle.

At the atomic ingestion point, and not before, `Current(Oₙ)` becomes `Current(Oₙ₊₁)`. Model-request assembly and action validation MUST observe either the complete old state or the complete new state, never a partially updated mixture. Projection/validation failure creates no recognized observation occurrence and cannot partially advance current state.

Every successfully recognized event creates a new occurrence, including:

- a successful non-empty complete observation;
- a successful empty observation;
- an accepted partial observation; and
- a repeated observation whose observation content and structural identities equal the preceding occurrence.

Thus the following is valid and required:

```text
content SAME
structural SAME
occurrence DIFFERENT
```

### 8.3 Acquisition outcome policy

| Acquisition outcome | Recognized observation occurrence? | Authoritative current-state transition | Action-validation semantics |
|---|---:|---|---|
| Successful complete observation | Yes | `NoCurrent/Current/Unavailable → Current(Oₙ₊₁)` after atomic ingestion | May validate observation-dependent actions against Oₙ₊₁ |
| Successful empty observation | Yes | `NoCurrent/Current/Unavailable → Current(Oₙ₊₁: empty)` | Valid evidence of an empty view; no fabricated refs/elements |
| Repeated content-equal successful observation | Yes | `Current(Oₙ) → Current(Oₙ₊₁)` with equal content identities and distinct occurrence | Exact provenance differs despite content equality |
| Accepted partial observation | Yes, only with explicit bounded completeness metadata | `NoCurrent/Current/Unavailable → Current(Oₙ₊₁: partial)` | May validate only facts/refs inside the declared complete scope; otherwise block/re-observe |
| Unbounded or malformed partial result | No | Retain authoritative current only if no browser-state invalidation is pending; otherwise `CurrentUnavailable(Uₙ₊₁)` | Cannot establish alignment or freshness |
| Acquisition failure | No | Same rule as malformed partial: retain current only if browser state remains known not to have advanced; otherwise unavailable | The failure event is recorded separately and has no content identity |
| Explicit unavailable result | No | `NoCurrent/Current → CurrentUnavailable(Uₙ₊₁)` | Observation-dependent actions MUST NOT execute |
| Transport/tool result with absent body but no explicit successful-empty outcome | No | Retain or become unavailable under the same invalidation rule | MUST NOT be interpreted as successful empty |

A failed acquisition does not by itself mutate the browser, so a prior `Current(Oₙ)` may remain authoritative only when no browser-state-changing operation has occurred since Oₙ. It cannot satisfy a refresh that was required after such an operation.

### 8.4 Observation source policy

Observation recognition is based on an authoritative typed observation outcome, not solely on a tool name or arbitrary text field.

- Explicit snapshots, framework auto-snapshots, and tool-post snapshots MUST enter the same recognition/ingestion lifecycle when their adapter declares them authoritative observation outcomes.
- An authoritative observation cannot be silently ignored because it was attached to a non-snapshot tool result.
- Incidental logs, summaries, status text, or untyped snapshot-like strings MUST NOT create or supersede current observation state.
- If a source cannot declare whether its payload is authoritative, that payload is not recognized and MUST NOT be used for correctness validation.

This policy defines lifecycle participation while leaving adapter mechanics to implementation design.

### 8.5 Browser-state invalidation

Before an observation-dependent action executes, it is validated against exactly one `Current(Oₙ)` and the immutable decision provenance.

When an executed tool can change browser-visible or actionable state, the prior current observation ceases to be authoritative for subsequent actions as soon as that state-changing execution succeeds or reports a possibly-applied/indeterminate outcome:

```text
Current(Oₙ)
    │ state-changing action succeeds or may have applied
    ▼
CurrentUnavailable(Uₙ₊₁: post-action observation required)
    │
    ├─ authoritative observation ingested
    │       → Current(Oₙ₊₂)
    │
    └─ acquisition fails/is malformed/unavailable
            → remain CurrentUnavailable(...)
```

A tool explicitly classified as read-only and guaranteed not to change browser/ref state does not invalidate current. Unknown tool effects default to state-changing. This classification is semantic input to the lifecycle, not inferred from whether returned text happens to differ.

### 8.6 Request binding and action-validation boundary

Model-request assembly atomically binds the request to the current state:

- `Current(Oₙ)` produces request-bound provenance for exact Oₙ and its observation content identity/contract.
- `NoCurrentObservation` or `CurrentUnavailable(Uₙ)` produces an explicit no-usable-observation binding; it MUST NOT reuse stale Oₙ.

Every observation-dependent action is validated immediately before execution against the authoritative state at that moment:

```text
decision provenance = exact Oₙ
current state        = exact Current(Oₘ)

Oₙ == Oₘ and observation contract/content binding is valid
    → provenance aligned; other action guards still apply

Oₙ != Oₘ
    → provenance skew; direct execution is forbidden
    → block and re-observe/re-align/replan under a separately defined policy

NoCurrentObservation or CurrentUnavailable
    → direct execution is forbidden
```

Structural identity is not read by this correctness decision. Structural `SAME` cannot convert occurrence skew into alignment. `NOT COMPARABLE` observation identities/contracts also cannot be treated as aligned.

Navigation or another action whose semantics do not depend on snapshot evidence MAY be allowed by its own explicit guard policy; it does not weaken the rule for observation-dependent actions.

### 8.7 Multi-tool decision boundary

One model response may contain multiple actions, but one decision provenance does not grant them a snapshot lease across browser-state changes.

For actions `A₁, A₂, …` bound to Oₙ:

```text
validate A₁ against Current(Oₙ)
        ↓
execute A₁
        ↓
if A₁ invalidates current or authoritative observation advances to Oₙ₊₁
        ↓
validate A₂ against the new authoritative state
        ↓
Oₙ provenance != Oₙ₊₁ / unavailable
        → do not directly execute A₂
        → re-observe/re-align/replan
```

This applies even when Oₙ and Oₙ₊₁ have equal observation content hashes or equal structural identities. Exact occurrence provenance is the correctness boundary. Remaining actions may proceed without rebinding only while the authoritative current occurrence remains exactly Oₙ and all other guards pass.

## 9. Consumer ownership

| Stage | Single responsibility | Produces | MUST NOT do |
|---|---|---|---|
| Snapshot acquisition | Capture immutable browser evidence and acquisition metadata | Raw snapshot outcome | Decide identity semantics ad hoc |
| Observation projection | Build exact canonical model-visible snapshot envelope | Model-visible observation + observation content identity | Hide identity normalization from the model payload |
| Structural projection | Extract/canonicalize semantic and actionable structure | StructuralEvidence { contractVersion, completenessScope, structuralIdentity } | Reuse observation content identity as structural equality; fold completenessScope into identity hash or into contract version |
| Model request assembly | Attach the exact observation occurrence binding used in the request | Request-to-occurrence binding, including observation content identity | Read a later “current” identity after request construction |
| Decision recording | Preserve the exact request binding as provenance | Decision snapshot provenance | Compute a decision-specific content hash or retain content hash without occurrence identity |
| ALIGN/stale-action/ref validation | Compare decision provenance with current observation occurrence/provenance | Correctness diagnostics/evidence | Re-normalize snapshots, infer safety from structural equality, or suppress occurrence skew |
| Replay/audit | Locate the exact observation occurrence and verify its content identity/contract | Traceable evidence | Treat content equality as occurrence equality; conflate contract and evidence incomparability |
| Surface reconciliation/change detection | Compare structural identities under one contract and one compatible completeness scope | Structural change evidence | Treat ref-only observation churn as a new surface; conflate scope differences with structural difference |
| Coverage/planning consumers | Consume authoritative identities appropriate to the decision | Domain-specific decisions | Reset coverage or loosen resolver confidence due to identity uncertainty |

Identity producers MUST be singular. Downstream consumers consume domain-tagged values and MUST NOT independently reproduce normalization rules.

## 10. Executable invariant matrix

Legend:

- `SAME`: content equality within one compatible domain; it never means the same occurrence.
- `DIFFERENT`: content inequality within one compatible domain.
- `CONDITIONAL`: permitted only for localization/copy-only structural classification under the bounded policy below.
- `NOT COMPARABLE`: comparison is undefined. Two incomparability reasons are distinguished:
  - **contract incomparability** — different domain or different structural/observation contract version.
  - **evidence/scope incomparability** — same contract but different or incompatible completeness scope.
- Every successfully recognized event creates and installs a new unique observation occurrence, including content-equal repeats.
- Observation and Structural results in each row are derived independently from the normative field policy; one result never implies the other.
- Structural verdicts are determined exclusively by the two structural projections and their comparison provenance. Observation outcome labels (complete, partial, empty, non-empty) never directly set Structural results.

| Change and normative field classification | Observation content identity | Structural identity | Occurrence/current effect | Decision provenance / correctness result |
|---|---|---|---|---|
| Exact same envelope is successfully recognized again | **SAME** | **SAME** | New Oₙ₊₁; `Current(Oₙ) → Current(Oₙ₊₁)` | Any decision bound to Oₙ is skewed against Oₙ₊₁ despite equal content |
| Only action ref/ref namespace changes | **DIFFERENT** because ref is visible | **SAME** because refs are structurally excluded | New Oₙ₊₁ becomes current | Oₙ-bound action MUST be blocked against Oₙ₊₁; structural SAME is irrelevant |
| Schema-classified generated timestamp changes and is removed from model envelope | **SAME** | **SAME**, independently, because generated metadata is structurally excluded | New Oₙ₊₁ becomes current | Occurrence skew still exists; content equality cannot authorize an Oₙ-bound action |
| Schema-classified business date/state changes and controls view/actions | **DIFFERENT** | **DIFFERENT** | New Oₙ₊₁ becomes current | Decision MUST reference the occurrence containing the actual business state |
| Schema-classified non-action framework/runtime ID changes and is removed from model envelope | **SAME** | **SAME**, independently, because its field class is non-structural | New Oₙ₊₁ becomes current | Occurrence skew remains detectable |
| Unknown identifier/value changes | **DIFFERENT** under conservative inclusion | **DIFFERENT** under conservative inclusion | New Oₙ₊₁ becomes current | Cannot normalize uncertainty into false alignment/equality |
| Semantic product/entity/view ID changes | **DIFFERENT** | **DIFFERENT** | New Oₙ₊₁ becomes current | Decision target/view provenance changes |
| Ordinary record ID/body value changes without controlling structure | **DIFFERENT** | **SAME** | New Oₙ₊₁ becomes current | Model evidence changed; structural equality does not authorize stale action |
| Identity-bearing role, heading, tab, form, navigation, or action label changes semantically | **DIFFERENT** | **DIFFERENT** | New Oₙ₊₁ becomes current | Semantic/actionable structure changed |
| Localization/copy-only variant of an identity-bearing label | **DIFFERENT** | **CONDITIONAL** under an explicit product/domain schema; otherwise conservative **DIFFERENT** | New Oₙ₊₁ becomes current | No correctness consumer may rely on the conditional structural result |
| Interactive element is added or removed | **DIFFERENT** | **DIFFERENT** | New Oₙ₊₁ becomes current | Available action structure changed |
| Pure presentation/paint change is absent from the canonical observation | **SAME** | **SAME** | If a successful observation is recognized, new Oₙ₊₁ becomes current | Oₙ-bound action is still occurrence-skewed against Oₙ₊₁ |
| CSS/layout changes visibility, role, enabled state, accessibility order, or interactivity | **DIFFERENT** | **DIFFERENT** | New Oₙ₊₁ becomes current | Usable semantic/actionable structure changed |
| Canonical origin, path, semantic query, or semantic fragment changes | **DIFFERENT** | **DIFFERENT** | New Oₙ₊₁ becomes current | Semantic browsing/view context changed |
| Only schema-classified tracking query or non-semantic fragment changes | **SAME** because removed before model input | **SAME** because structurally excluded | New Oₙ₊₁ becomes current after successful recognition | Exact occurrence differs even though canonical content does not |
| Unknown URL component changes | **DIFFERENT** | **DIFFERENT** | New Oₙ₊₁ becomes current | Unknown defaults to semantic; false equality is forbidden |
| Semantic action/DOM/workflow/navigation order changes | **DIFFERENT** | **DIFFERENT** | New Oₙ₊₁ becomes current | Action relationships or meaning changed |
| Only an explicitly unordered collection's enumeration order changes | **DIFFERENT** when actual model-visible order differs | **SAME** after independent set canonicalization | New Oₙ₊₁ becomes current | Decision follows observation occurrence, not structural set equality |
| Successful complete view becomes successful empty view | **DIFFERENT** because model-visible observation content changed | Derived only from comparing `structuralProjection(before)` with `structuralProjection(after)` under the same contract and compatible scope: equal → **SAME**, unequal → **DIFFERENT**; scope/contract incompatible → **NOT COMPARABLE** | New empty Oₙ₊₁ becomes current | Empty is valid evidence, never failure/unavailable; observation-outcome label does not set the structural verdict |
| Identical successful empty view is recognized again | **SAME** | **SAME** | New empty Oₙ₊₁ becomes current | Distinct occurrence remains mandatory |
| Complete observation is replaced by accepted partial observation | **DIFFERENT** because model-visible envelope kind/completeness changed | **NOT COMPARABLE** (reason: evidence/scope incomparability) unless both structural evidence records declare comparable completeness scope; if scopes are comparable, derived solely from structural projection equality | New partial Oₙ₊₁ becomes current | Validate only refs/facts inside the declared complete scope; otherwise block |
| Acquisition fails before any state-invalidating operation | No new observation content identity | No new structural identity | Retain Current(Oₙ); record a separate failure event | Oₙ remains current, but failure cannot masquerade as a refreshed occurrence |
| Acquisition fails after state invalidation | No new observation content identity | No new structural identity | Remain/become `CurrentUnavailable(Uₙ₊₁)` | Observation-dependent action is blocked |
| Explicit unavailable result | No observation content identity | No structural identity | `Current/NoCurrent → CurrentUnavailable(Uₙ₊₁)` | Observation-dependent action is blocked |
| Same-domain identities use different or unknown identity contracts | **NOT COMPARABLE** (reason: contract incomparability) | **NOT COMPARABLE** (reason: contract incomparability) | Occurrences remain distinct | MUST NOT be treated as aligned even if digest text matches |
| Identities belong to different domains | **NOT COMPARABLE** (reason: contract incomparability) | **NOT COMPARABLE** (reason: contract incomparability) | Not an occurrence comparison | Cross-domain equality has no meaning |
| Same contract but different or incompatible completeness scope | Observation envelope is compared by content; observation content may still be **DIFFERENT** or **SAME** | **NOT COMPARABLE** (reason: evidence/scope incomparability); structural identity equality alone does not establish equality | Occurrences remain distinct | Structural equality MUST NOT be inferred across incompatible scopes |

### 10.1 Bounded localization conditional

Localization/copy-only structural equality MAY remain product/domain-specific because it is not used for correctness. The schema MUST explicitly select one of:

- structurally `DIFFERENT`; or
- structurally `SAME` via a declared canonical semantic label.

Absent that declaration, the conservative result is `DIFFERENT`. In all cases visible copy changes make observation content `DIFFERENT`, create a new occurrence, and invalidate occurrence-bound actions.

## 11. Representative traces

### 11.1 Ref-only change

```text
occurrence A: observation content button "Save" [ref=e37]
occurrence B: observation content button "Save" [ref=e42]

observationContent(A) != observationContent(B)   refs remain actionable and model-visible
structure(A)          == structure(B)            role/label/action set unchanged
decision(B)           → occurrence B             never occurrence A, never an independent hash
ALIGN(A decision, B current) detects skew         structural equality cannot override this
```

### 11.2 Timestamp change

```text
If the timestamp field is schema-classified as generated metadata and removed before model input:
  observation content SAME
  structural SAME, independently because generated metadata is structurally excluded
  a later successful recognition still creates a distinct occurrence

If the date/time field is schema-classified as business/action state:
  observation content DIFFERENT
  structural DIFFERENT
  decision provenance follows the occurrence containing that business state
```

### 11.3 Action-target ref skew

```text
decision provenance → occurrence A (content includes ref=e37)
current provenance  → occurrence B (content includes ref=e42)

structural identity may remain SAME
observation content identity is DIFFERENT
occurrence identity is necessarily DIFFERENT
ALIGN MUST report decision/current occurrence skew
structural SAME MUST NOT suppress or downgrade that result
```

### 11.4 Semantic text change

```text
button "Submit" → button "Delete account"

observation DIFFERENT
structural DIFFERENT because identity-bearing action semantics changed
provenance points to the exact label the model saw
```

Ordinary record text such as `Order #123 → Order #124` remains observation-distinguishing when visible, but does not by itself require a different structural identity.

### 11.5 URL/navigation change

```text
/programs/12 → /settings/security

recommended observation envelope: DIFFERENT
structural: DIFFERENT semantic view
decision provenance: bound to the exact request-visible route
```

A query field classified by the URL schema as tracking/telemetry is removed from both approved projections; its change leaves both content identities `SAME`, but a later successful recognition still creates a distinct current occurrence. Unknown query/fragment fields default to semantic inclusion and therefore change both identities.

### 11.6 Order change

```text
workflow steps: Review → Approve  becomes  Approve → Review
  observation DIFFERENT
  structural DIFFERENT

unordered landmark role set emitted in another enumeration order
  observation follows actual model-visible ordering
  structural SAME after field-approved canonicalization
```

## 12. Current implementation (descriptive, non-normative)

This section records the implementation inspected on 2026-09-09. It does not approve the current behavior as the target contract.

### 12.1 Snapshot lifecycle identity

In [`workflow.ts`](../packages/agent/th-agent/src/workflow.ts):

- `SnapshotIdentity` currently contains `{ version, hash }` ([lines 140–153](../packages/agent/th-agent/src/workflow.ts#L140-L153)).
- `applySnapshotObservation()` extracts refs, calls the shared `normalizeSnapshot()`, computes a 12-hex-character SHA-256 prefix, and advances version only when that hash changes ([lines 501–520](../packages/agent/th-agent/src/workflow.ts#L501-L520)).
- The hash input is snapshot text only; URL is not included.
- Successful non-empty `browser_snapshot` results use this lifecycle path ([lines 566–571](../packages/agent/th-agent/src/workflow.ts#L566-L571)).

Consequently, the current `hash` resembles a normalized snapshot-text identity, but it is not yet a formally defined observation identity or structural identity.

### 12.2 Shared normalization

In [`surface-signature.ts`](../packages/agent/th-agent/src/surface-signature.ts):

- `normalizeSnapshot()` replaces selected timestamps, date formats, counts, UUID/long-hex values, session/token strings, loading text, greetings, and currency matches with underscores ([lines 59–115](../packages/agent/th-agent/src/surface-signature.ts#L59-L115)).
- Replacement length depends on the matched length up to 20 characters, so different value shapes are not necessarily canonicalized to one token.
- `[ref=...]` is preserved.
- Many short, numeric, framework-specific, request, or runtime IDs are preserved unless they match one of the selected patterns.
- Visible labels, text, whitespace, punctuation, and line order are otherwise retained.

The same function is currently reused before structural signature extraction. P2-E's proposed contract instead requires separate projection ownership even if a future implementation shares safe low-level canonicalization primitives.

### 12.3 Surface signature

Also in [`surface-signature.ts`](../packages/agent/th-agent/src/surface-signature.ts):

- `SurfaceSignature` stores URL, title/active tab, headings, role sets, form labels, table headers, actions, landmarks, feature labels, and a hash ([lines 20–46](../packages/agent/th-agent/src/surface-signature.ts#L20-L46)).
- `hashSurfaceSignature()` computes a 16-hex-character SHA-256 prefix over exact URL plus selected signature fields ([lines 342–367](../packages/agent/th-agent/src/surface-signature.ts#L342-L367)).
- Several arrays are sorted for hashing, so their order is treated as non-semantic; title still depends on the first heading encountered.
- `featureLabels` are collected but not included in this hash.

This is an existing structural approximation, not yet the approved P2-E structural-identity contract.

### 12.4 Decision capture and consumers

In [`loop.ts`](../packages/agent/th-agent/src/loop.ts):

- The current snapshot identity is copied after the model response is available and immediately before its tool calls execute; the copy is stored as `decisionSnapshotIdentity` ([lines 845–861](../packages/agent/th-agent/src/loop.ts#L845-L861)).
- ALIGN output formats current and decision identities as `version:hash` when an action cannot be resolved ([lines 1283–1288](../packages/agent/th-agent/src/loop.ts#L1283-L1288)).
- Surface-change handling consumes the separate surface-signature hash elsewhere in the loop.

The approved P2-E contract would require provenance to be bound to the observation used at model-request construction. Whether and how the current boundary maps to that requirement is a future implementation analysis; it is not treated here as new evidence reopening P2-A～P2-D.

## 13. Normative policy decisions

Revision 2 resolves the previous E4 blockers normatively. These policies are no longer “recommended starting positions.”

| Policy area | Normative decision |
|---|---|
| Observation envelope | Typed outcome, canonical snapshot body, effective location, browsing context, ref namespace, and partial completeness are included and model-visible in their identity form (§6.2) |
| Visible volatile values | Include by default; removal is allowed only for an approved schema-classified field and must occur before both model input and observation hashing (§6.3) |
| URL boundary | Origin/path and semantic query/fragment fields are included; known tracking/session/non-semantic fields are excluded; unknown fields default to semantic inclusion (§6.3) |
| Identifier taxonomy | Action refs, semantic IDs, ordinary data IDs, runtime IDs, transport IDs, and unknown IDs have distinct conservative rules (§6.3) |
| Order semantics | Semantic and unknown order are preserved; only schema-declared unordered collections are canonicalized as sets (§6.3, §7.3) |
| Empty/partial/failed/unavailable | They are distinct typed outcomes with explicit recognition, current-state, and validation transitions (§8.2–§8.6) |
| Repeated equal observations | Every successfully recognized event creates a unique occurrence and atomically becomes current, even when both content identities are equal (§8.2) |
| Contract evolution | Observation equality is defined only within the same contract; structural equality requires same contract AND same compatible completeness scope; all other comparisons are `NOT COMPARABLE` (§7.4) |
| Structural evidence scope | `completenessScope` is structural comparison provenance, not structural identity content; it is not folded into the structural hash or encoded as a structural contract version; `NOT COMPARABLE` distinguishes contract incomparability from evidence/scope incomparability (§7.4, §10) |
| Outcome-independent structural comparison | Structural verdicts are determined exclusively by the two structural projections and their comparison provenance; observation outcome labels never directly set structural results (§7.4, §10) |
| Localization/copy-only | The sole bounded structural conditional; defaults to `DIFFERENT` unless a product schema declares canonical semantic equality, and never participates in correctness (§10.1) |

Concrete schemas, type names, identifiers, and adapter APIs remain deferred implementation representation; the semantics above do not.

## 14. Regression constraints

Any later implementation proposal MUST preserve the validated P2-A～P2-D lifecycle unless it separately presents new regression evidence and receives approval to alter it:

- ESM-safe snapshot hashing remains operational.
- Initial TEST snapshots and ordinary snapshots continue through one authoritative lifecycle.
- Current and decision identity state remains explicit and atomic during migration.
- Real `AgentLoop` lifecycle coverage remains in place and is extended rather than replaced by helper-only tests.
- Existing conservative action resolution is not weakened.
- `resolver_miss` remains a valid negative control.
- Coverage is not reset or falsely advanced to compensate for identity uncertainty.
- Resolver thresholds, Intent roles, Surface reconciliation, and ALIGN diagnostics are not opportunistically refactored as part of identity migration.

## 15. Explicitly deferred implementation questions

Approval of this semantic document does **not** approve answers to these questions:

- final interface/type/field names;
- digest/hash algorithm, truncation length, collision handling, or encoding;
- concrete normalization functions and parser changes;
- contract-version representation;
- sequence versus occurrence counters;
- persistence or external serialization;
- compatibility and data migration;
- log format and telemetry changes;
- adapter/API mechanics for declaring authoritative explicit, auto-, and tool-post observation outcomes (their lifecycle participation is normative in §8.4);
- implementation stages, deployment, feature flags, or rollback;
- P2-F and all P3～P10 work.

## 16. Approval gates

P2-E design is accepted only after all gates pass:

1. **E1 — Scope:** P2-A～P2-D remain closed; the document is design-only and excludes P2-F/P3+.
2. **E2 — Domain model:** observation content and structural identity have non-overlapping definitions and both derive independently from immutable raw evidence.
3. **E3 — Provenance model:** observation content equality, observation occurrence identity, and decision provenance are explicitly distinct; decision provenance references the exact request-bound occurrence and its content identity, with no independent content-hash semantics.
4. **E4 — Normalization policy:** the normative envelope and field policy (§6), field-semantic structural policy (§7), typed outcome lifecycle (§8), symmetric three-valued comparison for both domains (§7.4), and the structural evidence scope model are complete. Structural verdicts are determined exclusively by projections and comparison provenance, never by observation outcome labels. Localization/copy-only remains the single bounded structural conditional and cannot affect correctness.
5. **E5 — Executable invariant matrix:** every row derives Observation and Structural results independently from normative field classes, every successful recognition creates a new occurrence, cross-contract/domain comparison is `NOT COMPARABLE`, evidence/scope incomparability is distinguished from contract incomparability, and the complete→empty row has no outcome-derived structural verdict.
6. **E6 — Ownership:** each projection has one producer and downstream consumers cannot independently normalize or hash.
7. **E7 — Correctness boundary:** `Current(Oₙ)` has an authoritative atomic ingestion/invalidation lifecycle; typed acquisition outcomes and observation sources have explicit transitions; every observation-dependent action, including later actions in one multi-tool decision, compares exact request-bound provenance with the authoritative current occurrence; structural identity cannot substitute or suppress skew.
8. **E8 — Current-state mapping and design verdict:** descriptive behavior is accurate and is not mistaken for a regression or implementation commitment. Reviewers then issue the explicit `APPROVED` or `CHANGES REQUIRED` verdict. `APPROVED` closes P2-E only as a design milestone; production work still requires a separate implementation proposal.

## 17. Acceptance checklist

- [ ] Raw snapshot, model-visible observation, observation content identity, observation occurrence identity, structural identity, decision provenance, and lifecycle ordering are unambiguous.
- [ ] Observation content equality, observation occurrence identity, and decision provenance are explicitly non-equivalent.
- [ ] Every recognized observation occurrence is uniquely locatable, including repeated content-equal observations.
- [ ] The raw snapshot forks into two explicit projection paths; neither content identity derives from the other.
- [ ] Observation content identity equality guarantees equal model-visible snapshot evidence.
- [ ] Decision provenance binds the exact request occurrence and its content identity; it is not a third hash.
- [ ] Ref, timestamp, runtime ID, semantic text, ordinary data text, interaction, CSS, URL, and order cases are all covered.
- [ ] Structural normalization is schema/field-aware, and regex appearance is not the authority for structural semantics.
- [ ] ALIGN/stale-action correctness uses observation occurrence/provenance; structural equality cannot suppress skew.
- [ ] Structural identity is prohibited as a substitute for observation content identity or occurrence identity at every correctness-critical boundary.
- [ ] Consumer ownership is singular and downstream recomputation is prohibited.
- [ ] The observation envelope and field classes have normative projection policies; unknown fields use conservative defaults.
- [ ] Successful empty, accepted partial, failure, malformed partial, unavailable, and absent-body outcomes cannot collapse into one identity state.
- [ ] Every successfully recognized observation creates a unique occurrence and atomically becomes current, including content-equal repeats.
- [ ] Explicit, auto-, and tool-post authoritative observations share one recognition lifecycle; untyped snapshot-like text cannot supersede current.
- [ ] State-changing or indeterminate tool outcomes invalidate prior current observation until a new authoritative occurrence is ingested.
- [ ] Every observation-dependent action is revalidated immediately before execution, including remaining actions in a multi-tool response.
- [ ] Observation and structural identity comparison is three-valued: `SAME`, `DIFFERENT`, or `NOT COMPARABLE`. Structural NOT COMPARABLE distinguishes contract incomparability from evidence/scope incomparability.
- [ ] Structural verdicts are determined exclusively by the two structural projections and their comparison provenance. Observation outcome labels (complete, partial, empty, non-empty) never directly set Structural results.
- [ ] `completenessScope` is structural comparison provenance, not structural identity content, not a structural contract version, and not folded into the structural hash.
- [ ] The executable matrix derives each projection independently and permits only the bounded localization/copy structural conditional.
- [ ] Normative semantics and current implementation are clearly separated.
- [ ] P2-A～P2-D constraints are preserved without reopening their implementation.
- [ ] Concrete type names, algorithms, migrations, and implementation sequencing remain deferred; normative field/lifecycle/source policies do not.
- [ ] No production code, tests, P2-F, or P3～P10 changes are included.

Once this checklist and gates E1～E8 are approved, P2-E may be marked complete as a design milestone. That approval permits planning a separate implementation milestone; it does not itself authorize implementation.
