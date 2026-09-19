# P6 Phase 1 — Persistence Ownership Contract

**Status**: APPROVED / CLOSED
**Formal verdict**: APPROVED
**Date**: 2026-09-14
**Revision**: R3 (legacy-import, metadata-policy, terminology, and document-consistency closure)
**Next milestone**: P6 Phase 2 — Implementation Planning (AUTHORIZED)
**Production implementation**: NOT AUTHORIZED

This document makes the semantic ownership decisions required before P6 implementation. It does not implement migrations, writers, projections, locking, or recovery.

---

## Revision History

### R0 — Initial proposal
Architecture direction established; formal review returned `CHANGES REQUIRED` for six design-level ownership gaps.

### R3 — Final contract consistency closure

**Verdict on R2**: `CHANGES REQUIRED` (2 contract-level consistency gaps + 4 editorial fixes)

R3 makes the following narrow changes without reopening authority selection, restart semantics, or the P6/P9 boundary:

1. Cognition and SiteProfile use the same deterministic insert-only automatic legacy-import precedence.
2. Metadata uses one current policy: field-owner serialized updates in the supported single-process topology; no current versioned-update option remains.
3. P6-F8 verification matches that policy with race, unrelated-field-preservation, serialization-order, and cross-owner rejection evidence.
4. SiteProfile identity terminology is consistently `canonical origin key` / `canonical origin normalizer`.
5. Element-cache ownership is named as a derived-cache writer, not a semantic authority writer.
6. Header, final status, and section numbering are synchronized.

---

## 1. Scope and Current Failure Model

P6 addresses logical ownership and convergence for Cognition and SiteProfile. It does not address physical file durability.

The current system has split behavior:

```text
Agent cognition       → .cognition/*.json
API/worker cognition  → DB projection and direct DB mutations

Browser/worker profile → .site-profiles/*.json
API/site profile      → DB projection and direct DB mutations
```

The same logical facts can therefore have competing values. P6 replaces that ambiguity with one authority per logical subdomain and one-way projections.

### 1.1 Explicit non-goals

P6 does not implement or guarantee:

- atomic rename or fsync;
- crash-consistent physical files;
- corruption recovery;
- cross-process locks or transactions;
- durable queue/replay;
- API/worker process splitting;
- retry/watchdog behavior.

Those are P9 or separate milestones.

---

## 2. Domain Boundaries and Data Classification

A “domain” is divided into logical subdomains when fields have genuinely different ownership. Two stores holding the same logical fact are never both authoritative.

### 2.1 Canonical ownership matrix

| Domain | Canonical authority | Allowed authority writers | Projection/cache | Direction | Identity | Restart semantics |
|---|---|---|---|---|---|---|
| **Cognition: durable learned entities** (episodes, semantic knowledge, procedures, patterns) | **DB cognition tables** | Explicit cognition write service/repository only | `.cognition` files are legacy import input and agent-read cache during migration; they are not authority | DB → file/read projection; automatic legacy import is insert-only when authority is absent, and skips existing authority | Stable canonical entity ID / idempotency key | DB survives when durable DB configured; projection is rebuildable |
| **Cognition: runtime learning controls** (Q-values, recovery, strategies, update logs) | **Cognition files initially** | Cognition engine's single serialized semantic writer for each control-state partition | No DB projection in P6 unless separately designed | file only | Stable key scoped by site/model/policy as applicable | File reload if parseable; physical crash durability is P9 |
| **Cognition: WorkingMemory** | **Ephemeral agent runtime** | Agent runtime | None | None | session-scoped | Lost on restart by design |
| **Cognition: SessionLog** | **Ephemeral in current P6** | Agent runtime | Optional derived summary/metadata | outward derived only | sessionId + event sequence | Lost on restart; no recovery claim |
| **SiteProfile: canonical site identity and persisted profile fields** | **DB `site_profiles`** | SiteProfile write service/repository only | `.site-profiles` is legacy import input and optional cache/export | DB → file/read projection | Canonical origin key | DB survives with durable DB; file projection rebuildable |
| **SiteProfile: runtime browser locator cache** | **Ephemeral/derived cache** | SmartLocator/browser runtime | Optional DB cache projection only if explicitly classified | outward derived only | profile key + normalized hint | Rebuildable/lost on restart unless promoted later |
| **Session lifecycle** | DB transition authority | P5 transition primitive | API/dashboard views | outward only | sessionId | Durable per P5 |

