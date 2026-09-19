# P6 Phase 2-F Authorization 2 Live Coordinated Cutover Contract

Status: `DRAFT FOR EXPLICIT REVIEW / DOCUMENTATION ONLY / AUTHORIZATION 2 NOT GRANTED`

This contract defines the decision and execution boundary for one coordinated
Phase 2-F live cutover. It does not authorize entering a maintenance window,
freezing live traffic, capturing the final live backup, importing data,
enabling writers, releasing traffic, crossing PONR, or beginning Phase 2-G.

The governing semantics are:

```text
review ready != authorization 2 approved
authorization 2 approved != permission to cross PONR
contract review = documentation/design activity only
```

Normative terms `MUST`, `MUST NOT`, and `NO-GO` are fail-closed requirements.
`PENDING` identifies an approval blocker that may not be inferred or filled by
the operator during execution.

## 1. Contract decision

This contract becomes executable only when all `PENDING` fields in section 4
are completed, all requirements `LCC-01` through `LCC-18` are accepted, and an
explicit authorization record names this exact contract revision, target,
artifact, configuration, resolution manifest, operator, approvers, and window.

Authorization 2, if granted, permits entry into the named live window and
execution only as far as each internal stop point permits. It does not waive
any in-window gate. Separate recorded approvals are required at `SP-1` through
`SP-4`. In particular, authorization 2 alone does not permit mutation-capable
traffic or the first authority-only mutation.

Any identity, path, byte hash, runtime topology, command, threshold, owner, or
window change after approval invalidates authorization 2. The run MUST stop and
return to contract review; the operator MUST NOT substitute an equivalent value.

## 2. Evidence basis and classification

| Evidence ID | Classification | Record | Accepted conclusion |
|---|---|---|---|
| `EVD-V9-READINESS` | Observed fact | v9 immutable artifact/configuration identities | v9 execution readiness passed |
| `EVD-V9-EVIDENCE` | Observed fact | `.p6-rehearsal/2026-09-18-root-json-v9/preflight-evidence.json` | designated isolated-clone rehearsal passed |
| `EVD-V9-SNAPSHOT` | Observed fact | v9 `snapshot/snapshot-manifest.json` | ten rehearsal inputs were captured with exact before/copy/after hashes |
| `EVD-V9-PONR` | Observed fact | v9 `success-clone/p6-ponr-audit.jsonl` plus focused regression results | accepted PONR was audited in v9; ambiguous PONR handling passed focused tests |
| `EVD-DEC-02` | Observed fact | `docs/P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-02` | accountable system owner approved Billy Xu (admin) as `DEC-02`; that decision does not itself approve any other DEC or SP-0 |
| `EVD-DEC-03` | Observed fact | `E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-03` | accountable system owner approved Billy Xu (admin) as `DEC-03` |
| `EVD-ROLE-02-03` | Observed fact | `E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#role-concentration-dec-02-dec-03` | accountable system owner explicitly accepted `DEC-02 == DEC-03` role concentration |
| `EVD-GOV-EX-01` | Observed fact | `E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#gov-ex-01-single-operator-governance-exception` | accountable system owner approved the exact, role-enumerated single-operator exception; eligibility only, with no DEC, SP, authorization 2, or live execution approval implied |
| `REQ-AUTH2` | Stakeholder request | this contract | prepare one explicit live coordinated-cutover decision; no authorization yet |
| `ASM-LIVE-WINDOW` | Assumption to validate | section 4 | remaining live execution roles, window, commands, and operational ownership remain unapproved |

The accepted v9 evidence establishes authorization 1 completion. It is not the
final post-freeze backup and cannot substitute for in-window evidence.

## 3. Exact candidate identity lock

The following values are the only candidate identities eligible for
authorization 2 review. Their status is `FROZEN CANDIDATE`; they become live
approved only through the explicit authorization record required by `SP-0`.

