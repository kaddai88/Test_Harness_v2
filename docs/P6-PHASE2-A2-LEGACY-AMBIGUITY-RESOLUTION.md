# P6 Phase 2-A2 Legacy Ambiguity Resolution Manifest

Status: `APPROVED / CLOSED`

This manifest records the read-only evidence review for every currently
ambiguous SiteProfile record in the two repository JSON data sources. It does
not execute a resolution, backfill, duplicate merge, or uniqueness enforcement.

## Review boundary

- Evidence inspected: SiteProfile rows and session `targetUrl` values only.
- A resolution is valid only when an operator explicitly supplies the final
  canonical origin and approval basis.
- No scheme, port, or `www` decision is inferred from convention.
- The existing JSON data files remain unchanged.

## Evidence summary

| Source data file | Legacy record | Legacy value | Evidence | Current status |
|---|---|---|---|---|
| `data/testharness.json` | `284abe06-8eb4-4d43-81be-fefd1bfaeaab` | `185.200.65.4` | 98 matching sessions use `http://185.200.65.4:82/...`; representative session `327d1581-796a-4304-9dc3-945a48ccee8d` | Approved as `http://185.200.65.4:82` |
| `data/testharness.json` | `44423011-1754-44b7-b714-f109ee30d6b0` | `baidu.com` | 19 matching sessions use `https://www.baidu.com`; representative session `e838dd20-ee67-4b45-90a2-f4a581d4c914` | Approved as `https://www.baidu.com` |
| `apps/server/th-server/data/testharness.json` | `52363079-93bc-4679-87e2-0f2efc7a1b80` | `185.200.65.4` | 24 matching sessions use `http://185.200.65.4:82/...`; representative session `30162171-0853-46ea-8ac4-589ad85017ce` | Approved as `http://185.200.65.4:82` |
| `apps/server/th-server/data/testharness.json` | `167f5ad2-2211-492b-8337-d1785c914168` | `baidu.com` | 1 matching session uses `https://www.baidu.com`; representative session `508da624-ff14-433a-9ee8-e68ea82e4b9d` | Approved as `https://www.baidu.com` |

## Explicit resolution input records

The following record-specific resolutions were explicitly approved by the
P6 Phase 2-A2 review gate. Generated candidates remain diagnostic evidence;
these values are operator decisions and must still pass the shared
canonical-origin normalizer.

```text
source_file: data/testharness.json
legacy_record: 284abe06-8eb4-4d43-81be-fefd1bfaeaab
legacy_value: 185.200.65.4
resolved_canonical_origin: http://185.200.65.4:82
basis: 98 historical sessions consistently reference http://185.200.65.4:82/...; non-default port :82 is preserved explicitly.
approved_by: P6 Phase 2-A2 review gate

source_file: data/testharness.json
legacy_record: 44423011-1754-44b7-b714-f109ee30d6b0
legacy_value: baidu.com
resolved_canonical_origin: https://www.baidu.com
basis: 19 historical sessions reference https://www.baidu.com; www is preserved explicitly rather than normalized away.
approved_by: P6 Phase 2-A2 review gate

source_file: apps/server/th-server/data/testharness.json
legacy_record: 52363079-93bc-4679-87e2-0f2efc7a1b80
legacy_value: 185.200.65.4
resolved_canonical_origin: http://185.200.65.4:82
basis: 24 historical sessions consistently reference http://185.200.65.4:82/...; non-default port :82 is preserved explicitly.
approved_by: P6 Phase 2-A2 review gate

source_file: apps/server/th-server/data/testharness.json
legacy_record: 167f5ad2-2211-492b-8337-d1785c914168
legacy_value: baidu.com
resolved_canonical_origin: https://www.baidu.com
basis: 1 historical session references https://www.baidu.com; www is preserved explicitly rather than normalized away.
approved_by: P6 Phase 2-A2 review gate
```

## Gate verdict

```text
2-A2 legacy ambiguity resolution gate
→ APPROVED / CLOSED — four record-specific operator resolutions supplied

Evidence found
→ yes
Final canonical origins approved
→ yes
Canonical backfill
→ EXECUTED — four SiteProfile rows backfilled
Uniqueness enforcement
→ JSON/in-memory guards active; SQL DDL implemented with no live SQL target discovered

Final Gate 2-A2 verdict
→ APPROVED / CLOSED
```

## Execution evidence

```text
read-only preflight
→ zero unresolved ambiguity
→ zero canonical collision

canonical backfill
→ data/testharness.json: 2 SiteProfile rows
→ apps/server/th-server/data/testharness.json: 2 SiteProfile rows

post-backfill semantic diff
→ exactly four canonicalOriginKey additions
→ no unrelated legacy JSON field changes

post-backfill duplicate verification
→ zero duplicates in each JSON datastore

JSON/in-memory canonical uniqueness guards
→ active and regression-tested

idempotent lookup/upsert replay-conflict behavior
→ PASS

PostgreSQL/SQLite unique-index DDL
→ implemented as the approved post-backfill schema
→ SQLite in-memory execution created all six indexes
→ SiteProfile and idempotency duplicate writes were rejected
→ no live PostgreSQL/SQLite datastore exists in this workspace to mutate

focused A2 regressions
→ 45/45 PASS

th-core / th-cognition / th-persistence typecheck
→ PASS

dependency build through th-persistence
→ PASS
```

Pre-backfill SHA-256:

```text
data/testharness.json
3C878C50D5E032C2DCE8BB598DC774D2F34558FD2F756F48459C6929A6390ABB

apps/server/th-server/data/testharness.json
893B59BB148C38610B9261A9A1E27C05010189FA151462B8E402B8B21E1A5BD8
```

Post-backfill SHA-256:

```text
data/testharness.json
B41324284CAB0C1FAE86A1AE50CF3A14B7FE5668B7D85D0ADA165DAE902C504E

apps/server/th-server/data/testharness.json
D5A3A642AA1F7B24191C79CBE61E3BEEE374CA66E6CAA2A20685296C40CEC398
```

Gate 2-A2 is closed. No legacy import, writer routing, authority-service
activation, cutover, or 2-B–2-G work was performed.