### 2.2 Important consequence

The authority decision is **not** “all files move to DB”:

- DB is canonical for durable Cognition entities and canonical SiteProfile records.
- Cognition control files remain an explicitly separate logical subdomain for P6, owned by the cognition engine.
- WorkingMemory and SessionLog remain ephemeral.
- A field is never simultaneously authoritative in file and DB.

If a future requirement promotes a currently file-owned control field to durable DB state, that is a new field-level ownership decision and migration, not an implicit projection.

---

## 3. Cognition Authority Contract

### 3.1 DB-authoritative learned entities

The following are DB-authoritative logical entities:

```text
cognition_episodes
cognition_knowledge
cognition_procedures
cognition_patterns
```

The DB owns their canonical identity, site association, content, lifecycle, and user-visible mutations.

Allowed writers:

1. a designated cognition write service/repository;
2. explicitly authorized API operations routed through that service;
3. an explicitly authorized worker import/projector routed through that service.

The AgentLoop/CognitiveEngine must not silently create a competing authoritative file record after the migration boundary. During migration, file records are import input or read cache only, with explicit provenance.

### 3.2 Cognition file role

`.cognition/*.json` has one of two permitted roles per file/subdomain:

- **legacy import source**: read by a controlled importer, never treated as a competing authority after import;
- **agent read cache/export**: generated from DB authority and safe to delete/rebuild.

The final P6 contract must not use generic “sync files to DB” and “sync DB to files” language. Each operation must be named as one of:

```text
importLegacyCognition
exportCognitionReadCache
readAuthoritativeCognition
writeAuthoritativeCognition
```

An importer must not overwrite DB-authoritative user mutations. Automatic legacy import is strictly insert-only:

```text
canonical authority record absent
→ insert/import once

canonical authority record exists
→ SKIP authority update
→ optionally attach/report provenance conflict
→ never automatic update
```

After cutover, background legacy import is disabled. An explicit operator import is a separate authorized mutation with an audit/conflict decision; it is not part of automatic projection.

### 3.3 File-owned runtime controls and physical writer boundaries (R1-3)

Q-values, recovery state, strategies, and update logs remain file-owned in P6 because the current DB schema does not model them. Their files are not projections of DB learned entities and must not be imported into those tables by shape alone.

A physical whole-file artifact may not have independent authority writers from different logical subdomains. For each file-owned control partition, P6 requires one serialized semantic writer:

```text
same control-state partition
→ one cognition-engine writer authority
→ all mutations pass through that authority
```

If a file contains multiple subdomains, implementation must either:

1. split them into separate physical files/namespaces; or
2. retain one composite writer/serialization authority that owns every mutation to that file.

A DB exporter, API route, or projection process must never read a stale whole-file snapshot and write it back while another control-state writer can mutate the same artifact. P9 may later improve physical durability and cross-process locking, but this P6 rule prevents semantic double-writer ownership within the supported topology.

This is an intentional field-level split, not a two-authority exception.

### 3.4 Cognition identity and provenance (R1-1)

Entity identity and source occurrence are different facts.

```text
CanonicalEntityIdentity
≠
SourceOccurrenceIdentity / Provenance
```

Identity semantics are defined by entity kind:

| Entity kind | Canonical entity identity | Occurrence/provenance |
|---|---|---|
| Episode | occurrence-bound: domain + scope + logical occurrence identity | producer/session/source occurrence attached as provenance |
| Semantic knowledge | stable logical knowledge identity derived from normalized scope + knowledge subject/content key | every producer/session observation attached as provenance |
| Procedure | stable logical procedure identity derived from normalized scope + procedure subject/step key | producer/session observations attached as provenance |
| Pattern | stable logical pattern identity derived from normalized scope + normalized pattern key | detection occurrences attached as provenance |