| Item | Exact value | Review status |
|---|---|---|
| Provider | `json` | frozen candidate |
| Working directory | `E:\Projects\Test-Harness` | frozen candidate |
| Authority datastore | `E:\Projects\Test-Harness\data\testharness.json` | frozen candidate |
| Cognition legacy root | `E:\Projects\Test-Harness\.cognition` | frozen candidate |
| SiteProfile legacy root | `E:\Projects\Test-Harness\.site-profiles` | frozen candidate |
| Resolution manifest | `E:\Projects\Test-Harness\.p6-rehearsal\example-com-resolution-v2.json` | frozen candidate |
| Resolution SHA-256 | `f6965b6b84d3727011257e25947ae5334c94a3b6f1c36682da232e4951aac8d0` | reviewed |
| Artifact identity | `eebfa1e708be2bc295b1a359a1927e1f3b8f64c02b3c71fd16558d971a9e0b92` | reviewed rehearsal identity; live approval pending |
| Configuration identity | `022247208906a6a2a91b52e4933f507cf6dc0db2ff75ae2172733aaeba67f4dc` | reviewed rehearsal identity; live approval pending |
| v9 evidence SHA-256 | `dab95cf4718d288bfb528eaf7975f4d0adb3df1f1151eb6329c0546fe433de1d` | reviewed and immutable |
| v9 snapshot ID | `a12c573b3add6b4e15d2f69f11e0cead4d02e41d5f20edfdeb691b5d08d1e8bb` | reviewed and immutable |
| v9 snapshot manifest SHA-256 | `592f9b14a6101aeafa2736418c0f42a96b1def59f335cd12fa17353b9d489dfa` | reviewed and immutable |
| v9 PONR audit SHA-256 | `f1d03a06ae5ba43c4d11e43980b759db603a3e331be0e0a0282585cf851b8830` | reviewed and immutable |

The artifact identity MUST bind the production runtime bytes or an approved,
reproducible deployment package derived from exactly those bytes. The live
deployment mechanism and verification command are `PENDING`; source-manifest
identity alone MUST NOT be silently promoted into a deployment attestation.

### 3.1 Rehearsed ten-file baseline

The authorization decision MUST state whether exact equality with this baseline
is required at window entry. This draft requires exact equality. Any drift is
`NO-GO` and requires a new evidence/contract decision; the operator may not
extend the resolution manifest or accept additional rows in-window.

| Source ID / role | Absolute path | Bytes | v9 source-before SHA-256 |
|---|---|---:|---|
| datastore / semantic | `E:\Projects\Test-Harness\data\testharness.json` | 6113156 | `b41324284cab0c1fae86a1ae50cf3a14b7fe5668b7d85d0ada165dae902c504e` |
| cognition / semantic | `E:\Projects\Test-Harness\.cognition\episodes.json` | 133535 | `c5c14d311966b4ed85ed491b188dfee1ff1c237d6947ebd931f07fd65b561f1a` |
| cognition / control | `E:\Projects\Test-Harness\.cognition\patterns.json` | 2 | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| cognition / control | `E:\Projects\Test-Harness\.cognition\q-values.json` | 468 | `9e126c4cfc6c2cc8f7e833ee4570076e8ca9817c4f7123f3be69940b6c3325d7` |
| cognition / control | `E:\Projects\Test-Harness\.cognition\recovery.json` | 1500 | `8a8d38f5b47d14fb2383d7320615c4ae770d3fc0fb6cb353eee3b28fcbfb5f54` |
| cognition / semantic | `E:\Projects\Test-Harness\.cognition\semantic.json` | 1127644 | `b11e481ffaa28101ce5a8e89d2cdec45b26c2a2b9844beaba3ea41dda47703e5` |
| cognition / control | `E:\Projects\Test-Harness\.cognition\strategies.json` | 1107 | `dd3e6ebfe3feaddb2f07ba8e549cf4b4a763269d808372f928420e1c65853bed` |
| profiles / semantic | `E:\Projects\Test-Harness\.site-profiles\185.200.65.4.json` | 155 | `8a000a365ac794dd4f355a1323c928d8246bca84f673429a332afd07442b2838` |
| profiles / semantic | `E:\Projects\Test-Harness\.site-profiles\www.baidu.com.json` | 119 | `47fefbade09a914e2833abc9263858f03ab0af940b14b9d3251cc4563cd726da` |
| resolution / semantic | `E:\Projects\Test-Harness\.p6-rehearsal\example-com-resolution-v2.json` | 23171 | `f6965b6b84d3727011257e25947ae5334c94a3b6f1c36682da232e4951aac8d0` |

No file may be added, removed, renamed, replaced by a link/junction, or resolve
outside these exact roots. Control-state files are evidence-only partitions and
MUST NOT be restored from the semantic rollback backup.

## 4. Mandatory authorization fields

Every row is an authorization blocker until its status is `APPROVED` and its
evidence location is recorded in the signed authorization record.

