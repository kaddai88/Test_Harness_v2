# P6 Phase 2-F Authorization 2 Operational Decision Record

Status: `PARTIAL / DEC-01 THROUGH DEC-10, DEC-16, DEC-17, AND GOV-EX-01 APPROVED EXCEPT DEC-11 THROUGH DEC-15 / AUTHORIZATION 2 NOT GRANTED`

This record captures explicit human operational decisions only. It does not
constitute `SP-0`, does not grant authorization 2, and does not authorize any
live freeze, backup, import, writer activation, traffic release, or PONR.

## DEC-01

### DEC-01 Live cutover operator

```text
DEC-ID: DEC-01
approval decision: APPROVE
exact approved person: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-02
decision timestamp + timezone: 2026-09-19T11:42:42+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-01
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as the approved authorization-2
approver under `DEC-02` and the role concentration permitted by `GOV-EX-01`,
explicitly appoints Billy Xu (admin) as the live cutover operator. This resolves
`DEC-01` only. It does not approve `SP-0`, authorization 2, or live execution.

## DEC-02

### DEC-02 Authorization-2 approver

```text
DEC-ID: DEC-02
exact approved person: Billy Xu (admin)
decision owner: Billy Xu (admin)
decision timestamp + timezone: 2026-09-19T10:48:18+08:00
evidence/approval record location: docs/P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-02
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as accountable system owner,
explicitly appoints Billy Xu (admin) as the Authorization-2 approver for this
cutover decision process. This resolves `DEC-02` only. The appointment does not
approve `SP-0` or authorization 2.

Constraints accepted:

```text
By default, DEC-02 MUST NOT be the DEC-01 executing operator. Approved
`GOV-EX-01` established eligibility for Billy Xu (admin) under the
single-operator exception; `DEC-01` was separately approved and recorded at
`#dec-01`.

DEC-02 may approve or reject authorization 2 / SP-0 only after the contract's
remaining blockers and review checklist are satisfied.

This appointment does not authorize live execution.
```

## DEC-03

### DEC-03 Incident commander

```text
DEC-ID: DEC-03
exact approved person: Billy Xu (admin)
decision owner: Billy Xu (admin)
decision timestamp + timezone: 2026-09-19T10:56:59+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-03
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as accountable system owner,
explicitly appoints Billy Xu (admin) as Incident Commander for this cutover
decision process. This resolves `DEC-03` only and does not approve `SP-0` or
authorization 2.

Constraints accepted:

```text
By default, DEC-03 MUST NOT be the DEC-01 executing operator. Approved
`GOV-EX-01` established eligibility for Billy Xu (admin) under the
single-operator exception; `DEC-01` was separately approved and recorded at
`#dec-01`.

DEC-03 has authority to STOP or ABORT, require a renewed freeze, invoke
pre-PONR rollback, enforce DB-authority preservation after ambiguous PONR, and
coordinate deployment, queue/worker, rollback, and evidence owners.

DEC-03 must remain continuously available from the first freeze-entry action
until post-PONR stabilization is accepted or pre-PONR rollback and operational
restoration are complete.

This appointment does not authorize live execution.
```

## DEC-04

### DEC-04 Rollback owner

```text
DEC-ID: DEC-04
approval decision: APPROVE
exact approved person: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-03
decision timestamp + timezone: 2026-09-19T11:42:42+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-04
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as Incident Commander under
`DEC-03` and the role concentration permitted by `GOV-EX-01`, explicitly
appoints Billy Xu (admin) as rollback owner. This resolves `DEC-04` only and
does not approve a rollback command, `SP-0`, authorization 2, or live execution.

## DEC-05

### DEC-05 Evidence custodian

```text
DEC-ID: DEC-05
approval decision: APPROVE
exact approved person: Billy Xu (admin)
approver: Billy Xu (admin), acting as DEC-02
decision owner: Billy Xu (admin), acting as DEC-02
decision timestamp + timezone: 2026-09-19T16:39:45+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-05
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as the approved authorization-2
approver under `DEC-02` and the role concentration permitted by `GOV-EX-01`,
explicitly appoints Billy Xu (admin) as evidence custodian. This resolves
`DEC-05` only. It does not approve an evidence root, final backup path, `SP-0`,
authorization 2, or live execution.

## DEC-06

### DEC-06 Queue/worker drain owner

```text
DEC-ID: DEC-06
approval decision: APPROVE
exact approved person: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-03
decision timestamp + timezone: 2026-09-19T11:42:42+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-06
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as Incident Commander under
`DEC-03` and the role concentration permitted by `GOV-EX-01`, explicitly
appoints Billy Xu (admin) as queue/worker drain owner. This resolves `DEC-06`
only and does not approve drain commands, `SP-0`, authorization 2, or live
execution.

