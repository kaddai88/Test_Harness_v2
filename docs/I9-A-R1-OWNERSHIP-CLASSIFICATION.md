# I9-A-R1 Ownership Classification

> **Status:** Complete / Awaiting review  
> **Scope:** classification only; no deletion authorized

## A — P2E authority / active shared correctness infrastructure

- `decisionProvenance` in `agentloop-integration.ts`, `execution-boundary.ts`, `provenance-validation.ts`
- `currentObservation` and its `ObservationOccurrence` lifecycle
- `StructuralEvidence` and structural comparison provenance
- `installAuthoritativeObservation()` → I4 ingestion
- `validateBeforeToolDispatch()` and `handlePostToolExecution()`
- P2E-specific ALIGN fields: decision/current occurrence, content identity, state kind
- `sessionIdentitySemantics.mode` as the existing session authority gate
- `DurableSessionPersistenceStore` as the P2E persistence adapter
- P2E persisted session metadata, including `recordVersion` and `semanticsVersion`
- Persisted `occurrenceCounter`, which prevents occurrence ID reuse across restart

These are active P2E/shared authority infrastructure. They are not migration-only plumbing and are not deletion candidates.

## B — LEGACY runtime required

- `lastRawSnapshot`: coverage/surface extraction and legacy-compatible snapshot state
- `lastSnapshot`: action verification's before-snapshot input
- `lastPageContent`: workflow/login/legacy verification state
- `currentSnapshotIdentity`: legacy lifecycle diagnostics and compatibility behavior
- `decisionSnapshotIdentity`: legacy decision diagnostics/hook path
- `updateWorkflowContext()`: legacy compatibility projection for non-P2E consumers
- Existing legacy ALIGN formatting for LEGACY sessions
- Existing coverage/surface reconciliation inputs that still consume legacy snapshot text

These remain required while I8 supports mixed LEGACY/P2E sessions and unsupported/unknown persistence backends fall back to LEGACY.

## C — Diagnostics only

- Legacy `SnapshotIdentity` formatting in the LEGACY-only ALIGN branch
- P2E `formatI7BAlignDiagnostic()` structural-comparison annotation
- P2E integration trace messages (`P2E-CAPTURE`, `P2E-INVALIDATE`, `P2E-INSTALL`)
- `currentSnapshotIdentity`/`decisionSnapshotIdentity` when read solely by a LEGACY diagnostic hook

Diagnostics must not be used as an execution authority. P2E diagnostics now report occurrence/provenance fields and do not label legacy identity as P2E current state.

## D — Migration / compatibility

- Legacy session migration adapter
- `LEGACY_UNAVAILABLE` compatibility path
- Mixed-mode compatibility adapters
- Legacy fields retained while sessions or persisted records can still be LEGACY
- Compatibility test fixtures and existing helper-level lifecycle tests
- Old-record migration logic

`LEGACY_UNAVAILABLE` originated in migration compatibility but is also an active P2E fail-closed correctness guard. D describes ownership origin, not an automatic deletion candidate. No D item may be deleted until persisted compatibility and mixed-mode operation no longer require it.

## E — Dead / unreachable

**No items are currently proven E; the deletion candidate set is empty.**

This means I9-B has no authorized deletion scope and is **SKIPPED / NOT APPLICABLE** for the current architecture. Do not manufacture cleanup work merely to populate E. Any future I9-B candidate requires separate proof that it is unreachable for both supported LEGACY and P2E runtime modes, is not required by persisted-state compatibility, and has no diagnostic or test ownership.

## Ownership findings

1. One `browser_snapshot` source event now goes through `processAuthoritativeSnapshot()` in both ordinary tool-result handling and TEST-entry initialization.
2. The coordinator validates partial scope before fan-out publication: `accepted_partial` must carry a valid explicit `completenessScope`; missing, invalid, or unbounded scope is rejected as malformed and neither LEGACY compatibility state nor P2E occurrence/current state may be published.
3. The coordinator stages P2E I4 ingestion and LEGACY compatibility projection from the same raw event, then commits their copy-on-write outputs together.
4. If P2E staging rejects (for example, accepted partial without scope) or LEGACY staging throws, the original workflow is returned unchanged; neither projection is published partially.
5. P2E ALIGN diagnostics use `currentObservation`/`decisionProvenance`; legacy identity is retained only in the LEGACY formatting branch.

6. Runtime authoritative source set remains `{ browser_snapshot }`; unknown/incidental snapshot-like payloads do not install current.

## Deferred cleanup boundary

- I9-B is **SKIPPED / NOT APPLICABLE** for the current architecture because E is empty; no deletion is authorized.
- P2-F runtime artifacts/repository hygiene remains out of scope.
- P9 backend physical durability remains out of scope.
- P3+ remains out of scope.
