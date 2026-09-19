# P6 Phase 2 — Persistence Ownership Implementation Plan

**Status**: PROPOSED-R4 / AWAITING REVIEW  
**Date**: 2026-09-14  
**Revision**: R4 (final classification/vocabulary cleanup)  
**Prerequisites**:
- `docs/P5-PHASE0-AUDIT.md` — APPROVED / CLOSED
- `docs/P5-PHASE1-DESIGN-BRIEF.md` — APPROVED / FROZEN
- `docs/P6-PHASE0-PERSISTENCE-OWNERSHIP-AUDIT.md` — APPROVED / CLOSED
- `docs/P6-PHASE1-DESIGN-BRIEF.md` — APPROVED / FROZEN
- `docs/P6-PERSISTENCE-OWNERSHIP-CONTRACT.md` — APPROVED / CLOSED

**Production code**: NOT AUTHORIZED  
**Purpose**: implementation planning only. This document does not perform schema migration, writer cutover, importer changes, or physical durability work.

---

## Revision History

### R0 — Initial plan
Initial ordering/authority/projection plan without storage gate, collision policy, frozen callsite inventory, importer boundary, rollback point-of-no-return, or metric idempotency identity.

### R1 — Plan consistency closure

**Verdict on R0**: `CHANGES REQUIRED` (6 plan-level blockers; architecture/ordering approved in principle)

R1 resolves the following plan gaps without changing Phase 1 contract, overall ordering, or P6/P9 boundary:

1. Add explicit storage/schema readiness gate for canonical identity/origin/provenance/idempotency, required before authority writers are enabled.
2. Define deterministic legacy canonical-identity/origin collision policy; cutover blocked until no unresolved collisions remain.
3. Expand writer inventory into a frozen callsite inventory covering exact site, field group, current target, classification, future owner, cutover slice, and removal gate.
4. Freeze explicit legacy importer execution boundary; it is never GET/read-triggered.
5. Define semantic rollback point-of-no-return: code rollback after authority-only mutations may keep DB authority, not automatically restore file authority.
6. Define SiteProfile metric idempotency identity as profile + completed-session key.

### R2 — Final plan closure

**Verdict on R1**: `CHANGES REQUIRED` (4 remaining plan-level blockers; ordering/architecture approved)

R2 resolves the final remaining plan gaps without changing Phase 1 contract, R1 decisions, or P6/P9 boundary:

1. Turn writer inventory into a truly frozen durable-writer callsite manifest; the main table remains a grouped view, but Gate 2-G closes against the manifest.
2. Split `CognitiveEngine` learned-entity file I/O from retained file-owned control-state file I/O, so `onSessionStart`/`onSessionEnd` are split by subdomain.
3. Define service/repository encapsulation timing: services are introduced first, repository adapters are hidden only after legacy direct callers are migrated at coordinated cutover.
4. Define legacy import migration window and anti-resurrection rule: freeze relevant authority mutations, run bounded legacy import, resolve collisions, record completion, disable importer, then cut over to authority writers.

### R3 — Final manifest and cutover consolidation

**Verdict on R2**: `CHANGES REQUIRED` (4 remaining plan-level blockers; architecture/ordering/R1/R2 decisions approved)

R3 resolves the last remaining plan gaps without changing Phase 1 contract, R1/R2 decisions, storage gate, collision policy, metric identity, rollback semantics, or P6/P9 boundary:

1. Materialize the actual frozen durable-writer manifest as an appendix, rather than only describing it.
2. Resolve Cognition pattern ownership: decide whether `pattern-recognizer.ts` writes DB-authoritative `cognition_patterns` or a separate file-owned runtime-control pattern subdomain with distinct identity/artifact.
3. Classify `AgentLoop`/`CognitiveEngine` lifecycle callsites that trigger both learned-entity and retained control-state effects as split orchestration, not single "MIGRATE to authority service" entries.
4. Move the actual legacy-import/cutover execution to one single coordinated runbook in 2-F, applying to both Cognition and SiteProfile; 2-C/2-D only implement migration machinery and focused tests, they do not execute the migration window.

---

## 1. Scope and Non-Goals

P6 Phase 2 implements the approved ownership contract for Cognition, SiteProfile, and session metadata. It changes semantic writer routing and logical projection/restart behavior, not physical storage durability.

### In scope

```text
shared identity / normalization contracts
authority-service boundaries
writer classification and coordinated cutover
legacy import retirement and projection direction
Cognition entity/provenance idempotency
Cognition control-state physical writer partition
SiteProfile canonical-origin migration
configure_site explicit scope
read/mutation separation
metadata field-owner mutation APIs
projection rebuildability and logical restart behavior
P6-F1–F10 verification
rollback and compatibility controls
```

### Out of scope

```text
atomic rename
fsync / WAL
corruption recovery
cross-process locking or transactions
multi-process API/worker deployment
Redis/Postgres migration
queue redesign or durable replay
watchdog/recovery scan
retry semantics
P4 changes
legacy alias deletion without consumer audit
```

P9 remains responsible for physical crash durability and cross-process coordination.

---

## 2. Current Writer Inventory and Classification

The inventory must be frozen before the first implementation slice and repeated at closure. The only classifications permitted in the manifest are:

```text
KEEP       → one retained writer effect
MIGRATE    → one semantic authority writer effect to move
DOWNGRADE  → one projection/cache/export effect to retain without authority
REMOVE     → one effect to eliminate
SPLIT      → orchestration callsite only; its effects are listed as separate manifest rows
```

`SPLIT` is not a fifth writer destination, and `MIGRATE/DOWNGRADE` is not a valid combined classification. If one callsite has multiple effects, it receives one manifest row per effect.

