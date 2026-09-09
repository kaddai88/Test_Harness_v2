# P2-E Implementation Plan

> **Status:** Phase 0 APPROVED / Phase 1a AUTHORIZED  
> **Date:** 2026-09-09  
> **Design baseline:** [P2-E-IDENTITY-SEMANTICS.md](P2-E-IDENTITY-SEMANTICS.md) (APPROVED)  
> **Phase:** Phase 1a — code changes authorized (types + C1 conformance)  
> **Implementation status:** foundational types implementation in progress

---

## 1. Scope

### 1.1 In scope

- Gap mapping from approved design to current implementation
- Target data model definition
- Migration strategy for existing workflow/session state
- Implementation task graph with dependencies
- Conformance test matrix (test design before code)
- Compatibility constraints with Phase 1 closure
- Rollout and rollback strategy
- Acceptance gates for implementation phases

### 1.2 Out of scope

- P2-F Repository Hygiene (separate milestone)
- P3–P10 system risks (separate milestones)
- Changes to P2-A–P2-D closure code without new regression evidence
- Changes to non-identity-related workflow logic
- Changes to coverage model, intent model, or action resolution algorithms

---

## 2. Approved Design Baseline

Reference: [P2-E-IDENTITY-SEMANTICS.md](P2-E-IDENTITY-SEMANTICS.md)

Key normative requirements:

1. **Three distinct concepts:** observation content identity, observation occurrence identity, decision snapshot provenance
2. **Two independent identity domains:** observation domain and structural domain, derived from same raw snapshot through separate projections
3. **Structural outcome-independence:** structural verdicts determined exclusively by projections + comparison provenance, never by observation outcome labels
4. **StructuralEvidence model:** `{ contractVersion, completenessScope, structuralIdentity }` where completenessScope is comparison provenance, not hash content
5. **Three-valued comparison:** SAME / DIFFERENT / NOT COMPARABLE (with two incomparability reasons: contract vs evidence/scope)
6. **Current observation lifecycle:** authoritative states, atomic ingestion, typed outcomes (complete/empty/partial/failure/unavailable), multi-tool revalidation
7. **Decision provenance:** binds exact request-bound occurrence + its observation content identity
8. **Structural identity NEVER substitutes for occurrence identity** at correctness boundaries

---

## 2.5 Implementation Correctness Hard Rules (P0-R1)

These rules are non-negotiable correctness constraints that override all other implementation decisions. Violation of any rule is a blocking defect.

### Rule 1: Legacy Provenance Non-Fabrication

**Old `{version, hash}` state CANNOT be migrated into exact provenance.**

Legacy state lacks request-bound occurrence information. Migration code MUST NOT synthesize:

```text
old snapshotVersion + snapshotHash
→ fake observation occurrence
→ fake decision provenance
```

Instead:

```text
Legacy state without exact provenance
→ provenance = LEGACY_UNAVAILABLE
→ MUST NOT be treated as exact occurrence binding
→ before observation-dependent action:
   obtain fresh authoritative observation
   create new provenance
```

**Rationale:** Fabricating provenance from content identity alone violates the core semantic that content equality ≠ occurrence equality. This would reintroduce the exact bug P2-E was designed to prevent.

### Rule 2: Single Correctness Authority During Migration

**At every correctness-critical boundary, exactly one identity semantics is authoritative.**

Allowed patterns:

```text
Pattern A: Legacy authoritative + New shadow-computed
Pattern B: New authoritative + Legacy retained for compatibility/diagnostics
```

Forbidden pattern:

```text
New preferred
→ fallback to legacy when convenient
```

**Rationale:** Mixing authorities at request binding vs. validation would break E7's occurrence-based correctness. The same decision cannot be created under one semantics and validated under another.

**Atomic switch boundary:** request binding, current occurrence, ALIGN, stale-action validation MUST switch as one atomic group, not independently.

### Rule 3: Session-Pinned Feature Semantics

**Feature flag `P2E_IDENTITY_SEMANTICS` activation is pinned at session start.**

```text
session starts
    ↓
identity semantics mode pinned: LEGACY or P2E
    ↓
entire session uses same mode for:
  - request provenance
  - current lifecycle
  - ALIGN
  - multi-tool revalidation
```

**Forbidden:**

```text
request created under LEGACY
        ↓
flag changes
        ↓
action validated under P2E
```

**Rationale:** Mid-session semantics change would create provenance skew between decision creation and validation.

### Rule 4: Type Separation — Identity / Evidence / Provenance / State

**Target types MUST clearly separate these concepts:**

```text
ObservationContentIdentity
    └─ contract version + content hash

ObservationOccurrenceIdentity
    └─ unique occurrence locator (NOT content hash)

StructuralEvidence
    ├─ structural contract version
    ├─ completeness scope
    └─ structural identity (NOT evidence itself)

DecisionProvenance
    ├─ exact occurrence identity
    └─ corresponding observation content identity

CurrentObservationState
    ├─ authoritative occurrence (or unavailable)
    └─ valid / invalidated / unavailable state
```

**Key distinctions:**

- `structuralIdentity ≠ StructuralEvidence` (evidence includes scope + contract)
- `observationOccurrenceIdentity ≠ decisionProvenance` (provenance = occurrence + content identity)

**Rationale:** Conflating these in types would make it easy to accidentally use content identity where occurrence identity is required, reintroducing the bug.

### Rule 5: Mandatory Conformance Cases as Sequencing Gates