`producerIdentity` and `sessionId` are therefore provenance inputs by default, not automatic parts of the canonical identity for semantic knowledge, procedures, or patterns. They are part of episode identity only when they define the logical occurrence.

The exact hash/encoding is an implementation detail, but the semantic inputs above are fixed. Every DB-authoritative entity must preserve source/provenance fields separately from its canonical entity key. Repeated import of the same logical entity is an idempotent upsert; repeated observation adds provenance or updates the entity according to the field policy, never a duplicate entity.

### 3.5 Cognition scope

Every cognition entity must have explicit scope:

- `siteId` for site-specific knowledge;
- nullable/explicit global scope for universal knowledge;
- `sessionId` for provenance, not as an implicit authority target;
- producer/source identity for import provenance.

No importer may assign the current request’s site ID to a source record without proving that the source belongs to that site.

### 3.6 Learned-entity physical write boundary

DB-authoritative learned entities and file-owned control state must not share an independently writable whole-file artifact. Before any projection/export implementation, the physical layout must satisfy the R1-3 rule:

```text
one physical artifact
→ one semantic writer authority per mutation partition
```

If the existing `.cognition` layout cannot provide that boundary, implementation must split files/namespaces or route all mutations through one composite writer. This is a P6 semantic writer rule; P9 may later add stronger physical locking/durability.

## 4. SiteProfile Authority Contract

### 4.1 DB-authoritative profile

DB `site_profiles` is canonical for:

```text
canonical profile identity
canonical origin key
profile display name
explicit persisted profile metadata represented by the schema
site test metrics
```

The **locator/element cache is not semantic profile authority**. It is a derived runtime cache that may be persisted as a DB cache projection for performance, but it remains rebuildable and must never determine canonical profile identity or overwrite authoritative profile metadata. If the DB stores `elementCache`, its owner is the SiteProfile service as a cache writer, with explicit replacement/merge semantics; the cache's persistence does not promote it to semantic authority.

The DB repository/write service is the only authority writer. API edits, worker learning updates, and configuration mutations must route through it after the implementation cutover.

### 4.2 File role

`.site-profiles/<canonical-host>.json` becomes:

- legacy import input during migration;
- optional derived/export cache after DB authority is established.

It is not an authority after cutover. A later file scan must never overwrite a DB-authoritative edit. Deleting the file projection must not delete the DB authority; deleting a DB projection must not resurrect it from an unapproved stale file.

If import is retained, its conflict policy is deterministic:

```text
automatic legacy import
→ insert-only when canonical authority record is absent
→ if canonical record exists: SKIP, never update authority
→ after cutover: background legacy import disabled

explicit operator import
→ separate authorized conflict-resolution operation
→ may update authority only with explicit operator decision and audit record
```

No implicit version/watermark/tombstone choice is deferred to an importer. Deletion follows authority semantics: deleting a projection never deletes authority; deleting authority suppresses/revokes its projections, and stale legacy files cannot resurrect it.

### 4.3 Full runtime profile and lossy projection

The current runtime `SiteProfile` includes auth, forms, navigations, constraints, and locator cache, while current DB/file persistence formats retain only a subset.

P6 chooses an explicit policy:

```text
DB site_profiles is the authority for currently modeled semantic/profile fields.
The locator/element cache is a rebuildable derived cache, even when stored in DB.
The current reduced file/DB shape is intentionally lossy for unmodeled runtime fields.
Unmodeled fields are runtime-derived and must not be silently claimed durable.
```

Before any unmodeled field is made durable, the schema and authority contract must be expanded first. A reduced projection writer must never reconstruct a partial profile and overwrite the authoritative modeled representation or its cache without an explicit cache policy.

### 4.4 Canonical SiteProfile identity and normalization (R1-2)

