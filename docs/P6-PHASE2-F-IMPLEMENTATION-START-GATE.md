# P6 Phase 2-F coordinated cutover implementation-start gate

Status: `APPROVED / FROZEN — REHEARSAL/TOOLING AUTHORIZED; LIVE CUTOVER NOT AUTHORIZED`

The closed recovery point is:

```text
P6 Phase 2-A through 2-E — APPROVED / CLOSED

P6 Phase 2-F
-> IMPLEMENTATION-START GATE APPROVED / FROZEN
-> REHEARSAL / TOOLING AUTHORIZED
-> LIVE CUTOVER NOT AUTHORIZED

P6 Phase 2-G
-> NOT AUTHORIZED
```

This document freezes the independent Phase 2-F implementation-start gate.
Authorization 1 permits tooling and cloned-datastore rehearsal under the
boundaries below. It does not authorize live restore, freeze, mutation,
import, writer activation, deployment, traffic release, or cutover.

## Gate interpretation

Phase 2-F is the single coordinated migration and behavioral cutover unit from
the frozen Phase 2 plan. Cognition, SiteProfile, migrated metadata boundaries,
import direction, GET/reverse-sync retirement, and projection policy may not
be deployed as independent cutovers.

Phase 2-F has two separate authorization points:

```text
authorization 1
-> cutover tooling and full rehearsal on isolated clones only
-> no live datastore or legacy source mutation

independent rehearsal review
-> evidence accepted
-> exact target, artifact, operator, and maintenance window named

authorization 2
-> one live coordinated cutover for that approved target/window only
```

Approval of this scope does not imply either authorization. A successful
rehearsal does not itself authorize live cutover.

## Runtime-provider prerequisite

The cutover target must name the exact provider, datastore path/instance,
deployment artifact digest, legacy source roots, and runtime topology.

The currently validated runtime providers are in-memory and JSON. The
in-memory provider remains a reference/test topology and cannot satisfy a
durable live backup, restore, and restart claim. Under the current approved
provider set, JSON is the only candidate for a persistent live 2-F cutover.

SQLite and PostgreSQL remain unavailable runtime providers. Enabling or
claiming either backend requires a separate authority-adapter/provider gate
and is not permitted as part of 2-F.

## Required cutover state machine

The runbook and tooling must expose an unambiguous state for every step:

```text
PREPARED
-> target/artifact/operator/window fixed
-> rehearsal evidence approved

FROZEN
-> new sessions and semantic mutation entrypoints rejected
-> workers/queues drained and paused
-> final backup and input hash manifest captured

IMPORTING
-> SiteProfile bounded insert-only import
-> Cognition bounded insert-only import by verified site scope

VERIFYING
-> import reports reconciled
-> semantic diff and duplicate/collision checks pass
-> automatic importer/reverse sync proven absent or disabled

WRITERS_ENABLED_TRAFFIC_FROZEN
-> one coordinated artifact is active
-> all DB-authoritative semantic writers are service-routed
-> no external mutation traffic is admitted yet

LIVE_PRE_PONR
-> traffic may be released
-> no authority-only mutation has yet been accepted

LIVE_POST_PONR
-> first post-cutover authority-only semantic mutation accepted
-> file authority may no longer be restored automatically
```

Every transition is fail-closed and audit-recorded. A skipped, failed, or
unknown state is a no-go. If evidence cannot prove that no authority-only
mutation occurred after traffic release, rollback must conservatively treat
the system as `LIVE_POST_PONR`.

## Exact mutation-freeze window

Before entering `FROZEN`, stop admission of new sessions and drain or
terminalize every active worker. Then pause queue consumption and reject all
Cognition learned-entity, SiteProfile modeled-field, locator-cache, metric,
import, and metadata mutations that could alter the coordinated datastore.
Reads may remain available only if they are mutation-free.

The final backup and all migration inventories are captured only after the
freeze is proven. During the window, the only permitted semantic datastore
mutations are the explicitly authorized SiteProfile and Cognition importer
operations in the `IMPORTING` state.

Approved file-owned Cognition control-state partitions are not converted to DB
authority by this freeze. If they remain active, their exact files must be
excluded from the semantic import/restore set so a rollback cannot overwrite
newer control state. Any physical-file overlap with imported learned entities
is a no-go.

