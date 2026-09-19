# P6 Phase 0 — Persistence Ownership Audit

**Status**: COMPLETE / AWAITING REVIEW
**Date**: 2026-09-14
**Scope**: read-only ownership and restart audit
**Production-code changes**: NOT AUTHORIZED

This audit traces current producers, writers, readers, persistence targets, restart behavior, and ownership conflicts for Cognition and SiteProfile. It does not select or implement the P6 target architecture.

---

## Executive Summary

The current system has **split persistence ownership** rather than one authoritative source:

```text
Cognition:
  Agent → .cognition/*.json (effective agent authority)
  API/worker → DB cognition tables (derived/dashboard projection)

SiteProfile:
  Browser/tools/worker → .site-profiles/*.json (learning source)
  API/worker → DB site_profiles (API/read projection)

Session lifecycle:
  DB session row (P5 transition authority)

Session log / WorkingMemory:
  in-memory only
```

The primary P6 problem is therefore ownership and convergence, not file-write durability:

```text
same fact
→ multiple stores
→ multiple writers
→ unclear authority
→ stale import / overwrite / resurrection risk
```

P9 remains a separate concern for physical atomicity, crash consistency, fsync/rename semantics, and multi-process coordination.

---

## 1. Scope / Audit Questions

This audit answers:

1. What Cognition writers exist?
2. What SiteProfile writers exist?
3. What do API, worker, agent, and persistence each write?
4. Where is the same fact duplicated or overwritten?
5. Which store is currently authoritative in practice?
6. What survives/reloads after restart?
7. Can metadata, summary, findings, or enrichment overwrite one another?
8. Which writes are core persistence versus derived/cache/audit artifacts?
9. Where are read-after-write and last-writer-wins risks?
10. Where does P6 ownership stop and P9 physical durability begin?

Out of scope:

- implementing a new owner;
- migrating filesystem data to DB or DB data to filesystem;
- changing schemas or repository APIs;
- fixing file atomicity;
- changing worker/API behavior;
- recovery/watchdog design.

---

## 2. Storage and Runtime Topology

### 2.1 Current server composition

`apps/server/th-server/src/app.ts:243-283` creates:

- one database aggregate via `createDatabase(dbPath)`;
- one in-memory queue;
- one API server;
- one worker bootstrap;
- shared repository/queue object references in one Node process.

Without `DB_PATH`, repository state is in-memory and lost on restart. With `DB_PATH`, the current factory selects the JSON provider (`packages/persistence/th-persistence/src/index.ts:84-124`); SQLite/Postgres comments and schema strings are not active runtime providers.

### 2.2 Restart semantics

| Data | Current store | Clean restart | Process crash during write |
|------|---------------|---------------|-----------------------------|
| Session rows | in-memory or JSON DB | JSON only if `DB_PATH` | partial/last-write risk in JSON; P9 |
| Agent cognition | `.cognition/*.json` | reload latest parseable file | truncated/partial file possible; P9 |
| Site profile learning | `.site-profiles/*.json` | reload latest parseable file | non-atomic file write; P9 |
| DB site/cognition projection | JSON DB tables/maps | JSON only with `DB_PATH` | whole-file loss/overwrite risk; P9 |
| Session log | memory | lost | lost |
| WorkingMemory | memory | lost | lost |
| Queue jobs | in-memory queue | lost | lost |
| P2E identity state | session metadata | JSON only with `DB_PATH` | metadata merge race; physical durability P9 |

The JSON database has a five-second save interval (`json-file.ts:95-108`) that is not cleared by `close()`. This is a separate lifecycle defect, not fixed by this audit.

### 2.3 P6 vs P9 boundary

**P6 owns logical persistence semantics**:

- who owns each fact;
- which store is authoritative;
- which writers are allowed;
- projection/import direction;
- conflict precedence;
- read-after-write and restart visibility contract;
- stable identity/idempotency semantics.

**P9 owns physical durability**:

- atomic file replacement;
- fsync/write-ahead logging;
- crash-consistent snapshots;
- corruption recovery;
- cross-process locks/transactions;
- durable queue/replay if selected later.

A P6 decision cannot claim that a mutex or source selection makes JSON writes crash-safe.

---

## 3. Cognition Ownership Inventory

### 3.1 Agent-side producers and file writers

