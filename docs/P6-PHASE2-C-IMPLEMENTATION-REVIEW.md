# P6 Phase 2-C implementation review evidence

Status: `APPROVED / CLOSED`

P6 Phase 2-A through 2-C are `APPROVED / CLOSED`. Phase 2-D through
2-G remain `NOT AUTHORIZED`. This report records 2-C implementation,
validation evidence, and subsequent formal Gate 2-C approval.

## Provider prerequisite

The provider-first prerequisite passed before caller migration:

- The runtime factory now creates one shared datastore for repositories and
  authority services for both in-memory and JSON modes.
- Authority transactions apply record-level three-way changes. Unrelated
  concurrent legacy repository updates are preserved; same-record conflicts
  fail closed instead of overwriting either side.
- Entity mutations and idempotency records publish as one authority commit.
- JSON authority commits write a temporary file and replace the datastore
  before publishing the new in-memory state. Commit errors propagate and leave
  both the prior file and in-memory authority state unchanged.
- JSON entity/idempotency state survives reload and replays the original
  response. Read/query paths do not commit.

SQLite remains an unavailable runtime placeholder and PostgreSQL still has no
runtime provider. No transaction, deployment, or migration guarantee is
claimed for either backend. Cross-process locking and broader crash durability
remain outside this P6 gate.

## Cognition capability and callers

`th-cognition` defines a persistence-neutral learned-entity capability. In
authority mode, `CognitiveEngine` requires explicit site/session identity and a
stable session timestamp, uses the capability for startup retrieval and
session-end recording, and disables persistence for episode, semantic, and
procedure file memories.

Retained control state remains file-owned. The reinforcement learner, pattern
matcher control state, recovery state, strategies, and update log retain their
existing files and owners.

The authority service now supplies:

```text
site-scoped mutation-free list/query
site-scoped bulk delete
manual episode creation with service-owned idempotency
relative knowledge-confidence adjustment with service-owned idempotency
session retrieval and recording capability
atomic insert-only legacy import primitive
```

Production source routing is migrated as follows:

- Agent receives the learned-entity capability; it has no persistence package
  dependency.
- Worker passes the shared authority capability and no longer performs
  session-end `.cognition` file synchronization.
- API Cognition GET/list/create/update/delete/clear operations use the authority
  service. SiteProfile repository operations remain unchanged for 2-D.
- Cognition import is no longer triggered by GET or another read path.

## Bounded importer

The importer is an internal explicit-command executor with no runtime route or
file registration. It requires command authorization, verified scope and audit,
accepts only insert-only Cognition commands, enforces a finite row bound and
site scope, and performs existing-authority check plus insertion in one
authority transaction.

Existing authority is returned unchanged: the importer does not overwrite
semantic fields or attach provenance. Repeated focused execution is idempotent.
No importer was run against actual data.

## Validation

| Check | Result |
|---|---|
| 2-C focused provider/service/importer/partition/caller/boundary suite | 40/40 PASS |
| Core, Cognition and Agent suites | 516/516 PASS across 38 files |
| Persistence suite | 69/69 PASS across 9 files |
| Existing API regression suite | 9/9 PASS |
| 2-C API authority-route test | 1/1 PASS |
| Worker suite | 15/15 PASS across 5 files |
| Core/Cognition/Persistence/Agent/API/Worker/Server typecheck | PASS |
| Server dependency build | 16/16 packages PASS |
| Production direct `repos.cognition` caller scan | ZERO |
| GET/read-triggered `syncCognition*` scan | ZERO |

The first highly parallel Core/Cognition/Agent run had one dynamic-import test
reach its 15-second timeout; that test passed alone, and the complete 516-test
set then passed cleanly with four workers.

## Data and scope check

Actual JSON data remains byte-for-byte unchanged from the closed A2/2-B
baseline:

```text
data/testharness.json
B41324284CAB0C1FAE86A1AE50CF3A14B7FE5668B7D85D0ADA165DAE902C504E

apps/server/th-server/data/testharness.json
D5A3A642AA1F7B24191C79CBE61E3BEEE374CA66E6CAA2A20685296C40CEC398
```

No legacy import, canonical backfill, schema/data migration, independent
deployment, or authority cutover was executed. SiteProfile and metadata callers
were not migrated, repository adapters and generic `updateMetadata` remain
available, and no 2-D–2-G implementation was started.

## Stop condition

```text
P6 Phase 2-C
-> APPROVED / CLOSED

P6 Phase 2-D through 2-G
-> NOT AUTHORIZED
```

Stop here for independent Gate 2-C review.
