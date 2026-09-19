# P6 Phase 2-D implementation-start gate

Status: `APPROVED / CLOSED`

The closed recovery point is:

```text
P6 Phase 2-A through 2-A2 — APPROVED / CLOSED
P6 Phase 2-B               — APPROVED / CLOSED
P6 Phase 2-C               — APPROVED / CLOSED
P6 Phase 2-D               — APPROVED / CLOSED
P6 Phase 2-E through 2-G   — NOT AUTHORIZED
```

This document froze the independent 2-D implementation-start gate. The gate
was subsequently approved with the following explicit authorization:

```text
Authorize P6 Phase 2-D implementation only.
```

Implementation evidence is recorded in
`P6-PHASE2-D-IMPLEMENTATION-REVIEW.md`. Deployment, importer execution,
coordinated cutover, and 2-E through 2-G remain unauthorized.

## Gate interpretation

Phase 2-D may implement and test the SiteProfile source-level migration, but
the coordinated authority switch remains in 2-F. As in 2-C, source routing may
change only after explicit 2-D authorization and must be validated with
in-memory or temporary JSON stores. It must not be deployed or executed as an
independent migration.

The 2-D plan requirement to retire GET-triggered file-to-DB mutation means
removing that source path during caller migration. Gate 2-F must verify the
same path remains absent before coordinated cutover. The bounded legacy
importer may be implemented and tested in 2-D, but actual import execution is
reserved for 2-F.

## Frozen current-state inventory

The implementation review must account for these current callers and writer
effects:

| Area | Current effect | Required 2-D disposition |
|---|---|---|
| API site routes | local hostname normalization, direct `repos.sites` reads/writes, GET-triggered `.site-profiles` sync | shared canonical-origin contract and SiteProfile capability; remove read-triggered mutation |
| Worker session processor | local hostname normalization, direct profile create and metric increment, file profile read/write | SiteProfile authority capability; derived cache/export only |
| `configure_site` | implicit `current-session` file target | explicit profile or session scope; no implicit target |
| Browser profile store | hostname-derived whole-file read/write | legacy importer input or canonical derived export/cache only |
| Locator cache | runtime-derived cache | remain rebuildable; mutate only through the cache-owned authority operation when persisted |
| Dashboard site client | hostname/`baseUrl` route keys, with inconsistent URL encoding | canonical route key returned and encoded consistently |
| Repository adapters | direct create/update/delete/increment methods remain public | retain for compatibility; production callers stop using them in source |

The inventory includes reads used to resolve a SiteProfile before Cognition
operations. Migrating only obvious create/update calls is insufficient. No
production API, worker, browser, or tool caller may retain an independent
normalizer or a direct SiteProfile authority mutation.

## Canonical-origin and route-key contract

All 2-D paths consume `normalizeCanonicalOrigin` as the sole normative origin
contract:

```text
raw HTTP(S) target
-> shared canonical-origin normalizer
-> scheme://hostname[:non-default-port]
-> canonical SiteProfile lookup key
```

The following remain distinct and must not be collapsed:

```text
http://example.com
https://example.com
https://www.example.com
https://example.com:8443
```

API route keys and dashboard calls must use one deterministic encoding of the
canonical origin. The frozen representation is URL-encoding the complete
canonical origin as one route segment, decoding exactly once at the API
boundary, then validating it with the shared normalizer. Bare-hostname route
compatibility may read an existing legacy record only through an explicit
compatibility boundary; it may not guess a scheme or create/update authority.

Derived file names must also be collision-free functions of the complete
canonical origin. Legacy `<hostname>.json` names remain importer inputs only.
No runtime path may strip `www`, discard a non-default port, accept an invalid
host, or choose a scheme.

## Supported-provider prerequisite

The currently selectable runtime providers remain:

```text
no DB path  -> in-memory
DB path     -> JSON file
```

The shared authority runtime introduced in 2-C includes SiteProfile service
composition, but the existing provider evidence is primarily Cognition-led.
Before any SiteProfile production caller is migrated, focused tests must prove
the complete SiteProfile behavior on both current providers:

```text
- repositories and SiteProfile authority share one datastore instance
- create/update/delete/cache/metric mutations publish with idempotency state
- a failed JSON commit publishes neither mutation nor replay record
- concurrent same-record legacy/authority mutation fails closed
- unrelated-record provider changes are preserved
- canonical-origin and idempotency uniqueness remain enforced
- JSON profile, cache, metric, and replay results survive close/reload
- replay returns the original result; payload mismatch remains a conflict
- reads and exports do not mutate authority
```

If any prerequisite fails, implementation stops before caller migration. It
must not fall back to direct repositories, a second authority snapshot, file
authority, or best-effort JSON saving.

SQLite and PostgreSQL are not current runtime providers. They are not 2-D
entry blockers and must not be enabled or claimed by this gate. Each requires
its own future authority-adapter gate before runtime support.

## Authorized implementation scope

Implementation must occur in this order:

1. Complete the in-memory and JSON SiteProfile provider prerequisite above.
2. Add only the SiteProfile capability operations required by frozen callers,
   such as mutation-free list/by-ID/by-origin reads, canonical ensure/create,
   modeled name update, derived cache replacement, delete, and completed-
   session metric mutation. Do not expose repositories or mutable storage rows.