## DEC-07

### DEC-07 Deployment owner

```text
DEC-ID: DEC-07
approval decision: APPROVE
exact approved person: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-03
decision timestamp + timezone: 2026-09-19T11:42:42+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-07
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as Incident Commander under
`DEC-03` and the role concentration permitted by `GOV-EX-01`, explicitly
appoints Billy Xu (admin) as deployment owner. This resolves `DEC-07` only and
does not approve deployment commands, runtime-byte attestation, `SP-0`,
authorization 2, or live execution.

## DEC-08

### DEC-08 Maintenance window and timezone

```text
DEC-ID: DEC-08
approval decision: APPROVE
maintenance window start: 2026-09-20T20:00:00+08:00
maintenance window end: 2026-09-20T23:00:00+08:00
timezone: UTC+08:00
approver: Billy Xu (admin), acting as DEC-02
decision owner: Billy Xu (admin), acting as DEC-02
decision timestamp + timezone: 2026-09-19T16:39:45+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-08
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as the approved authorization-2
approver under `DEC-02`, explicitly approves this exact maintenance window.
This resolves `DEC-08` only. It does not approve `SP-0`, authorization 2, or
any live operation.

## DEC-09

### DEC-09 Maximum freeze duration

```text
DEC-ID: DEC-09
approval decision: APPROVE
maximum freeze duration: 90 minutes
rollback reserve: 60 minutes
basis: The approved maintenance window is 180 minutes. At nominal window entry, 180 minutes remaining exceeds maximum freeze duration (90 minutes) plus rollback reserve (60 minutes). The run remains fail-closed if the required reserve is no longer available.
approver: Billy Xu (admin), acting as DEC-03
decision owner: Billy Xu (admin), acting as DEC-03
decision timestamp + timezone: 2026-09-19T16:39:45+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-09
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as Incident Commander under
`DEC-03`, explicitly approves this maximum freeze duration and rollback reserve.
This resolves `DEC-09` only. It does not approve `SP-0`, authorization 2, or
any live operation.

## DEC-10

### DEC-10 Latest safe writer-activation time

```text
DEC-ID: DEC-10
approval decision: APPROVE
latest safe writer-activation timestamp: 2026-09-20T21:30:00+08:00
basis: The approved maintenance window ends at 2026-09-20T23:00:00+08:00. This deadline leaves 90 minutes before window end and therefore preserves more than the approved 60-minute rollback reserve. Writer activation after this timestamp is NO-GO for this authorization package. No in-window extension or substitution is permitted.
approver: Billy Xu (admin), acting as DEC-03
decision owner: Billy Xu (admin), acting as DEC-03
decision timestamp + timezone: 2026-09-19T16:39:45+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-10
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as Incident Commander under
`DEC-03`, explicitly approves this writer-activation deadline. This resolves
`DEC-10` only. Writer activation after the deadline is `NO-GO`; this does not
approve writer activation, `SP-0`, authorization 2, or any live operation.

## DEC-14

### DEC-14 Deployment and Runtime-Byte Attestation

```text
DEC-ID: DEC-14
approval decision: APPROVE
approved by: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-07 Deployment Owner
decision timestamp + timezone: 2026-09-20T11:20:13+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-14
status: APPROVED
```

```text
Exact runtime package root:
E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\runtime-package-v2

Exact deployed entrypoint:
E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\runtime-package-v2\dist\index.js

Runtime artifact identity:
2c5c6fa14ff940ce1916c96bebd8229c20045147818427d06411dd3f91e78e72

Runtime manifest SHA-256:
2713d894f20f6a502ade2aa6b55042bb7ef2853593f76736d107ff0a03ea6ac4

Runtime attestation SHA-256:
4c24c92490c35f7c083f57db1c20b65d1de3b43e60516c4cfd66b03e67811625

Runtime inventory:
5844 entries
5435 regular files
409 internal junctions
0 probe references

Deployment provider: node
Runtime topology: single-process
Authority storage representation: json
Authority datastore: E:\Projects\Test-Harness\data\testharness.json
```

