# P6 Pre-SP-0 Operationalization Corrective Design

Status: `PENDING WRITTEN-SPEC REVIEW`

Date: `2026-09-21`

Authorization record:
`docs/P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#pre-sp-0-operationalization-corrective-gate`

## 1. Purpose

This design closes the pre-SP-0 operational tooling gaps identified after the
P6 Phase 2-F operational-decision review. It covers only:

- `C6`: evidence-root packaging and finalization;
- `C7`: isolated final-backup restore and verification;
- `C8`: live preflight, import, reconciliation, replay, revoke, and rejection
  proof tooling;
- `C9`: complete pre-PONR rollback orchestration; and
- `C10`: freeze-entry evidence collection.

The deliverable is deterministic, fail-closed tooling and focused tests. This
design does not authorize or execute a live command.

## 2. Authorization And Safety Boundary

The approved implementation scope includes design, production implementation,
focused regression tests, independent corrective review, read-only command
discovery, and documentation required to describe the implemented tooling.

The following remain prohibited:

- live runtime start or deployment;
- live freeze or queue pause;
- final live backup capture or restore against live/source paths;
- live preflight, import, writer activation, traffic release, mutation
  enablement, or PONR;
- approval or execution of `SP-0` through `SP-4`;
- Authorization 2, package freeze, or P6 Phase 2-G; and
- selection of a new maintenance window, writer-activation deadline, final
  evidence root, isolated restore target, or previous live artifact.

The following remain required human inputs and have no software default:

- superseding `DEC-08` maintenance window;
- explicit reaffirmation of the `DEC-09` freeze and rollback reserve;
- superseding `DEC-10` writer-activation deadline;
- exact final evidence root;
- exact isolated restore target; and
- exact previous live artifact and deployment contract.

Missing values, relative paths, placeholders, path overlap, unbound identities,
or mismatched hashes fail closed.

## 3. Selected Architecture

The implementation extends the existing
`packages/persistence/th-persistence/src/cutover` module. It uses focused core
modules with narrow CLI entrypoints:

```text
operational-contract
operation-ledger
evidence-root                 (C6)
final-backup-restore          (C7)
live-migration               (C8)
pre-ponr-rollback             (C9)
freeze-entry-evidence         (C10)
```

Existing snapshot, preflight, importer, provider, and runtime-attestation
primitives are reused. Existing v9 `stableJson`, snapshot identity, and
historical evidence semantics are not modified.

The following alternatives are rejected:

- a separate cutover-ops package, because it adds public API and cross-package
  coupling without reliably preserving runtime identity; and
- a monolithic operational runner, because it collapses mandatory human stop
  points and expands the failure and rollback blast radius.

### 3.1 Runtime identity consequence

The approved `runtime-package-v2` remains immutable historical evidence. Its
existing `DEC-14` approval remains true for those exact bytes and must not be
rewritten.

Production/runtime byte changes from C6-C10 make that package ineligible as the
final live Authorization-2 candidate. After implementation and independent
review, a later human gate must select a new create-new package root and approve
a new artifact identity, manifest SHA-256, attestation SHA-256, deployment
binding, and superseding `DEC-14` record. This corrective gate does not
authorize that package generation or approval.

## 4. Shared Operational Contract

Every CLI consumes an exact `p6-operational-contract-v1` JSON document. The
implementation reads the contract bytes exactly once and uses that same byte
buffer for SHA-256 calculation, JSON parsing, and validation.

The contract carries only explicit values, including:

- run ID and governed operation;
- canonical absolute paths;
- source, document, artifact, manifest, attestation, and result hashes;
- expected inventory and migration counts;
- runtime provider, topology, entrypoint, datastore, and control-plane
  bindings;
- exact mutation rejection probe;
- human-decision record references; and
- result, ledger, and evidence destinations.

No CLI may derive a missing operational value from the current working
directory, a historical rehearsal identity, a workspace build, or a nearby
file. Path handling resolves the nearest existing ancestor with `realpath` and
appends a non-existing suffix before containment checks.

## 5. Human-Decision Binding

The ledger verifies human decisions but never creates, infers, completes, or
approves them.