SiteProfile identity is a canonical **origin key**, not an unqualified hostname. One shared normalization function owns it:

```text
raw target URL
→ parse URL
→ lowercase scheme + hostname
→ convert hostname to ASCII IDNA/punycode
→ remove a single trailing dot
→ remove default port (80 for http, 443 for https)
→ preserve non-default port
→ discard path/query/fragment
→ canonical origin key: `${scheme}://${hostname}[non-default-port]`
```

Concrete rules:

- `http://example.com` and `http://example.com:80` are the same key.
- `https://example.com` and `https://example.com:443` are the same key.
- `http://example.com` and `https://example.com` are different keys.
- non-default ports remain part of identity (`example.com:8443` differs from `example.com`).
- `www.example.com` is **not** stripped; it is a distinct hostname unless an explicit future alias policy is approved.
- Unicode and punycode forms normalize to the same ASCII IDNA hostname.
- invalid URLs/hosts fail closed and do not produce a profile key.

All browser, worker, API, importer, and file-store paths must consume this shared normalization contract. File names, DB uniqueness keys, API route IDs, and worker lookups derive from the canonical origin key. No caller may independently strip `www`, preserve ports, or choose a filename convention.

A profile mutation binds to canonical `profileId`/origin key, never `current-session`, process CWD, or an unvalidated raw URL.

### 4.5 Configure-site scope

`configure_site` must require an actual target/profile identity. The hard-coded `current-session` target is forbidden:

```text
no implicit current-session persistence target
```

If a configuration is session-specific, it must carry `sessionId` and remain session-scoped. If it changes a SiteProfile, it must carry the canonical `profileId`/origin key and use the SiteProfile authority writer. These are distinct operations and must not be inferred from one another.

---

## 5. Writer Permissions and Field Ownership

### 5.1 Cognition field ownership

| Field group | Authority writer | Projection writers | Forbidden behavior |
|---|---|---|---|
| Episode identity/content/outcome | cognition write service | file export only | DB and file independently creating same episode |
| Semantic knowledge | cognition write service/API-approved mutation | file export only | DB-only edits later overwritten by file import |
| Procedures/patterns | cognition write service | file export only | importer assigning unproven site scope |
| Q-values/recovery/strategies | cognition engine file writer | none in P6 | treating DB projection as authority |
| Access counters/statistics | **Derived telemetry in P6; no durable authority write** | none | reader silently saving counters |
| WorkingMemory | agent runtime | none | claiming restart recovery |

### 5.2 SiteProfile field ownership

| Field group | Owned writer | Projection/cache writers | Forbidden behavior |
|---|---|---|---|
| profile ID/origin key/name | SiteProfile repository | file export | multiple normalization rules |
| locator/element cache | **SiteProfile cache writer; derived/rebuildable** | file export/cache | stale file replacing DB semantic fields |
| auth/forms/navigation/constraints | not durable under current shape; runtime owner only | none | reduced projection erasing or claiming these fields |
| test count/last tested | SiteProfile authority service, exactly once per completed core session | none | worker and sync path double increment |
| updated timestamps | authority writer per record | projection timestamp separate | one timestamp representing multiple facts |

### 5.3 Session metadata ownership

`SessionRow.metadata` is not one homogeneous ownership domain. P6 must define field groups:

```text
instructions / uploadedImages → session creation/request owner
summary / findings / activities / executionSummary → worker result owner
P2E identity state → durable session persistence owner
P6 cognition/profile references → explicit owner, not arbitrary merge
```

Until field-level merge/versioning is implemented, writers must not use shallow whole-map replacement for unrelated fields. A projection may not erase authority-owned metadata fields merely because they are absent from its input.

---

## 6. One-Way Projection and Deletion Semantics

### 6.1 Projection graph

The approved logical graph is:

```text
DB cognition authority      → optional .cognition read cache/export
DB SiteProfile authority    → optional .site-profiles export/cache
DB session authority        → API/WebSocket/dashboard views
file-owned cognition controls → cognition engine readers/writers only
runtime cache               → no authority projection by default
```

