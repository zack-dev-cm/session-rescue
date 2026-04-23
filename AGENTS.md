# AGENTS.md

Session Rescue is a small Chrome extension product repo.

## Operating Rules

- Restate the goal and verification before edits.
- Keep MV3 permissions narrow and justified in `docs/cws/listing.json`.
- Keep public Chrome Web Store surfaces in `site/` and policy docs in `docs/`.
- Use real-browser E2E for reviewer-critical flows before packaging.
- Do not commit generated `dist/`, OpenClaw state, browser profiles, tokens, or
  dashboard snapshots.

## Verification

```bash
npm run verify
```
