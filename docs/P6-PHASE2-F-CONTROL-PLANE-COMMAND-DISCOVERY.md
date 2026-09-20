# P6 Phase 2-F Corrective Control-Plane Command Discovery

Status: DISCOVERED / NOT APPROVED / DOCUMENTATION ONLY

This document records the commands and machine-readable evidence made
available by the corrective control-plane implementation. It does not resolve
DEC-11 through DEC-15, approve any stop point, or authorize a live action.

## DEC-11 and DEC-15: Admission And Traffic Controls

The single-process API exposes these control-plane endpoints:

```text
GET  /api/v1/cutover/status
POST /api/v1/cutover/controls/freeze-entry
POST /api/v1/cutover/controls/confirm-frozen
POST /api/v1/cutover/controls/release-read-only
POST /api/v1/cutover/controls/enable-mutation
POST /api/v1/cutover/controls/abort-restore-normal
```

Each POST requires `X-Cutover-Control-Token` and `X-Cutover-Actor`. The server
only accepts state changes when both `CUTOVER_CONTROL_TOKEN` and
`CUTOVER_CONTROL_AUDIT_PATH` are configured. The audit path parent must exist,
and the audit file is created with exclusive creation then appended as JSONL.

`/api/v1/cutover/status` returns the state, admission state, mutation-capable
traffic state, queue inventory, timestamp, and transition count. Read requests
remain available while mutation-capable requests are blocked. `release-read-only`
does not enable mutations; only `enable-mutation` can do that.

DEC-11 must still approve the exact base URL, actor value, token delivery
mechanism, audit path, state transition sequence, and verification query.
DEC-15 must still approve the exact command that performs `release-read-only`.

## DEC-12: Queue Pause And Quiescence

The single-process `TaskQueue` now provides:

```text
pause()
resume()
inventory()
```

The supported protected runtime commands are:

```text
POST /api/v1/cutover/queue/pause
POST /api/v1/cutover/queue/resume
GET  /api/v1/cutover/status
```

The POST requests require the same control token and actor headers as the
traffic controls. Each operation writes requested and applied JSONL audit
records, with the applied queue inventory.

`inventory()` returns `state`, `waiting`, `delayed`, `active`, `reserved`,
`queued`, and `isQuiescent`. `isQuiescent` is true only for a paused, non-closed
queue with zero active jobs. `close()` is terminal shutdown and is explicitly
not quiescence proof.

DEC-12 must still approve the exact base URL, actor value, token delivery
mechanism, pause, drain, inspection, and resume commands and evidence locations.

## DEC-13: Capture-Only Final Backup

The discovery command is:

```text
pnpm --filter @test-harness/th-persistence p6:final-backup-capture -- \
  --datastore <exact-live-datastore> \
  --cognition <exact-live-cognition-root> \
  --profiles <exact-live-site-profile-root> \
  --resolutions <exact-resolution-manifest> \
  --output <exact-create-new-backup-root>
```

It captures a source-before/copy/source-after hash inventory, writes
`snapshot-manifest.json` and `final-backup-evidence.json`, and refuses an
existing output root. The evidence asserts clone restore, preflight import, and
rehearsal were not run and that live mutation was none.

DEC-13 must still choose the exact create-new destination, retention owner, and
cleanup policy.

## DEC-14: Deployable Runtime Package And Target

The discovery commands are:

```text
pnpm --filter @test-harness/th-persistence p6:runtime-package -- \
  --operation package \
  --workspace-root <exact-workspace-root> \
  --output <exact-create-new-runtime-package-root>

pnpm --filter @test-harness/th-persistence p6:runtime-package -- \
  --operation capture \
  --package-root <runtime-package-root> \
  --entrypoint dist/index.js \
  --provider node --topology single-process \
  --authority-datastore <exact-live-datastore> \
  --output <exact-create-new-frozen-runtime-manifest>

pnpm --filter @test-harness/th-persistence p6:runtime-package -- \
  --operation verify \
  --manifest <frozen-runtime-manifest> \
  --artifact-id <artifact-identity-from-capture> \
  --manifest-sha256 <frozen-runtime-manifest-sha256> \
  --package-root <runtime-package-root> \
  --entrypoint dist/index.js \
  --provider node --topology single-process \
  --authority-datastore <exact-live-datastore> \
  --output <exact-create-new-runtime-attestation>
```

The package command builds the th-server dependency closure then uses
`pnpm deploy --legacy --prod` to create a standalone package. It removes only
pnpm's source-workspace self-junction and rejects every other junction escaping
the package root. The manifest binds regular files and package-internal
junction targets. The verifier rejects byte, file inventory, link, provider,
topology, entrypoint, or datastore-path differences and writes JSON evidence
only on a match. Verification requires exact matches for both the frozen
artifact identity and the SHA-256 of the exact manifest bytes read and
validated. The supported topology is `node` / `single-process`; no container
or multi-process deployment path is implied.

DEC-14 must still approve the exact package root, deployment/start command,
entrypoint, target path, frozen manifest path, and runtime-package identity.

## Gate Boundary

The discovered interfaces make DEC-11 through DEC-15 capable of explicit human
approval. They are not approvals. No command in this document was run against
the live target.