**Conformance tests C1–C14 are implementation gates, not final验收 checklist.**

Each case MUST be implemented and passing before the corresponding implementation task can be considered complete. See Section 7 for the complete list.

**Rationale:** These cases encode the approved design's core invariants. If they're not executable and passing, the implementation has not actually achieved the design semantics.

---

## 3. Current Implementation Mapping

### 3.1 Current data structures

**File:** `packages/agent/th-agent/src/workflow.ts`

```typescript
// Lines 143-146
export interface SnapshotIdentity {
  version: number;  // occurrence locator (monotonic counter)
  hash: string;     // content identity (12-hex SHA-256 prefix of normalized snapshot)
}

// Lines 87-91 in WorkflowContext
currentSnapshotIdentity: SnapshotIdentity | null;
decisionSnapshotIdentity: SnapshotIdentity | null;
```

**Current semantics:**
- `version` serves dual role: occurrence locator AND monotonic ordering
- `hash` is computed from `normalizeSnapshot(text)` which uses regex-based dynamic pattern removal
- `decisionSnapshotIdentity` is a shallow copy captured before tool execution
- No explicit contract version tracking
- No explicit completeness scope tracking
- Structural signature (`SurfaceSignature`) is separate from snapshot identity

### 3.2 Current projection functions

**File:** `packages/agent/th-agent/src/surface-signature.ts`

```typescript
// normalizeSnapshot() uses DYNAMIC_PATTERNS (regex-based)
// Returns: string (normalized snapshot text)

// extractSurfaceSignature(snapshot, url)
// Returns: SurfaceSignature { url, title, activeTab, headings, interactiveRoles, 
//                            formFields, tableHeaders, majorActions, landmarkRoles, 
//                            featureLabels, hash }

// hashSurfaceSignature(signature)
// Returns: string (16-hex SHA-256 prefix)
```

**Current semantics:**
- Single normalization function shared between observation and structural projections
- Regex-based dynamic pattern removal (timestamps, UUIDs, counts, etc.)
- Structural hash includes URL but not completeness scope
- No field-aware semantic classification
- No contract version concept

### 3.3 Current lifecycle handling

**File:** `packages/agent/th-agent/src/loop.ts`

```typescript
// Lines 854-861: Decision boundary capture
const decisionSnapshotIdentity = context.workflow.currentSnapshotIdentity
  ? { ...context.workflow.currentSnapshotIdentity }
  : null;
context.workflow.decisionSnapshotIdentity = decisionSnapshotIdentity;

// Line 1410-1417: TEST initialization routes through updateWorkflowContext()
```

**Current semantics:**
- Single `currentSnapshotIdentity` updated on every successful snapshot
- Decision identity captured as shallow copy before tool execution
- No explicit occurrence identity separate from version
- No multi-tool revalidation logic
- No typed outcome states (complete/empty/partial/failure/unavailable)
- No state invalidation on state-changing actions

### 3.4 Gap summary

| Design Requirement | Current State | Gap |
|-------------------|---------------|-----|
| Observation content identity | `SnapshotIdentity.hash` | Needs explicit separation from occurrence locator |
| Observation occurrence identity | `SnapshotIdentity.version` | Version conflates occurrence + ordering; needs explicit provenance |
| Structural identity | `SurfaceSignature.hash` | Separate from snapshot identity; needs integration into StructuralEvidence |
| StructuralEvidence model | Not present | New type needed: `{ contractVersion, completenessScope, structuralIdentity }` |
| Completeness scope | Not tracked | New field needed for partial observation support |
| Contract version | Not tracked | New field needed for both domains |
| Three-valued comparison | Binary (equal/not-equal) | Need NOT COMPARABLE with two reasons |
| Typed outcomes | Implicit (empty string = empty) | Need explicit: complete/empty/partial/failure/unavailable |
| Multi-tool revalidation | Not present | Need to detect state changes within single model response |
| State invalidation | Not present | Need to invalidate current after state-changing actions |
| Field-aware classification | Regex-based normalization | Need schema-driven field semantics |
| Outcome-independent structural | Not enforced | Structural verdicts currently may be influenced by outcome labels |
| Decision provenance | Shallow copy of SnapshotIdentity | Need explicit provenance object with occurrence + content identity |

---

## 4. Target Data Model

### 4.1 Core types (proposed, names subject to refinement)

