# P6 Phase 2-F Corrective Control-Plane Command Discovery

Status: `FINAL-SIGNATURE COMMAND SET / DEC-11, DEC-12, DEC-13, AND DEC-15 APPROVED / NOT EXECUTED`

This document records the exact commands approved by `DEC-11`, `DEC-12`,
`DEC-13`, and `DEC-15`. Approval defines the operational commands and
acceptance criteria only. No command in this document has been executed
against the live target.

Common control-plane bindings:

```text
base URL: http://127.0.0.1:3000
actor: Billy Xu (admin)
token delivery/reference: Windows process environment variable env:CUTOVER_CONTROL_TOKEN
audit path: E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\control-plane-audit.jsonl
secret handling: the token value is excluded from Git, decision records,
  command-discovery documents, audit evidence, and evidence bundles
```

`env:P6_CONTROL_PLANE_TOKEN` is deprecated and MUST NOT be used.

## DEC-11 Canonical Commands

### DEC-11 Admission Freeze

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $baseUrl = 'http://127.0.0.1:3000'
  if ([string]::IsNullOrWhiteSpace($env:CUTOVER_CONTROL_TOKEN)) {
    throw 'CUTOVER_CONTROL_TOKEN is required'
  }
  $headers = @{
    'X-Cutover-Control-Token' = $env:CUTOVER_CONTROL_TOKEN
    'X-Cutover-Actor' = 'Billy Xu (admin)'
  }
  $result = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/cutover/controls/freeze-entry" -Headers $headers
  if ($result.status -ne 'ok' -or
      $result.control.state -ne 'freeze-entry' -or
      $result.control.newSessionAdmission -ne 'blocked' -or
      $result.control.mutationCapableTraffic -ne 'blocked' -or
      $result.control.readOnlyTraffic -ne 'enabled') {
    throw 'DEC-11 admission freeze verification failed'
  }
  $result | ConvertTo-Json -Depth 10
}
```

### DEC-11 Semantic-Mutation Freeze Confirmation

This command is eligible only after the `DEC-12` queue quiescence command has
passed.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $baseUrl = 'http://127.0.0.1:3000'
  if ([string]::IsNullOrWhiteSpace($env:CUTOVER_CONTROL_TOKEN)) {
    throw 'CUTOVER_CONTROL_TOKEN is required'
  }
  $headers = @{
    'X-Cutover-Control-Token' = $env:CUTOVER_CONTROL_TOKEN
    'X-Cutover-Actor' = 'Billy Xu (admin)'
  }
  $before = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/cutover/status"
  if ($before.control.state -ne 'freeze-entry' -or
      $before.queue.state -ne 'paused' -or
      [int]$before.queue.active -ne 0 -or
      [int]$before.queue.reserved -ne 0 -or
      $before.queue.isQuiescent -ne $true) {
    throw 'DEC-11 cannot confirm FROZEN before DEC-12 quiescence passes'
  }
  $result = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/cutover/controls/confirm-frozen" -Headers $headers
  if ($result.status -ne 'ok' -or
      $result.control.state -ne 'frozen' -or
      $result.control.newSessionAdmission -ne 'blocked' -or
      $result.control.mutationCapableTraffic -ne 'blocked' -or
      $result.control.readOnlyTraffic -ne 'enabled') {
    throw 'DEC-11 semantic-mutation freeze verification failed'
  }
  $result | ConvertTo-Json -Depth 10
}
```

### DEC-11 Frozen Status Verification

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $result = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3000/api/v1/cutover/status'
  if ($result.status -ne 'ok' -or
      $result.control.state -ne 'frozen' -or
      $result.control.newSessionAdmission -ne 'blocked' -or
      $result.control.mutationCapableTraffic -ne 'blocked' -or
      $result.control.readOnlyTraffic -ne 'enabled' -or
      $result.queue.state -ne 'paused' -or
      [int]$result.queue.active -ne 0 -or
      [int]$result.queue.reserved -ne 0 -or
      $result.queue.isQuiescent -ne $true) {
    throw 'DEC-11 frozen status verification failed'
  }
  $result | ConvertTo-Json -Depth 10
}
```

DEC-11 acceptance requires all three commands to return without error; new
session admission and semantic mutation must be `blocked`; permitted read-only
status probes must remain available; the state must be machine-readable as
`frozen`; queue state must remain `paused` and quiescent; and the protected
transitions must be persisted to the create-new append-only audit file. Any
mismatch, HTTP error, missing audit record, or ambiguous response is `NO-GO`.

## DEC-12 Canonical Commands

### DEC-12 Queue Pause

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $baseUrl = 'http://127.0.0.1:3000'
  if ([string]::IsNullOrWhiteSpace($env:CUTOVER_CONTROL_TOKEN)) {
    throw 'CUTOVER_CONTROL_TOKEN is required'
  }
  $headers = @{
    'X-Cutover-Control-Token' = $env:CUTOVER_CONTROL_TOKEN
    'X-Cutover-Actor' = 'Billy Xu (admin)'
  }
  $result = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/cutover/queue/pause" -Headers $headers
  if ($result.status -ne 'ok' -or $result.queue.state -ne 'paused') {
    throw 'DEC-12 queue pause verification failed'
  }
  $result | ConvertTo-Json -Depth 10
}
```