The freeze ends only after the system reaches
`WRITERS_ENABLED_TRAFFIC_FROZEN`, restart/read verification passes, and an
explicit go decision releases traffic. Writer enablement alone does not end
the freeze.

## Backup and restore evidence

Two different captures are required and must not be conflated:

```text
rehearsal snapshot
-> read-only, byte-for-byte capture from the designated live JSON datastore
   and legacy source roots before live-cutover authorization
-> used only to build isolated rehearsal clones
-> proves the procedure against representative real data

final cutover backup
-> captured after the live mutation freeze
-> authoritative rollback baseline for the approved window
-> must pass the rehearsed integrity and isolated-restore verification before import
```

Each capture set must include:

- the complete selected authority datastore, including canonical keys,
  provenance, metadata owner partitions, and idempotency records;
- the exact legacy SiteProfile and Cognition learned-entity import inputs;
- the approved SiteProfile ambiguity-resolution manifest and all explicit
  Cognition scope/mapping inputs;
- the deployment artifact/configuration identity needed to reproduce the run;
- an inventory manifest containing size, count, and SHA-256 for every captured
  file or datastore export.

The rehearsal snapshot capture is a read-only source operation. It may open and
copy the designated live JSON datastore and legacy source files, but it may not
write, rename, chmod, lock for mutation, normalize, serialize, repair, or
otherwise alter a source. For every source file, evidence records:

```text
absolute source path
relative manifest path
byte length
source SHA-256 before copy
copy SHA-256
source SHA-256 after copy
```

All three hashes must match. The complete source inventory is captured before
and after the copy; any added, removed, renamed, resized, or rehashed source
invalidates the snapshot. The operation fails closed and produces no accepted
rehearsal seed rather than retrying with a mixed-generation file set.

Secrets are referenced by identifier and are not copied into the evidence
manifest. Backups are immutable for the duration of 2-F through 2-G and have a
named retention/cleanup owner.

A capture is not accepted merely because it exists. Before use, tooling must
resolve source and destination paths and prove that neither rehearsal target is
the live datastore, a legacy source root, an ancestor/descendant of either, or
a link/junction resolving into either. Rehearsal processes receive clone-only
configuration and credentials.

The rehearsal snapshot must restore into at least two fresh isolated targets
for the rehearsals below. The final cutover backup must use the same capture,
manifest, restore, and verification procedure and pass an isolated restore
during the frozen live window before live import. Each restore proves:

```text
raw backup hashes                       -> exact match
canonical semantic snapshot             -> exact match
authority reads after restore            -> PASS
selected-provider close/reload/restart   -> PASS
legacy input hashes                      -> unchanged
source paths opened for write             -> ZERO
```

The canonical semantic snapshot is generated independently from the captured
source and from each restored clone, using deterministic record ordering. The
snapshots must match exactly. Any excluded run metadata is listed by exact
field name and justification; broad timestamp or metadata exclusions are not
permitted.

Restore verification records the restore command/tool version, source manifest
identity, destination path, restored raw hashes, semantic hash, provider
startup/read result, close/reload result, and cleanup owner. Failed or partial
restores are retained as evidence and are never promoted into a rehearsal
target.

Restore rehearsal never targets the live datastore. The current 2-E JSON
hashes are historical planning evidence only; they must be recaptured after
the final live freeze and cannot substitute for the final backup manifest.

## Cloned-datastore full rehearsal

Authorization 1, if later granted, may capture one explicitly approved,
read-only rehearsal snapshot from the named real target. All execution is then
limited to immutable copies of that snapshot. At least two fresh isolated
restores from the same rehearsal snapshot are required:

1. A success-path clone executes the complete cutover sequence, including a
   controlled authority-only mutation, provider restart, idempotent replay,
   and projection rebuild validation.
2. A rollback clone executes the sequence only through
   `WRITERS_ENABLED_TRAFFIC_FROZEN`, then performs the pre-PONR rollback and
   proves exact restoration.

The rehearsal uses the exact release artifact, configuration shape, import
manifests, commands, bounds, and operator runbook proposed for the live window.
Synthetic fixtures alone are insufficient. Clone paths and credentials must be
incapable of resolving to the live datastore or legacy source roots.

Rehearsal output must include timings, row counts, diagnostics, state
transitions, audit events, raw hashes, canonical semantic hashes, expected
diffs, restart results, and rollback results. Any manual step not captured in
the reviewed runbook is a rehearsal failure.

