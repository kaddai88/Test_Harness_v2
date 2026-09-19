# P6 Phase 2-E implementation-start gate

Status: `APPROVED / CLOSED`

The closed recovery point is:

```text
P6 Phase 2-A through 2-E — APPROVED / CLOSED
P6 Phase 2-F through 2-G — NOT AUTHORIZED
```

This document froze the independent 2-E implementation-start gate. The gate
was subsequently approved with the following explicit authorization:

```text
Authorize P6 Phase 2-E implementation only.
```

Implementation evidence is recorded in
`P6-PHASE2-E-IMPLEMENTATION-REVIEW.md`. Deployment, import execution,
coordinated cutover, and 2-F through 2-G remain unauthorized.

The independent implementation review subsequently approved and closed Gate
2-E. This closure does not authorize Phase 2-F planning or execution beyond a
separate implementation-start gate.

## Gate interpretation

Phase 2-E completes the source-level read/mutation and session-metadata cleanup
defined by the frozen Phase 2 plan. It removes durable writes from Cognition
read/search paths and migrates the remaining generic session-metadata writers
to owner-bound operations. It does not execute the 2-F migration window or
activate a coordinated authority cutover.

The supported topology remains one server process with in-memory or JSON
storage. Serialization guarantees in this gate are process-local authority
storage guarantees. Cross-process coordination and physical crash durability
remain P9 concerns.

## Frozen current-state inventory

| Area | Current effect | Required 2-E disposition |
|---|---|---|
| Episodic memory `get`/`search` | increments access statistics and saves the learned-entity file | access statistics may remain in-memory derived telemetry; read path performs no durable save |
| Semantic memory `get`/search-related reads | updates usage statistics and saves | derived telemetry only; no durable save from reads |
| Procedural memory search/read helpers | updates usage statistics and saves | derived telemetry only; no durable save from reads |
| Context awareness/retrieval | invokes the memory read paths above | no transitive durable write |
| Worker completion | generic `sessions.updateMetadata` of result fields | worker-result owner operation |
| Durable P2E session store | generic metadata read/merge/write/delete of `persistedSessionState` | P2E owner capability with replace/read/clear semantics |
| In-memory/JSON repositories | generic whole-map `updateMetadata` implementation | remove the generic mutator after caller closure; retain all other repository adapters |
| API session reads | reads result fields from legacy `metadata` | mutation-free owner-first compatibility projection |
| Session creation | request fields enter legacy metadata/scan config | typed immutable request-owner initialization or mutation-free compatibility read |

Production generic mutation callers currently consist of the worker result
writer and `DurableSessionPersistenceStore`. Tests, fakes, and repository
implementations must be included in the closure scan but do not expand the
semantic owner inventory.

## Frozen metadata ownership and policy

The field groups are:

| Owner | Fields | Mutation policy |
|---|---|---|
| request | `instructions`, `uploadedImages` | immutable after session creation |
| worker result | `summary`, `executionSummary`, `findings`, `activities`, `turns`, `score` | owner-bound replacement; `findings` and `activities` form one result snapshot |
| P2E | complete `PersistedSessionState` logical value | owner-bound replace/read/clear |
| Cognition | `references` | owner-bound replacement |
| SiteProfile | `references` | owner-bound replacement |

`turns` and `score` are frozen here as worker-result compatibility fields
because the production worker currently publishes them in the same completion
operation and the session API exposes `score`. They must not be silently lost,
left behind in a generic writer, or assigned to a new owner during migration.

The phrase "P2E identity state" denotes the complete existing
`PersistedSessionState`, not a reduced or parallel identity object. The current
legacy key is `metadata.persistedSessionState`; the 2-B scaffold named its owner
field `identitySemantics`. Implementation must converge these into one P2E
owner contract without creating two independent durable identities. The owner
representation uses the complete persisted state and retains mutation-free
compatibility reads for existing legacy values.

P2E clear must affect only the P2E-owned value. It must record an owner-level
absence/tombstone or equivalent explicit state so that a cleared value cannot
be resurrected by legacy fallback. It may not reconstruct and replace the
whole legacy metadata map.

### Worker result semantics

```text
summary / executionSummary / turns / score
-> replace only the named owner fields supplied by the operation

findings + activities
-> one replacement snapshot
-> both supplied together when either is replaced

append mode
-> not supported by the current contract
```

Missing fields mean "not supplied", not "delete another owner". Same-owner
operations execute in authority-storage serialization order; the last
successful operation in that order wins for the fields it supplies. Different
owners cannot select or overwrite each other's fields.

## Mutation-free compatibility projection

Session reads must preserve current API/dashboard behavior while owner data is
adopted. The read projection is deterministic:

```text
owner partition value for an owned field
-> wins

owned field absent from an uninitialized owner partition
-> legacy metadata compatibility value may be read

explicit owner clear/tombstone
-> wins over legacy fallback

unrelated legacy extension fields
-> remain present and unchanged
```

Projection, fallback, list, detail, P2E load, and existence checks are reads.
They must not backfill, save, commit, or initialize an owner partition. Existing
legacy sessions remain readable without executing a data migration.

