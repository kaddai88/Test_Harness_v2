# P6 Phase 2-D implementation review evidence

Status: `APPROVED / CLOSED`

P6 Phase 2-A through 2-D are `APPROVED / CLOSED`. Phase 2-D completed its
authorized source-level implementation and validation and received independent
Gate 2-D approval. Phase 2-E through 2-G remain `NOT AUTHORIZED`.

## Provider prerequisite

The provider-first prerequisite passed before SiteProfile caller migration:

- In-memory and JSON authority services share the datastore used by the
  compatibility repositories.
- Profile, locator-cache, metric, and idempotency changes publish as one
  authority transaction.
- A failed JSON commit publishes neither the mutation nor its idempotency
  record; reload preserves committed results and replay state.
- Same-record concurrent legacy/authority mutation fails closed while
  unrelated record changes are preserved.
- Replay returns the original result and a changed request under the same key
  raises an idempotency conflict.
- Read and export preparation paths do not mutate authority.

SQLite remains an unavailable runtime placeholder and PostgreSQL still has no
runtime provider. No runtime, deployment, or migration guarantee is claimed
for either backend.

## SiteProfile authority and caller migration

The SiteProfile authority service supplies mutation-free list and by-ID reads,
canonical ensure/create, modeled profile updates, dedicated locator-cache
replacement, delete, completed-session metric mutation, and an insert-only
import primitive. New profile IDs are deterministic functions of canonical
origin. Existing repository adapters remain available for compatibility.

Production caller source routing is migrated as follows:

- API SiteProfile routes use the authority service and no longer trigger a
  `.site-profiles` file-to-database sync from GET/read paths.
- Worker ensure, cache, and completed-session metric operations use the
  SiteProfile authority capability and no longer read or write file profiles.
- Browser and tools consume a persistence-neutral SiteProfile capability;
  neither package acquires a persistence dependency.
- Dashboard calls encode the complete canonical origin as one route segment.
  The API decodes that segment once and validates it through the shared
  canonical-origin normalizer.

Scheme, `www`, and non-default-port distinctions are preserved. Bare hostname
compatibility is read-only and cannot infer a scheme or create authority.
Production scans find no direct `repos.sites` callers, independent
`normalizeToHostname` implementation, or worker/tool profile file writer.

## Explicit configure-site scope

`configure_site` now requires one of two non-interchangeable scopes:

```text
profile scope
-> explicit canonical profile identity
-> modeled SiteProfile name/cache mutation only

session scope
-> explicit real sessionId
-> session-local runtime configuration only
-> no durable SiteProfile mutation
```

Implicit or inferred `current-session` scope is rejected. Auth, forms,
navigation, and constraints remain runtime-only and cannot be persisted as
unmodeled SiteProfile fields.

## Import, export, and cache boundary

The bounded SiteProfile importer is an internal insert-only command executor.
It validates canonical origins, skips existing authority, reports conflicts,
and has no GET/read or runtime registration. The browser file store produces a
canonical-origin-derived projection/export cache; projection reads, deletion,
or rescans cannot write back to or resurrect authority.

Locator data remains derived and rebuildable. Its dedicated replacement
operation cannot erase canonical origin, profile name, metrics, or other
modeled semantic fields. No importer was executed against actual legacy files.

## Metric ownership

The SiteProfile authority service is the production owner of `testCount` and
`lastTestedAt`. Metric idempotency uses the structured identity
`(profileId, completedSessionId)`. Only a completed core session with the same
canonical origin is eligible. Replay cannot increment twice, and an older
completion cannot move `lastTestedAt` backward. Failed, cancelled, or
origin-mismatched sessions are rejected.

## Validation

| Check | Result |
|---|---|
| Gate 2-D focused provider/service/caller/importer/cache/metric suite | 47/47 PASS |
| Persistence suite after final replay-conflict assertion | 77/77 PASS across 11 files |
| API suite | 14/14 PASS |
| Worker suite | 15/15 PASS |
| Core/browser/tools relevant suites | 24/24 PASS |
| Broader package regression total | 130/130 PASS |
| Core/browser/tools/persistence/API/worker/dashboard/server typecheck | PASS |
| Server dependency build | 16/16 packages PASS |
| Dashboard production build | PASS (existing large-chunk warning only) |
| Production direct `repos.sites` scan | ZERO |
| GET/read-triggered `syncSiteProfilesFromFiles` scan | ZERO |
| Production independent `normalizeToHostname` scan | ZERO |
| Worker/tool `loadSiteProfile` or `saveSiteProfile` scan | ZERO |
| Implicit production `current-session` target | ZERO; one explicit rejection sentinel remains |

## Data and scope check

Actual JSON data remains byte-for-byte unchanged from the closed A2 through
2-C baseline:

```text
data/testharness.json
B41324284CAB0C1FAE86A1AE50CF3A14B7FE5668B7D85D0ADA165DAE902C504E

apps/server/th-server/data/testharness.json
D5A3A642AA1F7B24191C79CBE61E3BEEE374CA66E6CAA2A20685296C40CEC398
```

No actual SiteProfile legacy import, schema/data migration, independent
deployment, authority activation, or coordinated cutover was executed.
Metadata ownership was not migrated, generic `updateMetadata` and repository
adapters remain available, SQLite/PostgreSQL were not enabled, and no Phase
2-E through 2-G implementation was started.

## Stop condition

```text
P6 Phase 2-D
-> APPROVED / CLOSED

P6 Phase 2-E through 2-G
-> NOT AUTHORIZED
```

Gate 2-D is closed. Its approval does not authorize deployment, importer
execution, 2-F cutover, or the next phase.