```typescript
// ─── Identity Domains ───────────────────────────────────────────────────────

/** Observation content identity - domain-scoped identity of model-visible evidence */
export interface ObservationContentIdentity {
  contractVersion: string;        // normalization contract version
  contentHash: string;            // hash of normalized observation envelope
}

/** Observation occurrence identity - unique locator for one observation event */
export interface ObservationOccurrenceIdentity {
  occurrenceId: string;           // unique ID (e.g., monotonic counter or UUID)
  timestamp: number;              // when this occurrence was recognized
}

/** Structural identity - domain-scoped identity of semantic/actionable structure */
export interface StructuralIdentity {
  structuralHash: string;         // hash of structural projection
}

/** Structural evidence - complete structural comparison record */
export interface StructuralEvidence {
  contractVersion: string;        // structural projection contract version
  completenessScope: string;      // evidence scope descriptor (e.g., "complete", "partial:main", "empty")
  structuralIdentity: StructuralIdentity;
}

/** Decision snapshot provenance - binds decision to exact observation occurrence */
export interface DecisionSnapshotProvenance {
  occurrenceId: string;           // which observation occurrence was used
  observationContent: ObservationContentIdentity;  // what content was observed
}

// ─── Lifecycle States ────────────────────────────────────────────────────────

/** Typed observation outcome */
export type ObservationOutcome = 
  | 'complete'                    // successful non-empty observation
  | 'empty'                       // successful empty observation
  | 'partial'                     // accepted partial observation
  | 'failure'                     // acquisition failed
  | 'unavailable';                // explicit unavailable state

/** Current observation state */
export type CurrentObservationState =
  | { kind: 'none' }                                    // NoCurrentObservation
  | { kind: 'current'; occurrence: ObservationOccurrence }  // Current(Oₙ)
  | { kind: 'unavailable'; event: UnavailableEvent };   // CurrentUnavailable(Uₙ)

/** Complete observation occurrence */
export interface ObservationOccurrence {
  occurrenceId: ObservationOccurrenceIdentity;
  outcome: ObservationOutcome;
  observationContent: ObservationContentIdentity;
  structuralEvidence: StructuralEvidence;
}

/** Unavailable event */
export interface UnavailableEvent {
  eventId: string;
  reason: string;
  timestamp: number;
}

// ─── Comparison Results ──────────────────────────────────────────────────────

/** Three-valued comparison result */
export type IdentityComparison = 
  | { result: 'SAME' }
  | { result: 'DIFFERENT' }
  | { result: 'NOT_COMPARABLE'; reason: 'contract' | 'evidence_scope' };

// ─── Workflow Context Updates ────────────────────────────────────────────────

export interface WorkflowContext {
  // ... existing fields ...
  
  /** Current observation occurrence (replaces currentSnapshotIdentity) */
  currentObservation: CurrentObservationState;
  
  /** Decision provenance (replaces decisionSnapshotIdentity) */
  decisionProvenance: DecisionSnapshotProvenance | null;
  
  /** Occurrence counter for generating unique occurrence IDs */
  occurrenceCounter: number;
  
  /** Identity contract versions */
  observationContractVersion: string;
  structuralContractVersion: string;
}
```

### 4.1.1 Type Separation Clarification (Rule 4 Enforcement)

**Critical distinctions that MUST be preserved in implementation:**

1. **`structuralIdentity ≠ StructuralEvidence`**
   - `StructuralIdentity` is just the hash (content identity)
   - `StructuralEvidence` includes contract + scope + identity (comparison record)
   - Using `StructuralIdentity` alone for comparison would ignore scope/contract

2. **`observationOccurrenceIdentity ≠ decisionProvenance`**
   - `ObservationOccurrenceIdentity` is just the occurrence locator
   - `DecisionSnapshotProvenance` = occurrence + observation content identity
   - Using occurrence alone would lose the content identity needed for validation

3. **`observationContentIdentity ≠ observationOccurrenceIdentity`**
   - Content identity = what was observed (hash of normalized content)
   - Occurrence identity = when it was observed (unique locator)
   - Two occurrences can have SAME content but DIFFERENT occurrence IDs

4. **`ObservationOccurrence` bundles all three**
   - occurrenceId (locator)
   - observationContent (what)
   - structuralEvidence (structure)
   - outcome (typed result)
   - This is the atomic unit of "one observation event"

### 4.2 Migration mapping

| Old Field | New Field | Migration Notes |
|-----------|-----------|-----------------|
| `currentSnapshotIdentity.version` | `currentObservation.occurrence.occurrenceId` | Version → occurrence ID (may need conversion logic) |
| `currentSnapshotIdentity.hash` | `currentObservation.occurrence.observationContent.contentHash` | Hash field name change |
| `decisionSnapshotIdentity` | `decisionProvenance` | Shallow copy → explicit provenance object |
| (implicit empty) | `currentObservation.occurrence.outcome` | New explicit outcome field |
| (not present) | `currentObservation.occurrence.structuralEvidence` | New structural evidence tracking |
| (not present) | `currentObservation.occurrence.structuralEvidence.completenessScope` | New completeness scope tracking |
| (not present) | `observationContractVersion` | New contract version tracking |
| (not present) | `structuralContractVersion` | New contract version tracking |

---

## 5. Migration Strategy

### 5.1 Single Correctness Authority (Rule 2 Enforcement)

**CRITICAL CONSTRAINT:** At every correctness-critical boundary, exactly one identity semantics is authoritative.

**Forbidden pattern:**
```text
New preferred
→ fallback to legacy when convenient
```

**Allowed patterns:**

**Pattern A: Legacy authoritative + New shadow-computed**
- Old code paths read/write old fields (authoritative)
- New code paths read/write new fields in shadow (non-authoritative)
- Switch to Pattern B only when ready for atomic transition

**Pattern B: New authoritative + Legacy retained for compatibility**
- New code paths read/write new fields (authoritative)
- Old fields retained but not used for correctness decisions
- Old code paths disabled or redirected

**Atomic switch boundary:**
The following MUST switch together as one atomic group:
- Request binding (decision provenance creation)
- Current occurrence tracking
- ALIGN validation
- Multi-tool revalidation
- Stale-action detection

Cannot switch these independently. Cannot have request created under one semantics and validated under another.

### 5.2 Backward compatibility approach

**Strategy:** Atomic semantics transition (not gradual field migration)

1. **Phase 1a: Add new fields, keep old fields (Pattern A)**
   - Add new fields to WorkflowContext alongside old fields
   - New code writes to new fields (shadow)
   - Old code reads/writes old fields (authoritative)
   - No behavioral changes yet
   - All correctness decisions use old semantics

