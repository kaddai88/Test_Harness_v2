# P6 Phase 2-F Rehearsal Evidence

Status: `PONR EXCEPTION-PATH CORRECTIVE PATCH APPLIED / RE-REVIEW PENDING / REAL-DATA REHEARSAL BLOCKED / OPERATOR RESOLUTION REVIEW PAUSED`

This record covers authorization 1 only. It does not authorize or claim a live
restore, freeze, import, writer activation, traffic release, cutover, or Phase
2-G work.

## Designated target

```text
runtime provider        -> JSON
runtime working dir     -> repository root
datastore               -> data/testharness.json
legacy Cognition root   -> .cognition
legacy SiteProfile root -> .site-profiles
```

The historical alternate-CWD datastore under `apps/server/th-server/data` is
not part of this target and was not merged into the rehearsal seed.

## Tooling validation

Focused isolated-fixture tests cover:

```text
live/clone path overlap rejection                  -> PASS
manifest-bound live-source isolation              -> PASS
snapshot identity/clone marker binding            -> PASS
source-before / copy / source-after hash equality  -> PASS
two independent exact restores                     -> PASS
canonical datastore semantic hash restoration     -> PASS
pattern-matcher patterns.json import exclusion     -> PASS
evidence-only control-state rollback preservation  -> PASS
orphan SiteProfile scope fail-closed               -> PASS
SiteProfile-first success-path import              -> PASS (fixture clone)
import replay semantic diff                        -> EMPTY (fixture clone)
import authorization revocation                    -> PASS (fixture clone)
provider reload/read                               -> PASS (fixture clone)
projection preparation authority diff              -> EMPTY (fixture clone)
idempotent authority replay / payload conflict     -> PASS (fixture clone)
accepted first mutation enters LIVE_POST_PONR       -> PASS (fixture clone)
ambiguous first mutation completion is post-PONR    -> PASS (fixture clone)
ambiguous PONR has no fabricated acceptedAt         -> PASS (fixture clone)
ambiguous PONR cannot select pre-PONR rollback      -> PASS (fixture clone)
pre-PONR raw + semantic exact rollback             -> PASS (fixture clone)
site-scoped Cognition import idempotency            -> PASS (fixture clone)
legacy clone input mutation                        -> ZERO (fixture clone)
```

Synthetic fixture evidence validates the tooling but does not replace the
mandatory rehearsal against clones of the designated real target.

```text
2-F focused tests       -> 10/10 PASS
persistence full suite  -> 91/91 PASS
typecheck               -> PASS
build                   -> PASS
tracked/untracked whitespace scan -> PASS
```

## Read-only real snapshot

The designated sources were copied read-only into the ignored
`.p6-rehearsal/2026-09-18-root-json-v5` evidence directory. The accepted
snapshot contains nine files: one datastore, six Cognition files, and two
SiteProfile files.

```text
all source-before/copy/source-after SHA-256 values -> MATCH
source inventories before/after copy               -> MATCH
raw source writes                                   -> ZERO
restored isolated clone count                       -> 2
raw restore hashes                                  -> EXACT / EXACT
datastore semantic SHA-256                          -> 059616b2a55a4bafc917038746d340ede2645262861e5f1409a814125b2a37fb
restored semantic hashes                            -> EXACT / EXACT
live datastore raw SHA-256                          -> b41324284cab0c1fae86a1ae50cf3a14b7fe5668b7d85d0ada165dae902c504e
```

The generated snapshot manifest and `preflight-evidence.json` remain under
the ignored evidence directory. They contain the per-file inventories and
the complete affected source-ID list.

Because preflight returned NO-GO, no release artifact, configuration, or
operator identity was promoted as the exact rehearsal identity. The CLI
requires all three identifiers before it will execute a GO rehearsal.

## Real-data preflight

```text
authority SiteProfiles            -> 2
legacy SiteProfile files          -> 2
SiteProfile rows requiring import -> 0
legacy Cognition learned rows     -> 914
proven Cognition import rows      -> 0
excluded control-state files      -> 4
preflight                         -> NO-GO
```

All 914 learned rows resolve to canonical origin `https://example.com`. The
authority datastore contains only `http://185.200.65.4:82` and
`https://www.baidu.com`; no approved SiteProfile/site identity exists for
`https://example.com`.

The excluded Cognition files are `patterns.json`, `q-values.json`,
`recovery.json`, and `strategies.json`. They were captured and hashed as
`evidence-only-control-state`; they are neither learned-entity import inputs
nor members of the semantic rollback restore set.

No SiteProfile was invented, no profile ID/name was inferred, no row was
discarded, and no Cognition row was mapped to another site. Preflight stopped
before either importer was called.

## Scope and hashes

After the real snapshot, two restores, and preflight:

```text
live JSON mutation                 -> NONE
legacy source mutation             -> NONE
real-clone SiteProfile import      -> NOT EXECUTED
real-clone Cognition import        -> NOT EXECUTED
real-clone writer activation/PONR  -> NOT EXECUTED
live cutover                       -> NOT AUTHORIZED / NOT EXECUTED
Phase 2-G                          -> NOT AUTHORIZED / NOT STARTED
```

The live datastore raw SHA-256 remains the closed A2 baseline
`b41324284cab0c1fae86a1ae50cf3a14b7fe5668b7d85d0ada165dae902c504e`.

## Gate state

```text
P6 Phase 2-F rehearsal/tooling
-> PONR EXCEPTION-PATH CORRECTIVE PATCH APPLIED
-> NARROW PONR RE-REVIEW PENDING
-> READ-ONLY SNAPSHOT / TWO ISOLATED RESTORES VERIFIED
-> FIXTURE SUCCESS + PRE-PONR ROLLBACK PATHS PASS
-> DESIGNATED REAL-DATA REHEARSAL BLOCKED AT MAPPING PREFLIGHT
-> OPERATOR RESOLUTION REVIEW REMAINS PAUSED

P6 Phase 2-F live cutover
-> NOT AUTHORIZED

P6 Phase 2-G
-> NOT AUTHORIZED
```

The PONR exception-path corrective patch requires narrow independent re-review
before operator resolution work resumes. After that review, an explicit
approved mapping must establish the SiteProfile identity for
`https://example.com`; the mapper must not create or select that identity
implicitly.
