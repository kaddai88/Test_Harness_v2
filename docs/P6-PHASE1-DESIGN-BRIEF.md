# P6 Phase 1 — Persistence Ownership Contract Design Brief

**Status**: AUTHORIZED (design only)
**Based on**: `docs/P6-PHASE0-PERSISTENCE-OWNERSHIP-AUDIT.md` (APPROVED / CLOSED)
**Production code**: NOT AUTHORIZED

## Purpose

Define a single-authority ownership contract for Cognition and SiteProfile before any migration or implementation. Phase 1 must resolve semantic ownership, projection direction, identity, scope, restart behavior, and conflict policy without assuming that all data moves to the database or remains file-backed.

## Required contract sections

1. Scope and current ownership findings
2. Domain boundaries and data classification
3. Canonical authority decision for Cognition
4. Canonical authority decision for SiteProfile
5. Writer permissions and field ownership
6. One-way projection/import contract
7. Canonical identity and idempotency
8. Session/profile scope and normalization
9. Lossy projection and field preservation
10. Read mutation and statistics policy
11. Metadata merge/concurrency policy
12. Restart semantics and recovery boundary
13. P6/P9 boundary and approval gates

## Required ownership matrix

| Domain | Canonical authority | Writers | Projection target | Direction | Identity | Restart semantics |
|---|---|---|---|---|---|---|
| Cognition | TBD | TBD | TBD | one-way | canonical ID | TBD |
| SiteProfile | TBD | TBD | TBD | one-way | canonical hostname/profile ID | TBD |
| Session lifecycle | DB transition authority | transition primitive | UI/derived views | outward only | sessionId | durable per P5 |
| WorkingMemory | ephemeral or explicit authority decision | agent runtime | none or explicit projection | TBD | session-scoped | explicit |
| SessionLog | ephemeral or explicit authority decision | agent runtime | none or explicit projection | TBD | session-scoped | explicit |

## Mandatory decisions

### Single authority

Each domain must have exactly one canonical authority. The other copy may only be a projection, cache, or import staging target:

```text
authority → projection
```

Bidirectional `file ↔ DB` sync is not an accepted final contract.

### Identity

Define one canonical identity function used by producers, writers, and projectors. Repeated projection/import must be idempotent and must not create duplicate logical records. Preserve source IDs or define deterministic idempotency keys.

### Site scope

Define one hostname normalization owner and require all callers to use it. No persistence mutation may use an implicit global or hard-coded `current-session` target. Every mutation must bind to an actual session/profile identity where applicable.

### Projection fidelity

For fields the projection cannot represent, explicitly choose:

- intentionally lossy derived view, with documented non-authority; or
- expanded format that preserves authoritative fields.

No worker/API path may silently erase fields merely because its projection shape is smaller.

### Read mutation

A read/search/get path must not silently become an authority write. If access counters or statistics are durable, define them as an explicit mutation with an owner and conflict policy.

### Metadata concurrency

Define field-level ownership for summary, findings, activities, instructions, uploaded images, and P2E identity state. Choose replace, merge, append-only, version/CAS, or another explicit policy per field group. Shallow merge without ownership is not sufficient.

### Restart semantics

For every domain classify state as:

```text
durable authority
reconstructible projection
 ephemeral runtime state
```

If WorkingMemory or SessionLog remain ephemeral, state explicitly that restart loses them and does not promise reconstruction.

## P6-F1–F10 invariants

| ID | Invariant | Required evidence |
|---|---|---|
| P6-F1 | Every domain has exactly one canonical authority | Ownership matrix + writer inventory |
| P6-F2 | A projection never overwrites its authority | Directional write graph + negative test |
| P6-F3 | Repeated projection/import is idempotent | Same-input replay test |
| P6-F4 | Producers/projectors share canonical identity | Identity contract + duplicate prevention test |
| P6-F5 | No hard-coded or implicit `current-session` persistence target | Static audit + scoped mutation test |
| P6-F6 | Read-only paths cannot silently mutate authority | Read/write separation test |
| P6-F7 | Projection cannot accidentally erase authoritative fields | Field-preservation test or explicit lossy contract |
| P6-F8 | Concurrent metadata updates follow an explicit merge/CAS policy | Race test + field ownership matrix |
| P6-F9 | Restart semantics are explicit for every domain | Restart matrix and reload test where durable |
| P6-F10 | P9 physical durability concerns remain out of P6 | Scope audit; no fsync/rename/cross-process implementation |

## Phase 1 exclusions

Do not implement:

- schema migration;
- file locking or atomic rename;
- DB/file sync code;
- API or worker writer changes;
- Cognition or SiteProfile authority migration;
- queue/recovery changes;
- multi-process deployment;
- P9 physical durability work.

## Phase 1 exit criteria

Phase 1 closes only when:

1. Cognition and SiteProfile each have one explicit authority decision.
2. Writer permissions are field-specific and exhaustive.
3. Projection direction and deletion/resurrection semantics are explicit.
4. Canonical identity and idempotency are formalized.
5. Session/profile scope and normalization are fixed.
6. Lossy projection and read mutation policies are explicit.
7. Metadata concurrency policy is explicit.
8. Restart matrix is complete.
9. P6-F1–F10 each have evidence strategy.
10. P9 responsibilities remain explicitly excluded.

Final status after authoring:

```text
P6 Phase 0 — APPROVED / CLOSED
P6 Phase 1 — PROPOSED / AWAITING REVIEW
Production code — NOT AUTHORIZED
```