`packages/cognition/th-cognition/src/cognitive-engine.ts:57-93` constructs a `CognitiveEngine` with file-backed components under `.cognition`:

```text
episodes.json
semantic.json
procedures.json
q-values.json
patterns.json
recovery.json
strategies.json
updates.json
```

The AgentLoop constructs one engine per run at `packages/agent/th-agent/src/loop.ts:425-426`, reads experiences on session start (`loop.ts:430-438`), and calls `onSessionEnd` from `finalizeSession` (`loop.ts:606-650`).

| Producer / writer | Location | Writes |
|------------------|----------|--------|
| `AgentLoop` session start/end | `packages/agent/th-agent/src/loop.ts:425-438, 606-650` | reads experiences; persists session outcome through CognitiveEngine |
| Per-action learning | `loop.ts:1481-1517` | working memory, RL/recovery/strategy updates |
| `CognitiveEngine.onSessionEnd` | `cognitive-engine.ts:126-175` | episode, semantic distillation, strategy outcome |
| Manual knowledge/procedure/pattern APIs | `cognitive-engine.ts:292-405, 509-553` | file-backed cognition records |
| Recovery outcome | `cognitive-engine.ts:272-285` | recovery file |
| Memory component constructors | `packages/cognition/th-cognition/src/memory/*` | load JSON snapshots into each component |
| Search/read accessors | e.g. episodic `:152-159`, semantic `:83-90` | mutate access counters/last-accessed and save |
| Pattern detection | pattern component `:263-291` | detection statistics and save |
| Fresh defaults | StrategyAdapter/ErrorRecovery constructors | may initialize and save empty/default files |

The agent-side file stores are the effective source for model-visible cognition: `ExperienceRetriever` reads episodic/semantic/procedural files (`packages/cognition/th-cognition/src/context/experience-retriever.ts:49-173, 247-285`).

### 3.2 DB cognition writers and readers

Persistence defines DB rows for episodes, knowledge, procedures, and patterns (`packages/persistence/th-persistence/src/schema.ts:70-129`; repository interface `:100-135`). JSON provider CRUD is at `packages/persistence/th-persistence/src/providers/json-file.ts:394-581`; in-memory equivalents are at `providers/in-memory.ts:264-401`.

| Writer / reader | Location | Role |
|----------------|----------|------|
| Worker file-to-DB sync | `packages/worker/th-worker/src/processors/test-session.ts:565-572, 813-877` | imports episodes and semantic knowledge after a run |
| API file-to-DB sync | `packages/api/th-api/src/routes/sites.ts:73-254` | imports file data during site list/detail reads |
| API manual experience | `sites.ts:539-574` | writes DB directly |
| API feedback/weight | `sites.ts:502-537, 577+` | mutates DB directly |
| API clear/delete | `sites.ts:418-435, 484-500` | deletes DB projection, not cognition files |
| Dashboard Sites page | `apps/web/th-dashboard/src/pages/Sites.tsx:228-309` | reads API projection only |

### 3.3 Current effective authority

```text
Agent cognition reads → filesystem files
Agent cognition writes → filesystem files
API/dashboard reads  → DB projection, after optional file import
API manual mutations → DB only
```

Thus DB is authoritative for current API/dashboard views, while filesystem is authoritative for agent retrieval and learning. Neither is a complete authority for all consumers.

### 3.4 Cognition risks

1. **ID mismatch defeats dedupe**: file episodes/knowledge carry source IDs, but `JsonFileCognitionRepository.createEpisode/createKnowledge` generates new DB UUIDs (`json-file.ts:405-410, 446-457`). Worker/API dedupe checks compare source IDs against generated DB IDs (`test-session.ts:820-871`, `sites.ts:139-188`), so repeated sync can recreate records.
2. **Repeated sync / cross-site contamination**: worker sync forces the current `siteId`; source records do not reliably retain target provenance. API GET sync can re-import stale files.
3. **DB-only mutations resurrect**: API clear/update/delete changes DB but not `.cognition`; later GET or worker sync can reintroduce old file data.
4. **Whole-file last-writer-wins**: concurrent CognitiveEngine instances load stale snapshots and overwrite each other's records; no lock/merge/version.
5. **Reads are writers**: search/get can update usage stats and save; read-after-write ordering is not read-only.
6. **Errors are swallowed**: file load/save errors are caught/logged or ignored; successful session terminalization can coexist with lost cognition persistence.
7. **Synthetic provenance**: `onSessionEnd` uses synthetic `session_${Date.now()}` identifiers (`cognitive-engine.ts:133-143`) rather than actual session IDs, weakening dedupe and traceability.
8. **Volatile state**: WorkingMemory has no restart persistence path.
9. **Metadata merge race**: durable P2E session state is stored in `SessionRow.metadata` through read/merge/write (`packages/agent/th-agent/src/durable-session-persistence.ts:29-109`), so concurrent metadata writers can lose fields. This is a separate logical ownership concern from cognition files.
10. **Timeout semantics leakage**: Agent timeout finalization maps through generic outcome handling (`loop.ts:614-617`), potentially causing cognition side effects even though timeout is not a normal success.

