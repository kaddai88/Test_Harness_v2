# P6 Phase 2-C implementation-start gate

Status: `APPROVED / CLOSED`

The closed recovery point is:

```text
P6 Phase 2-A through 2-A2 — APPROVED / CLOSED
P6 Phase 2-B               — APPROVED / CLOSED
P6 Phase 2-C               — APPROVED / CLOSED
P6 Phase 2-D through 2-G   — NOT AUTHORIZED
```

This gate froze the 2-C implementation scope and was subsequently authorized.
Implementation evidence is recorded in `P6-PHASE2-C-IMPLEMENTATION-REVIEW.md`.
Import execution, deployment, coordinated cutover, and 2-D–2-G remain
unauthorized.

## Plan interpretation

Phase 2-C implements and tests Cognition writer migration machinery. The
coordinated authority switch remains in 2-F. Source-level routing may change
after 2-C is authorized, but it must be tested only against temporary or
in-memory stores and must not be deployed or run against the actual datastore
as an independently activated migration.

The 2-C gate requirement that read paths have zero authority writes means that
new Cognition authority read/query operations are mutation-free. Removal of
other legacy read-derived statistics remains in its frozen later slice; 2-C
must not move unrelated 2-E cleanup forward.

## Provider prerequisite

The current runtime factory supports two effective providers:

```text
no DB path  -> in-memory
DB path     -> JSON file
```

SQLite is currently an unavailable placeholder and PostgreSQL has schema DDL
but no runtime provider. They are not 2-C entry blockers. Either backend must
pass its own authority-adapter gate before it is later enabled as a supported
runtime provider.

Before changing any Agent, API, or worker Cognition caller, 2-C must first
wire and validate authority storage for both currently selectable providers:

```text
- repository and authority services share one datastore instance
- all authority services for that datastore share one adapter
- entity mutation and its idempotency record publish atomically
- a failed commit publishes neither and propagates the failure
- provider operations serialize in the supported single-process topology
- authority transactions cannot overwrite concurrent legacy-repository changes
- canonical and idempotency uniqueness checks remain active
- JSON idempotency/entity results survive close and reload
- replay returns the original result and payload mismatch remains a conflict
```

For JSON, the existing `save()` behavior that catches write failures is not a
valid authority commit implementation. The 2-C adapter must provide a
failure-propagating commit boundary without exposing raw storage to callers.
This gate does not add cross-process locking, PostgreSQL/SQLite runtime support,
or broader crash-durability guarantees outside the frozen P6/P9 boundary.

If any provider prerequisite fails, implementation stops before caller
migration. It must not fall back to a second independently owned authority
snapshot or to direct repository mutation.

## Authorized scope after explicit start approval

Work must occur in this order:

1. Implement and validate the in-memory and JSON authority adapters described
   above.
2. Add only the Cognition authority capabilities required by frozen callers:
   mutation-free scoped list/query operations and explicit site-scoped bulk
   deletion, with policy and idempotency retained in the service.
3. Define an implementation-neutral Cognition capability port in the Cognition
   layer so that `th-cognition` does not depend on `th-persistence`; implement
   that port through the authority service at privileged composition.
4. Route all Agent/API/worker learned-entity reads and mutations through that
   capability, preserving canonical entity identity, source occurrence, scope,
   and deterministic idempotency keys.
5. Split learned-entity persistence from retained `.cognition` control state.
   Q-values, matcher control patterns, recovery, strategies, and update-log
   files keep their approved owners and must not acquire learned-entity writes.
6. Implement the explicit bounded Cognition legacy importer: insert-only when
   authority identity is absent, skip existing authority, and report conflicts
   and provenance without updating authority.
7. Disconnect Cognition import/sync from GET and other read paths in the
   source-level migrated implementation. Do not execute the importer.
8. Add focused provider, service, caller, partition, importer, dependency, and
   regression tests; then stop for Gate 2-C review.

The caller inventory includes every actual Cognition authority operation, not
only create/update examples: session-end writes, startup retrieval, manual API
reads and writes, weight/feedback updates, site-scoped clear/delete operations,
and worker synchronization/import paths. A delete or bulk clear may not remain
as a direct repository bypass.

Additive list/query and site-scoped delete service operations are 2-C migration
support, not a reopening of 2-B. They must return capability-owned data and may
not expose repositories or mutable storage rows.

## Hard boundary

The following remain prohibited throughout 2-C:

```text
- executing legacy import against actual data
- canonical backfill or schema/data migration
- independently deploying or activating Cognition authority routing
- retiring reverse sync as a deployed behavior before coordinated cutover
- migrating SiteProfile callers or session metadata owners
- hiding repository adapters or removing generic updateMetadata
- enabling SQLite or PostgreSQL as a claimed supported runtime provider
- changing retained file-owned control-state ownership
- starting any 2-D through 2-G implementation
- executing the 2-F migration window or authority cutover
```

Existing repository adapters remain available until the coordinated cutover.
No test may use either actual JSON datastore as a fixture or mutation target.

## Gate 2-C validation and stop condition

Gate 2-C may enter final review only when all of the following are evidenced:

```text
in-memory authority adapter semantics                 — PASS
JSON authority adapter commit/failure/reload semantics — PASS
shared datastore and single-process serialization     — PASS
entity + idempotency atomicity and replay              — PASS

all Agent/API/worker Cognition authority callers       — MIGRATED IN SOURCE
direct learned-entity repository mutations by callers  — ZERO
canonical identity and separate provenance             — PASS
read/query authority mutations                         — ZERO

bounded importer repeated execution in tests           — IDEMPOTENT
existing authority auto-overwrite                       — ZERO
GET/read-triggered importer paths                       — ZERO
actual importer execution                               — NONE

learned-entity/control-state physical ownership         — PARTITIONED
retained control-state owners                           — UNCHANGED
SiteProfile/metadata caller migration                   — NONE
repository hiding / cutover                             — NONE
actual JSON data hashes                                 — UNCHANGED

focused and regression tests                            — PASS
relevant typecheck/build                                — PASS
dependency graph / authority bypass checks              — PASS
```

Then stop at:

```text
P6 Phase 2-C
-> APPROVED / CLOSED

P6 Phase 2-D through 2-G
-> NOT AUTHORIZED
```

The approved implementation authorization was:

```text
Authorize P6 Phase 2-C implementation only.

Follow the frozen provider-first order. Do not migrate a production Cognition
caller until the in-memory and JSON authority-provider prerequisite passes.
Do not execute import, deploy an independent writer switch, or begin 2-D–2-G.
Stop after Gate 2-C validation for independent review.
```