Request fields are initialized only at session creation and are immutable
afterward. A typed request-owner creation input may be added; callers must not
receive a generic `metadataByOwner` injection surface.

## Supported-provider prerequisite

Before either production metadata caller is migrated, focused tests must prove
the full metadata owner behavior on both current providers:

```text
- in-memory and JSON services share the repository datastore
- owner mutation and JSON commit publish atomically
- failed JSON commit publishes no owner mutation
- committed owner state survives JSON close/reload
- different-owner concurrent updates preserve every owner partition
- same-owner concurrent updates follow deterministic serialization order
- cross-owner and unknown-field writes fail closed
- findings/activities incomplete snapshots and append mode fail closed
- mutation-free compatibility reads do not commit
- unrelated legacy metadata survives every owner mutation
- P2E replace/read/clear does not alter worker/request/domain fields
```

If this prerequisite fails, implementation stops before worker or Agent P2E
caller migration. It must not fall back to generic repository mutation or a
read/merge/write sequence.

SQLite and PostgreSQL are not current runtime providers. They are not 2-E
entry blockers and must not be enabled or claimed by this gate.

## Authorized implementation scope

Implementation must occur in this order:

1. Align the existing owner representation and service with the frozen field
   inventory, including worker `turns`/`score` and complete P2E persisted state.
   This uses the existing `metadataByOwner`/`metadata_by_owner` representation;
   it does not execute schema or data migration.
2. Complete the in-memory and JSON provider prerequisite above, including
   failure, reload, race, preservation, and cross-owner rejection tests.
3. Add persistence-neutral capabilities needed by worker result publication
   and Agent P2E replace/read/clear. Ordinary Agent code must not receive raw
   authority storage or a generic metadata mutation surface.
4. Migrate worker completion from `updateMetadata` to the worker-result owner
   operation while preserving all six currently published result fields.
5. Migrate `DurableSessionPersistenceStore` to the P2E owner capability.
   Preserve full-state restart recovery, mutation-free legacy reads, and
   owner-scoped clear behavior.
6. Add the mutation-free owner-first session metadata projection required by
   API/dashboard consumers and preserve unrelated legacy extensions.
7. Remove durable save effects from the inventoried Cognition get/search/read
   paths. Access counters may remain ephemeral derived telemetry only.
8. After production and compatibility callers are migrated, remove the generic
   `SessionRepository.updateMetadata` contract and its in-memory/JSON whole-map
   implementations. This does not authorize hiding other repository adapters.
9. Run focused provider, owner-policy, worker, Agent P2E, API projection,
   Cognition read-side, race, reload, regression, typecheck, build, dependency,
   and static closure validation; then stop.

## Hard boundary

The following remain prohibited throughout 2-E:

```text
- executing Cognition or SiteProfile legacy import
- running a schema or existing-data migration/backfill
- coordinated deployment or 2-F authority cutover
- automatic migration importer or reverse-sync activation
- broad repository hiding/removal beyond generic updateMetadata closure
- changing Cognition/SiteProfile authority or projection direction
- changing session lifecycle transition ownership
- enabling or claiming SQLite/PostgreSQL runtime providers
- cross-process locks, CAS, fsync, rename durability, WAL, or recovery work
- any 2-F or 2-G implementation
```

No focused test may use either actual JSON datastore or actual Cognition files
as a mutation target. Existing actual data must remain unchanged.

## Validation matrix

Gate 2-E may enter implementation review only with evidence for all of the
following:

```text
Cognition get/search/read durable writes                 — ZERO
access statistics durable authority                      — NONE
explicit learned-entity mutation behavior                — UNCHANGED

in-memory metadata owner semantics                       — PASS
JSON commit/failure/reload semantics                     — PASS
different-owner concurrent field preservation            — PASS
same-owner deterministic serialization                   — PASS
cross-owner / unknown-field mutation                     — REJECTED
findings/activities partial snapshot or append            — REJECTED

worker result fields including turns/score                — PRESERVED
P2E complete persisted state restart recovery             — PASS
P2E clear resurrection from legacy fallback               — ZERO
request fields after creation                             — IMMUTABLE
unrelated legacy metadata after owner updates              — PRESERVED
owner-first API/dashboard compatibility projection        — PASS
read projection/backfill commits                          — ZERO

production `updateMetadata` callers                       — ZERO
generic repository whole-map metadata mutator             — REMOVED
other repository adapters hidden/removed                  — NONE

legacy import / schema-data migration / cutover            — NONE
SQLite/PostgreSQL runtime enablement                       — NONE
actual JSON and Cognition files                            — UNCHANGED
focused/regression tests                                   — PASS
relevant typecheck/build/dependency checks                 — PASS
```

Static closure must cover worker completion, Agent durable-session save/load/
delete, repository interfaces and providers, API session list/detail
projections, Cognition memory get/search helpers, and context retrieval call
chains. Searching only direct `save()` calls or only production callers is
insufficient.

## Stop condition

The approved implementation and independent review stop at:

```text
P6 Phase 2-E
-> APPROVED / CLOSED

P6 Phase 2-F through 2-G
-> NOT AUTHORIZED
```

Gate closure does not authorize deployment, import execution, coordinated
cutover, repository closure beyond this gate, or the next phase.