### 2.1 Frozen callsite inventory

Each row below captures exact code site, field group, current target, classification, future owner, cutover slice, and removal gate.

| Code site | Logical field group | Current target | Classification | Future owner | Cutover slice | Removal gate |
|---|---|---|---|---|---|---|
| `packages/cognition/th-cognition/src/cognitive-engine.ts:146` `episodicMemory.store` | Cognition episode learned entity | file `.cognition/episodes.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/cognitive-engine.ts:154` `semanticMemory.store` | Cognition semantic learned knowledge | file `.cognition/semantic.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/cognitive-engine.ts:173` `strategyAdapter.recordOutcome` | Strategy outcome control state | file `.cognition/strategies.json` | KEEP | strategy control writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/memory/episodic-memory.ts` store/save | Cognition episode learned entity storage | file `.cognition/episodes.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/memory/semantic-memory.ts` store/save | Cognition semantic learned knowledge storage | file `.cognition/semantic.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/memory/procedural-memory.ts` store/save | Cognition procedure learned entity storage | file `.cognition/procedures.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/memory/working-memory.ts` | Ephemeral session memory | in-memory | KEEP | ephemeral runtime | — | none |
| `packages/cognition/th-cognition/src/learning/reinforcement-learner.ts` | Q-values runtime control state | file `.cognition/q-values.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/learning/pattern-recognizer.ts` | Pattern runtime control state | file `.cognition/patterns.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/learning/knowledge-distiller.ts` | Pure transformation | none | KEEP | no I/O; pure logic | — | none |
| `packages/cognition/th-cognition/src/healing/error-recovery.ts` | Error-recovery runtime control state | file `.cognition/recovery.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/healing/strategy-adapter.ts` | Strategy runtime control state | file `.cognition/strategies.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/healing/knowledge-updater.ts` | Update-log runtime control state | file `.cognition/updates.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/context/context-awareness.ts` | Context-awareness read/search with possible stat writes | files | REMOVE | reads non-persisting; stats derived telemetry | 2-E | read-side durable writes removed |
| `packages/cognition/th-cognition/src/context/experience-retriever.ts` | Experience retrieval read/search with possible stat writes | files | REMOVE | reads non-persisting; stats derived telemetry | 2-E | read-side durable writes removed |
| `packages/cognition/th-cognition/src/cognitive-engine.ts:101` `onSessionStart` retrieval | Durable learned-entity read effect | file | MIGRATE | authority service read API | 2-C | no direct learned-entity file authority after cutover |
| `packages/cognition/th-cognition/src/cognitive-engine.ts:126` `onSessionEnd` learned-entity writes | Durable learned-entity write access | file | MIGRATE | authority service write API | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/cognitive-engine.ts:173` `onSessionEnd` strategy outcome | Strategy outcome control state write | file | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/agent/th-agent/src/loop.ts:427` `new CognitiveEngine` | Engine construction | files | KEEP | engine construction | — | none |
| `packages/agent/th-agent/src/loop.ts:434` `onSessionStart` | Experience retrieval orchestration | file | KEEP | orchestration | — | none |
| `packages/agent/th-agent/src/loop.ts:640` `onSessionEnd` learned-entity effect | Session-end learned-entity persistence | file | MIGRATE | authority service write API | 2-C | no learned-entity authority file I/O after cutover |
| `packages/agent/th-agent/src/loop.ts:640` `onSessionEnd` control-state effect | Strategy outcome/control-state persistence | file | KEEP | retained file-owned control-state partition | 2-C | no learned-entity writes in control partition |
| `packages/worker/th-worker/src/processors/test-session.ts:820` `syncCognitionFilesToDB` | Background files→DB reverse sync | DB | REMOVE | explicit bounded legacy importer, not GET | 2-F | disabled at coordinated cutover |
| `packages/api/th-api/src/routes/sites.ts:82` `syncSiteProfilesFromFiles` | SiteProfile GET-triggered file sync | DB | REMOVE | legacy importer boundary | 2-F | removed |
| `packages/api/th-api/src/routes/sites.ts:98` `syncSiteProfilesFromFiles` hostname normalization | SiteProfile file→DB normalize | DB | REMOVE | canonical origin normalizer | 2-F | removed |
| `packages/api/th-api/src/routes/sites.ts:124` `syncCognitionFromFiles` | Cognition GET-triggered reverse sync | DB | REMOVE | legacy importer boundary | 2-F | removed |
| `packages/api/th-api/src/routes/sites.ts:136-173` `syncCognitionFromFiles` episode/knowledge normalize | Cognition file→DB normalize | DB | REMOVE | canonical entity identity | 2-F | removed |
| `packages/api/th-api/src/routes/sites.ts:523,564,599` | API manual cognition GET | DB | MIGRATE | authority service read API | 2-C | direct repo read removed |
| `packages/api/th-api/src/routes/sites.ts:531,606` | API manual knowledge weight update | DB | MIGRATE | authority service write API | 2-C | direct repo mutation removed |
| `packages/worker/th-worker/src/processors/test-session.ts:565-572` | Worker session-end cognition sync | DB | MIGRATE | canonical identity + idempotent import | 2-C | direct repo mutation removed |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.createEpisode` | Cognition episode learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deleteEpisodesBySite` | Cognition episode learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.createKnowledge` | Cognition semantic learned knowledge | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.updateKnowledge` | Cognition semantic learned knowledge | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deleteKnowledge` | Cognition semantic learned knowledge | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deleteKnowledgeBySite` | Cognition semantic learned knowledge | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.createProcedure` | Cognition procedure learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.updateProcedure` | Cognition procedure learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deleteProceduresBySite` | Cognition procedure learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.createPattern` | Cognition pattern learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.updatePattern` | Cognition pattern learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deletePatternsBySite` | Cognition pattern learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.clearAllBySite` | All DB cognition entities for site | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySiteProfileRepository.create` | SiteProfile modeled metadata | DB site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySiteProfileRepository.update` | SiteProfile modeled metadata | DB site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySiteProfileRepository.incrementTestCount` | SiteProfile test-count metric | DB site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySiteProfileRepository.delete` | SiteProfile modeled metadata | DB site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.updateStartedAt` | Session startedAt | DB session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.updateCompletedAt` | Session completedAt | DB session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.transitionStatus` | Session lifecycle status and terminal fields | DB session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.transitionPostProcessingStatus` | Session post-processing status and error | DB session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.createEpisode` | Cognition episode learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deleteEpisodesBySite` | Cognition episode learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.createKnowledge` | Cognition semantic learned knowledge | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.updateKnowledge` | Cognition semantic learned knowledge | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deleteKnowledge` | Cognition semantic learned knowledge | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deleteKnowledgeBySite` | Cognition semantic learned knowledge | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.createProcedure` | Cognition procedure learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.updateProcedure` | Cognition procedure learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deleteProceduresBySite` | Cognition procedure learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.createPattern` | Cognition pattern learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.updatePattern` | Cognition pattern learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deletePatternsBySite` | Cognition pattern learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.clearAllBySite` | All DB cognition entities for site | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSiteProfileRepository.create` | SiteProfile modeled metadata | DB JSON site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSiteProfileRepository.update` | SiteProfile modeled metadata | DB JSON site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSiteProfileRepository.incrementTestCount` | SiteProfile test-count metric | DB JSON site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSiteProfileRepository.delete` | SiteProfile modeled metadata | DB JSON site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.updateStartedAt` | Session startedAt | DB JSON session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.updateCompletedAt` | Session completedAt | DB JSON session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.transitionStatus` | Session lifecycle status and terminal fields | DB JSON session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.transitionPostProcessingStatus` | Session post-processing status and error | DB JSON session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/browser/th-browser/src/smart-locator.ts` | Runtime locator cache mutation | in-memory cache + file | KEEP | derived cache writer | 2-D | none |
| `packages/browser/th-browser/src/site-profile-store.ts:54` `saveSiteProfile` | Whole-file profile write | file `.site-profiles/<host>.json` | DOWNGRADE | controlled export/cache only | 2-D | no authority mutation after cutover |
| `packages/browser/th-browser/src/site-profile-store.ts:74` `persistSiteCache` | Whole-file cache overwrite | file | DOWNGRADE | cache export only | 2-D | no semantic overwrite |
| `packages/worker/th-worker/src/processors/test-session.ts` | profile enrichment write | Worker profile enrichment write | file | DOWNGRADE | authority service semantic + controlled export | 2-D | no authority mutation via file |
| `packages/api/th-api/src/routes/sites.ts:375-436` | API SiteProfile PUT/DELETE | DB | MIGRATE | SiteProfile authority service | 2-D | direct mutation removed |
| `packages/tools/th-tools/src/builtins/configure-site.ts:81,115,155` | `configure_site` with `current-session` | file | MIGRATE | explicit profile/session scope via authority | 2-D | `current-session` target removed |
| `packages/worker/th-worker/src/processors/test-session.ts:249,785-794` | Worker ensure-site creation with local normalization | DB profile via local normalization | MIGRATE | canonical-origin normalizer + authority | 2-D | local normalization removed |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.createEpisode`, `deleteEpisodesBySite`, `createKnowledge`, `updateKnowledge`, `deleteKnowledge`, `deleteKnowledgeBySite`, `createProcedure`, `updateProcedure`, `deleteProceduresBySite`, `createPattern`, `updatePattern`, `deletePatternsBySite`, `clearAllBySite` | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySiteProfileRepository.create`, `update`, `incrementTestCount`, `delete` | DB site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.createEpisode`, `deleteEpisodesBySite`, `createKnowledge`, `updateKnowledge`, `deleteKnowledge`, `deleteKnowledgeBySite`, `createProcedure`, `updateProcedure`, `deleteProceduresBySite`, `createPattern`, `updatePattern`, `deletePatternsBySite`, `clearAllBySite` | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSiteProfileRepository.create`, `update`, `incrementTestCount`, `delete` | DB JSON site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/worker/th-worker/src/processors/test-session.ts:509` `updateMetadata` | Generic whole-map metadata merge | DB metadata | MIGRATE | field-owner mutation APIs | 2-E | generic merge removed |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.updateMetadata` | Generic merge implementation | DB session map | MIGRATE | field-owner mutation implementations | 2-E | whole-map merge removed |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.updateMetadata` | Generic merge implementation | DB JSON session map | MIGRATE | field-owner mutation implementations | 2-E | whole-map merge removed |
| `packages/agent/th-agent/src/durable-session-persistence.ts:54,98` | P2E identity metadata writes | DB metadata | MIGRATE | P2E field-owner API | 2-E | generic merge removed |
| `packages/cognition/th-cognition/src/memory/episodic-memory.ts` | read paths | May save access statistics | files | REMOVE | derived telemetry only | 2-E | read-side mutation removed |
| `packages/cognition/th-cognition/src/memory/semantic-memory.ts` | read paths | May save access statistics | files | REMOVE | derived telemetry only | 2-E | read-side mutation removed |
| `packages/cognition/th-cognition/src/memory/procedural-memory.ts` | read paths | May save access statistics | files | REMOVE | derived telemetry only | 2-E | read-side mutation removed |
| `packages/cognition/th-cognition/src/cognitive-engine.ts` constructors | Default file creation | files | KEEP | initialization ownership documented | 2-B partition gate | none |

The worker test adapter's mock methods are test-only and do not count as production writers.

### 2.2 Frozen writer manifest appendix

The main table above is a grouped classification view. Gate 2-G must close against the **frozen durable-writer callsite manifest** below, which lists every production durable-mutation callsite by exact file/function and field group. Pure readers that do not persist side effects are not manifest rows. No wildcard, method-family, or aggregate provider rows are permitted.

The manifest covers:

- every file and function that performs durable learned-entity write;
- every file and function that performs durable profile metadata write;
- every file and function that performs durable metadata field-owner write;
- every file and function that performs controlled file export/cache write.

It does not cover pure readers unless they persist side effects.

#### Frozen durable-writer callsite manifest

| File | Function/method | Logical field group | Physical target | Classification | Future owner | Implementation slice | Closure condition |
|---|---|---|---|---|---|---|---|
| `packages/cognition/th-cognition/src/cognitive-engine.ts` | `episodicMemory.store` | Cognition episode learned entity | file `.cognition/episodes.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/cognitive-engine.ts` | `semanticMemory.store` | Cognition semantic learned knowledge | file `.cognition/semantic.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/cognitive-engine.ts` | `onSessionEnd` learned-entity writes | Durable learned-entity write access | file | MIGRATE | authority service write API | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/cognitive-engine.ts` | `onSessionStart` learned-entity read effect | Durable learned-entity read effect | file | MIGRATE | authority service read API | 2-C | no direct learned-entity file authority after cutover |
| `packages/cognition/th-cognition/src/cognitive-engine.ts` | `onSessionEnd` strategy outcome | Strategy outcome control state write | file `.cognition/strategies.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/cognitive-engine.ts` | constructor orchestration | File-owned control-state initialization orchestration | files | KEEP | initialization ownership documented | 2-B partition gate | none |
| `packages/cognition/th-cognition/src/healing/strategy-adapter.ts` | constructor/load/default initialization | Strategy control-state initialization | file `.cognition/strategies.json` | KEEP | control-state writer in file partition | 2-B partition gate | none |
| `packages/cognition/th-cognition/src/learning/reinforcement-learner.ts` | constructor/load initialization | Q-value control-state initialization | file `.cognition/q-values.json` | KEEP | control-state writer in file partition | 2-B partition gate | none |
| `packages/cognition/th-cognition/src/learning/pattern-recognizer.ts` | constructor/load initialization | Pattern-matcher control-state initialization | file `.cognition/patterns.json` | KEEP | control-state writer in file partition | 2-B partition gate | none |
| `packages/cognition/th-cognition/src/healing/error-recovery.ts` | constructor/load initialization | Recovery control-state initialization | file `.cognition/recovery.json` | KEEP | control-state writer in file partition | 2-B partition gate | none |
| `packages/cognition/th-cognition/src/healing/knowledge-updater.ts` | constructor/load initialization | Update-log control-state initialization | file `.cognition/updates.json` | KEEP | control-state writer in file partition | 2-B partition gate | none |
| `packages/cognition/th-cognition/src/memory/episodic-memory.ts` | store/save | Cognition episode learned entity storage | file `.cognition/episodes.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/memory/semantic-memory.ts` | store/save | Cognition semantic learned knowledge storage | file `.cognition/semantic.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/memory/procedural-memory.ts` | store/save | Cognition procedure learned entity storage | file `.cognition/procedures.json` | MIGRATE | Cognition authority service | 2-C | no learned-entity authority file I/O after cutover |
| `packages/cognition/th-cognition/src/memory/working-memory.ts` | ephemeral session memory | Ephemeral session memory | in-memory | KEEP | ephemeral runtime | — | none |
| `packages/cognition/th-cognition/src/learning/reinforcement-learner.ts` | Q-values runtime control state | Q-values runtime control state | file `.cognition/q-values.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/learning/pattern-recognizer.ts` | pattern runtime control state | Pattern-matcher runtime control state | file `.cognition/patterns.json` | KEEP | pattern-matcher control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/learning/knowledge-distiller.ts` | pure transformation | Pure transformation | none | KEEP | no I/O; pure logic | — | none |
| `packages/cognition/th-cognition/src/healing/error-recovery.ts` | error-recovery runtime control state | Error-recovery runtime control state | file `.cognition/recovery.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/healing/strategy-adapter.ts` | strategy runtime control state | Strategy runtime control state | file `.cognition/strategies.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/healing/knowledge-updater.ts` | update-log runtime control state | Update-log runtime control state | file `.cognition/updates.json` | KEEP | control-state writer in file partition | 2-C partition gate | none |
| `packages/cognition/th-cognition/src/context/context-awareness.ts` | read/search statistic persistence | Read-side access statistics | cognition files | REMOVE | derived telemetry | 2-E | read-side durable writes removed |
| `packages/cognition/th-cognition/src/context/experience-retriever.ts` | read/search statistic persistence | Read-side access statistics | cognition files | REMOVE | derived telemetry | 2-E | read-side durable writes removed |
| `packages/agent/th-agent/src/loop.ts` | `new CognitiveEngine` | Engine construction | files | KEEP | engine construction | — | none |
| `packages/agent/th-agent/src/loop.ts` | `onSessionStart` | Experience retrieval orchestration | file | KEEP | orchestration | — | none |
| `packages/agent/th-agent/src/loop.ts` | `onSessionEnd` learned-entity orchestration | Session-end learned-entity persistence | file | MIGRATE | authority service write API | 2-C | no learned-entity authority file I/O after cutover |
| `packages/agent/th-agent/src/loop.ts` | `onSessionEnd` control-state orchestration | Strategy outcome/control-state persistence | file | KEEP | retained file-owned control-state partition | 2-C | no learned-entity writes in control partition |
| `packages/worker/th-worker/src/processors/test-session.ts` | `syncCognitionFilesToDB` | Background files→DB reverse sync | DB | REMOVE | explicit bounded legacy importer, not GET | 2-F | disabled at coordinated cutover |
| `packages/api/th-api/src/routes/sites.ts` | `syncSiteProfilesFromFiles` | SiteProfile GET-triggered file sync | DB | REMOVE | legacy importer boundary | 2-F | removed |
| `packages/api/th-api/src/routes/sites.ts` | `syncSiteProfilesFromFiles` hostname normalization | SiteProfile file→DB normalize | DB | REMOVE | canonical origin normalizer | 2-F | removed |
| `packages/api/th-api/src/routes/sites.ts` | `syncCognitionFromFiles` | Cognition GET-triggered reverse sync | DB | REMOVE | legacy importer boundary | 2-F | removed |
| `packages/api/th-api/src/routes/sites.ts` | `syncCognitionFromFiles` episode/knowledge normalize | Cognition file→DB normalize | DB | REMOVE | canonical entity identity | 2-F | removed |
| `packages/api/th-api/src/routes/sites.ts` | manual cognition GET | API manual cognition GET | DB | MIGRATE | authority service read API | 2-C | direct repo read removed |
| `packages/api/th-api/src/routes/sites.ts` | manual knowledge weight update | API manual knowledge weight update | DB | MIGRATE | authority service write API | 2-C | direct repo mutation removed |
| `packages/worker/th-worker/src/processors/test-session.ts` | session-end cognition sync | Worker session-end cognition sync | DB | MIGRATE | canonical identity + idempotent import | 2-C | direct repo mutation removed |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.createEpisode` | Cognition episode learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deleteEpisodesBySite` | Cognition episode learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.createKnowledge` | Cognition semantic learned knowledge | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.updateKnowledge` | Cognition semantic learned knowledge | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deleteKnowledge` | Cognition semantic learned knowledge | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deleteKnowledgeBySite` | Cognition semantic learned knowledge | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.createProcedure` | Cognition procedure learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.updateProcedure` | Cognition procedure learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deleteProceduresBySite` | Cognition procedure learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.createPattern` | Cognition pattern learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.updatePattern` | Cognition pattern learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.deletePatternsBySite` | Cognition pattern learned entity | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemoryCognitionRepository.clearAllBySite` | All DB cognition entities for site | DB cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySiteProfileRepository.create` | SiteProfile modeled metadata | DB site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySiteProfileRepository.update` | SiteProfile modeled metadata | DB site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySiteProfileRepository.incrementTestCount` | SiteProfile test-count metric | DB site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySiteProfileRepository.delete` | SiteProfile modeled metadata | DB site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.updateStartedAt` | Session startedAt | DB session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.updateCompletedAt` | Session completedAt | DB session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.transitionStatus` | Session lifecycle status and terminal fields | DB session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.transitionPostProcessingStatus` | Session post-processing status and error | DB session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.createEpisode` | Cognition episode learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deleteEpisodesBySite` | Cognition episode learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.createKnowledge` | Cognition semantic learned knowledge | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.updateKnowledge` | Cognition semantic learned knowledge | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deleteKnowledge` | Cognition semantic learned knowledge | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deleteKnowledgeBySite` | Cognition semantic learned knowledge | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.createProcedure` | Cognition procedure learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.updateProcedure` | Cognition procedure learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deleteProceduresBySite` | Cognition procedure learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.createPattern` | Cognition pattern learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.updatePattern` | Cognition pattern learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.deletePatternsBySite` | Cognition pattern learned entity | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileCognitionRepository.clearAllBySite` | All DB cognition entities for site | DB JSON cognition maps | KEEP | repository adapter | — | authority services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSiteProfileRepository.create` | SiteProfile modeled metadata | DB JSON site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSiteProfileRepository.update` | SiteProfile modeled metadata | DB JSON site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSiteProfileRepository.incrementTestCount` | SiteProfile test-count metric | DB JSON site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSiteProfileRepository.delete` | SiteProfile modeled metadata | DB JSON site profile map | KEEP | repository adapter | — | authority service owns policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.updateStartedAt` | Session startedAt | DB JSON session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.updateCompletedAt` | Session completedAt | DB JSON session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.transitionStatus` | Session lifecycle status and terminal fields | DB JSON session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.transitionPostProcessingStatus` | Session post-processing status and error | DB JSON session map | KEEP | repository adapter | — | field-owner/transition services own policy |
| `packages/browser/th-browser/src/smart-locator.ts` | runtime locator cache mutation | Runtime locator cache mutation | in-memory cache + file | KEEP | derived cache writer | 2-D | none |
| `packages/browser/th-browser/src/site-profile-store.ts` | `saveSiteProfile` | Whole-file profile write | file `.site-profiles/<host>.json` | DOWNGRADE | controlled export/cache only | 2-D | no authority mutation after cutover |
| `packages/browser/th-browser/src/site-profile-store.ts` | `persistSiteCache` | Whole-file cache overwrite | file | DOWNGRADE | cache export only | 2-D | no semantic overwrite |
| `packages/worker/th-worker/src/processors/test-session.ts` | profile enrichment authority effect | Modeled SiteProfile semantic fields | DB authority | MIGRATE | SiteProfile authority service | 2-D | no semantic authority mutation via file |
| `packages/worker/th-worker/src/processors/test-session.ts` | profile enrichment cache/export effect | Derived locator cache/export | file/cache | DOWNGRADE | SiteProfile cache/export writer | 2-D | export cannot overwrite semantic authority |
| `packages/api/th-api/src/routes/sites.ts` | SiteProfile PUT/DELETE | API SiteProfile PUT/DELETE | DB | MIGRATE | SiteProfile authority service | 2-D | direct mutation removed |
| `packages/tools/th-tools/src/builtins/configure-site.ts` | `configure_site` with `current-session` | `configure_site` with `current-session` | file | MIGRATE | explicit profile/session scope via authority | 2-D | `current-session` target removed |
| `packages/worker/th-worker/src/processors/test-session.ts` | ensure-site creation with local normalization | Worker ensure-site creation with local normalization | DB profile via local normalization | MIGRATE | canonical-origin normalizer + authority | 2-D | local normalization removed |
| `packages/worker/th-worker/src/processors/test-session.ts` | `updateMetadata` | Generic whole-map metadata merge | DB metadata | MIGRATE | field-owner mutation APIs | 2-E | generic merge removed |
| `packages/persistence/th-persistence/src/providers/in-memory.ts` | `InMemorySessionRepository.updateMetadata` | Generic merge implementation | DB | MIGRATE | field-owner mutation implementations | 2-E | whole-map merge removed |
| `packages/persistence/th-persistence/src/providers/json-file.ts` | `JsonFileSessionRepository.updateMetadata` | Generic merge implementation | DB | MIGRATE | field-owner mutation implementations | 2-E | whole-map merge removed |
| `packages/agent/th-agent/src/durable-session-persistence.ts` | P2E identity metadata writes | P2E identity metadata writes | DB metadata | MIGRATE | P2E field-owner API | 2-E | generic merge removed |
| `packages/cognition/th-cognition/src/memory/episodic-memory.ts` | `search` / `getSiteEpisodes` usage-stat update paths | Read-side access statistics | file `.cognition/episodes.json` | REMOVE | derived telemetry | 2-E | read does not save |
| `packages/cognition/th-cognition/src/memory/semantic-memory.ts` | `get` / search usage-stat update paths | Read-side access statistics | file `.cognition/semantic.json` | REMOVE | derived telemetry | 2-E | read does not save |
| `packages/cognition/th-cognition/src/memory/procedural-memory.ts` | search/read usage-stat update paths | Read-side access statistics | file `.cognition/procedures.json` | REMOVE | derived telemetry | 2-E | read does not save |
| `packages/cognition/th-cognition/src/context/context-awareness.ts` | read/detection-stat persistence paths | Read-side access statistics | cognition files | REMOVE | derived telemetry | 2-E | read does not save |
| `packages/cognition/th-cognition/src/context/experience-retriever.ts` | retrieval read paths | Read-only learned-entity access | cognition files | MIGRATE | Cognition authority read API | 2-C | no direct authority file read after cutover |

The worker test adapter's mock methods are test-only and do not count as production writers.

### 2.3 Inventory freeze and closure

The frozen callsite inventory is frozen for Phase 2. Gate 2-G must verify the same manifest, proving no new authority writer exists and no classified REMOVE caller still mutates authority.

---

## 3. Authority-Service Boundaries

No independent authority service currently exists. Establishing these boundaries precedes writer migration.

### 3.1 Cognition authority service

Responsibilities:

```text
canonical entity identity by entity kind
source occurrence/provenance attachment
explicit site/global/session scope validation
idempotent create/update/delete
legacy insert-only import
DB repository access
projection/export requests
```

Only this service may mutate DB-authoritative learned entities:

```text
episodes
semantic knowledge
procedures
patterns
```

The service must reject an importer that supplies an unproven site scope or attempts an automatic update of an existing authority record.

### 3.2 SiteProfile authority service

Responsibilities:

```text
canonical origin normalization and lookup
profile identity/name/modeled metadata mutation
derived locator-cache mutation policy
site metrics (test count/last tested) ownership
explicit profile/session scope validation
controlled legacy import/export
```

The DB repository remains a storage adapter; callers use the service so normalization and writer permissions cannot diverge.

### 3.3 Session metadata field-owner boundary

Introduce field-scoped operations rather than generic whole-map mutation:

```text
request owner       → instructions/images
worker result owner → summary/executionSummary/findings/activities
P2E owner           → identity semantics state
Cognition owner     → cognition references
SiteProfile owner   → profile references
```

Each operation preserves unrelated fields and is serialized within the supported single-process topology. No caller may use object spread to decide conflicts across field groups.

---

## 4. Migration Order and Cutover Gates

Slices may be implemented incrementally in one branch, but are **not independently deployable runtime migrations**. Behavioral cutover occurs only after all authority writers are migrated as one coherent unit.

### 2-A — Shared identity and normalization contracts

Implement/type-test:

- entity-kind-specific Cognition identity helpers;
- separate source occurrence/provenance types;
- shared canonical-origin normalizer;
- invalid-input and scope validation;
- compatibility readers for legacy IDs/hostname files.

**Gate 2-A**:

```text
identity semantics compile and test
origin normalization has one owner
legacy values remain readable
no runtime writer behavior changes
```

### 2-A0 — Storage representation readiness gate

Before authority services are designed to enable writer cutover, storage must represent:

```text
canonical Cognition entity identity and provenance
canonical SiteProfile origin lookup key
per-owner metadata mutation fields
idempotency records/keys
```

This gate prepares representation and migration tooling only. It does **not** enforce final uniqueness yet; existing-data collisions must be discovered and resolved first.

### 2-A1 — Legacy collision and ambiguity policy

Before uniqueness enforcement or writer cutover, map existing records to canonical identity/origin:

```text
0 collisions
→ migrate automatically