### 3.5 Cognition classification

| Data | Classification today | P6 question |
|------|----------------------|-------------|
| Episodes | file source + DB projection | choose one authority and stable source ID |
| Semantic knowledge | file source + DB projection | define import direction and mutation ownership |
| Procedures/patterns | primarily file source; API DB projection | close missing worker sync and ownership gap |
| Q-values/recovery/strategies/updates | file-backed learning state | decide whether DB is needed or files remain owned |
| WorkingMemory | derived runtime state | likely cache/ephemeral unless product requires durability |
| Access counters | file mutation side-effect of reads | separate read model from durable learning update |
| Session identity semantics | DB metadata | separate from cognition ownership; preserve P5/P2E contract |

---

## 4. SiteProfile Ownership Inventory

### 4.1 Runtime model and file writer

Full runtime `SiteProfile` is defined at `packages/browser/th-browser/src/site-profile.ts:113-130`. It includes auth, forms, navigations, constraints, cache, and timestamps.

The persisted `SiteProfileData` format retains only name, base URL, element cache, and updatedAt (`packages/browser/th-browser/src/site-profile-store.ts:19-24`). File path is `.site-profiles/<hostname>.json` (`site-profile-store.ts:30-68`).

| Producer / writer | Location | Writes |
|------------------|----------|--------|
| SmartLocator | `packages/browser/th-browser/src/smart-locator.ts:109-160, 369-392` | in-memory element cache and timestamps |
| Browser providers | `playwright-provider.ts:62, 771-796`; MCP provider `:40-45` | expose cache, no automatic profile persistence |
| `configure_site` tool | `packages/tools/th-tools/src/builtins/configure-site.ts:85-155` | file profile; hardcodes `current-session` target at `:79-82`; auth/constraints not persisted |
| Worker enrichment | `packages/worker/th-worker/src/processors/test-session.ts:526-560` | reads file, enriches, writes reduced file format |
| Site profile store | `site-profile-store.ts:54-89` | whole-file read/write |

### 4.2 DB SiteProfile writers/readers

DB schema/repository retain only normalized site identity, name, element cache, counts, and timestamps (`packages/persistence/th-persistence/src/schema.ts:53-67`; interfaces `:81-98`).

| Writer / reader | Location | Role |
|----------------|----------|------|
| Worker ensure-site | `test-session.ts:248-257` | creates DB row by normalized hostname |
| API file sync | `packages/api/th-api/src/routes/sites.ts:73-121` | imports file name/cache into DB |
| API PUT | `sites.ts:375-416` | DB-only update |
| API DELETE | `sites.ts:418-436` | DB-only delete |
| API cognition/site operations | `sites.ts:539-574` and related handlers | DB projection/mutation |
| Dashboard Sites page | `apps/web/th-dashboard/src/pages/Sites.tsx:16-118` | API consumer |

### 4.3 Current effective authority

```text
Browser/worker learning → .site-profiles files
API reads/mutations      → DB site_profiles
Worker AgentHints        → file profile (name only)
```

The system has no single source of truth. DB edits can be overwritten by a later file sync; deleting DB rows can be undone by stale files.

### 4.4 SiteProfile risks

