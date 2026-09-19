# P6 Phase 2-F Authorization 2 Operational Decision Record

Status: `PARTIAL / DEC-02, DEC-03, AND GOV-EX-01 APPROVED / AUTHORIZATION 2 NOT GRANTED`

This record captures explicit human operational decisions only. It does not
constitute `SP-0`, does not grant authorization 2, and does not authorize any
live freeze, backup, import, writer activation, traffic release, or PONR.

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
`GOV-EX-01` permits Billy Xu (admin) to be considered for DEC-01 under the
single-operator exception, but DEC-01 remains separately PENDING.

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
`GOV-EX-01` permits Billy Xu (admin) to be considered for DEC-01 under the
single-operator exception, but DEC-01 remains separately PENDING.

DEC-03 has authority to STOP or ABORT, require a renewed freeze, invoke
pre-PONR rollback, enforce DB-authority preservation after ambiguous PONR, and
coordinate deployment, queue/worker, rollback, and evidence owners.

DEC-03 must remain continuously available from the first freeze-entry action
until post-PONR stabilization is accepted or pre-PONR rollback and operational
restoration are complete.

This appointment does not authorize live execution.
```

## Remaining pending decisions

| DEC ID | Decision | Status | Required decision source |
|---|---|---|---|
| `DEC-01` | Live cutover operator | `PENDING`; Billy Xu (admin) eligible under approved `GOV-EX-01`, but `NOT APPROVED` | explicit approval by `DEC-02` |
| `DEC-04` | Rollback owner | candidate Billy Xu (admin); `NOT APPROVED` | incident commander |
| `DEC-05` | Evidence custodian | `PENDING` | authorization-2 approver |
| `DEC-06` | Queue/worker drain owner | candidate Billy Xu (admin); `NOT APPROVED` | incident commander |
| `DEC-07` | Deployment owner | candidate Billy Xu (admin); `NOT APPROVED` | incident commander |
| `DEC-08` | Maintenance window and timezone | `PENDING` | authorization-2 approver |
| `DEC-09` | Maximum freeze duration | `PENDING` | incident commander |
| `DEC-10` | Latest safe writer-activation time | `PENDING` | incident commander |
| `DEC-11` | Admission freeze and verification commands | `PENDING` | deployment owner |
| `DEC-12` | Queue/worker pause, drain, and inspection commands | `PENDING` | queue/worker drain owner |
| `DEC-13` | Final backup path and retention/cleanup owner | `PENDING` | evidence custodian |
| `DEC-14` | Deployment command and runtime artifact verification | `PENDING` | deployment owner |
| `DEC-15` | Pre-PONR traffic-release command | `PENDING` | deployment owner |
| `DEC-16` | `SP-1` through `SP-4` approvers and communication channel | `PENDING` | authorization-2 approver |
| `DEC-17` | Post-PONR incident/escalation channel | `PENDING` | incident commander |

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

DEC-01
-> PENDING / Billy Xu (admin) eligible under GOV-EX-01

DEC-04 / DEC-06 / DEC-07
-> CANDIDATE ONLY / NOT APPROVED

DEC-05 and DEC-08 through DEC-17
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
