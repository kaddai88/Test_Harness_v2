# P6 Phase 2-E implementation review evidence

Status: `APPROVED / CLOSED`

P6 Phase 2-A through 2-E are `APPROVED / CLOSED`. Phase 2-E completed its
authorized source-level implementation and validation and received independent
Gate 2-E approval. Phase 2-F through 2-G remain `NOT AUTHORIZED`.

## Cognition read-side closure

Episodic recall/search and semantic get/search retain only in-memory derived
usage telemetry. Procedural reads remain non-persisting. None of those paths
calls the file-backed `save()` operation, including through the context and
retrieval callers covered by the Cognition regression suite.

Explicit learned-entity create, update, delete, clear, and import mutations
retain their existing persistence behavior. Phase 2-E did not change their
authority direction or execute an import.

## Metadata ownership boundary

The owner inventory is implemented as frozen:

- request: immutable `instructions` and `uploadedImages`, initialized only by
  the typed session-creation input;
- worker result: `summary`, `executionSummary`, `findings`, `activities`,
  `turns`, and `score`;
- P2E: the complete `PersistedSessionState` logical value with replace, read,
  and owner-scoped clear;
- Cognition and SiteProfile: their existing owner-bound `references` fields.

Owners are bound by service composition and cannot be selected by mutation
input. Unknown or cross-owner fields fail closed. Worker findings and
activities must be replaced together. Same-owner updates execute in authority
storage serialization order, while different-owner updates preserve every
partition and unrelated legacy metadata.

P2E clear writes an owner-level null tombstone. Owner-first reads therefore do
not resurrect a cleared value from `metadata.persistedSessionState`. Legacy
owner reads and API projections are pure compatibility reads and do not
initialize, backfill, or commit owner partitions.

## Provider and caller closure

The in-memory and JSON providers use the shared authority datastore. Metadata
owner mutation, JSON commit, failed-commit rollback, reload, owner isolation,
and deterministic serialization are covered by focused provider tests. A
session created without request metadata omits the optional owner property
instead of publishing an explicit non-JSON `undefined` value.

Production caller routing is closed as follows:

- worker completion publishes all six result fields through the worker-result
  owner service;
- the Agent durable session store receives only a persistence-neutral P2E
  capability and no repository or generic metadata mutation surface;
- API session list/detail responses use the pure owner-first projection;
- session creation exposes only typed immutable request metadata;
- the generic `SessionRepository.updateMetadata` contract and both current
  provider implementations are removed after caller closure.

All other repository adapters remain available. No repository hiding beyond
the authorized generic metadata mutator closure was performed.

## Validation

| Check | Result |
|---|---|
| Metadata authority service/provider focused tests | 23/23 PASS |
| Metadata plus dependency-boundary focused tests | 28/28 PASS |
| API metadata creation/projection focused tests | 3/3 PASS |
| Agent P2E capability focused tests | 3/3 PASS |
| Cognition read-side focused tests | 3/3 PASS |
| Persistence full suite | 81/81 PASS across 12 files |
| API full suite | 16/16 PASS across 6 files |
| Agent full suite, one worker | 465/465 PASS across 32 files |
| Cognition full suite | 20/20 PASS |
| Worker full suite | 15/15 PASS |
| Server dependency typecheck graph | 30/30 tasks PASS |
| Server dependency build | 16/16 packages PASS |
| Production `updateMetadata` scan | ZERO |
| Agent `SessionRepository`/persistence dependency scan | ZERO |
| Worker direct generic metadata mutation scan | ZERO |
| Cognition read/get/search durable save scan | ZERO |
| Tracked diff whitespace check | PASS |

The Agent suite was run with one Vitest worker. Its dynamic-import log-level
tests, which had timed out under an earlier heavily parallel run, passed in the
complete constrained suite.

## Data and scope check

Actual JSON data remains byte-for-byte unchanged from the closed 2-D baseline:

```text
data/testharness.json
B41324284CAB0C1FAE86A1AE50CF3A14B7FE5668B7D85D0ADA165DAE902C504E

apps/server/th-server/data/testharness.json
D5A3A642AA1F7B24191C79CBE61E3BEEE374CA66E6CAA2A20685296C40CEC398
```

No legacy import, schema or existing-data migration, coordinated deployment,
authority cutover, SQLite/PostgreSQL runtime enablement, repository hiding, or
Phase 2-F through 2-G implementation was executed. Focused tests used in-memory
or temporary JSON stores and did not use actual Cognition files as mutation
targets.

The current transaction and serialization evidence applies to the supported
single-process in-memory and JSON topology. It does not claim cross-process
coordination, physical crash durability, or SQLite/PostgreSQL runtime authority
semantics.

## Stop condition

```text
P6 Phase 2-E
-> APPROVED / CLOSED

P6 Phase 2-F through 2-G
-> NOT AUTHORIZED
```

Gate 2-E is closed. Its approval does not authorize deployment, import
execution, coordinated cutover, repository closure beyond this gate, or the
next phase.