1. **Two authorities / stale projection**: worker writes files but does not update DB element cache; API later imports file data and can overwrite DB edits.
2. **Normalization mismatch**: file store preserves `www.` and hostname conventions while worker/API normalize differently; same site can produce duplicate files/rows.
3. **Non-atomic whole-file writes**: concurrent worker/configure writes are last-writer-wins; crash can truncate profile.
4. **Enrichment data loss**: worker reconstructs a cache-only runtime profile and serializes reduced fields; auth/forms/navigation/constraints discoveries do not survive.
5. **Wrong configure target**: `configure_site` hardcodes `current-session`, creating a shared/wrong profile rather than the target site.
6. **Cache loss**: whole supplied cache can replace prior cache; empty/stale cache can erase entries.
7. **File resurrection**: API DB delete does not remove file; subsequent GET sync recreates DB row.
8. **File/API race**: process-local mtime watermark resets on restart; stale files re-import after restart.
9. **Count duplication**: worker increments DB test count and cognition/site sync may increment related counters independently.
10. **Incomplete persistence shape**: runtime profile fields are not represented in DB or file format, so “profile persisted” does not mean full profile persisted.

### 4.5 SiteProfile classification

| Data | Classification today | P6 question |
|------|----------------------|-------------|
| Hostname/base URL | identity/core | define canonical normalization owner |
| Auth/forms/navigation/constraints | runtime-derived knowledge | choose durable owner and format |
| Element cache | derived cache/learned hint | decide authoritative cache and merge policy |
| Test count/last tested | DB metric/audit | define one increment owner |
| Updated timestamps | metadata | separate source update from projection update |

---

## 5. Cross-Domain and Cross-Layer Ownership Matrix

| Data / fact | Agent | Worker | API | Persistence/DB | Dashboard | Effective authority |
|-------------|-------|--------|-----|----------------|-----------|--------------------|
| Session terminal state | returns result | transition CAS | cancel intent | session repository | reads | DB transition primitive (P5) |
| Agent cognition learning | writes files | triggers sync | may mutate DB directly | DB projection | reads DB | split: files for agent, DB for API |
| Site profile cache | SmartLocator memory | writes file/enriches | imports/edits DB | DB projection | reads DB | split: file for learning, DB for API |
| Summary/findings/activities | session log/result | writes session metadata | reads | session metadata | reads | worker/session metadata, with shallow merge risks |
| P2E identity semantics | reads/writes metadata | passes store | indirect | session metadata | not primary | session metadata, logical only |
| WorkingMemory | memory | per-run engine | none | none | none | ephemeral |

### 5.1 Metadata overlap

`SessionRow.metadata` is a catch-all containing instructions, uploaded images, summaries, findings, activities, execution summaries, and durable P2E identity state. Worker post-processing uses shallow merge (`updateMetadata`), so concurrent writers can overwrite nested facts or lose updates. P6 must classify metadata fields individually; it must not treat the entire map as one homogeneous ownership domain.

### 5.2 Core versus derived artifacts

Current likely classification (subject to P6 design approval):

```text
Core:
- session lifecycle and terminal facts
- session identity semantics/provenance
- canonical site identity

Derived / projection:
- DB cognition rows imported from .cognition
- DB site cache imported from .site-profiles
- dashboard counts and summaries

Learned durable knowledge:
- cognition episodes/semantic/procedural knowledge
- site auth/forms/navigation/constraints

Ephemeral/cache:
- WorkingMemory
- SmartLocator in-memory cache before persistence
- session log unless separately persisted
```

The audit does not make this classification authoritative; it identifies decisions Phase 1 must make.

---

## 6. Read-After-Write and Conflict Scenarios

### Scenario C1 — Cognition duplicate import

```text
Agent writes episode E with source id e1
→ worker creates DB row with generated id d1
→ next worker/API sync sees e1 ≠ d1
→ creates d2
```

**Impact**: duplicate episodes/knowledge and broken provenance.

### Scenario C2 — API clear resurrection

```text
API clears DB cognition
→ .cognition files remain
→ next GET sites triggers file sync
→ stale cognition returns to DB
```

**Impact**: user-visible clear is not durable.

### Scenario C3 — Site DB edit overwritten

```text
API PUT updates DB cache/name
→ existing file remains older/different
→ next GET sync imports file
→ API edit disappears
```

### Scenario C4 — Concurrent cognition engines

```text
Engine A loads file snapshot
Engine B loads same old snapshot
A saves learning A
B saves learning B
→ A's changes disappear (or vice versa)
```

### Scenario C5 — Worker enrichment cache loss