```text
Launch mode: foreground / dedicated operator shell
Node executable: C:\Program Files\nodejs\node.exe
Node version: v22.23.2
Working directory: E:\Projects\Test-Harness
PORT: 3000
DB_PATH: E:\Projects\Test-Harness\data\testharness.json
CUTOVER_CONTROL_AUDIT_PATH: E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\control-plane-audit.jsonl
CUTOVER_CONTROL_TOKEN reference: env:CUTOVER_CONTROL_TOKEN

Secret handling:
The CUTOVER_CONTROL_TOKEN value MUST NOT be written into Git, the contract,
decision records, command-discovery documents, audit evidence, or final
evidence bundles.
```

Exact deployment/start command:

```powershell
& {
  $env:PORT = '3000'
  $env:DB_PATH = 'E:\Projects\Test-Harness\data\testharness.json'
  $env:CUTOVER_CONTROL_AUDIT_PATH = 'E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\control-plane-audit.jsonl'

  if ([string]::IsNullOrWhiteSpace($env:CUTOVER_CONTROL_TOKEN)) {
    throw 'CUTOVER_CONTROL_TOKEN is required'
  }
  if (-not (Test-Path -LiteralPath $env:DB_PATH -PathType Leaf)) {
    throw 'Approved authority datastore does not exist'
  }
  if (-not (Test-Path -LiteralPath (Split-Path -Parent $env:CUTOVER_CONTROL_AUDIT_PATH) -PathType Container)) {
    throw 'Approved control-plane audit parent does not exist'
  }
  if (Test-Path -LiteralPath $env:CUTOVER_CONTROL_AUDIT_PATH) {
    throw 'CUTOVER_CONTROL_AUDIT_PATH must not exist before runtime start'
  }
  if (-not (Test-Path -LiteralPath 'E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\runtime-package-v2\dist\index.js' -PathType Leaf)) {
    throw 'Approved runtime entrypoint does not exist'
  }

  Set-Location -LiteralPath 'E:\Projects\Test-Harness'
  & 'C:\Program Files\nodejs\node.exe' 'E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\runtime-package-v2\dist\index.js'

  if ($LASTEXITCODE -ne 0) {
    throw "Runtime exited with code $LASTEXITCODE"
  }
}
```

Owner attestation:

> I, Billy Xu (admin), explicitly APPROVE DEC-14 for the exact runtime package,
> entrypoint, artifact identity, manifest SHA-256, attestation SHA-256, inventory,
> provider, topology, authority datastore, Node runtime, launch mode, process
> environment, working directory, token reference, and deployment/start command
> recorded above.
>
> No package, path, byte, identity, manifest, attestation, entrypoint, Node
> runtime, environment value, working directory, or command substitution is
> permitted.
>
> Any mismatch invalidates DEC-14 and requires return to review.
>
> This approval defines the exact deployment procedure only.
>
> It does NOT execute the deployment/start command and does NOT authorize
> DEC-11, DEC-15, SP-0, SP-1 through SP-4, Authorization 2, live runtime start,
> live freeze, final backup, import, writer activation, traffic release, PONR,
> or P6 Phase 2-G.

## DEC-14 Runtime Package Root

### DEC-14 Runtime Package Root Decision

```text
approval decision: APPROVE
exact final runtime package root: E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\runtime-package
approved by: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-07 Deployment Owner
decision timestamp + timezone: 2026-09-20T09:13:59+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-14-runtime-package-root
status: APPROVED / PACKAGE ROOT ONLY
```

Owner attestation:

> I, Billy Xu (admin), explicitly APPROVE the exact final runtime package root:
>
> `E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\runtime-package`
>
> This approval authorizes use of this exact absolute path for the final
> post-corrective runtime package build, manifest capture, and runtime-byte
> attestation preparation.
>
> The package root MUST NOT exist before the final package build.
>
> Once the final runtime manifest is captured, the package root MUST NOT be
> renamed, moved, substituted, or rebuilt in place without invalidating the
> resulting artifact identity and requiring a new review decision.
>
> This decision approves the package-root value only.
>
> It does NOT approve DEC-14 as a whole, the final runtime artifact identity,
> the final runtime manifest SHA-256, deployment to live, SP-0, authorization 2,
> or any live freeze, import, writer activation, traffic release, or PONR.