2. **Phase 1b: Validate new semantics in parallel**
   - New code computes new fields (shadow)
   - Compare new vs old at correctness boundaries (logging only)
   - Old code still authoritative for actual decisions
   - Identify discrepancies but don't act on them
   - All correctness decisions still use old semantics

3. **Phase 1c: Atomic switch to new semantics (Pattern B)**
   - Feature flag enables new semantics for new sessions
   - New sessions: new fields authoritative, old fields retained
   - Old sessions: continue with old semantics (pinned at session start)
   - All correctness decisions use new semantics for new sessions
   - Atomic switch: request binding + current + ALIGN + revalidation switch together

4. **Phase 1d: Remove old fields**
   - Once all sessions migrated, remove old fields
   - Update persistence schema
   - Migration complete

### 5.3 Legacy Provenance Non-Fabrication (Rule 1 Enforcement)

**CRITICAL CONSTRAINT:** Old `{version, hash}` state CANNOT be migrated into exact provenance.

**Forbidden migration:**
```text
old snapshotVersion + snapshotHash
→ synthesize new occurrence identity
→ synthesize decision provenance
→ treat as exact occurrence binding
```

**Required migration:**
```text
Legacy state without exact provenance:
  currentSnapshotIdentity: { version: 5, hash: "abc123" }
  decisionSnapshotIdentity: { version: 4, hash: "def456" }

Migrated to:
  currentObservation: {
    kind: 'current',
    occurrence: {
      occurrenceId: { occurrenceId: 'LEGACY_v5', timestamp: 0 },
      outcome: 'complete',
      observationContent: {
        contractVersion: 'v1',
        contentHash: 'abc123'
      },
      structuralEvidence: {
        contractVersion: 'v1',
        completenessScope: 'complete',
        structuralIdentity: { structuralHash: 'UNKNOWN' }
      }
    }
  }
  decisionProvenance: LEGACY_UNAVAILABLE  // NOT a fake provenance!
```

**Key points:**
- `occurrenceId` marked as `'LEGACY_v5'` (not a real occurrence locator)
- `structuralIdentity.structuralHash` marked as `'UNKNOWN'` (not fabricated)
- `decisionProvenance` = `LEGACY_UNAVAILABLE` (not a fake provenance object)

**Behavioral consequence:**
```text
Before any observation-dependent action:
  if (decisionProvenance === LEGACY_UNAVAILABLE) {
    // Cannot validate against legacy provenance
    // MUST invalidate observation-dependent continuation
    // Acquire fresh authoritative observation
    // Issue NEW model request bound to that observation
    // Produce NEW decision provenance from that request
    // Then proceed with action validation
  }
```

**P0-R2-1 — Legacy Decision Reacquisition:**
Fresh observation is a reacquisition boundary, not a mechanism for retroactively legitimizing an old decision. Unknown/LEGACY_UNAVAILABLE decision provenance MUST invalidate observation-dependent continuation. A fresh observation MUST be followed by a fresh request-bound model decision. Old decision provenance MUST NOT be synthesized, rebound, adopted, or retroactively validated.

**Rationale:** Fabricating provenance from content identity alone violates the core semantic that content equality ≠ occurrence equality. This would reintroduce the exact bug P2-E was designed to prevent.

### 5.4 Session-Pinned Feature Semantics (Rule 3 Enforcement)

**CRITICAL CONSTRAINT:** Feature flag activation is pinned at session start.

**Session initialization:**
```text
session starts
    ↓
read feature flag P2E_IDENTITY_SEMANTICS
    ↓
pin identity semantics mode: LEGACY or P2E
    ↓
store in session context: sessionIdentitySemantics: 'LEGACY' | 'P2E'
    ↓
entire session uses this mode for all correctness decisions
```

**P0-R2-2 — Persistent Session Semantics:**
Identity semantics mode is immutable for the lifetime of a session and MUST survive worker/process restart. The mode MUST be either persisted as immutable session/workflow metadata, or deterministically recoverable from immutable persisted session creation metadata. Global feature-flag changes affect new sessions only. Rollback MUST drain/cancel/replan existing P2E sessions at an explicit boundary; it MUST NOT cause an existing decision or session to cross correctness authorities.

**Worker/process restart:**
```text
worker restarts
    ↓
load session from durable storage
    ↓
read sessionIdentitySemantics from session state (NOT from global flag)
    ↓
session continues with pinned mode
```

**No mid-session switch:**
```text
// FORBIDDEN
if (session.startedUnder === 'LEGACY' && flag.changed()) {
  session.switchTo('P2E');  // NEVER DO THIS
}
```

**Rollback boundary:**
```text
Rollback from P2E to LEGACY:
  1. Disable P2E for NEW sessions (set global flag to LEGACY)
  2. Existing P2E sessions remain P2E
     - Continue using persisted sessionIdentitySemantics: 'P2E'
     - Not affected by global flag change
  3. Drain/cancel/replan existing P2E sessions at explicit boundary
     - User-initiated session restart
     - Natural session completion
     - Explicit replan action
  4. New sessions created after rollback start as LEGACY
```

Cannot rollback mid-session. Existing P2E sessions must drain/transition cleanly. Must not cause an existing decision or session to cross correctness authorities.

### 5.5 Persisted state handling

**Challenge:** Existing sessions have WorkflowContext with old field structure