Pre-SP-0 frozen decisions are bound by:

```text
decision document SHA-256
stable anchor or decision ID
exact decision payload SHA-256
```

In-window SP and rollback-GO decisions are bound by:

```text
exact append-only JSONL record bytes
record SHA-256
decision ID
state
reviewed evidence hashes
```

Line numbers are not identities. Duplicate decision IDs, truncated JSONL,
missing fields, mismatched state, or mismatched evidence hashes are rejected.

## 6. Operation Ledger

The operation ledger is a create-new event directory. Events use ordinal file
names and a SHA-256 chain:

```text
events/0001-preflight.json
events/0002-site-profile-import-intent.json
events/0003-site-profile-import-completed.json
```

Every event binds:

- run ID and operation;
- operational-contract SHA-256;
- previous event SHA-256;
- input artifact hashes;
- result artifact SHA-256 when present;
- exact human-decision binding when required;
- actor and timestamp with timezone; and
- outcome or transition state.

Missing, extra, duplicate, out-of-order, or hash-chain-invalid events reject
all nominal commands.

The ledger enforces state and evidence order. It does not replace a human gate.
It may verify that a prerequisite decision exists and matches exact state and
hashes. It must not infer approval, auto-approve rollback, or continue to the
next mutating step.

### 6.1 Intent and completion

Commands that can modify a datastore, process, request target, or operational
state use this sequence:

```text
validate contract and complete ledger chain
validate exact human gate
persist create-new operation-intent event
cross the mutation boundary
persist create-new result
persist operation-completed event
STOP
```

An intent without completion is `AMBIGUOUS`. All nominal commands reject it.
Automatic retry, automatic completion reconstruction, and inference from a
result file are prohibited.

Resolution requires a separate, explicitly authorized reconciliation path that
classifies the effect as `NO_EFFECT`, `COMPLETED_EFFECT`, or `UNKNOWN` under a
new human decision. That reconciliation path is not implicitly authorized by
this design.

A persisted migration-revoke intent with no completion is
`MIGRATION_REVOKE_AMBIGUOUS`. Every importer, replay, or writable migration
entrypoint must reject it before opening a writable provider. Only explicit
revoke reconciliation/resolution may proceed.

## 7. C6 Evidence-Root Package And Finalization

### 7.1 Structure

C6 initializes an absent, human-approved root and records its operational
contract binding. Child artifacts are associated with `EVD-LIVE-01` through
`EVD-LIVE-15` through create-new binding records.

Artifacts outside the evidence root, including final backup, control-plane
audit, SP approvals, and incident audit, are external bound artifacts. Their
bindings record exact canonical path, byte length, and SHA-256. They are not
silently copied into the root.

### 7.2 Manifest and seal

The evidence manifest:

- binds all governed child and external artifacts;
- uses deterministic ordinal ordering and runtime-local canonical JSON;
- does not bind itself; and
- does not bind the finalization seal.

The finalization seal binds the exact manifest bytes and manifest SHA-256 and
records run ID, actor, and finalization timestamp.

Post-finalization verification fails for any missing, extra, modified, or
link-substituted child; external artifact drift; manifest drift; or seal drift.

### 7.3 Incomplete finalization

```text
manifest absent + seal absent
-> evidence root remains open

manifest present + seal absent
-> FINALIZATION_INCOMPLETE
-> existing manifest bytes are immutable
-> regenerate or replace manifest is prohibited
-> exact children and external bindings are re-verified
-> only the missing seal may be created

seal present
-> root is sealed
-> bind and finalize operations reject
```

## 8. C7 Isolated Final-Backup Restore

C7 does not require the operational contract to predict the live final-backup
snapshot ID or manifest SHA-256. Those values are generated by DEC-13 capture.

The data flow is:

```text
DEC-13 capture result
-> ledger event binds exact backup result and manifest hashes
-> C7 reads that exact prior event and result
-> C7 reads backup manifest bytes once
-> validates manifest SHA and snapshot identity against DEC-13 result
-> restores to an absent isolated target
```

C7 then verifies every raw payload hash, datastore semantic hash, provider
reload/read behavior, and source immutability. The JSON provider receives a
narrow read-only mode for this verification. Existing default provider and
`close()` behavior remain unchanged.