The package rooted at the path above, including artifact identity
`9edda6be37f33295bef353d9952279db8ef3ab9ea9b09cdd4f36c12a9b7776d0`,
is a historical verified candidate only after the dotenv-precedence corrective.
It is not eligible for final `DEC-14` binding.

### DEC-14 Runtime Package Root V2

```text
approval decision: APPROVE
exact final runtime package root: E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\runtime-package-v2
approved by: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-07 Deployment Owner
decision timestamp + timezone: 2026-09-20T10:57:05+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-14-runtime-package-root-v2
status: APPROVED / PACKAGE ROOT ONLY
```

Owner attestation:

> I, Billy Xu (admin), explicitly APPROVE the exact final runtime package root:
>
> `E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\runtime-package-v2`
>
> The path MUST NOT exist before the final runtime package build.
>
> The runtime package MUST be created directly at this exact path. No equivalent,
> renamed, substituted, or relocated path is approved.
>
> The deployed entrypoint for this package will be:
>
> `E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\runtime-package-v2\dist\index.js`
>
> For that deployed entrypoint, the server bootstrap root calculation MUST resolve
> to:
>
> `E:\Projects\Test-Harness`
>
> This approval authorizes only use of the exact package-root value for the
> post-dotenv-corrective package build, manifest capture, and read-only runtime
> attestation preparation.
>
> This decision does NOT approve DEC-14 as a whole, the future runtime artifact
> identity, the future manifest SHA-256, the future attestation SHA-256, the
> deployment/start command, DEC-11, DEC-15, SP-0 through SP-4, Authorization 2,
> live deployment or runtime start, or any freeze, backup, import, writer
> activation, traffic release, or PONR.

## CUTOVER CONTROL AUDIT PATH

```text
approval decision: APPROVE
exact CUTOVER_CONTROL_AUDIT_PATH: E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\control-plane-audit.jsonl
approved by: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-07 Deployment Owner
decision timestamp + timezone: 2026-09-20T11:03:26+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#cutover-control-audit-path
status: APPROVED / PATH VALUE ONLY
```

Owner attestation:

> I, Billy Xu (admin), explicitly APPROVE the exact control-plane audit path:
>
> `E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\control-plane-audit.jsonl`
>
> This exact absolute path is approved for `CUTOVER_CONTROL_AUDIT_PATH` for run:
>
> `2026-09-19-root-json-live-01`
>
> The approved value may be used when constructing the exact `DEC-11`, `DEC-14`,
> and `DEC-15` operational command contracts.
>
> This approval is for the exact path value only.
>
> It does NOT approve DEC-11, DEC-14, DEC-15, any deployment/start command,
> SP-0 through SP-4, Authorization 2, runtime start, live freeze, backup, import,
> writer activation, traffic release, or PONR.

### DEC-14 Runtime Launch Parameters

```text
approval decision: APPROVE
launch mode: foreground / dedicated operator shell
Node executable: C:\Program Files\nodejs\node.exe
Node version: v22.23.2
approved by: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-07 Deployment Owner
decision timestamp + timezone: 2026-09-20T11:16:54+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-14-runtime-launch-parameters
status: APPROVED / LAUNCH PARAMETERS ONLY
```

Owner attestation:

> This approval confirms only the exact launch mode and Node runtime values.
>
> The deployment shell remains attached to the Node process. Subsequent DEC,
> stop-point, and control-plane commands must be executed from a separate
> operator shell. An unexpected non-zero process exit is `FAIL / NO-GO`.
>
> This approval does NOT approve the full DEC-14 deployment/start command,
> DEC-14 overall, DEC-11, DEC-15, SP-0 through SP-4, Authorization 2, live
> runtime start, or any live cutover action.

## DEC-16

### DEC-16 SP-1 through SP-4 approvers and approval/evidence channel