**Approach:**
1. On session load, detect old field structure
2. Apply legacy provenance non-fabrication migration (Section 5.3)
3. Set `sessionIdentitySemantics: 'LEGACY'` (pinned)
4. Continue session with LEGACY semantics
5. New sessions with flag ON start with `sessionIdentitySemantics: 'P2E'`

**Rollback safety:**
- Old fields preserved during Phase 1a-1c
- If rollback needed, old code can still read old fields
- After Phase 1d, rollback requires data migration script
- Session-pinned semantics prevent mid-session rollback issues

### 5.6 Replay and old session compatibility

**Challenge:** Old sessions may have different normalization semantics

**Approach:**
1. Store `observationContractVersion` and `structuralContractVersion` with each occurrence
2. Comparison functions check contract versions first
3. Different contract versions → NOT COMPARABLE (reason: contract)
4. Old sessions continue with their contract version
5. New sessions start with new contract version
6. Cross-version comparison explicitly NOT COMPARABLE

---

## 6. Implementation Task Graph

```
I1: Identity Type Definitions
  ├─ Define ObservationContentIdentity, ObservationOccurrenceIdentity
  ├─ Define StructuralIdentity, StructuralEvidence
  ├─ Define DecisionSnapshotProvenance
  ├─ Define ObservationOutcome, CurrentObservationState
  ├─ Define IdentityComparison (three-valued with reasons)
  └─ Update WorkflowContext with new fields (alongside old)

I2: Observation Content Projection
  ├─ Create observation normalization function (field-aware)
  ├─ Define observation envelope structure
  ├─ Implement observation content hash computation
  └─ Add contract version tracking

I3: Structural Projection
  ├─ Refactor extractSurfaceSignature → buildStructuralEvidence
  ├─ Add field-aware semantic classification
  ├─ Add completeness scope tracking
  ├─ Implement structural hash computation
  └─ Add structural contract version tracking

I4: Observation Occurrence Lifecycle
  ├─ Implement occurrence ID generation
  ├─ Implement atomic ingestion (all-or-nothing)
  ├─ Implement typed outcome classification
  ├─ Implement CurrentObservationState transitions
  └─ Update workflow context update functions

I5: Structural Evidence Comparison
  ├─ Implement three-valued comparison function
  ├─ Implement contract compatibility check
  ├─ Implement scope compatibility check
  ├─ Add incomparability reason tracking
  └─ Implement outcome-independence invariant

I6: Decision Provenance
  ├─ Refactor decision boundary capture
  ├─ Capture exact occurrence ID (not just identity)
  ├─ Capture observation content identity
  ├─ Update ALIGN diagnostics to use provenance
  └─ Implement multi-tool revalidation logic

I7: Current Observation Lifecycle
  ├─ Implement state invalidation on state-changing actions
  ├─ Implement immediate pre-execution validation
  ├─ Implement authoritative current-observation updates
  └─ Implement unavailable state handling

I8: Migration and Compatibility
  ├─ Implement session state migration (old → new)
  ├─ Implement dual-read phase logic
  ├─ Implement fallback to old fields
  └─ Add migration tests

I9: Cleanup
  ├─ Remove old fields after migration complete
  ├─ Update persistence schema
  └─ Remove dual-read logic

Dependencies:
  I1 → I2, I3, I4, I5, I6, I7
  I2, I3 → I4
  I4 → I5, I6, I7
  I5, I6, I7 → I8
  I8 → I9
```

---

## 7. Conformance Test Matrix

### 7.1 Mandatory Conformance Cases (Rule 5 Enforcement)

**CRITICAL CONSTRAINT:** These 14 test cases are implementation gates, not final验收 checklist. Each case MUST be implemented and passing before the corresponding implementation task can be considered complete.

| Case ID | Test Scenario | Expected Result | Implementation Gate For |
|---------|---------------|-----------------|------------------------|
| **C1** | Same raw/model-visible content observed twice (Oₙ, Oₙ₊₁) | content SAME, occurrence DIFFERENT | I4 (Occurrence Lifecycle) |
| **C2** | Ref e37 → e42 (action target changed) | structural may be SAME, occurrence DIFFERENT, stale decision still detected | I4, I6 (Provenance) |
| **C3** | Decision bound to Oₙ, current = Oₙ₊₁ | observation-dependent action cannot execute as aligned | I6, I7 (Validation) |
| **C4** | Structural hash equal, scope incompatible | NOT COMPARABLE (reason: evidence/scope) | I5 (Comparison) |
| **C5** | Structural contract differs | NOT COMPARABLE (reason: contract) | I5 (Comparison) |
| **C6** | Complete text-only non-empty → successful empty | observation DIFFERENT, structural determined only from projections (may be SAME) | I3, I5 (Structural) |
| **C7** | Complete actionable → empty | structural DIFFERENT | I3, I5 (Structural) |
| **C8** | Failed acquisition ≠ successful empty | Different outcome types, different lifecycle transitions | I4 (Lifecycle) |
| **C9** | Unavailable ≠ successful empty | Different outcome types, different lifecycle transitions | I4 (Lifecycle) |
| **C10** | Accepted partial observation | Unique occurrence, StructuralEvidence contains completeness scope | I3, I4 (Structural+Lifecycle) |
| **C11** | State-changing A1 invalidates current, A2 from same response | A2 revalidates before execution against new current | I7 (Multi-tool) |
| **C12** | A1 produces Oₙ₊₁ whose content hash equals Oₙ | A2 still sees occurrence skew (content SAME ≠ occurrence SAME) | I4, I7 (Occurrence≠Content) |
| **C13** | Legacy persisted state without exact provenance | Cannot fabricate provenance, fresh authoritative observation required | I8 (Migration) |
| **C14** | Feature-mode switch / rollback | No decision created under one authority validated under another | I8 (Migration) |