## Inventory and import ordering

After freeze, rerun read-only mapping against the exact final input set. The
result must contain zero unresolved canonical collisions, zero ambiguous
origins, zero invalid records, and zero Cognition rows without proven site
scope. No default scheme, inferred profile, generated winner, or destructive
merge is permitted.

Import order is frozen as:

```text
1. SiteProfile
   -> apply only approved canonical-origin resolutions
   -> bounded, explicit, insert-only import
   -> reconcile inserted/skipped/blocked diagnostics
   -> require blocked = 0

2. Cognition
   -> use the now-established SiteProfile/site identity
   -> group each command by explicit verified site scope
   -> bounded, explicit, insert-only import
   -> reconcile inserted/skipped/blocked diagnostics
   -> require blocked = 0
```

SiteProfile precedes Cognition because the approved Cognition importer requires
an explicit existing `siteId` scope. It may not assign a current request site,
invent an orphan profile, or import an unproven cross-site record.

Every skipped-existing row must be individually accounted for as retained DB
authority. A skip with an unexplained semantic mismatch or provenance conflict
is unresolved and blocks progression. For each domain:

```text
inserted + approved skipped-existing = valid input count
blocked                              = 0
replay inserted                       = 0
replay semantic datastore diff        = empty
```

Legacy source files remain byte-for-byte unchanged by import.

## Importer disable and writer enablement

After import verification and before authority writers are enabled:

1. Record import completion, input/output counts, provenance, actor, artifact,
   and manifest hashes.
2. Revoke the migration-run authorization and prove there is no startup,
   scheduler, GET/read, worker-finalization, or background path that can invoke
   automatic import.
3. Prove background reverse sync is absent from the deployed artifact and
   runtime registration.
4. If an explicit operator conflict-resolution importer is retained, keep it
   behind a separate command, principal, approval, and audit policy. It is not
   enabled by the migration-run authorization.
5. Verify static and runtime writer inventory closure while traffic remains
   frozen.
6. Restrict Cognition and SiteProfile authority mutation adapters to the
   privileged authority/import composition boundary. Do not hide unrelated
   session/report/read compatibility adapters.
7. Enable Cognition, SiteProfile, and metadata authority services as one
   coordinated writer unit. Do not open one domain to live traffic before the
   others.
8. Restart/reload the selected provider and repeat mutation-free reads and
   inventory checks before traffic release.

The importer implementation may remain in source for separately authorized
operator use. "Permanently disabled" means no automatic/background invocation
or reusable migration grant remains after cutover; it does not mean deleting
the audited explicit command boundary.

## Point of no return

The semantic point of no return is the first post-cutover authority-only
mutation accepted after writer activation. Import mutations are migrations of
preserved legacy input and do not by themselves cross this boundary.

Before traffic release, capture the `LIVE_PRE_PONR` datastore semantic hash and
record the operator decision. The first accepted authority-only mutation must
be identifiable by domain, operation, canonical identity, idempotency key or
audit identity, timestamp, and resulting authority version/hash.

Writer traffic release without sufficient audit evidence is conservative
PONR: if zero mutations cannot be proved, post-PONR restrictions apply.

## Rollback procedures

### Pre-PONR rollback

Pre-PONR rollback is permitted only while semantic write traffic is frozen or
the audit proves that no post-cutover authority-only mutation was accepted:

1. Re-enter/reassert the mutation freeze.
2. Stop the new artifact and all importer/writer processes.
3. Preserve cutover logs and failed-state evidence outside the restore target.
4. Restore the authority datastore from the final verified backup.
5. Verify raw hashes, canonical semantic hash, row counts, and authority reads.
6. Restore the previous application artifact and the complete previous
   authority/import/projection direction as one coherent unit.
7. Do not overwrite file-owned control partitions from the semantic backup.
8. Reopen traffic only after an explicit rollback go decision.

Partial rollback of one domain, one writer route, or one projection direction
is prohibited.

### Post-PONR rollback

After PONR, automatic restoration of file authority or the pre-cutover
datastore backup is prohibited because it can lose authority-only mutations.
Emergency response may freeze traffic and roll application code back only if
DB semantic authority and authority-service routing remain intact.