1:1 mapping
→ migrate automatically

N legacy records → 1 canonical entity/origin
→ BLOCK cutover
→ require deterministic merge or manual resolution policy

1 legacy record → ambiguous multiple canonical origins
→ BLOCK cutover
→ require explicit resolution policy
```

### 2-A2 — Uniqueness enforcement readiness

After 2-A1 resolves all collisions:

```text
backfill canonical identity/origin keys
→ verify no unresolved duplicates
→ enforce uniqueness constraints/indexes
→ verify idempotent lookup/upsert behavior
```

No authority writer or cutover may begin until 2-A0, 2-A1, and 2-A2 all pass. This separates storage representation readiness from post-collision uniqueness enforcement and avoids applying a new uniqueness constraint before legacy duplicates are resolved.

**Gate 2-A2**:

```text
canonical keys backfilled
no unresolved collisions
uniqueness enforcement active
idempotency lookup/upsert verified
writer cutover permitted
```

### 2-B — Authority-service boundaries

Phase 2-B introduces authority services without yet hiding repository adapters. New code must go through authority services, but existing direct callers remain temporarily until 2-C/2-D/2-E cutover.

Implement/type-test service interfaces and adapters without switching existing callers yet:

- Cognition authority service;
- SiteProfile authority service;
- field-owner metadata mutation boundary;
- explicit import/export command boundaries.

At this stage, repository adapters remain accessible for backward-compatible legacy callers. Hiding adapters behind services happens at coordinated cutover, after legacy direct callers are migrated.

**Gate 2-B**:

```text
authority services exist and are the only approved new writer API
new callers cannot access repository authority adapters directly
existing legacy direct callers temporarily remain
service/package dependency graph does not introduce new authority bypass
old runtime behavior remains unchanged until cutover
```

### 2-C — Cognition writer migration

1. Route Agent/worker/API durable learned-entity writes through Cognition authority service.
2. Preserve source IDs/provenance and use entity-kind identity.
3. Replace worker/API GET reverse sync with controlled bounded legacy importer:
   - insert-only if authority identity is absent;
   - skip existing authority;
   - report provenance/conflict without updating authority;
   - never triggered by GET or read path.
4. Partition `.cognition` physical files so DB-authoritative learned entities and file-owned controls do not share independently writable whole-file boundaries.
5. Remove durable writes from read/search paths.

**Gate 2-C**:

```text
repeated import is idempotent
existing DB authority is never auto-overwritten
source occurrence is retained separately
control-state writer partition is single-owner
read paths have zero authority writes
legacy importer is never GET/read-triggered
legacy importer implementation and focused tests are in place
actual execution of the migration window is performed in 2-F
```

### 2-D — SiteProfile writer migration

1. Route DB profile creation/update/metrics through SiteProfile authority service.
2. Migrate all callers to canonical origin normalizer.
3. Convert `.site-profiles` to controlled legacy import and optional DB export/cache.
4. Retire GET-triggered file→DB mutation.
5. Migrate `configure_site` to explicit profile/session scope; reject `current-session`.
6. Keep locator cache derived/rebuildable and prevent it from overwriting semantic profile fields.
7. Ensure test count/last-tested has exactly one metric owner.
8. Freeze metric idempotency identity as profile identity plus completed-session identity.

**Gate 2-D**:

```text
same raw origin maps to one canonical profile key
file projection cannot overwrite DB authority
configure_site has explicit scope
cache writes preserve semantic fields
metric increments use profile + completed-session identity
replayed worker completion does not double-increment
```

### 2-E — Read/mutation and metadata cleanup

1. Remove persistence side effects from cognition reads/searches.
2. Keep access statistics as derived telemetry unless a future contract promotes them.
3. Replace generic `updateMetadata` usage with field-owner operations.
4. Define append/replace semantics for findings/activities and summary fields.
5. Preserve P2E identity metadata from unrelated worker result updates.

**Gate 2-E**:

```text
read-only calls do not save authority
unrelated metadata fields survive concurrent owner updates
same-owner ordering is deterministic
cross-owner writes are rejected
```

### 2-F — Coordinated cutover

This is the single coordinated migration/cutover runbook. 2-C and 2-D only implement migration machinery and focused tests; they do not execute the migration window.

1. Freeze all Cognition and SiteProfile mutations that affect the semantic authority being migrated. Unrelated file-owned control-state writes remain available within their approved partitions.
2. Run Cognition and SiteProfile legacy data inventory and identity/origin mapping.
3. Resolve all canonical identity collisions (Cognition) and canonical origin collisions (SiteProfile) per §2-A1.
4. Run bounded insert-only legacy import for both Cognition and SiteProfile.
5. Record import completion and provenance.
6. Permanently disable the **automatic migration importer and background reverse sync**. A separately authorized operator conflict-resolution import capability, if retained by product decision, is not background import and remains audited/explicit.
7. Verify every DB-authoritative semantic writer is service-routed; retained file-owned control-state writers remain only inside their approved partitions.
8. Enable DB authority writers.
9. Only now permit the first authority-only mutation.

This ordering is the semantic rollback point-of-no-return from §5.4.

**Gate 2-F**:

```text
all DB-authoritative semantic writers use authority services
retained file-owned control-state writers remain only in approved partitions
automatic migration importer and background reverse sync are permanently disabled
explicit operator import, if retained, is separate, authorized, audited, and never background
no unresolved canonical identity/origin collisions remain
Cognition and SiteProfile legacy imports were bounded and deterministic
post-cutover DB-authoritative semantic mutations are authority-service-only
projections are rebuildable
rollback unit is ready
```

### 2-G — P6-F1–F10 closure

Run the complete writer audit and verification matrix below. This is the final P6 closure gate, not a new architecture phase.

---

## 5. Compatibility and Rollback Boundaries

### 5.1 Compatibility rules

- Existing file formats remain readable during migration.
- Legacy Cognition IDs are treated as source identity/provenance; they are not silently equated with generated DB IDs.
- Legacy SiteProfile filenames are imported only through the canonical origin normalizer.
- `pending`/`executing` remain compatibility-readable until consumer audit.
- Projections can be deleted and rebuilt without changing authority.
- Missing projection fields mean “not supplied,” never “erase authority.”

### 5.2 Cutover unit

The following must switch together:

```text
Cognition authority service
SiteProfile authority service
all API/worker/agent authority writers
legacy importer direction
GET sync retirement
metadata field-owner APIs
projection/export policy
```

Do not deploy a partial state in which one writer uses the authority service while another independently writes files or DB tables.

### 5.3 Rollback

Safe to retain on rollback:

```text
identity/normalization helpers
read-only compatibility readers
additive service interfaces
projection tests
provenance fields that are additive
```

Must roll back coherently:

```text
authority declaration
writer routing
legacy importer enablement
background reverse-sync retirement
projection direction
configure_site scope behavior
```

### 5.4 Semantic rollback point-of-no-return

Code rollback is not the same as semantic authority rollback.

```text
before first post-cutover authority-only mutation:
→ behavioral rollback may restore legacy file authority