### 7.2 Test Case Implementation Requirements

**Each mandatory case MUST:**

1. **Be executable as an automated test** (not manual verification)
2. **Run in CI/CD pipeline** (not ad-hoc testing)
3. **Pass before implementation task marked complete** (not deferred to end)
4. **Have clear pass/fail criteria** (not subjective assessment)
5. **Cover the specific invariant** (not just related behavior)

**Example: C12 Implementation**

```typescript
test('C12: content SAME ≠ occurrence SAME', async () => {
  // Setup: initial observation Oₙ
  const initial = await takeObservation();
  const O_n = initial.occurrence;
  
  // Action: tool execution that produces new observation Oₙ₊₁
  // with identical content (e.g., no-op action)
  await executeAction();
  const afterAction = await takeObservation();
  const O_n_plus_1 = afterAction.occurrence;
  
  // Verify: content identity is SAME
  expect(compareObservationContent(O_n, O_n_plus_1)).toEqual({ result: 'SAME' });
  
  // Verify: occurrence identity is DIFFERENT
  expect(O_n.occurrenceId.occurrenceId).not.toEqual(O_n_plus_1.occurrenceId.occurrenceId);
  
  // Verify: decision provenance from Oₙ is skewed against Oₙ₊₁
  const decisionBoundToOn = createDecisionProvenance(O_n);
  const validationResult = validateAction(decisionBoundToOn, O_n_plus_1);
  
  expect(validationResult.isAligned).toBe(false);
  expect(validationResult.reason).toContain('occurrence skew');
});
```

**Example: C13 Implementation**

```typescript
test('C13: legacy state cannot fabricate provenance', async () => {
  // Setup: load legacy session state
  const legacyState = {
    currentSnapshotIdentity: { version: 5, hash: 'abc123' },
    decisionSnapshotIdentity: { version: 4, hash: 'def456' }
  };
  
  // Migrate to new structure
  const migrated = migrateLegacyState(legacyState);
  
  // Verify: decision provenance is LEGACY_UNAVAILABLE
  expect(migrated.decisionProvenance).toEqual('LEGACY_UNAVAILABLE');
  
  // Verify: cannot validate action against legacy provenance
  const action = createAction();
  const validationResult = validateAction(migrated.decisionProvenance, migrated.currentObservation);
  
  expect(validationResult.isAligned).toBe(false);
  expect(validationResult.reason).toContain('legacy provenance unavailable');
  
  // Verify: must obtain fresh observation before proceeding
  const freshObservation = await takeObservation();
  const freshProvenance = createDecisionProvenance(freshObservation.occurrence);
  const freshValidation = validateAction(freshProvenance, migrated.currentObservation);
  
  // Now validation can proceed (though may still fail for other reasons)
  expect(freshValidation.reason).not.toContain('legacy provenance unavailable');
});
```

### 7.3 Test Sequencing and Dependencies

**Test cases must be implemented in dependency order:**

```text
Phase 1a (Types):
  - C1 (content vs occurrence identity)
  
Phase 1b (Structural):
  - C4 (scope incomparability)
  - C5 (contract incomparability)
  - C6, C7 (outcome-independence)
  
Phase 1c (Lifecycle):
  - C8, C9 (typed outcomes)
  - C10 (partial observation)
  - C11 (multi-tool revalidation)
  - C12 (occurrence ≠ content)
  
Phase 1d (Provenance + Migration):
  - C2 (ref drift detection)
  - C3 (provenance skew)
  - C13 (legacy non-fabrication)
  - C14 (session-pinned semantics)
```

**No implementation task can be marked complete until its associated test cases pass.**

### 7.4 Legacy Domain Separation Tests

| Test Case | Expected Result |
|-----------|-----------------|
| Same raw snapshot → observation projection | Observation content identity SAME |
| Same raw snapshot → structural projection | Structural identity SAME |
| Observation SAME, structural SAME | Occurrence DIFFERENT (new occurrence created) |
| Observation SAME, structural DIFFERENT | Valid (different projections) |
| Observation DIFFERENT, structural SAME | Valid (different projections) |

### 7.5 Observation Occurrence Identity Tests

| Test Case | Expected Result |
|-----------|-----------------|
| Two observations with same content | Occurrence IDs DIFFERENT |
| Two observations with different content | Occurrence IDs DIFFERENT |
| Decision bound to occurrence A, current is occurrence B | Provenance skew detected |

### 7.6 Structural Outcome-Independence Tests

| Test Case | Expected Result |
|-----------|-----------------|
| Complete non-empty → successful empty, no structural content before or after | Structural SAME |
| Complete non-empty → successful empty, structural content before | Structural DIFFERENT |
| Partial observation → partial observation, different scopes | Structural NOT COMPARABLE (evidence/scope) |
| Same structural hash, different completeness scope | Structural NOT COMPARABLE (evidence/scope) |

### 7.7 Three-Valued Comparison Tests

| Test Case | Expected Result |
|-----------|-----------------|
| Same domain, same contract, equal content | SAME |
| Same domain, same contract, unequal content | DIFFERENT |
| Same domain, different contract | NOT COMPARABLE (reason: contract) |
| Different domain | NOT COMPARABLE (reason: contract) |
| Same contract, different completeness scope | NOT COMPARABLE (reason: evidence/scope) |

