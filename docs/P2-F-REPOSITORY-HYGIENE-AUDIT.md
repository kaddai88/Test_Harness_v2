# P2-F Phase 0 — Repository Hygiene Audit

> **Status:** Audit complete / approval required  
> **Scope:** read-only inventory, ownership classification, sensitive-content triage, and `.gitignore` gap analysis. No deletion or ignore-rule change was authorized or performed.

## 1. Inventory snapshot

Current working tree includes pre-existing code changes from the completed P2-E/I9-A-R1 work, unrelated runtime state changes, and generated artifacts. This audit does not reclassify or modify those changes.

| Category | Path(s) | Git state | Observed size / scope | Initial ownership |
|---|---|---|---|---|
| Persistent JSON database | `data/testharness.json` | tracked + modified | ~6.1 MB; 135 sessions, 19 reports, 2 sites | C candidate; ownership decision required because tracked |
| Server persistent JSON database | `apps/server/th-server/data/testharness.json` | tracked + modified | ~2.7 MB; 25 sessions, 1 report, 2 sites | C candidate; ownership decision required because tracked |
| Cognition runtime state | `.cognition/*.json` | untracked | 6 files, ~592 KB | C/D candidate; generated local state |
| Site-profile runtime state | `.site-profiles/*.json` | untracked | 2 files, 274 bytes | C/D candidate; generated local state |
| Server site-profile runtime state | `apps/server/th-server/.site-profiles/*.json` | untracked | 1 file, 155 bytes | C/D candidate; generated local state |
| Playwright MCP state | `.playwright-mcp/` | mostly untracked/ignored directory; one PNG tracked | 1,526 files, ~33.0 MB | D/E candidate; debug/session artifacts |
| Root screenshots | `screenshot.png` | tracked | 148,960 bytes | E candidate; generated visual artifact |
| Playwright screenshot | `.playwright-mcp/page-2026-08-31T06-13-44-170Z.png` | tracked | 419,398 bytes | E candidate; generated visual artifact |
| Additional root screenshots | `program_*.png`, `program-*.png` | untracked | multiple generated images | E candidate; generated visual artifacts |
| Runtime/program browse notes | `program-browse.md`, `program-list.md` | untracked | generated inspection notes | D/E candidate |
| Tracked program inspection docs | `program-list-full.md`, `program-list-before-delete.md` | tracked; `program-list-full.md` modified | generated/inspection content | D/E candidate; review whether intentional evidence |
| I9/P2-E docs and tests | `docs/*`, `packages/agent/th-agent/src/*` | tracked/untracked depending file | source/design/test artifacts | A; outside P2-F mutation scope |

The tracked file inventory also shows `I7-B-R2-COMPLETION-REPORT.md` and other project documentation; these are source/history documentation, not runtime state by filename alone and require no automatic ignore rule.

## 2. Ownership classification

### A — Source / must track

- Application and package source under `apps/*/src` and `packages/*/src`.
- Hand-authored architecture, API, contributor, and implementation documentation under `docs/` and root README files.
- `.env.example` (template; must remain trackable).
- `package.json`, lockfiles, workspace/config files, CI definitions, Docker files, and `.gitignore`.
- `program-list-before-delete.md` and similar files only if the team confirms they are intentional human-maintained evidence rather than generated captures; filename alone is insufficient.

### B — Test fixture or seed / must track

- Deliberately curated test fixtures, seed data, deterministic snapshots, and test-only input files.
- No currently inventoried runtime JSON or screenshot is proven B solely from its current location/content. The tracked databases contain live session/report history and require an explicit fixture decision before retention.
- A fixture must be deterministic, documented as fixture/seed data, and not contain credentials, user-specific secrets, or accidental activity history.

### C — Generated runtime state / should ignore

- `data/testharness.json` and `apps/server/th-server/data/testharness.json` appear to be live persistence outputs: their top-level schema is the application database and their current modifications are large runtime deltas.
- `.cognition/*.json` are generated cognition state files (`episodes`, `patterns`, `q-values`, `recovery`, `semantic`, `strategies`).
- `.site-profiles/*.json` and `apps/server/th-server/.site-profiles/*.json` are generated site-profile/runtime cache state.
- These should normally be excluded from source commits, while curated seed/fixture replacements belong in B under separate paths.

### D — Local developer/debug state / should ignore

- `.playwright-mcp/` console/page/session capture files and local browser debugging state.
- `program-browse.md`, `program-list.md`, and generated inspection notes when they are local captures rather than reviewed documentation.
- Local debug traces, temporary session dumps, and developer-specific state not required to reproduce tests.

### E — Sensitive/generated artifact / ignore + retention/redaction policy