3. Provide an implementation-neutral SiteProfile capability to browser/tools
   callers through privileged composition. `th-browser` and `th-tools` must not
   acquire a runtime dependency on `th-persistence`.
4. Migrate API, worker, browser/file-store, tool, and dashboard caller surfaces
   to canonical-origin identity. Remove local hostname normalizers and direct
   SiteProfile repository authority calls from production callers.
5. Migrate `configure_site` to an explicit discriminated scope:
   - profile scope carries a canonical profile identity and may mutate only
     fields modeled by the current SiteProfile schema through authority;
   - session scope carries the actual `sessionId`, remains session-local
     runtime state, and does not mutate the durable SiteProfile;
   - `current-session`, CWD-derived targets, and inferred profile/session scope
     are rejected;
   - auth/forms/navigation/constraints remain unmodeled runtime fields and are
     not made durable in 2-D.
6. Downgrade `.site-profiles` to a bounded insert-only legacy importer input
   and optional authority-derived export/cache. The importer skips existing
   authority, reports conflicts, never chooses a scheme, and is never invoked
   by GET/read paths. Implement and test it without executing it.
7. Keep locator cache derived and rebuildable. Persisted cache replacement uses
   its dedicated authority operation and cannot supply or erase profile name,
   canonical origin, metrics, or unmodeled runtime fields. Export generation is
   one-way from authority/cache state and cannot write back automatically.
8. Make the SiteProfile authority service the only production owner of
   `testCount` and `lastTestedAt`. The mutation key is the structured identity
   `(profileId, completedSessionId)`; only a completed core session with the
   same canonical origin is eligible. Replay cannot increment twice, and an
   older completion cannot move `lastTestedAt` backward.
9. Add focused provider, service, API, worker, configure-site, importer/export,
   cache-preservation, metric replay, dependency, and dashboard contract tests.
   Run relevant regressions, typechecks, and dependency builds, then stop.

Metric idempotency is a P6 semantic guarantee in the supported single-process
topology. 2-D does not add cross-process locking or crash-atomic coupling
between session terminalization and profile metrics; those physical durability
claims remain outside P6. The normal completion/replay path must nevertheless
use the same profile plus completed-session identity every time.

## Hard boundary

The following remain prohibited throughout 2-D:

```text
- executing a SiteProfile legacy import against actual data
- schema changes, canonical backfill, or datastore migration
- independently deploying or activating SiteProfile authority routing
- coordinated authority cutover or migration-window execution
- session metadata owner migration or generic updateMetadata removal
- repository adapter hiding/removal
- durable storage of currently unmodeled auth/forms/navigation/constraints
- Cognition ownership changes beyond existing authority capability use
- SQLite or PostgreSQL runtime enablement/claims
- cross-process locking, fsync, or other P9 durability work
- any 2-E through 2-G implementation
```

Existing repository adapters remain available until the coordinated cutover.
No test may use either actual JSON datastore as a fixture or mutation target.
Actual `.site-profiles` files are read-only evidence and must not be imported,
rewritten, or deleted in 2-D implementation/testing.

## Validation matrix

Gate 2-D may enter implementation review only with evidence for all of the
following:

```text
in-memory SiteProfile authority semantics                  — PASS
JSON commit/failure/reload/replay semantics                — PASS
shared datastore and single-process serialization          — PASS
profile/cache/metric plus idempotency atomic publish       — PASS

same raw origin maps to one canonical profile key          — PASS
scheme/www/non-default-port distinctions preserved         — PASS
independent runtime hostname normalizers                    — ZERO
production direct repos.sites authority callers            — ZERO

API GET/read-triggered file-to-DB mutations                 — ZERO
bounded insert-only importer implementation                 — PASS
actual legacy import execution                              — NONE
stale file/export overwrites existing authority             — ZERO
projection deletion/rescan resurrects authority             — ZERO

configure_site implicit current-session target              — ZERO
profile/session scopes explicit and non-interchangeable     — PASS
unmodeled profile fields made durable                       — ZERO

locator cache classified as derived/rebuildable             — PASS
cache/export erases modeled semantic fields                 — ZERO
test-count/last-tested production metric owners             — ONE
profile + completed-session metric replay                   — IDEMPOTENT
failed/cancelled/mismatched session metric mutation          — REJECTED

metadata migration / repository hiding / cutover            — NONE
SQLite/PostgreSQL runtime enablement                         — NONE
actual JSON and legacy profile files                         — UNCHANGED
focused/regression tests                                     — PASS
relevant typecheck/build/dependency checks                   — PASS
```

The static closure check must cover all API route variants, worker completion
and enrichment paths, `configure_site`, browser file-store helpers, dashboard
route consumers, direct metric mutation, and GET-triggered sync symbols. It
must not rely on a search for create/update alone.

## Stop condition

Completion of 2-D implementation and validation stops at:

```text
P6 Phase 2-D
-> APPROVED / CLOSED

P6 Phase 2-E through 2-G
-> NOT AUTHORIZED
```

Passing tests does not authorize deployment, importer execution, 2-F cutover,
or the next phase. An unresolved provider prerequisite, canonical-origin
ambiguity, direct authority bypass, implicit scope, projection overwrite, or
metric replay defect is a hard stop.
