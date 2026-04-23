# Session Rescue E2E Testing

Run:

```bash
npm run test:e2e
```

The runner:

- builds `dist/extension`
- launches a temporary Chrome profile with the extension loaded unpacked
- serves local reviewer-style fixture pages
- opens the extension popup page
- creates a session snapshot through the UI
- verifies the library page and search
- restores a saved session
- writes `dist/e2e-report.json` and `dist/e2e-report.md`

For CWS dashboard checks later, use OpenClaw or Computer Use with CWS publisher
and extension IDs supplied through environment variables. Do not store IDs,
tokens, account emails, or dashboard snapshots in the repo.