### 7.8 Current Observation Lifecycle Tests

| Test Case | Expected Result |
|-----------|-----------------|
| Successful complete observation | Current transitions to new occurrence |
| Successful empty observation | Current transitions to new occurrence |
| Accepted partial observation | Current transitions to new occurrence |
| Failed acquisition (no state change) | Current retained |
| Failed acquisition (after state change) | Current → unavailable |
| State-changing action executed | Current → unavailable until next observation |
| Multi-tool response with state change | Subsequent tools revalidate against new current |

### 7.9 Decision Provenance Correctness Tests

| Test Case | Expected Result |
|-----------|-----------------|
| Decision bound to Oₙ, current is Oₙ | Provenance aligned |
| Decision bound to Oₙ, current is Oₙ₊₁ (content SAME) | Provenance skewed (occurrence DIFFERENT) |
| Decision bound to Oₙ, current unavailable | Action blocked |
| ALIGN with structural SAME but occurrence DIFFERENT | Skew detected, not suppressed |

### 7.10 Migration and Compatibility Tests

| Test Case | Expected Result |
|-----------|-----------------|
| Load session with old field structure | Migration successful, legacy markers set |
| Load session with new field structure | No migration needed |
| Compare old contract version vs new contract version | NOT COMPARABLE (reason: contract) |
| Rollback to old code during Phase 1a-1c | Old fields still readable |

---

## 8. Compatibility Constraints

### 8.1 Phase 1 closure preservation

**Constraint:** P2-A–P2-D closure code MUST NOT be modified without new regression evidence

**Implications:**
- ESM crypto import in `computeSnapshotHash` preserved
- TEST initialization routing through `updateWorkflowContext` preserved
- `decisionSnapshotIdentity` persistence preserved (migrated to provenance)
- AgentLoop lifecycle tests preserved (extended, not replaced)

### 8.2 Existing test compatibility

**Constraint:** All existing tests must continue to pass during migration

**Implications:**
- Dual-read phase ensures old tests work with old fields
- New tests added for new semantics
- Old tests gradually migrated to new fields
- No test deleted without replacement

### 8.3 Persistence backward compatibility

**Constraint:** Existing persisted sessions must be loadable

**Implications:**
- Migration logic on session load
- Old field values converted to new structure
- Contract version defaults to "v1" for old sessions
- Completeness scope defaults to "complete" for old sessions

---

## 9. Rollout Strategy

### 9.1 Feature flag approach

**Recommended:** Use feature flag `P2E_IDENTITY_SEMANTICS`

**Phases:**
1. **Phase 1a:** Flag OFF
   - New fields added but not used
   - Old code path active
   
2. **Phase 1b:** Flag ON (new sessions only)
   - New sessions use new semantics
   - Old sessions continue with old semantics
   
3. **Phase 1c:** Flag ON (all sessions)
   - All sessions migrated to new semantics
   - Old fields still written for rollback safety
   
4. **Phase 1d:** Flag removed
   - Old fields removed
   - Migration complete

### 9.2 Telemetry and diagnostics

**New telemetry to add:**
- Observation occurrence ID generation count
- Structural evidence comparison results (SAME/DIFFERENT/NOT COMPARABLE)
- Incomparability reasons (contract vs evidence/scope)
- Decision provenance alignment/skew events
- Multi-tool revalidation events
- State invalidation events

**Diagnostic enhancements:**
- ALIGN logs include occurrence IDs (not just content hashes)
- Comparison logs include incomparability reasons
- Lifecycle state transition logs

### 9.3 Rollback plan

**Rollback triggers:**
- Critical bug in new identity logic
- Performance regression > 10%
- Data corruption in persisted sessions

**Rollback procedure:**
1. Set feature flag OFF
2. New sessions use old semantics
3. Old sessions continue with old semantics
4. If during Phase 1d (old fields removed):
   - Run migration script to restore old fields
   - Set feature flag OFF
   - Restart sessions

**Rollback safety:**
- Phase 1a-1c: Old fields preserved, safe rollback
- Phase 1d: Requires data migration script
- No data loss in any phase

---

## 10. Rollback Strategy

### 10.1 Rollback scenarios

| Phase | Rollback Complexity | Data Migration Required |
|-------|---------------------|-------------------------|
| Phase 1a | None | No (old fields still present) |
| Phase 1b | Low | No (old sessions untouched) |
| Phase 1c | Medium | Maybe (if old fields removed early) |
| Phase 1d | High | Yes (restore old fields) |

### 10.2 Rollback procedure

**Phase 1a-1c rollback:**
1. Set feature flag OFF
2. Restart affected sessions
3. Old code reads old fields (still present)
4. No data migration needed

**Phase 1d rollback:**
1. Stop all sessions
2. Run migration script to restore old fields:
   - `occurrenceId` → `version` (strip "v" prefix)
   - `observationContent.contentHash` → `hash`
   - `outcome` → (implicit non-empty for non-null identities)
3. Set feature flag OFF
4. Restart sessions
5. Old code reads old fields

### 10.3 Rollback validation

**Checks after rollback:**
- Old tests pass
- Sessions load successfully
- No data corruption
- Alignment diagnostics work (with old format)

---

## 11. Acceptance Gates

### 11.1 Phase 1a acceptance

- [ ] New type definitions compile
- [ ] New fields added to WorkflowContext
- [ ] Old fields still present
- [ ] All existing tests pass
- [ ] No behavioral changes