| Field ID | Required decision | Current value/status | Owner required |
|---|---|---|---|
| `DEC-01` | Live cutover operator | `PENDING`; Billy Xu (admin) is eligible under approved `GOV-EX-01`, but is not approved for this role | authorization-2 approver |
| `DEC-02` | Authorization-2 approver | `APPROVED`: Billy Xu (admin); decision owner Billy Xu (admin); `2026-09-19T10:48:18+08:00`; evidence `docs/P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-02`; independent from `DEC-01` by default | accountable system owner |
| `DEC-03` | Incident commander | `APPROVED`: Billy Xu (admin); decision owner Billy Xu (admin); `2026-09-19T10:56:59+08:00`; evidence `E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-03`; complete critical-window presence required | accountable system owner |
| `DEC-04` | Rollback owner | `PENDING` | incident commander |
| `DEC-05` | Evidence custodian | `PENDING` | authorization-2 approver |
| `DEC-06` | Queue/worker drain owner | `PENDING` | incident commander |
| `DEC-07` | Deployment owner | `PENDING` | incident commander |
| `DEC-08` | Maintenance-window start/end and timezone | `PENDING`; timezone MUST be explicit | authorization-2 approver |
| `DEC-09` | Maximum freeze duration | `PENDING` | incident commander |
| `DEC-10` | Latest safe writer-activation time | `PENDING` | incident commander |
| `DEC-11` | Exact admission-freeze command and verification query | `PENDING` | deployment owner |
| `DEC-12` | Exact worker/queue pause, drain, and inspection commands | `PENDING` | queue/worker owner |
| `DEC-13` | Final backup output path and retention/cleanup owner | `PENDING`; path MUST not exist before capture | evidence custodian |
| `DEC-14` | Exact deployment command and runtime artifact verification | `PENDING` | deployment owner |
| `DEC-15` | Exact pre-PONR traffic-release command | `PENDING` | deployment owner |
| `DEC-16` | `SP-1` through `SP-4` approvers and communication channel | `PENDING` | authorization-2 approver |
| `DEC-17` | Post-PONR incident/escalation channel | `PENDING` | incident commander |

### 4.1 Role selection constraints

`DEC-02` MUST have authority to approve or reject authorization 2, accept the
business and operational risk, and sign `SP-0` for the exact contract,
identities, and window. By default, `DEC-02` MUST NOT be the `DEC-01` executing
operator.
The authorization-2 approver SHOULD NOT also be the deployment owner or rollback
executor; any exception requires an explicit role-concentration acceptance by
the accountable system owner in the approval record.

`DEC-03` MUST have authority to stop or abort the window, require a renewed
freeze, invoke pre-PONR rollback, enforce DB-authority preservation after an
ambiguous PONR, and coordinate the deployment, queue/worker, rollback, and
evidence owners. The incident commander MUST remain continuously available from
the first freeze-entry action until either post-PONR stabilization is accepted
or pre-PONR rollback and operational restoration are complete.

By default, `DEC-02` and `DEC-03` SHOULD be different people so governance
authorization and operational command remain separated. If team size requires
one person to hold both roles, the accountable system owner MUST explicitly
accept and record that concentration. That `DEC-02 == DEC-03` concentration
acceptance alone does not permit either role to be held by the `DEC-01`
executing operator; only an approved section 4.2 exception can alter that
default.

For this decision package, the accountable system owner accepted the
`DEC-02 == DEC-03` role concentration at
`E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#role-concentration-dec-02-dec-03`.
This acceptance does not by itself relax role authority, presence, stop-point,
or `DEC-01` independence requirements. The separately approved `GOV-EX-01`
changes eligibility only and does not approve any affected DEC or stop point.

### 4.2 `GOV-EX-01` single-operator governance exception

Status: `APPROVED / DIRECTED CONTRACT REVIEW PASS / ELIGIBILITY ONLY`

The declared project staffing model contains one accountable human operator:
Billy Xu (admin). Because no second authorized human exists, the accountable
system owner explicitly approved this single-operator concentration exception.

```text
approval decision: APPROVE
decision owner: Billy Xu (admin)
decision timestamp + timezone: 2026-09-19T11:17:02+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#gov-ex-01-single-operator-governance-exception
directed contract review: PASS
```

The approved `GOV-EX-01` permits Billy Xu (admin) to concurrently hold exactly
these roles if each still-pending role is separately approved:

```text
DEC-01 Live cutover operator
DEC-02 Authorization-2 approver
DEC-03 Incident commander
DEC-04 Rollback owner
DEC-06 Queue/worker drain owner
DEC-07 Deployment owner
SP-0 approver
SP-1 approver
SP-2 approver
SP-3 approver
SP-4 approver
```

The exception establishes eligibility for role concentration only. It does not
itself approve `DEC-01`, `DEC-04`, `DEC-06`, `DEC-07`, `DEC-16`, any stop-point
decision, authorization 2, or live execution. It MUST NOT operate as a general
waiver for unnamed roles or decisions.

The exception does not relax any technical, evidence, state-machine, NO-GO,
rollback, PONR, immutable-evidence, or critical-window presence requirement.
Every `SP-0` through `SP-4` decision MUST still be:

- explicitly re-entered by the accountable human;
- separately timestamped before the gated action;
- bound to the exact state, hashes, counts, and diagnostics reviewed;
- persisted to immutable, append-only evidence before continuation;
- fail-closed when any required evidence is missing or ambiguous;
- never inferred from silence, a previous stop-point decision, or prior approval.

Single-operator execution additionally requires these compensating controls:

```text
immutable evidence at every SP
machine-readable pass criteria at every gate
exact hashes/counts recorded before each GO
no in-window command or path substitution
no automatic continuation between SP gates
ambiguous evidence => NO-GO
ambiguous mutation outcome => conservative LIVE_POST_PONR handling
```

Self-approval is permitted only after `GOV-EX-01` is explicitly approved and
only because the accountable system owner and executing operator are the same
sole human for this project. The exception approval MUST have its own decision
owner, timestamp with timezone, exact role list, evidence location, and directed
contract review result before any affected DEC can be approved.

For a single-operator project, `DEC-17` MAY designate an exact create-new,
append-only, auditable incident-record path instead of a human chat channel.
The absolute path, file format, writer, finalization rule, and retention owner
remain explicit `DEC-17` decisions; generic values such as `email`, `Slack`, or
`admin group` are not acceptable.

## 5. State machine and stop points

The run MUST emit one append-only audit event for every state transition and
decision. A missing, duplicated, skipped, out-of-order, or ambiguous transition
is `NO-GO`.

```text
PREPARED
  -> SP-0: explicit authorization 2 for exact contract/target/window
FROZEN
  -> final backup + restore + preflight
  -> SP-1: explicit GO before live import
IMPORTING_SITE_PROFILES
IMPORTING_COGNITION
VERIFYING
  -> SP-2: explicit GO before writer activation
WRITERS_ENABLED_TRAFFIC_FROZEN
  -> restart/read/projection verification
LIVE_PRE_PONR
  -> SP-3: explicit GO before any traffic release
  -> SP-4: explicit authority to admit mutation-capable traffic
  -> PONR occurs only on the first accepted authority-only mutation
LIVE_POST_PONR
  -> DB authority preservation boundary; automatic legacy restore prohibited
```

`SP-0` is the authorization-2 decision itself. `SP-1` through `SP-4` remain
mandatory even after `SP-0`. Approval evidence MUST name approver, operator,
state, exact hashes/counts reviewed, timestamp, decision, and communication
record. Silence, timeout, or inferred consent is not GO. Operator self-approval
is not GO by default and is permitted only under an approved `GOV-EX-01` with
all section 4.2 compensating controls satisfied.

## 6. Freeze entry and drain contract

Before `FROZEN`, the operator MUST prove all of the following:

1. The current provider, working directory, paths, artifact, configuration,
   resolution manifest, operator, and window exactly match sections 3 and 4.
2. The ten-file inventory and hashes exactly match section 3.1.
3. New session admission is disabled and a mutation attempt is rejected.
4. Active/running sessions are exactly `0`.
5. Active, reserved, or in-flight worker jobs are exactly `0`.
6. Queue consumption is paused. Queued/delayed jobs may remain only when the
   evidence proves they cannot execute until an explicit post-cutover decision.
7. No scheduler, startup hook, GET/read path, worker finalizer, automatic
   importer, or reverse sync can mutate semantic authority during the window.
8. A mutation-free read probe leaves every designated live hash unchanged.
9. The incident commander, rollback owner, evidence custodian, and required
   approvers are present and have acknowledged the exact stop/abort procedure.
10. Remaining window time exceeds the approved maximum execution plus rollback
    reserve. The exact threshold is `PENDING` under `DEC-09` and `DEC-10`.

