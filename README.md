# Session Rescue

Session Rescue is a local-first Chrome extension for saving browser session
snapshots, restoring tabs after accidental loss, and exporting/importing
portable backups.

## MVP Scope

- snapshot all normal browser windows and restorable tabs
- user-enabled automatic local snapshots
- manual snapshot from the toolbar popup
- session library with search, restore, delete, export, and import
- local IndexedDB persistence
- no backend, account, analytics, ads, or remote code

The MVP stores only tab URLs, titles, pinned/active state, window grouping, and
capture timestamps. It does not read page content.
Autosave is off by default.

## Load Unpacked

1. Run `npm run package`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click `Load unpacked`.
5. Select `dist/extension`.

## Verification

```bash
npm run verify
```

The verification stack runs unit tests, manifest validation, CWS readiness
checks, package creation, and a real-browser E2E flow.

## Public Review Surface

Chrome Web Store listing URLs, privacy disclosures, permission justifications,
and reviewer notes are tracked in [`docs/cws/listing.json`](docs/cws/listing.json).
Cloudflare Pages source lives in [`site/`](site/).

Public review-surface deployment notes are tracked in
[`docs/cws/deployment-log.md`](docs/cws/deployment-log.md).