Focused tests must prove that read-only provider construction, reads, close,
reopen, and repeated reads perform no write.

Any overlap, link substitution, manifest mismatch, or prior-event mismatch
fails before target creation. If failure occurs after target creation, the
partial target is retained for investigation, marked unusable, and never
deleted or reused automatically. Retry requires a different, human-approved
create-new target.

## 9. C8 Migration Operations

C8 exposes separate commands and prohibits a one-command import workflow.

The nominal sequence is:

```text
preflight
-> persist preflight result and ledger event
-> STOP

SP-1 human approval
-> binds exact preflight result SHA-256

SiteProfile import
-> STOP
Cognition import
-> STOP
reconcile
-> STOP
replay
-> STOP
revoke
-> STOP
rejection proof
-> STOP
```

Preflight is read-only and does not require SP-1. The first live import command
requires an exact SP-1 record that binds the accepted preflight result hash.

Every migration entrypoint checks the complete ledger, required predecessor,
SP-1 binding when applicable, unresolved intents, revoke completion, and revoke
intent before opening a writable provider.

Reconciliation proves expected counts, canonical identities, provenance,
collision membership, source immutability, and absence of unexpected authority
changes. Replay must insert zero rows and leave semantic authority unchanged.
Revocation is persisted in the ledger. Rejection proof invokes the command
boundary after revocation and must be rejected before a writable provider is
opened.

Any import, reconciliation, or replay failure advances only to
`MIGRATION_ABORT_REQUIRED`. This state does not authorize C9. Further import or
replay is prohibited; explicit revoke remains available, and rollback still
requires a separate exact rollback GO.

## 10. C9 Complete Pre-PONR Rollback

C9 provides one complete rollback orchestration. It has no domain-selection,
skip-step, or partial-restore option.

Rollback may begin only when all of the following are proven:

- an exact rollback execution GO exists;
- accepted post-writer authority-only mutations are zero;
- ambiguous mutation outcomes are zero;
- the final backup identity and hashes match;
- the previous artifact identity and hashes match; and
- the current runtime and frozen-state evidence match.

The rollback GO record binds this exact failed/current state, zero-accepted
proof hash, zero-ambiguous proof hash, final-backup identity/hash, previous
artifact identity/hash, current runtime identity, and frozen-state evidence
hash. Any mismatch requires a new rollback GO.

The tool must not infer the previous artifact from v9 rehearsal evidence, the
historical `9edda6be...` package, current v2 package, or a workspace build.
Those candidates are rejected unless a later human decision explicitly
approves the exact artifact as the previous live artifact.

The orchestration:

1. reasserts and verifies freeze;
2. preserves failed-state datastore, logs, audit, and hashes outside the restore
   target;
3. verifies and stops the exact current single-process runtime;
4. restores the authority datastore as one semantic rollback unit;
5. verifies exact raw hash, semantic hash, row counts, provider reload, and
   authority reads;
6. proves Cognition control-state partitions remain byte-identical;
7. verifies and launches the exact previous artifact;
8. verifies the previous authority, import, and projection direction; and
9. ends in `ROLLBACK_COMPLETE_FROZEN`.

`ROLLBACK_COMPLETE_FROZEN` is a success state, but traffic and mutation remain
frozen. A separate rollback traffic GO is required before reopening traffic.

P6 guarantees rollback ordering, complete semantic-unit restore, exact
raw/semantic/count verification, and no partial-domain rollback. It does not
claim fsync or crash consistency, physical atomic-rename durability, or
cross-process durability. Those are P9 concerns.

Accepted or ambiguous post-writer mutation evidence blocks pre-PONR restore and
requires post-PONR preservation/reconciliation instead.

## 11. C10 Freeze-Entry Evidence

C10 is a read-only collector except for its exact mutation rejection probe and
create-new evidence output. It does not redesign session lifecycle or the
control plane.

The flow is:

```text
verify exact ten-file path/type/size/hash baseline
-> query session inventory read-only
-> query existing control-plane and queue status
-> verify runtime/provider/path/source/artifact identities
-> capture governed hashes
-> send exact rejection probe once
-> perform read-only status/health/authority probes
-> recapture governed hashes
-> require exact equality
-> write create-new freeze-entry evidence
```

The following statuses are nonterminal and active for freeze purposes:

```text
queued
planning
running
cancelling
pending
executing
```

Freeze-entry acceptance requires the combined count across all six statuses to
be zero. Unknown, unparseable, or ambiguously mapped statuses are `NO-GO`; they
are never treated as terminal.

The mutation rejection route, method, and body are exact operational-contract
inputs. The guard must reject before authority write or provider mutation. The
response must match the rejection contract and governed hashes must remain
exactly unchanged.

The reviewed mutation-surface assertion binds:

- focused source-test evidence;
- exact source revision;
- reviewed mutation-surface inventory; and
- post-C6-C10 runtime package identity.

The live collector verifies that the running identity equals that reviewed
identity before sending the mutation probe. The collector cannot declare its
own mutation surface safe.

## 12. Failure Semantics

Exit classification is determined by whether absence of side effects can be
proven, not merely by whether a mismatch was expected.

```text
exit 0 / PASS
-> required operation completed
-> result persisted
-> completion event persisted

exit 2 / NO-GO
-> deterministic contract, state, or evidence mismatch
-> operation did not cross its mutation boundary
-> durable, process, and request side effects are proven absent

exit 1 / FAIL / AMBIGUOUS
-> operation crossed or may have crossed its mutation boundary
-> durable or process effect cannot be proven
-> no retry and no continuation
```

### 12.1 Result and ledger behavior

```text
PASS / exit 0
-> intent persisted when the operation has a mutation boundary
-> result persisted
-> completion event persisted

NO-GO / exit 2 before mutation boundary
-> optional create-new NO-GO diagnostic result
-> no operation intent
-> no completion event
-> provably zero writable, process, and request side effects

FAIL / AMBIGUOUS / exit 1
-> intent retained
-> failure or ambiguity evidence retained when writable
-> no nominal completion event
-> ledger enters unresolved-intent state
-> all nominal continuation rejects
```

Failure to persist ambiguity evidence does not downgrade the outcome to
`NO-GO`.

### 12.2 Rejection probe

For C10:

- exact expected rejection plus unchanged hashes is `PASS`;
- a contract/state mismatch before request send is `NO-GO`; and
- timeout after send, connection loss after send, unexpected success, an
  unknown response outcome, or governed hash drift is `FAIL / AMBIGUOUS`.

The collector does not retry within an invocation.

### 12.3 Rollback failure

If C9 fails after a process or datastore boundary may have been crossed, the
tool preserves failed-state evidence where possible, keeps traffic and mutation
frozen, starts no fallback artifact, restarts no current artifact, and opens no
traffic. The result is `FAIL / AMBIGUOUS` and requires incident review.

## 13. Secret Hygiene

`CUTOVER_CONTROL_TOKEN` is inherited only through its approved environment
reference. Its value must never appear in stdout, stderr, a result, ledger
event, evidence binding, evidence manifest, finalization seal, command-discovery
document, or committed file.

Tests inject a sentinel token and scan every output channel and generated
artifact for that sentinel.

## 14. Regression-Test Design

All tests use temporary directories, fixture datastores, controlled loopback
servers, and injected process adapters. Tests must not read or modify:

- `.p6-live-cutover/`;
- the live datastore or legacy roots;
- any existing runtime package; or
- `.runtime-package-probe/` or `.runtime-package-legacy-probe/`.

Every production behavior begins with a focused failing test. Implementation
then adds the minimum behavior needed to pass before refactoring.

### 14.1 Shared contract and ledger

Tests cover missing values, placeholders, relative paths, canonical overlap,
link aliases, exact-byte hashing/parsing, both decision-binding forms,
duplicate decisions, deterministic event ordering, chain tampering, invalid
transitions, unresolved intents, explicit effect classification, and revoke
intent fail-closure.

Every `exit 2` test uses injected adapters to prove zero writable-provider,
process, datastore, and request interaction. Every post-boundary fault test
expects `exit 1 / AMBIGUOUS`.