The drain evidence MUST include the exact commands, timestamped raw output,
queue names, worker identities, active/reserved/delayed counts, active session
IDs (empty), and operator attestation. A dashboard screenshot without machine-
readable counts is insufficient.

Failure before any live freeze-entry action leaves live operational state
unchanged and terminates the window. Failure after any freeze-entry control has
changed but before `FROZEN` or import requires an explicit abort decision. The
abort MUST restore every changed operational control, including admission,
queue consumption, worker scheduling, and any scheduler or mutation guard that
was paused or enabled. It MUST then verify admission, queue, worker, scheduler,
and mutation-routing state against the pre-window baseline and persist the
commands, raw results, actor, timestamps, and final abort decision. It does not
permit import or writer activation.

## 7. Final post-freeze backup contract

The final backup is captured only after section 6 passes and `FROZEN` is
recorded. It MUST use the rehearsed capture/inventory mechanism with a new,
non-existing output path and create-new immutable evidence.

Acceptance requires:

- exactly the ten paths in section 3.1, with no link/junction/path mismatch;
- source-before, copy, and source-after SHA-256 equality for every file;
- exact file count, byte lengths, roles, and source IDs;
- a deterministic datastore semantic hash;
- a content-derived snapshot ID and SHA-256 binding to the manifest bytes;
- binding to the exact artifact, configuration, resolution, operator, window,
  and authorization record;
- one fresh isolated restore outside every live/source ancestor or descendant;
- exact restored raw hashes and semantic hash;
- provider close/reload/restart plus authority-read verification;
- unchanged live input hashes after restore verification;
- recorded retention and cleanup owner.

Any missing/unreadable file, inventory drift, hash mismatch, semantic mismatch,
restore failure, source write, path overlap, or manifest mutation is `NO-GO`.
The backup MUST be retained even when the run aborts.

## 8. Final preflight and import contract

The final preflight MUST run read-only against the exact post-freeze backup
generation. Under the exact-equality rule in section 3.1, expected values are:

```text
status                       GO
diagnostics                  0
siteProfileImports           1
cognitionInputs              914
cognitionImports             365
resolvedCollisionGroups      7
collapsedExcessRows          549
excludedControlFiles         4
unresolved collision         0
orphan site scope            0
invalid record               0
semantic mismatch            0
```

Any count or diagnostic drift is `NO-GO`; no in-window manifest edit, winner
selection, auto-deduplication, source cleanup, or identity-algorithm change is
permitted.

After `SP-1`, import order is immutable:

1. SiteProfile insert-only import using only the approved v2 resolution.
2. Reconcile SiteProfile report: `inserted=1`, `skipped=0`, `blocked=0`.
3. Cognition insert-only import using the established SiteProfile/site scope.
4. Reconcile Cognition report: `inserted=365`, `skipped=0`, `blocked=0`.
5. Verify legacy source bytes remain unchanged.
6. Replay both importers: inserted rows `0`, semantic diff empty.
7. Revoke migration authorization and prove subsequent invocation is rejected.

If the live authority contains an unexpected existing row, a skip is not
automatically acceptable. The run stops for independent semantic/provenance
review; the operator may not revise the expected counts in-window.

## 9. Reconciliation and writer-enable gate

Before `SP-2`, evidence MUST prove:

- imported canonical entities equal the accepted final preflight output;
- inserted plus explicitly approved skipped-existing equals valid inputs;
- blocked, orphan, invalid, unresolved, and semantic mismatch counts are zero;
- no pre-existing authority entity was modified;
- no legacy learned-entity or control-state file was modified;
- importer replay inserts zero and changes no semantic authority;
- duplicate canonical identities are zero;
- provenance and all seven resolved-collision memberships are preserved;
- automatic import and background reverse sync are absent/disabled;
- projections are rebuildable and projection rebuild changes no authority;
- payload conflict replay is rejected;
- all evidence hashes remain bound to the same run.

After `SP-2`, the exact reviewed artifact may enable Cognition, SiteProfile, and
metadata authority writers as one coordinated unit while all traffic remains
frozen. Partial domain activation is prohibited. The runtime MUST then pass:

```text
provider close/reload/restart        PASS
authority reads                      PASS
canonical identity/provenance        unchanged
idempotency records                  unchanged
import completion evidence           present
automatic importer invocation        rejected
projection-to-authority mutation     zero
legacy source mutation               zero
```

Any failure invokes the pre-PONR rollback procedure in section 12.

## 10. `LIVE_PRE_PONR` definition