Legacy file import is a bounded migration input, not an ongoing reverse edge.

### 6.2 Rebuildability

A projection is **reconstructible** only if:

1. authority identity is stable;
2. all required authority fields are available;
3. projection generation is deterministic/idempotent;
4. deletion/tombstone policy is preserved.

Deleting a projection and rebuilding it must not alter the authority.

### 6.3 Delete/update behavior

| Operation | Authority effect | Projection effect |
|---|---|---|
| authority update | changes canonical record | projection marked stale/rebuilt |
| projection delete | no authority change | projection may be recreated |
| authority delete | canonical tombstone/delete policy applies | projection removed or omitted; stale file cannot resurrect it |
| legacy import after authority exists | no overwrite without explicit version/provenance acceptance | importer reports conflict/skip |

No background GET handler may mutate authority merely by discovering a stale file.

---

## 7. Identity, Provenance, and Idempotency Contract

### 7.1 Cognition identity

For each source record, retain:

```text
source system/file identity
producer identity
logical occurrence identity
site/global scope
source version or observed-at provenance
```

The DB’s internal UUID is not sufficient for dedupe if the source can be replayed.

### 7.2 SiteProfile identity

The canonical SiteProfile key is the output of the one shared **canonical origin normalizer**. All file names, DB uniqueness keys, API route IDs, and worker lookup keys must derive from that canonical origin key.

### 7.3 Provenance versus authority

Provenance records where a value came from; it does not grant the source authority. A file import may retain source provenance while the DB remains authoritative.

### 7.4 Replay rule

Repeated worker completion, API GET, restart import, or cache export must be safe:

```text
same logical input + same authority version
→ same canonical record/projection
```

No replay may increment metrics, duplicate episodes, or overwrite newer authority without an explicit conflict decision.

---

## 8. Read Mutation and Statistics Policy

### 8.1 Default rule

```text
read/search/get
→ no silent durable authority mutation
```

Cognition access counters, last-accessed values, confidence adjustments caused only by reading, and pattern detection statistics are **derived telemetry in P6**. Readers may update request-local/in-memory counters, but must not persist them. Any future durable statistics must be an explicitly authorized mutation contract with a named owner and concurrency policy.

A reader must not call `save()` as an incidental consequence of returning data.

### 8.3 Derived telemetry

Metrics not needed for authority or restart correctness should remain derived telemetry. Derived telemetry must never be used to reconstruct authoritative knowledge or profile state.

---

## 9. Metadata Concurrency Contract

### 9.1 Field-level policy

P6 does not approve generic shallow merge for `SessionRow.metadata`. The concrete policy for currently existing fields is:

| Field group | Owner and policy |
|---|---|
| instructions/images | request owner; immutable after creation |
| summary/executionSummary | worker result owner; replace only those named fields |
| findings/activities | worker result owner; replace the session result snapshot as one owned group |
| identity semantics | durable session-persistence owner; field-scoped update, never generic merge |
| cognition/profile references | owning Cognition or SiteProfile domain owner; field-owner serialized update in the supported single-process topology |
| access counters/statistics | derived telemetry in P6; not persisted by readers |

Workers and other callers must not use whole-map shallow merge to update a field group they do not own. Missing fields mean "not supplied", not delete.

### 9.2 Conflict behavior

The selected policy is **field-owner serialized update** for the current single-process topology. Each owner updates only its field group through a field-scoped repository operation; unrelated groups are preserved. Append-only event records or CAS/versioned updates may be introduced later only as an explicit contract revision.

For a concurrent update from the same owner, the latest operation in that owner's serialization order replaces that owner's result group. A different owner cannot overwrite it because it cannot write that field group. There is no generic last-writer-wins across unrelated metadata groups.

P2E identity state remains a dedicated session-persistence field contract; it is not merged through arbitrary worker metadata updates.

### 9.3 Projection constraint