### DEC-12 Queue Inventory

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $result = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3000/api/v1/cutover/status'
  foreach ($field in @('waiting', 'delayed', 'active', 'reserved', 'queued')) {
    if ($null -eq $result.queue.$field -or [int]$result.queue.$field -lt 0) {
      throw "DEC-12 queue inventory field is invalid: $field"
    }
  }
  $result.queue | ConvertTo-Json -Depth 10
}
```

### DEC-12 Quiescence Verification

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $result = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3000/api/v1/cutover/status'
  if ($result.queue.state -eq 'closed') {
    throw 'Queue close/shutdown is not accepted as quiescence proof'
  }
  if ($result.queue.state -ne 'paused' -or
      [int]$result.queue.active -ne 0 -or
      [int]$result.queue.reserved -ne 0 -or
      $result.queue.isQuiescent -ne $true) {
    throw 'DEC-12 queue is not quiescent'
  }
  [pscustomobject]@{
    state = $result.queue.state
    waiting = [int]$result.queue.waiting
    delayed = [int]$result.queue.delayed
    active = [int]$result.queue.active
    reserved = [int]$result.queue.reserved
    inFlight = [int]$result.queue.active + [int]$result.queue.reserved
    queued = [int]$result.queue.queued
    isQuiescent = [bool]$result.queue.isQuiescent
  } | ConvertTo-Json -Depth 10
}
```

### DEC-12 Explicit Abort Restoration