`LIVE_PRE_PONR` exists only when writer services are enabled, mutation-capable
traffic remains blocked, section 9 passes, and an independently generated
deterministic authority semantic hash has been recorded. Read-only traffic MAY
be released after `SP-3` only when the runtime proves mutation isolation. The
audit MUST prove zero accepted authority-only mutations since writer
activation.

Before `SP-3`, record:

- exact state timestamp and operator;
- artifact/configuration/runtime identities;
- authority raw and semantic hashes;
- writer-route inventory;
- importer/reverse-sync disabled evidence;
- mutation audit query and zero-result output;
- pre-PONR rollback readiness attestation;
- remaining maintenance-window and rollback reserve.

Writer activation does not end the freeze. Read-only traffic release, if the
runtime can prove mutation isolation, requires `SP-3`. Mutation-capable traffic
remains prohibited until the separate `SP-4` approval.

## 11. PONR and accepted/ambiguous handling

PONR is the first accepted post-cutover authority-only semantic mutation.
Import mutations do not cross PONR. `SP-4` authorizes admission of
mutation-capable traffic; the approval itself does not cross PONR. It MUST
acknowledge that the next accepted authority mutation ends automatic pre-PONR
restoration rights.

The first mutation audit MUST record:

```text
domain
operation
canonical identity
idempotency key or audit identity
attemptedAt
outcome
acceptedAt when known
resulting authority version/hash
artifact/configuration identity
operator/window/run identity
```

Outcomes are handled as follows:

| Outcome | Required state and action |
|---|---|
| Proven rejected, zero durable effect | remain `LIVE_PRE_PONR`; keep or re-establish the mutation-capable traffic freeze while reconciling |
| Proven accepted with complete audit | enter `LIVE_POST_PONR`; preserve DB authority |
| Timeout, lost response, partial audit, unknown commit, or inability to prove zero mutation | conservatively enter `LIVE_POST_PONR`; freeze writes and preserve DB authority |

An ambiguous outcome MUST NOT fabricate `acceptedAt`, retry with a new identity,
or invoke pre-PONR restore. Idempotent status/readback and authority hash/audit
reconciliation are required before any further mutation.

## 12. Rollback boundaries

### 12.1 Pre-PONR rollback

Pre-PONR rollback is allowed only when audit evidence proves zero accepted
authority-only mutations after writer activation:

1. Reassert admission and semantic mutation freeze.
2. Stop the new artifact and all importer/writer processes.
3. Preserve logs, audit records, hashes, and failed-state evidence outside the
   restore target.
4. Restore the authority datastore from the final post-freeze backup.
5. Verify exact raw hash, semantic hash, row counts, provider restart, and reads.
6. Restore the previous application artifact and complete previous authority,
   import, and projection direction as one unit.
7. Do not restore or overwrite file-owned Cognition control-state partitions.
8. Verify all legacy semantic inputs and retained control-state files.
9. Reopen traffic only through a separately recorded rollback GO.

Partial rollback of one domain, writer route, importer, or projection direction
is prohibited.

### 12.2 Post-PONR preservation/reconciliation

After accepted or ambiguous PONR, automatic restore of the final backup or
legacy file authority is prohibited. Incident response MUST:

1. Freeze mutation-capable traffic.
2. Preserve the DB authority datastore and complete mutation/audit evidence.
3. Determine accepted/ambiguous mutations by idempotency identity and semantic
   diff without deleting or overwriting them.
4. Permit application-code rollback only when DB semantic authority and
   authority-service routing remain intact.
5. Require a separately designed and authorized reverse migration or
   reconciliation before any return to file authority.

Post-PONR reconciliation is not authorization to start Phase 2-G.

## 13. Traffic-release gate

Traffic release requires `SP-3`; mutation-capable traffic additionally requires
`SP-4`. Both decisions MUST verify:

- exact artifact/configuration still active;
- provider restart/read and health checks pass;
- expected authority counts and semantic hash match;
- importer grant revoked and reverse sync absent;
- worker topology points only to authority services;
- mutation audit is complete and queryable;
- no unexplained legacy or authority mutation exists;
- rollback/incident owners and evidence capture remain available;
- maintenance window has sufficient approved reserve.

No canary, partial tenant, one-domain, or unreviewed route release is permitted
unless this contract is revised and re-approved. Traffic release does not erase
the need to classify the first mutation as accepted, rejected, or ambiguous.

## 14. NO-GO and abort matrix