A projection writer may update only fields it owns. Missing fields mean “not supplied,” not “delete the authority value.”

---

## 10. Restart Semantics

### 10.1 State classes

Every state belongs to exactly one class:

| Class | Meaning |
|---|---|
| Durable authority | Must survive configured durable-store restart and is the source for rebuild |
| Reconstructible projection | Can be deleted/rebuilt from authority without changing semantics |
| Ephemeral runtime state | Intentionally lost on restart; no recovery claim |

### 10.2 Domain restart matrix

| Domain | Class | Restart source | Explicit guarantee |
|---|---|---|---|
| DB cognition learned entities | Durable authority | DB | reload authority; rebuild file cache |
| File cognition controls | Durable authority within file-owned subdomain, physical durability deferred | cognition files | reload latest parseable state; no P9 crash guarantee |
| SiteProfile DB record | Durable authority | DB | reload canonical profile/metrics |
| SiteProfile file | Reconstructible projection/legacy import input | DB export or controlled import | file absence does not erase DB |
| WorkingMemory | Ephemeral | none | lost on restart |
| SessionLog | Ephemeral in P6 | none | lost on restart; summaries are not full log recovery |
| Session lifecycle | Durable authority | P5 repository | reload terminal/intent fields per P5 |
| Queue jobs | Ephemeral current queue | none | lost on restart; durable replay deferred |
| P2E identity state | Durable session metadata/logical record | DB metadata | restore semantics/counter per existing P2E contract; physical durability P9 |

### 10.3 Clean restart versus crash

A clean restart reloads the configured authority and reconstructs projections. A crash during a physical write may produce partial or stale data; P6 does not define repair. P9 owns that physical outcome.

---

## 11. P6/P9 Boundary

### P6 owns

```text
logical authority
allowed writers
field ownership
projection direction
identity/provenance/idempotency
scope and normalization
read versus mutation semantics
metadata conflict policy
restart meaning and source selection
```

### P9 owns

```text
atomic rename
fsync/write-ahead logging
crash-consistent snapshots
corruption detection/recovery
cross-process file/database coordination
physical JSON durability
```

P9 cannot decide which copy wins a semantic conflict. P6 cannot claim that a mutex, parseable reload, or source selection makes a write physically crash-safe.

---

## 12. Current Implementation Mapping

This is a mapping of current facts to the future ownership work; it is not an authorization to modify these files in Phase 1.

| Current site | Current behavior | Contract classification | Future action class |
|---|---|---|---|
| `packages/cognition/th-cognition/src/cognitive-engine.ts:57-175` | file-backed cognition engine, per-session construction, session-end writes | file-owned controls + legacy/source/cache behavior must be split by subdomain | migrate/read through authority or retain explicit file-owned controls |
| `packages/cognition/th-cognition/src/memory/*` | whole-file stores; some reads mutate stats | file writers/read-mutation risks | separate read and mutation APIs; assign ownership |
| `packages/agent/th-agent/src/loop.ts:425-438,606-650` | reads cognition files; finalizes cognition | agent consumer/producer | route durable learned entities through authority; preserve ephemeral semantics |
| `packages/worker/th-worker/src/processors/test-session.ts:565-572,813-877` | files→DB cognition sync; source IDs not preserved reliably | legacy importer/projection conflict | controlled idempotent import or remove reverse sync |
| `packages/api/th-api/src/routes/sites.ts:73-254` | GET-triggered files→DB sync | implicit reverse projection writer | replace with explicit controlled import/read path |
| `packages/api/th-api/src/routes/sites.ts:375-436,502-574` | DB-only SiteProfile/cognition mutations | current DB projection writer | route to chosen DB authority service |
| `packages/browser/th-browser/src/site-profile-store.ts:30-101` | current file store, whole-file writes | legacy projection/import store | consume shared canonical origin normalizer; export/cache only after cutover |
| `packages/tools/th-tools/src/builtins/configure-site.ts:74-165` | hard-coded `current-session`; reduced persistence | invalid implicit scope | require profile/session identity |
| `packages/worker/th-worker/src/processors/test-session.ts:248-560` | DB site ensure + file profile read/write | split SiteProfile writers | consolidate via DB authority and explicit export |
| `packages/persistence/th-persistence/src/schema.ts:53-129` | DB schema models reduced site/cognition fields | current authority candidate | expand only if future contract promotes fields |
| `packages/persistence/th-persistence/src/providers/*` | in-memory/JSON persistence | storage implementation | P9 physical issues remain separate |
| `packages/agent/th-agent/src/durable-session-persistence.ts:29-109` | P2E state in session metadata with read/merge/write | separate session metadata owner | apply field-level policy; do not conflate with cognition |
| `apps/web/th-dashboard/src/pages/Sites.tsx:16-118,228-309` | reads DB/API projection; mutation UI | projection consumer | consume authoritative DB responses; no local authority |

