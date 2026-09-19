# P6 Phase 2-B implementation review evidence

Status: `APPROVED / CLOSED`

2-A through 2-A2 remain `APPROVED / CLOSED`. 2-C through 2-G remain
`NOT AUTHORIZED`. This report records the additive 2-B implementation and its
subsequent formal Gate 2-B approval.

## Scope and entry points

All new implementation lives under
`packages/persistence/th-persistence/src/authority/`:

| File | Responsibility |
|---|---|
| `cognition.ts` | Four learned-entity kinds, shared identity normalization, explicit scope, provenance, create/update/delete/read APIs |
| `site-profile.ts` | Canonical-origin lookup, modeled profile fields, separate cache replacement, completed-session metric ownership |
| `metadata.ts` | Bound owner APIs, serialized field updates, immutable request data, worker snapshot replacement |
| `commands.ts` | Explicit import/export command validation, authorization, scope-proof verification and audit preparation only |
| `idempotency.ts` | Request hashes derived by the service, original-response replay, conflict detection within the entity transaction |
| `storage.ts` | Snapshot storage port and concrete in-memory adapter using the existing schema rows |
| `composition.ts` | Privileged internal construction of services sharing one storage adapter |
| `index.ts` | Public capability types; no storage adapters or composition functions exported |

The package adds `@test-harness/th-persistence/authority` as a public type
entry and re-exports those types from its existing root. Existing repository
exports, database factories and generic `updateMetadata` are retained.

## Policy implemented

- Site/global Cognition identity uses the frozen A1 mapper; explicit session
  identity uses the shared identity helpers. Episode storage still requires
  a site, as defined by the current schema. Session-scoped knowledge,
  procedures and patterns do not implicitly acquire a site association.
- Provenance is validated separately, including typed legacy IDs. Another
  observation of the same entity attaches provenance without replacing
  existing semantic content. Updates cannot rewrite identity or read-derived
  access counters.
- Mutation and its completed replay record share a staged storage transaction.
  Failed commits leave neither change published in the concrete reference
  adapter. Concurrent replays serialize; replay returns the original response
  even after later updates/deletion and cannot resurrect a deleted entity.
- SiteProfile mutations accept only the fields represented by the current
  schema. Arbitrary `modeledMetadata` is rejected. Locator cache replacement
  cannot overwrite profile name, origin or metrics. Metric keys are derived
  from an encoded `(profileId, completedSessionId)` tuple, and the completed
  session's origin must match the profile.
- Metadata owner is fixed during composition. Workers cannot write P2E or
  request fields. Findings and activities replace one result snapshot;
  append mode is not supported. Same-owner updates serialize and preserve
  unrelated owner partitions and legacy metadata. Request data is read-only
  after session creation, including legacy read compatibility.
- Command preparation requires an authorization callback, an import-scope
  verification callback and a successful audit callback. Nonempty actor/proof
  strings alone do not authorize a command. No importer/exporter executor,
  GET handler or file I/O is provided by this boundary.

## Validation

| Check | Result |
|---|---|
| Authority behavior tests | 18 PASS |
| Dependency boundary tests | 3 PASS |
| Combined authority, A2/core/cognition, storage and session-transition regressions | 80/80 PASS across 10 files |
| th-core typecheck | PASS |
| th-cognition `tsc --noEmit` | PASS |
| th-persistence typecheck | PASS |
| Dependency build through th-persistence | PASS (4 packages) |

The dependency tests freeze the nine legacy caller files by imported symbol,
reject new direct persistence/internal imports outside persistence, verify
the authority public entry is type-only, preserve existing adapter exports,
and check the relevant package graph for cycles and runtime-provider bypasses.
These are source/CI boundaries, not a runtime security sandbox. Existing
legacy callers are still privileged until their approved migration slices.

## Adapter and deployment limits

The concrete reference adapter is in-memory. The snapshot adapter also exposes
an internal load/commit composition port over existing row representations.
Its commit callback must publish the entity changes and idempotency records
together or throw without publishing; all services for a datastore must share
one adapter in the supported single-process topology.

No live JSON/SQL provider is bound to these services in 2-B. In particular,
the existing JSON provider's save method, which catches write errors, has not
been assumed to satisfy this commit contract. This report does not claim
live-provider transaction guarantees, crash durability, cross-process locking
or deployment readiness. Runtime binding/caller migration remains in the
later authorized slices and coordinated cutover.

## Scope check and stop condition

Only the new authority directory, the additive package/root exports, and this
review report changed for 2-B. Pre-existing unrelated working-tree changes
were retained. No production caller was migrated, no repository adapter was
hidden, and no legacy import, schema/data migration or cutover was executed.

The actual JSON data SHA-256 values remain unchanged from closed Gate 2-A2:

```text
data/testharness.json
B41324284CAB0C1FAE86A1AE50CF3A14B7FE5668B7D85D0ADA165DAE902C504E

apps/server/th-server/data/testharness.json
D5A3A642AA1F7B24191C79CBE61E3BEEE374CA66E6CAA2A20685296C40CEC398
```

Stop here for independent Gate 2-B implementation review. No 2-C–2-G work is
authorized by completion of these checks.