| Condition | Latest safe state | Mandatory response |
|---|---|---|
| Identity/path/window/operator drift | `PREPARED` | do not freeze; invalidate authorization and return to review |
| Baseline inventory/hash drift | `PREPARED` | stop; no in-window manifest or count revision |
| Admission leak, active session, active/reserved worker, unpaused queue | before `FROZEN` | stop and restore normal operations only by explicit abort decision |
| Backup/inventory/hash/semantic/restore failure | `FROZEN` | no import; retain evidence; abort window |
| Preflight diagnostic or expected-count drift | `FROZEN` | no import; retain backup; return to review |
| Import blocked row, unexplained skip, bounds breach, source mutation | `IMPORTING_*` | freeze; invoke pre-PONR rollback if zero authority-only mutations proven |
| Reconciliation, replay, restart, projection, routing, or importer-disable failure | `VERIFYING` | no writer/traffic release; pre-PONR rollback |
| Missing approver/evidence or window reserve expired | any pre-PONR state | stop; pre-PONR rollback when import occurred |
| First mutation proven rejected | `LIVE_PRE_PONR` | keep frozen; reconcile; no automatic retry |
| First mutation accepted | `LIVE_POST_PONR` | preserve DB authority; continue only under post-PONR runbook |
| First mutation ambiguous or audit incomplete | conservative `LIVE_POST_PONR` | freeze writes; preserve DB; reconcile; no legacy restore |
| Unexpected post-PONR authority diff or incident | `LIVE_POST_PONR` | freeze writes; preserve evidence/DB; incident escalation |

Every abort records the triggering requirement, actual observation, state,
operator, decision owner, hashes, and whether PONR was proven absent, accepted,
or ambiguous.

## 15. Required evidence and attestations

The cutover evidence root MUST be create-new, immutable after finalization, and
outside live datastore/legacy roots. It MUST contain or cryptographically bind:

| Evidence ID | Required record |
|---|---|
| `EVD-LIVE-01` | signed authorization-2 decision and exact contract revision |
| `EVD-LIVE-02` | target/provider/path/artifact/configuration/resolution identities |
| `EVD-LIVE-03` | named roles, maintenance window, commands, communication channel |
| `EVD-LIVE-04` | admission freeze, active-session zero, queue/worker drain raw output |
| `EVD-LIVE-05` | final post-freeze snapshot manifest, snapshot ID, manifest SHA-256 |
| `EVD-LIVE-06` | isolated restore raw/semantic hashes and restart/read result |
| `EVD-LIVE-07` | final preflight report, collision resolutions, counts, diagnostics |
| `EVD-LIVE-08` | SiteProfile and Cognition import reports and provenance |
| `EVD-LIVE-09` | reconciliation, replay, importer revoke, projection and source hashes |
| `EVD-LIVE-10` | deployed runtime identity, writer inventory, restart/read evidence |
| `EVD-LIVE-11` | `LIVE_PRE_PONR` hashes, zero-mutation audit, `SP-3`/`SP-4` decisions |
| `EVD-LIVE-12` | first-mutation/PONR audit or proof that no mutation was accepted |
| `EVD-LIVE-13` | rollback or post-PONR preservation/reconciliation evidence |
| `EVD-LIVE-14` | final traffic state, unresolved incidents, operator/approver attestations |
| `EVD-LIVE-15` | child-artifact hashes and final evidence SHA-256 |

Each attestation includes actor identity, role, timestamp with timezone, exact
decision, state, evidence hashes reviewed, and signature/approval record.
Secrets are referenced by identifier only and MUST NOT be copied into evidence.

## 16. Requirement trace matrix