This command is an explicit pre-PONR abort/restoration sequence. It is not an
automatic continuation from a failed check.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $baseUrl = 'http://127.0.0.1:3000'
  if ([string]::IsNullOrWhiteSpace($env:CUTOVER_CONTROL_TOKEN)) {
    throw 'CUTOVER_CONTROL_TOKEN is required'
  }
  $headers = @{
    'X-Cutover-Control-Token' = $env:CUTOVER_CONTROL_TOKEN
    'X-Cutover-Actor' = 'Billy Xu (admin)'
  }
  $null = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/cutover/controls/abort-restore-normal" -Headers $headers
  $null = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/cutover/queue/resume" -Headers $headers
  $result = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/cutover/status"
  if ($result.control.state -ne 'normal' -or
      $result.control.newSessionAdmission -ne 'enabled' -or
      $result.control.mutationCapableTraffic -ne 'enabled' -or
      $result.queue.state -ne 'open') {
    throw 'DEC-12 abort restoration verification failed'
  }
  $result | ConvertTo-Json -Depth 10
}
```

DEC-12 quiescence is accepted only when queue state is `paused`, `active = 0`,
`reserved = 0`, derived `inFlight = active + reserved = 0`, and
`isQuiescent = true`. Waiting/delayed jobs may remain and must be reported.
Queue `closed` is never accepted as quiescence. Pause, resume, and restoration
must be explicitly audited. Any nonzero active/reserved/in-flight value is
`NO-GO`.

## DEC-13 Canonical Command

Exact inputs:

```text
datastore: E:\Projects\Test-Harness\data\testharness.json
cognition root: E:\Projects\Test-Harness\.cognition
site-profile root: E:\Projects\Test-Harness\.site-profiles
resolution manifest: E:\Projects\Test-Harness\.p6-rehearsal\example-com-resolution-v2.json
resolution manifest SHA-256: f6965b6b84d3727011257e25947ae5334c94a3b6f1c36682da232e4951aac8d0
create-new output: E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\final-post-freeze-backup
retention/cleanup owner: Billy Xu (admin)
```

### DEC-13 Capture-Only Final Backup

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $workspace = 'E:\Projects\Test-Harness'
  $datastore = 'E:\Projects\Test-Harness\data\testharness.json'
  $cognition = 'E:\Projects\Test-Harness\.cognition'
  $profiles = 'E:\Projects\Test-Harness\.site-profiles'
  $resolutions = 'E:\Projects\Test-Harness\.p6-rehearsal\example-com-resolution-v2.json'
  $output = 'E:\Projects\Test-Harness\.p6-live-cutover\2026-09-19-root-json-live-01\final-post-freeze-backup'
  $pnpm = 'C:\Users\billy\AppData\Roaming\npm\pnpm.cmd'

  foreach ($file in @($datastore, $resolutions, $pnpm)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      throw "Required DEC-13 file does not exist: $file"
    }
  }
  foreach ($directory in @($cognition, $profiles)) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
      throw "Required DEC-13 directory does not exist: $directory"
    }
  }
  if (Test-Path -LiteralPath $output) {
    throw 'DEC-13 final-backup output must not exist before capture'
  }
  $expectedFiles = @(
    $datastore
    'E:\Projects\Test-Harness\.cognition\episodes.json'
    'E:\Projects\Test-Harness\.cognition\patterns.json'
    'E:\Projects\Test-Harness\.cognition\q-values.json'
    'E:\Projects\Test-Harness\.cognition\recovery.json'
    'E:\Projects\Test-Harness\.cognition\semantic.json'
    'E:\Projects\Test-Harness\.cognition\strategies.json'
    'E:\Projects\Test-Harness\.site-profiles\185.200.65.4.json'
    'E:\Projects\Test-Harness\.site-profiles\www.baidu.com.json'
    $resolutions
  ) | Sort-Object
  $actualFiles = @(
    $datastore
    (Get-ChildItem -LiteralPath $cognition -Recurse -Force -File).FullName
    (Get-ChildItem -LiteralPath $profiles -Recurse -Force -File).FullName
    $resolutions
  ) | Sort-Object
  if ($expectedFiles.Count -ne 10 -or
      $actualFiles.Count -ne 10 -or
      (Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $actualFiles)) {
    throw 'DEC-13 exact ten-file source inventory mismatch'
  }
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $resolutions).Hash.ToLowerInvariant() -ne
      'f6965b6b84d3727011257e25947ae5334c94a3b6f1c36682da232e4951aac8d0') {
    throw 'DEC-13 resolution manifest SHA-256 mismatch'
  }

  Set-Location -LiteralPath $workspace
  & $pnpm --filter '@test-harness/th-persistence' p6:final-backup-capture -- `
    --datastore $datastore `
    --cognition $cognition `
    --profiles $profiles `
    --resolutions $resolutions `
    --output $output
  if ($LASTEXITCODE -ne 0) {
    throw "DEC-13 capture command exited with code $LASTEXITCODE"
  }

  $manifestPath = Join-Path $output 'snapshot-manifest.json'
  $evidencePath = Join-Path $output 'final-backup-evidence.json'
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $evidence = Get-Content -Raw -LiteralPath $evidencePath | ConvertFrom-Json
  if ($manifest.files.Count -ne 10 -or
      [string]::IsNullOrWhiteSpace($manifest.snapshotId) -or
      [string]::IsNullOrWhiteSpace($manifest.datastoreSemanticSha256) -or
      ($manifest.files | Where-Object {
        $_.sourceSha256Before -ne $_.copySha256 -or
        $_.copySha256 -ne $_.sourceSha256After
      }).Count -ne 0 -or
      $evidence.snapshot.files -ne 10 -or
      $evidence.snapshot.allBeforeCopyAfterHashesMatch -ne $true -or
      $evidence.snapshot.manifestSha256 -ne
        (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant() -or
      $evidence.execution.cloneRestore -ne $false -or
      $evidence.execution.preflightImport -ne $false -or
      $evidence.execution.rehearsal -ne $false -or
      $evidence.execution.liveMutation -ne 'none') {
    throw 'DEC-13 captured backup acceptance verification failed'
  }
  $evidence | ConvertTo-Json -Depth 20
}
```

The output path is create-new and must not exist before capture. The command is
capture-only: it must not run a clone restore, rehearsal, preflight import,
live import, writer activation, traffic release, or PONR action. Acceptance
requires exactly ten governed files, source-before/copy/source-after SHA-256
equality, a content-derived snapshot ID, manifest SHA-256, deterministic
datastore semantic SHA-256, no live-source mutation, and create-new evidence.
The backup remains immutable through completion of Phase 2-G and its evidence
retention period. Billy Xu (admin), acting as evidence custodian, owns retention
and cleanup; deletion, movement, rename, or replacement requires a later
explicit evidence-retention decision.

## DEC-14 Runtime Package Binding

`DEC-14` separately approves the post-corrective runtime package v2, artifact
identity, manifest SHA-256, attestation SHA-256, Node runtime, and exact
foreground deployment/start command. That command remains unexecuted. The v9
artifact/configuration identities and the prior `9edda6be...` runtime package
remain historical evidence only.

## DEC-15 Canonical Commands

DEC-15 uses the same exact base URL, actor, token reference, and audit path as
DEC-11.

### DEC-15 Read-Only Traffic Release

This command is gated by a separately persisted `SP-3` approval.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $baseUrl = 'http://127.0.0.1:3000'
  if ([string]::IsNullOrWhiteSpace($env:CUTOVER_CONTROL_TOKEN)) {
    throw 'CUTOVER_CONTROL_TOKEN is required'
  }
  $headers = @{
    'X-Cutover-Control-Token' = $env:CUTOVER_CONTROL_TOKEN
    'X-Cutover-Actor' = 'Billy Xu (admin)'
  }
  $result = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/cutover/controls/release-read-only" -Headers $headers
  if ($result.status -ne 'ok' -or
      $result.control.state -ne 'read-only' -or
      $result.control.newSessionAdmission -ne 'blocked' -or
      $result.control.mutationCapableTraffic -ne 'blocked' -or
      $result.control.readOnlyTraffic -ne 'enabled') {
    throw 'DEC-15 read-only traffic release verification failed'
  }
  $result | ConvertTo-Json -Depth 10
}
```