Returning authority to files requires a separately designed and authorized
reverse migration/reconciliation with complete post-PONR mutation accounting.
It is not a 2-F rollback action. Stale legacy files, projections, or backups
must never be re-enabled as independent authority.

## Semantic diff and hash policy

Raw SHA-256 hashes prove exact capture and restore of immutable inputs. They do
not replace a semantic datastore comparison.

The runbook must also generate a deterministic, sorted canonical semantic
snapshot for every authority table/record group. Any excluded run metadata,
such as an audit timestamp, must be enumerated field by field in the gate
evidence; a broad ignore rule is prohibited.

Expected import diff is limited to:

- insert-only missing SiteProfile authority records and their idempotency/audit
  evidence;
- insert-only missing Cognition authority records with separate provenance and
  their idempotency/audit evidence;
- no modification of pre-existing DB-authoritative semantic records;
- no mutation of legacy source files;
- no unexplained delete, winner selection, metric increment, metadata change,
  or projection-to-authority write.

The controlled clone-only PONR mutation is reported separately from the import
diff. Live post-PONR mutations are never normalized away from rollback
evidence.

## Restart and replay validation

Before live authorization, the success-path clone must prove:

- selected-provider close/reload and full process restart preserve canonical
  identities, provenance, owner metadata, idempotency records, and import
  completion evidence;
- replaying each importer before disable inserts zero rows and changes no
  semantic authority;
- invoking automatic/background import after disable is unavailable or
  rejected and changes no data;
- replaying an authority mutation with the same idempotency identity returns
  the original result without duplication;
- replaying that identity with a different payload fails closed;
- rebuilding/deleting projections does not alter authority;
- retained file-owned controls remain readable/writable only by their approved
  partition owner.

Crash consistency, fsync guarantees, cross-process locks/CAS, WAL, and physical
recovery remain P9 concerns and are not claimed by this validation.

## Go / no-go criteria

### Required evidence before live-cutover authorization

Every item is mandatory before authorization 2 may be considered:

- Phase 2-A through 2-E remain closed and the frozen writer manifest has no
  reopened finding;
- exact provider, datastore, legacy roots, artifact digest, configuration,
  window, operator, rollback owner, and approver are named;
- the read-only rehearsal snapshot and isolated restore evidence pass;
- both full clone rehearsals pass with the exact proposed artifact/runbook;
- rehearsal mapping reports zero unresolved collision, ambiguity,
  invalid record, orphan site scope, or unexplained conflict;
- rehearsed import counts, skip decisions, provenance, and semantic diffs
  reconcile;
- static/runtime closure proves automatic import and reverse sync can be
  disabled before writers;
- all DB-authoritative semantic writers are service-only and retained file
  writers are confined to approved control partitions;
- Cognition/SiteProfile mutation adapters are reachable only through the
  privileged composition boundary, with unrelated adapters retained;
- restart, replay, projection rebuild, and idempotency checks pass;
- pre-PONR rollback rehearsal restores exact baseline;
- PONR detection and post-PONR authority-preserving response are observable;
- an explicit human/operator go decision approves the exact target/window.

### Required in-window GO evidence

Authorization 2 permits the runbook to enter the live window; it does not
waive its internal stop points. Before live import and again before writer
activation/traffic release, the operator must require:

- freeze rejection, queue drain, and zero active session evidence pass;
- final post-freeze backup, raw hashes, semantic snapshot, and isolated restore
  verification pass;
- final read-only mapping reports zero unresolved collision, ambiguity,
  invalid record, orphan site scope, or unexplained conflict;
- final source hashes exactly match the inputs approved for import;
- live import counts, skip decisions, provenance, and semantic diffs reconcile;
- automatic importer and reverse sync are absent/disabled before writers;
- authority-service-only routing and mutation-adapter encapsulation pass on the
  deployed artifact while traffic remains frozen;
- selected-provider restart/read verification passes;
- rollback owner and evidence capture remain available;
- an explicit operator GO is recorded before writer activation and separately
  before traffic release.

### Mandatory NO-GO conditions

Any one condition stops before writer activation or traffic release:

- unsupported or unnamed runtime provider;
- live/clone path ambiguity or inability to prove target isolation;
- mutation freeze leak, active worker, non-drained queue, or read-triggered
  durable mutation;