### 14.2 C6

Tests cover create-new initialization, child and external bindings, canonical
path/hash/size capture, link rejection, ordinal manifest ordering,
non-recursive manifest/seal semantics, incomplete-finalization seal-only
completion, all drift modes, extra/missing governed artifacts, and sealed-root
write rejection.

### 14.3 C7

Tests cover exact DEC-13 event/result binding, substituted backup rejection,
target separation, raw and semantic verification, corrupt/missing/extra
payloads, source immutability, zero-write provider lifecycle, unchanged default
provider behavior, and retained non-reusable partial targets.

### 14.4 C8

Tests cover the preflight STOP, exact SP-1/preflight hash binding, every ordered
transition, one-result/one-completion behavior, blocked transitions before
writable-provider open, revoke-intent closure, count/provenance/collision drift,
idempotent replay, persistent revoke, rejection proof, partial imports, and
ambiguous completion.

Integration tests use the real JSON provider only against temporary copies.

### 14.5 C9

Tests cover every rollback-GO evidence field, pre-side-effect rejection,
accepted/ambiguous mutation prohibition, complete semantic rollback,
control-state preservation, previous-artifact verification, previous-direction
verification, absence of partial options, frozen success state, and absence of
traffic release.

Fault injection surrounds every process and datastore boundary. Additional
tests reject v9 rehearsal identity, the historical `9edda6be...` candidate, and
an arbitrary workspace build as previous-live artifacts unless separately
human-approved.

### 14.6 C10

Tests cover exact ten-file inventory, link/path ambiguity, all six nonterminal
statuses, unknown statuses, zero lifecycle mutation, queue quiescence, exact
runtime identity, reviewed mutation-surface binding, exact rejection request,
pre-request `NO-GO`, all post-request ambiguity outcomes, governed hash drift,
and a request count of one.

Current runtime identity mismatch must reject before the mutation probe is
sent.

### 14.7 Offline integration order

The integration flow mirrors the permitted cutover sequence:

```text
C6 init evidence root
-> C10 freeze-entry evidence against controlled fixtures and fake endpoint
-> synthetic DEC-13 final-backup binding
-> C7 isolated restore and verify
-> C8 preflight
-> STOP
-> synthetic exact SP-1 record binding the preflight result
-> SiteProfile import
-> Cognition import
-> reconcile
-> replay
-> revoke
-> rejection proof
-> C6 bind remaining artifacts
-> C6 finalize
-> C6 verify
```

C9 has a separate integration fixture with a fake single-process adapter. No
real runtime is started.

### 14.8 Verification sequence

The implementation milestone runs:

1. focused C6-C10 tests;
2. the persistence package test suite;
3. persistence, API, server, and worker typechecks;
4. the workspace test suite once;
5. required builds;
6. `git diff --check`;
7. secret, generated-output, and untracked-scope inspection;
8. independent corrective review; and
9. read-only command discovery.

Independent review must be performed by a reviewer other than the implementer.
The implementation cannot self-declare that review `PASS`.

## 15. Documentation And Command Discovery

After implementation and independent review, documentation updates will:

- expose exact CLI syntax and machine-readable PASS/NO-GO/AMBIGUOUS criteria;
- distinguish stale trace-matrix entries from unresolved human blockers;
- retain undecided human values as explicit blockers rather than defaults;
- record the historical status of runtime-package-v2; and
- stop before selecting paths, windows, deadlines, previous artifacts, a new
  package root, or a superseding DEC-14 binding.

Read-only command discovery may prove command availability and parameter
semantics. It must not execute live operations.

## 16. Completion And Stop Condition

The corrective implementation is ready for the next human review only when:

- C6-C10 implementation is complete;
- focused and broader validation pass;
- independent corrective review passes;
- read-only command discovery is complete; and
- the contract trace matrix distinguishes resolved stale entries from real
  human/package blockers.

The work then stops before new human decisions or package completeness review.

Completion does not constitute:

- Authorization-2 package freeze;
- `SP-0` or any later stop point;
- Authorization 2;
- a superseding DEC-14 approval; or
- permission for any live operation.