after DB authority has accepted new mutations that file authority does not know:
→ DO NOT automatically restore file authority
→ rollback may revert application code while keeping DB semantic authority
→ restoring file authority requires explicit reverse data migration/reconciliation
```

Rollback must never silently lose new authority-only mutations by re-enabling a stale file authority independently.

### 5.5 Rollback invariant summary

```text
rollback may restore code paths
rollback may not silently restore file authority after DB authority-only mutations exist
rollback must preserve or explicitly reconcile the semantic authority state
```

---

## 6. P6-F1–F10 Verification Matrix

| Invariant | Unit | Integration | Cross-layer/static evidence |
|---|---|---|---|
| **F1** one authority per logical domain/subdomain | ownership/service tests | writer-to-service integration | complete writer inventory; no dual authority graph |
| **F2** projection never overwrites authority | negative projection tests | authority update then projection replay | directional call graph; no GET reverse writer |
| **F3** repeated projection/import idempotent | replay importer test | worker/API import replay | stable entity count and values |
| **F4** canonical identity shared | identity property tests | producer→authority→projection | no random-ID-only dedupe; provenance separate |
| **F5** no implicit current-session | scope validation tests | configure_site mutation test | search for literal/implicit target |
| **F6** reads do not silently mutate authority | read/write spy tests | API GET and cognition search | zero authority writes during reads |
| **F7** projection preserves authority | field-preservation tests | update authority then export/reload | lossy fields explicitly non-authoritative |
| **F8** metadata concurrency explicit | field-owner race tests | concurrent owner updates | unrelated-field preservation and cross-owner rejection |
| **F9** restart semantics explicit | reload/rebuild tests | clean restart matrix | durable/rebuildable/ephemeral classification |
| **F10** P9 remains out of scope | scope assertions | deployment capability check | no fsync/rename/corruption-recovery/cross-process implementation |

### 6.1 Required replay scenarios

```text
same Cognition source imported twice → one entity
same SiteProfile export generated twice → same canonical key
stale file after DB update → DB authority unchanged
projection deleted → rebuilt from authority
API GET → no authority mutation
read/search → no durable access-stat mutation
concurrent metadata owners → unrelated fields preserved
restart → authority reloads, projection rebuilds, ephemeral state lost
```

---

## 7. Deployment and P9 Boundary Check

Current supported deployment remains:

```text
one th-server Node process
one shared repository aggregate
one process-local queue
```

P6 may define semantic writer serialization for this topology. It must not claim:

```text
two processes sharing JSON → safe CAS
crash during write → automatic repair
fsync/rename durability
multi-process transaction safety
```

Before any future process split, a separate gate must require a shared durable backend, shared queue/claim semantics, and backend-enforced atomic conditional updates.

---

## 8. Final Planning State

```text
P6 Phase 0 Audit       — APPROVED / CLOSED
P6 Phase 1 Brief       — APPROVED / FROZEN
P6 Phase 1 Contract    — APPROVED / CLOSED
P6 Phase 2 Plan        — PROPOSED-R4 / AWAITING REVIEW
P6 implementation      — NOT AUTHORIZED
Production code        — NOT AUTHORIZED
```

### R4 revision

R4 adds the final classification/vocabulary cleanup and closes the remaining plan consistency items:

- `SPLIT` is now reserved for future orchestration callsites only, not for current writer rows.
- `MIGRATE/DOWNGRADE` is no longer a valid combined classification.
- `AgentLoop.onSessionEnd` is split into two distinct manifest rows: one for learned-entity orchestration and one for control-state orchestration.
- `AgentLoop.new CognitiveEngine` and `AgentLoop.onSessionStart` are now classified as orchestration/KEEP rows.
- 2-A0 representation readiness is separate from 2-A2 uniqueness enforcement; uniqueness is enabled only after collision resolution.
- 2-F authority closure checks DB-authoritative semantic writers separately from retained file-owned control-state writers.
- 2-F disables automatic migration importer/background reverse sync; explicit operator conflict import remains a separate audited capability if retained.

The rest of the plan content, gates, and invariants from R3 are unchanged.

**Next gate**: review Plan-R4. No production migration begins until the plan and its cutover gates are approved separately.