- missing/unrestorable backup or hash/semantic-snapshot mismatch;
- rehearsal/runbook/artifact/configuration drift;
- any unresolved mapping, blocked import row, unexplained skip, duplicate,
  invalid provenance, or scope mismatch;
- import bounds exceeded or source inputs changed after final inventory;
- any direct authority bypass, automatic importer, or background reverse sync;
- unexplained datastore diff, legacy file mutation, or projection overwrite;
- restart/replay/idempotency failure;
- unavailable rollback owner, missing audit evidence, or ambiguous PONR state;
- maintenance-window expiry before safe writer activation.

A no-go before PONR invokes the rehearsed pre-PONR rollback. A no-go after an
ambiguous or confirmed PONR freezes writes and preserves DB authority; it does
not restore file authority.

## Authorized scope for authorization 1

The explicit rehearsal authorization allows only:

- cutover orchestration/runbook and fail-closed freeze tooling;
- backup, restore, inventory, semantic-diff, hash, and evidence tooling;
- read-only, byte-for-byte snapshots/copies of the designated live JSON
  datastore and legacy source roots solely to seed isolated rehearsal clones;
  source files remain read-only and their before/copy/after hashes are
  recorded;
- explicit import manifests and cutover audit records;
- full execution against isolated real-datastore clones;
- focused tests, dependency checks, typecheck, and build;
- production-read-only discovery needed to identify exact paths/counts, if
  separately approved and incapable of mutation.

Authorization 1 does not permit restoring into the live datastore, entering
the live freeze window, mutating live data, executing live import, activating
writers, switching writer authority, or releasing cutover traffic. The final
post-freeze cutover backup also remains part of authorization 2.

The granted authorization text is explicit:

```text
Authorize P6 Phase 2-F rehearsal/tooling only.
Do not execute live cutover.
Stop after cloned-datastore rehearsal evidence and independent review.
```

Only after that review may a second authorization name one exact target,
artifact, operator, and window for live cutover.

## Hard boundary

The following remain prohibited at the current gate:

```text
- any live-target production-code activation or deployed writer behavior change
- any rehearsal execution outside validated isolated clones
- any final live cutover backup, restore, or mutation freeze
- any live-target Cognition or SiteProfile legacy import
- any live authority writer/deployment activation or traffic release
- automatic importer or reverse-sync reintroduction
- destructive merge or inferred collision winner
- broad repository removal beyond the frozen plan
- SQLite/PostgreSQL runtime enablement or migration
- P9 physical durability implementation or claims
- any Phase 2-G implementation or closure claim
```

## Validation matrix for a future rehearsal review

```text
target/provider/artifact/window identities                 — EXPLICIT
clone isolation from live paths                            — PROVEN
rehearsal snapshot raw hashes and isolated restore          — PASS
final backup/restore procedure rehearsal                    — PASS
canonical semantic snapshot restore                        — EXACT
mutation freeze and queue drain                            — PASS
SiteProfile-first import ordering                          — PASS
Cognition verified-site-scope import                       — PASS
unresolved collision/ambiguity/invalid/orphan              — ZERO
blocked import diagnostics                                 — ZERO
approved skip/count reconciliation                         — PASS
import replay semantic diff                                — EMPTY
legacy input mutation                                      — ZERO
automatic importer/background reverse sync                 — DISABLED
authority-service-only semantic writers                    — PASS
authority mutation adapter encapsulation                   — PASS
retained control writers outside approved partitions       — ZERO
restart/reload/idempotency/replay                           — PASS
projection rebuild authority mutation                      — ZERO
success-path clone rehearsal                               — PASS
pre-PONR rollback clone rehearsal                           — PASS
post-PONR file-authority restoration                       — PROHIBITED
semantic diff and datastore hash evidence                  — PASS
focused/regression/typecheck/build/static checks           — PASS
live datastore mutation                                    — NONE
```

## Stop condition

This scope-freeze milestone stops at:

```text
P6 Phase 2-F implementation-start gate
-> APPROVED / FROZEN

P6 Phase 2-F rehearsal/tooling
-> AUTHORIZED

P6 Phase 2-F live cutover
-> NOT AUTHORIZED

P6 Phase 2-G
-> NOT AUTHORIZED
```

No test result, current datastore hash, or prior source-level migration grants
implicit permission to rehearse against a real clone or execute live cutover.