```text
worker reads stale/empty reduced profile
→ enrichment writes entire reduced profile
→ prior fields/cache are lost
```

### Scenario C6 — Metadata merge loss

```text
P2E store reads metadata M
worker reads same M
P2E writes M+identity
worker writes M+summary
→ one update can erase the other
```

### Scenario C7 — Restart re-import

```text
API process watermark resets
→ old profile/cognition files are scanned again
→ DB projection may be rehydrated over newer DB-only edits
```

### Scenario C8 — Read operation mutates durable state

```text
API/agent performs search
→ access counter updates
→ file save occurs
→ a read changes the source snapshot and races with learning writes
```

---

## 7. Restart / Failure Matrix

| Event | Observed current behavior | P6 ownership question | P9 concern |
|-------|---------------------------|-----------------------|------------|
| Clean restart with no DB_PATH | DB session/site/cognition state lost; files reload | Which facts must survive? | N/A for intentional in-memory mode |
| Clean restart with DB_PATH | JSON DB reloads; files reload independently | Which source wins on re-import? | File/database physical consistency |
| Worker restart | in-memory queue jobs lost; files/JSON reload | replay/re-enqueue ownership | durable queue/recovery |
| Process killed during JSON DB write | possibly truncated/partial file | authority after corruption | atomic replace/fsync/recovery |
| Process killed during cognition file write | possibly partial file; loader may start empty | preserve/repair learning state | atomic file durability |
| Process killed during profile write | possibly partial profile | projection rebuild direction | atomic file durability |
| Two concurrent workers | separate CognitiveEngine snapshots; shared file LWW | one writer/merge/serialization policy | cross-process lock/transaction |
| API GET during worker file write | parses stale/partial file or skips on error | read consistency/versioning | physical atomic reads |
| API DB delete with file retained | later GET can resurrect row | delete/tombstone authority | durable deletion/write ordering |

---

## 8. Phase 0 Findings and Required P6 Decisions

### 8.1 Confirmed current ownership (descriptive, not approved target)

- Sessions: DB transition primitive is the lifecycle authority after P5.
- Agent cognition: filesystem is the agent read/write authority in practice.
- DB cognition: derived API/dashboard projection, despite direct API mutations.
- SiteProfile learning: filesystem is worker/browser learning source.
- DB site profiles: API/dashboard projection and metrics.
- Session log and WorkingMemory: ephemeral.
- P2E identity semantics: session metadata logical persistence, separate from cognition.

### 8.2 Decisions P6 Phase 1 must make

1. **Cognition source of truth**: DB or files; if split remains, define explicit projection direction and allowed writers.
2. **SiteProfile source of truth**: DB or files; define full profile shape, cache merge, and normalization owner.
3. **ID/provenance**: preserve source IDs through DB projection or define deterministic idempotency keys.
4. **API mutation semantics**: whether manual/feedback/clear writes authority, projection, or both.
5. **Worker sync semantics**: pull/push direction, idempotency, tombstones, conflict precedence.
6. **Metadata ownership**: field-level ownership for summary/findings/identity state/instructions/images.
7. **Restart contract**: what must survive and which source wins after reload.
8. **Read side effects**: whether access counters are durable writes or derived telemetry.
9. **Queue/recovery boundary**: keep queue and crash recovery out of P6 unless ownership requires a separate contract.
10. **P6/P9 interface**: logical authority must remain correct even before physical atomicity is upgraded by P9.

### 8.3 Explicit non-decisions

This Phase 0 audit does not decide:

- DB-authoritative versus file-authoritative migration;
- schema changes;
- file locking/atomic replacement;
- queue durability;
- recovery/watchdog;
- API or worker caller cutover;
- multi-process deployment.

---

## 9. Audit Verdict and Next Gate

```text
P6 Phase 0 — COMPLETE / AWAITING REVIEW
P6 Phase 1 — NOT AUTHORIZED
Production code — NOT AUTHORIZED
```

The audit is sufficient to enter design review. No additional broad trace is required unless review identifies a specific unverified writer or reader.

Recommended next milestone:

```text
P6 Phase 1 — Persistence Ownership Design
```

That design should define one authority per fact, writer permissions, projection/import semantics, stable IDs, restart behavior, metadata field ownership, and explicit P6/P9 boundaries before any implementation.