```text
DEC-ID: DEC-16
approval decision: APPROVE
SP-1 approver: Billy Xu (admin)
SP-2 approver: Billy Xu (admin)
SP-3 approver: Billy Xu (admin)
SP-4 approver: Billy Xu (admin)
exact approval/evidence path: E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\sp-approvals.jsonl
format: JSONL
creation rule: create-new; file MUST NOT exist before the live run
writer: Billy Xu (admin)
write rule: append-only; no rewrite or truncate
decision rule: each SP-1 through SP-4 decision MUST be separately entered before its gated action; each record MUST contain state, approver, operator, timestamp with timezone, decision, exact hashes/counts/diagnostics reviewed, and evidence references; no prior SP decision permits automatic continuation
finalization rule: after run completion or incident stabilization, compute SHA-256 and bind it into EVD-LIVE-15
retention owner: Billy Xu (admin)
approver: Billy Xu (admin), acting as DEC-02
decision owner: Billy Xu (admin), acting as DEC-02
decision timestamp + timezone: 2026-09-19T16:39:45+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-16
status: APPROVED
```

DEC-16 approval establishes approver eligibility and the exact evidence channel
only. `SP-1`, `SP-2`, `SP-3`, and `SP-4` remain `NOT APPROVED` until each
decision is separately entered, timestamped, evidence-bound, and persisted
before its gated action. No prior SP decision permits automatic continuation.

Owner attestation: Billy Xu (admin), acting as the approved authorization-2
approver under `DEC-02` and the role concentration permitted by `GOV-EX-01`,
explicitly approves this exact SP approval/evidence channel. This resolves
`DEC-16` only. It does not approve any SP, `SP-0`, authorization 2, or live
execution.

## DEC-17

### DEC-17 Post-PONR incident/escalation channel

```text
DEC-ID: DEC-17
approval decision: APPROVE
exact run ID: 2026-09-19-root-json-live-01
exact approved channel: E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\incident-audit.jsonl
format: JSONL
creation rule: create-new; file MUST NOT exist before the live run
writer: Billy Xu (admin)
write rule: append-only; no rewrite or truncate
finalization rule: after run completion or incident stabilization, compute SHA-256 and bind it into EVD-LIVE-15
retention owner: Billy Xu (admin)
decision owner: Billy Xu (admin), acting as DEC-03
decision timestamp + timezone: 2026-09-19T11:42:42+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#dec-17
status: APPROVED
```

Owner attestation: Billy Xu (admin), acting as Incident Commander under
`DEC-03`, explicitly approves this exact create-new, append-only incident record
as the post-PONR incident/escalation channel. This resolves `DEC-17` only. The
path MUST NOT be created before the live run, and this decision does not approve
`SP-0`, authorization 2, or live execution.

## Remaining pending decisions

| DEC ID | Decision | Status | Required decision source |
|---|---|---|---|
| `DEC-11` | Admission freeze and verification commands | `PENDING` | deployment owner |
| `DEC-12` | Queue/worker pause, drain, and inspection commands | `PENDING` | queue/worker drain owner |
| `DEC-13` | Final backup path and retention/cleanup owner | `PENDING` | evidence custodian |
| `DEC-14` | Deployment command and runtime artifact verification | `APPROVED` | deployment owner |
| `DEC-15` | Pre-PONR traffic-release command | `PENDING` | deployment owner |

## Role concentration DEC-02 DEC-03

```text
DEC-02 == DEC-03: YES
role concentration accepted: YES
decision owner: Billy Xu (admin)
decision timestamp + timezone: 2026-09-19T10:56:59+08:00
accountable system owner acceptance record: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#role-concentration-dec-02-dec-03
status: APPROVED / ACCEPTED
```

Owner attestation: Billy Xu (admin), acting as accountable system owner,
explicitly accepts the concentration of authorization governance (`DEC-02`)
and operational command (`DEC-03`) in Billy Xu (admin). This exception does not
by itself permit Billy Xu (admin) to act as `DEC-01`, self-execute the cutover,
skip any stop point, or approve authorization 2 before all remaining blockers
and review checks pass. The separately approved `GOV-EX-01` alters eligibility
only; it does not approve `DEC-01`, any stop-point decision, authorization 2, or
live execution.

## GOV-EX-01 Single-operator governance exception

```text
project staffing model: SINGLE HUMAN OPERATOR
accountable human: Billy Xu (admin)
approval decision: APPROVE
decision owner: Billy Xu (admin)
decision timestamp + timezone: 2026-09-19T11:17:02+08:00
evidence/approval record location: E:\Projects\Test-Harness\docs\P6-PHASE2-F-AUTHORIZATION2-OPERATIONAL-DECISIONS.md#gov-ex-01-single-operator-governance-exception
directed contract review: PASS
status: APPROVED / ELIGIBILITY ONLY
```