### 11.2 Phase 1b acceptance

- [ ] New sessions use new semantics
- [ ] Old sessions continue with old semantics
- [ ] Feature flag works
- [ ] All existing tests pass
- [ ] New conformance tests added

### 11.3 Phase 1c acceptance

- [ ] All sessions use new semantics
- [ ] Old fields still written
- [ ] Migration logic works
- [ ] All conformance tests pass
- [ ] Telemetry shows correct behavior

### 11.4 Phase 1d acceptance

- [ ] Old fields removed
- [ ] Persistence schema updated
- [ ] All sessions use new semantics
- [ ] All conformance tests pass
- [ ] Rollback procedure tested
- [ ] Documentation updated

---

## 12. Out-of-Scope Items

The following are explicitly out of scope for this implementation:

1. **P2-F Repository Hygiene** — separate milestone
2. **P3–P10 system risks** — separate milestones
3. **Changes to P2-A–P2-D closure code** — only if new regression evidence appears
4. **Changes to coverage model, intent model, or action resolution algorithms** — preserve existing behavior
5. **Changes to non-identity-related workflow logic** — preserve existing behavior
6. **Adapter API changes** — lifecycle participation semantics defined, adapter mechanics deferred
7. **Changes to logging format beyond identity-related diagnostics** — preserve existing logs

---

## 13. Risk Assessment

### 13.1 High risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Migration corrupts persisted sessions | Sessions fail to load | Test migration thoroughly; preserve old fields during Phase 1a-1c |
| Feature flag logic introduces bugs | New/old sessions behave incorrectly | Test feature flag thoroughly; rollback procedure ready |
| Multi-tool revalidation breaks existing behavior | Actions incorrectly blocked | Test multi-tool scenarios extensively; feature flag allows gradual rollout |
| Structural outcome-independence changes verdicts | Alignment diagnostics change | Test all matrix cases; compare old vs new verdicts |

### 13.2 Medium risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Performance regression from new fields | Slower session execution | Profile before/after; optimize hot paths |
| Contract version mismatch causes NOT COMPARABLE | Cross-version comparison fails | Test contract version logic; provide migration path |
| Completeness scope logic too complex | Bugs in partial observation handling | Test partial observation scenarios; simplify if needed |

### 13.3 Low risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| New telemetry adds overhead | Slightly slower logging | Profile telemetry impact; optimize if needed |
| Documentation drift | Developers confused | Update docs with each phase; review before Phase 1d |

---

## 14. Success Criteria

### 14.1 Functional success

- [ ] All conformance tests pass
- [ ] Existing tests continue to pass
- [ ] Feature flag works correctly
- [ ] Migration works for old sessions
- [ ] Rollback works in all phases
- [ ] Telemetry shows correct behavior

### 14.2 Non-functional success

- [ ] No performance regression > 5%
- [ ] No increase in memory usage > 10%
- [ ] No increase in log volume > 20%
- [ ] Code coverage maintained or improved

### 14.3 Quality success

- [ ] No critical bugs in production
- [ ] No data corruption
- [ ] Smooth rollout with feature flag
- [ ] Clear diagnostic improvements

---

## 15. Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1a: Type definitions | 1-2 days | None |
| Phase 1b: Dual-read implementation | 2-3 days | Phase 1a |
| Phase 1c: Consumer migration | 3-4 days | Phase 1b |
| Phase 1d: Cleanup | 1-2 days | Phase 1c |
| **Total** | **7-11 days** | |

**Note:** Estimates assume one developer. Parallel work possible if multiple developers available.

---

## 16. Approval Required

This implementation plan requires explicit approval before entering Phase 1 (code changes authorized).

**Approval gates:**

- [ ] Scope is clear and matches approved design
- [ ] Gap mapping is complete and accurate
- [ ] Target data model is sound and enforces type separation (Rule 4)
- [ ] Migration strategy prevents provenance fabrication (Rule 1)
- [ ] Migration strategy enforces single correctness authority (Rule 2)
- [ ] Rollout strategy enforces session-pinned semantics (Rule 3)
- [ ] Rollback strategy has safe transition boundaries
- [ ] Task graph has clear dependencies
- [ ] Mandatory conformance cases C1-C14 are specified (Rule 5)
- [ ] Conformance test matrix covers all approved invariants
- [ ] Compatibility constraints are respected
- [ ] Acceptance gates are clear
- [ ] Out-of-scope items are excluded
- [ ] Risks are identified and mitigated

**Mandatory correctness rules:**

1. **Rule 1: Legacy Provenance Non-Fabrication** - Old `{version, hash}` state cannot be migrated into exact provenance
2. **Rule 2: Single Correctness Authority** - At every correctness-critical boundary, exactly one identity semantics is authoritative
3. **Rule 3: Session-Pinned Feature Semantics** - Feature flag activation is pinned at session start
4. **Rule 4: Type Separation** - Identity / evidence / provenance / state must be clearly separated
5. **Rule 5: Mandatory Conformance Cases** - C1-C14 are implementation gates, not final verification

**Approver:** User (2026-09-09)

---

**Status:** Phase 0 APPROVED / Phase 1a AUTHORIZED  
**Current phase:** Phase 1a — code changes authorized  
**Authorized scope:** I1-I5 (types, projections, lifecycle, comparison) + C1-C14 conformance tests  
**Next phase:** Phase 1b (I6-I8: provenance, migration, compatibility)  
**Not authorized:** I9 cleanup, rollout activation, P2-F, P3+