### DEC-15 Read-Only Isolation Verification

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $result = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3000/api/v1/cutover/status'
  if ($result.status -ne 'ok' -or
      $result.control.state -ne 'read-only' -or
      $result.control.newSessionAdmission -ne 'blocked' -or
      $result.control.mutationCapableTraffic -ne 'blocked' -or
      $result.control.readOnlyTraffic -ne 'enabled') {
    throw 'DEC-15 SP-3 isolation verification failed'
  }
  $result | ConvertTo-Json -Depth 10
}
```

### DEC-15 Mutation-Capable Enable

This command is prohibited until a separate `SP-4` approval has been persisted.

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $baseUrl = 'http://127.0.0.1:3000'
  if ([string]::IsNullOrWhiteSpace($env:CUTOVER_CONTROL_TOKEN)) {
    throw 'CUTOVER_CONTROL_TOKEN is required'
  }
  $headers = @{
    'X-Cutover-Control-Token' = $env:CUTOVER_CONTROL_TOKEN
    'X-Cutover-Actor' = 'Billy Xu (admin)'
  }
  $result = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/v1/cutover/controls/enable-mutation" -Headers $headers
  if ($result.status -ne 'ok' -or
      $result.control.state -ne 'mutation-enabled' -or
      $result.control.newSessionAdmission -ne 'enabled' -or
      $result.control.mutationCapableTraffic -ne 'enabled' -or
      $result.control.readOnlyTraffic -ne 'enabled') {
    throw 'DEC-15 mutation-capable enable verification failed'
  }
  $result | ConvertTo-Json -Depth 10
}
```

### DEC-15 Mutation State Verification

```powershell
& {
  $ErrorActionPreference = 'Stop'
  $result = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:3000/api/v1/cutover/status'
  if ($result.status -ne 'ok' -or
      $result.control.state -ne 'mutation-enabled' -or
      $result.control.newSessionAdmission -ne 'enabled' -or
      $result.control.mutationCapableTraffic -ne 'enabled' -or
      $result.control.readOnlyTraffic -ne 'enabled') {
    throw 'DEC-15 post-SP-4 mutation state verification failed'
  }
  $result | ConvertTo-Json -Depth 10
}
```

SP-3 may execute only the read-only release and isolation verification. Those
commands must leave mutation-capable traffic and new-session admission blocked.
Only the separately SP-4-gated `enable-mutation` command may enable mutation
capability. Any ambiguous response, rejected transition, state mismatch, or
missing append-only audit record is `NO-GO` and does not imply admission.

## Approval Boundary

Approval of `DEC-11`, `DEC-12`, `DEC-13`, and `DEC-15` authorizes these exact
operational definitions only. It does not execute a command, approve `SP-0`
through `SP-4`, grant Authorization 2, or authorize runtime start, live freeze,
queue pause, final backup capture, import, writer activation, traffic release,
PONR, or Phase 2-G.