| Requirement | Contract subject | Primary section | Acceptance/evidence | Current status |
|---|---|---|---|---|
| `LCC-01` | exact live target/provider/path identity | 3 | `EVD-LIVE-02` exact match | ready for review |
| `LCC-02` | approved artifact/config/resolution identities | 3 | identities and runtime-byte attestation | deployment command `PENDING` |
| `LCC-03` | operator and maintenance window | 4 | `DEC-01`, `DEC-08`, `EVD-LIVE-03` | `PENDING` |
| `LCC-04` | freeze entry conditions | 6 | all ten freeze checks pass | commands `PENDING` |
| `LCC-05` | worker/queue drain criteria | 6 | active/reserved/in-flight = 0; consumption paused | commands/owner `PENDING` |
| `LCC-06` | final post-freeze backup | 7 | exact capture plus isolated restore | path/owner `PENDING` |
| `LCC-07` | snapshot/hash/inventory acceptance | 3.1, 7 | ten-file exact match and bound manifest | defined |
| `LCC-08` | import order and reconciliation | 8, 9 | SiteProfile first; exact counts; replay empty | defined |
| `LCC-09` | writer-enable gate | 9 | `SP-2` plus runtime checks | approver `PENDING` |
| `LCC-10` | `LIVE_PRE_PONR` | 10 | semantic hash plus zero mutation audit | defined |
| `LCC-11` | first authority mutation/PONR | 11 | complete first-mutation audit | defined |
| `LCC-12` | accepted versus ambiguous PONR | 11 | conservative outcome table | defined |
| `LCC-13` | pre-PONR rollback | 12.1 | exact restore and rollback GO | owner `PENDING` |
| `LCC-14` | post-PONR preservation/reconciliation | 12.2 | DB authority retained; separate reconciliation | escalation owner `PENDING` |
| `LCC-15` | traffic-release gate | 13 | `SP-3` and separate `SP-4` | commands/approvers `PENDING` |
| `LCC-16` | NO-GO/abort matrix | 14 | fail-closed state-specific response | defined |
| `LCC-17` | evidence and operator attestations | 15 | `EVD-LIVE-01` through `15` complete | custodian `PENDING` |
| `LCC-18` | explicit stop points | 5 | `SP-0` through `SP-4` signed | approvers/channel `PENDING` |

## 17. Authorization review checklist

The authorization-2 reviewer MUST record one result for every item:

```text
[ ] All DEC-01 through DEC-17 fields are APPROVED with evidence locations.
[ ] Exact provider/path/runtime topology is verified.
[ ] Deployment bytes are reproducibly bound to the artifact identity.
[ ] v9 evidence and child artifacts remain immutable and hash-valid.
[ ] Ten-file exact-equality policy is explicitly accepted.
[ ] Final backup output, isolated restore target, retention, and owner are named.
[ ] Freeze/admission/queue commands and machine-readable pass criteria are named.
[ ] Import commands, bounds, identities, and expected counts are exact.
[ ] DEC-02 is independent from DEC-01, or approved GOV-EX-01 explicitly names and controls that concentration.
[ ] The incident commander is committed to the complete critical-window presence requirement.
[ ] SP-1 through SP-4 approvers are independent of the executing operator, or approved GOV-EX-01 applies with separate immutable decisions.
[ ] GOV-EX-01 is either not needed or explicitly approved, role-enumerated, directed-review accepted, and evidenced.
[ ] Pre-PONR rollback command sequence and previous artifact are exact.
[ ] Post-PONR preservation and escalation ownership is accepted.
[ ] Maintenance window includes measured execution and rollback reserve.
[ ] Evidence root and finalization/hash procedure are exact.
[ ] Explicit authorization text names this contract revision and all identities.
```

Any unchecked item leaves authorization 2 `NOT AUTHORIZED`.

## 18. Current frozen status

```text
P6 Phase 2-F v9 designated isolated-clone rehearsal
-> PASS

v9 independent rehearsal review
-> PASS

evidence transitive binding / live-source immutability evidence
-> PASS

P6 Phase 2-F authorization 1
-> COMPLETE

operational decisions
-> DEC-02 APPROVED: Billy Xu (admin)
-> DEC-03 APPROVED: Billy Xu (admin)
-> DEC-02 == DEC-03 ROLE CONCENTRATION ACCEPTED
-> DEC-01 PENDING; Billy Xu (admin) eligible under GOV-EX-01
-> DEC-04 / DEC-06 / DEC-07 CANDIDATE ONLY / NOT APPROVED
-> DEC-05 and DEC-08..17 PENDING

single-operator governance exception GOV-EX-01
-> APPROVED: Billy Xu (admin), 2026-09-19T11:17:02+08:00
-> DIRECTED CONTRACT REVIEW PASS / CLOSED
-> ELIGIBILITY ONLY; NO DEC OR SP APPROVAL IMPLIED

authorization 2 contract
-> DRAFT FOR EXPLICIT REVIEW
-> NON-EXECUTABLE WHILE ANY DEC FIELD IS PENDING

authorization 2
-> NOT AUTHORIZED

live cutover
-> NOT AUTHORIZED

P6 Phase 2-G
-> NOT AUTHORIZED
```

No live freeze, backup, import, writer switch, traffic release, or live PONR may
occur while this status remains in force.