Exact concentrated role list:

```text
Billy Xu (admin) is permitted, under GOV-EX-01 only, to concurrently hold:
- DEC-01 Live cutover operator
- DEC-02 Authorization-2 approver
- DEC-03 Incident commander
- DEC-04 Rollback owner
- DEC-06 Queue/worker drain owner
- DEC-07 Deployment owner
- SP-0 approver
- SP-1 approver
- SP-2 approver
- SP-3 approver
- SP-4 approver
```

This exception establishes eligibility for role concentration only. It does not
itself approve `DEC-01`, `DEC-04`, `DEC-06`, `DEC-07`, `DEC-16`, any stop-point
decision, authorization 2, or live execution.

Owner attestation:

> I, Billy Xu (admin), acting as the accountable system owner and sole
> accountable human operator for this project, explicitly APPROVE GOV-EX-01.
>
> I accept the concentration of the exact roles enumerated above because no
> second authorized human operator exists for this project.
>
> I acknowledge that this exception does not relax any technical, evidence,
> state-machine, NO-GO, rollback, PONR, immutable-evidence, or critical-window
> presence requirement.
>
> I further acknowledge that SP-0 through SP-4 remain separate pre-action
> decisions. Each stop-point decision must be separately entered, timestamped,
> bound to the exact machine-readable evidence reviewed, persisted before the
> gated action, and must not be inferred from this exception or any prior
> approval.
>
> Decision timestamp: 2026-09-19T11:17:02+08:00
>
> Directed contract review: PASS

Every affected stop-point decision remains a separate,
pre-action, timestamped, append-only record bound to exact machine-readable
evidence. No prior approval permits automatic continuation.

## Current gate

```text
DEC-02
-> APPROVED

DEC-03
-> APPROVED

DEC-02 == DEC-03 role concentration
-> APPROVED / ACCEPTED

GOV-EX-01 single-operator governance exception
-> APPROVED
-> DIRECTED REVIEW PASS / CLOSED

DEC-01 / DEC-04 / DEC-06 / DEC-07 / DEC-17
-> APPROVED: Billy Xu (admin), 2026-09-19T11:42:42+08:00

DEC-05 / DEC-08 / DEC-09 / DEC-10 / DEC-16
-> APPROVED: Billy Xu (admin), 2026-09-19T16:39:45+08:00
-> DEC-16 establishes approver eligibility and evidence channel only; SP-1..SP-4 remain NOT APPROVED

DEC-14 final runtime package root v2
-> APPROVED: Billy Xu (admin), 2026-09-20T10:57:05+08:00
-> PACKAGE ROOT ONLY; DID NOT BY ITSELF APPROVE DEC-14

DEC-14 prior runtime package / identity 9edda6be...
-> HISTORICAL VERIFIED CANDIDATE ONLY
-> NOT ELIGIBLE FOR FINAL DEC-14 BINDING

CUTOVER_CONTROL_AUDIT_PATH
-> APPROVED: Billy Xu (admin), 2026-09-20T11:03:26+08:00
-> PATH VALUE ONLY; DID NOT BY ITSELF APPROVE DEC-11 / DEC-14 / DEC-15

DEC-14 runtime launch parameters
-> APPROVED: Billy Xu (admin), 2026-09-20T11:16:54+08:00
-> FOREGROUND / DEDICATED OPERATOR SHELL
-> C:\Program Files\nodejs\node.exe / v22.23.2
-> LAUNCH PARAMETERS ONLY

DEC-14 Deployment and Runtime-Byte Attestation
-> APPROVED: Billy Xu (admin), 2026-09-20T11:20:13+08:00
-> EXACT DEPLOYMENT PROCEDURE ONLY; NOT EXECUTED

DEC-11 / DEC-12 / DEC-13 / DEC-15
-> PENDING / HARD BLOCKERS

SP-0 / authorization 2
-> NOT AUTHORIZED

live cutover
-> NOT AUTHORIZED

P6 Phase 2-G
-> NOT AUTHORIZED
```

No remaining DEC may be filled without a new explicit human decision and its
evidence location.
