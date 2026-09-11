# P2-F Runtime Artifact Retention and Redaction Policy

## Runtime JSON

- `data/testharness.json` and `apps/server/th-server/data/testharness.json` are local runtime persistence only.
- They must not be committed as live session/report databases.
- Do not place production or user session dumps in source control.
- If reproducible seed data is needed, create a separate sanitized fixture under an explicit `fixtures/` or `seed/` path with a documented purpose.
- Retain locally only as required by the developer/server environment; purge or archive according to local data-retention requirements.

## Cognition and site-profile state

- `.cognition/`, `.site-profiles/`, and `apps/server/th-server/.site-profiles/` are generated local state/cache directories.
- They are not fixtures and should remain ignored.
- Do not commit user-specific history, learned state, site caches, or runtime identifiers.

## Screenshots and browser captures

- Generated screenshots are ignored by default and remain local artifacts.
- A screenshot may be intentionally committed only when all of the following hold:
  - it is explicitly reviewed;
  - sensitive content is removed or redacted;
  - it lives in an intentional `docs/`, `fixtures/`, or `assets/` location;
  - its purpose is documented.
- Before promotion, inspect visible page content, form values, URLs, query strings, account identifiers, and session-specific data.
- `.playwright-mcp/` captures remain local/debug-only; existing tracked captures must not be reintroduced without review.

## Logs and browser/debug captures

- Console logs, page dumps, headers, cookies, credential-bearing URLs, form values, model prompts, and activity history are local/debug-only.
- Redact secrets and personal/session data before sharing.
- The presence of a credential-shaped marker requires review; confirmed credentials require immediate revoke/rotation before any history or retention decision.
- The previously exposed DashScope key remains permanently compromised regardless of Git cleanup.

## Fixtures and seeds

- Fixtures/seeds must be deterministic, synthetic or redacted, explicitly named, and documented.
- Fixture content must not be copied from live runtime databases or unreviewed browser captures.
- Source and fixture paths remain trackable; runtime ignore rules must not use broad patterns that hide templates such as `.env.example`.