- Tracked or untracked screenshots and browser/page captures, including `screenshot.png`, the tracked `.playwright-mcp` PNG, and generated program screenshots, unless explicitly promoted to reviewed product documentation.
- `.playwright-mcp` logs/page captures that contain model prompts, URLs, form values, headers, or browser output; these require retention limits and redaction review before sharing.
- Any runtime database or debug capture containing credentials, tokens, credential-bearing URLs, or sensitive user/session data must be treated as E even if its broader file class is C/D.

E means “ignore plus retention/redaction policy”; it does not authorize deletion in this phase.

## 3. Sensitive-content scan results

The scan was deliberately non-disclosing: it reports paths and marker classes, not secret values.

- `.env.backup`: not in the current tracked inventory, not found in local reachable Git history during the prior security check, and now ignored by the exact `.env.backup` rule. The previously exposed DashScope key remains compromised and must stay revoked/rotated.
- No `sk-sp-` marker was found in the runtime artifact scan.
- `data/testharness.json` contains credential-bearing URL / key-assignment-shaped markers. This needs manual redaction review before any commit or sharing; the scan cannot establish from the marker alone whether values are real credentials.
- `apps/server/th-server/data/testharness.json` contains key-assignment-shaped markers and also needs manual redaction review.
- Multiple `.playwright-mcp` console logs contain key-assignment-shaped markers. Because these are browser/debug captures, classify them E pending redaction/retention review.
- No conclusion is made from generic words such as `token` in source/config documentation; marker classification requires value/context review without exposing values.

## 4. `.gitignore` gap analysis (no edits made)

Current relevant rules:

```text
.env
.env.local
.env.*.local
.env.backup
*.log
.playwright-mcp/
```

What is covered:

- `.env` and `.env.local` are ignored.
- `.env.backup` is ignored exactly.
- `.playwright-mcp/` is ignored for future untracked files.
- Logs are ignored by `*.log`.

Gaps requiring approval before changes:

1. `.cognition/` is not currently ignored.
2. `.site-profiles/` is not currently ignored.
3. `apps/server/th-server/.site-profiles/` is not currently ignored.
4. Root generated screenshots are not currently ignored; `screenshot.png` is already tracked and therefore ignore rules would not remove it from the index.
5. `program-*.md` / `program_*.png` patterns would be too broad without confirming whether any are curated documentation or fixtures.
6. Tracked runtime JSON requires an ownership decision before any `git rm --cached`, deletion, or relocation.
7. Existing `.playwright-mcp/` tracked files are unaffected by adding an ignore rule; untracking is a separate authorized operation.
8. `.env.*` must not be used as a blanket rule because it would hide `.env.example` and other potentially intentional templates.

## 5. Fixture/runtime boundary recommendation

Do not use live runtime paths as fixtures. If reproducible seed data is required:

```text
fixtures/ or test/fixtures/  → curated, deterministic, sanitized, must track
seed/                         → intentional bootstrap data, sanitized, must track
data/                         → runtime persistence, should ignore after ownership approval
.cognition/                   → local generated cognition state, should ignore
.site-profiles/               → local generated/cache state, should ignore
artifacts/screenshots/        → generated debug/evidence output, E policy
```

This is a classification recommendation only; no directory move or ignore change is authorized in Phase 0.

## 6. Decisions required before Phase 1

1. Confirm whether either tracked `testharness.json` is a deliberate seed/fixture (B) or live runtime database (C). Current evidence favors C.
2. Confirm whether tracked `screenshot.png` and tracked `.playwright-mcp` PNG are intentionally reviewed documentation (A/B) or generated artifacts (E). Current evidence favors E.
3. Approve exact ignore rules for confirmed C/D/E paths, preserving `.env.example`.
4. Decide retention/redaction policy for browser captures and runtime JSON before untracking or deleting anything.
5. If runtime JSON is retained locally but removed from source history, decide whether a sanitized fixture replacement is needed under B.
6. Confirm the intended durable persistence path for development and server operation; this audit does not redesign persistence.

## 7. Phase 0 acceptance and stopping condition

- [x] Git status and tracked inventory captured.
- [x] Runtime artifact directories discovered and summarized.
- [x] A–E ownership classification produced.
- [x] Sensitive-content scan performed without echoing values.
- [x] `.gitignore` gaps documented without edits.
- [x] P2-F scope kept separate from persistence redesign and P3+ work.
- [x] No deletion, untracking, ignore-rule edit, history rewrite, or source-code change performed.

**Phase 0 status:** Audit complete / awaiting ownership decisions.  
**Next authorized action:** After review, approve a narrowly scoped Phase 1 hygiene change set.  
**Not authorized:** deletion, `git rm --cached`, `.gitignore` edits, history rewrite, persistence redesign, P3+.