### 12.1 Required future writer inventory

Before implementation, enumerate every writer by logical field, including:

- direct file writes;
- DB repository writes;
- import/projector writes;
- read methods that call save;
- constructor default writes;
- API GET side effects;
- worker post-processing;
- generated/runtime entrypoints.

No implementation milestone closes until the inventory shows one authority writer per logical fact.

---

## 13. Invariant Matrix and Approval Gates

### 13.1 P6-F1–F10

| ID | Invariant | Verification strategy |
|---|---|---|
| **P6-F1** | Every logical domain/subdomain has exactly one canonical authority | Complete ownership matrix and field-level writer inventory |
| **P6-F2** | Projection never overwrites authority | Directional write graph + negative projection test |
| **P6-F3** | Repeated projection/import is idempotent | Replay same source set and assert stable entity count/values |
| **P6-F4** | All producers/projectors share canonical identity | Identity/property tests and duplicate-import regression |
| **P6-F5** | No implicit `current-session` persistence target | Static search + configure-site scoped mutation test |
| **P6-F6** | Read-only paths cannot silently mutate authority | Spy/write-count tests for search/get/read APIs |
| **P6-F7** | Projection cannot accidentally erase authoritative fields | Field-preservation tests or explicit lossy projection assertions |
| **P6-F8** | Concurrent metadata updates use field-owner serialized update in the supported single-process topology | Per-field race tests, unrelated-field preservation, same-owner serialization ordering, and cross-owner write rejection |
| **P6-F9** | Restart semantics are explicit and match authority class | Clean restart/reload tests; crash behavior deferred to P9 |
| **P6-F10** | P9 physical durability concerns remain outside P6 | Scope audit; no rename/fsync/cross-process implementation |

### 13.2 Design approval gates

Before P6 implementation planning is authorized, review must approve:

- G1: DB authority for durable Cognition learned entities, with explicit file-owned controls and physical writer boundary;
- G2: DB authority for modeled SiteProfile fields, with file as import/cache/export only and locator cache classified as derived;
- G3: one-way projection graph, deterministic legacy import precedence, and no background bidirectional sync;
- G4: entity-kind-specific canonical cognition identity plus separate occurrence/provenance;
- G5: canonical origin normalization rules and shared normalization owner;
- G6: explicit session/profile scope and removal of `current-session` semantics;
- G7: intentional lossy handling of currently unmodeled profile fields and no cache-authority ambiguity;
- G8: read/mutation separation and derived statistics policy;
- G9: concrete field-level metadata ownership and serialized concurrency policy;
- G10: durable/reconstructible/ephemeral restart classification;
- G11: P6/P9 boundary;
- G12: implementation may not begin until a migration plan and writer inventory are separately approved.

## Final Status

```text
P6 Phase 0 Audit       — APPROVED / CLOSED
P6 Phase 1 Brief       — APPROVED / FROZEN
P6 Phase 1 Contract    — PROPOSED-R3 / AWAITING REVIEW
Production code        — NOT AUTHORIZED
P6 Implementation Plan — NOT AUTHORIZED
```

No migration or implementation is authorized by this document.