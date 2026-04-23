# Session Rescue Privacy Policy

Effective date: 2026-04-23

Session Rescue saves browser session snapshots locally so users can restore
tabs after accidental loss and keep portable backups of their own sessions.
Manual snapshots happen only when the user clicks `Snapshot now`. Automatic
snapshots are off by default and start only after the user clicks
`Enable autosave`.

## Data Handled

Session Rescue handles web browsing activity limited to:

- tab URLs
- tab titles
- window grouping
- pinned and active tab state
- capture timestamps

Session Rescue does not read page body content, form fields, passwords,
cookies, or account data.

## Storage And Network Behavior

Session snapshots are stored locally in IndexedDB in the user's
Chrome profile. Session Rescue does not send tab URLs, session snapshots,
searches, imports, exports, or usage events to a backend service.

## Export, Import, And Deletion

Users can export a JSON backup file from the library page and import compatible
JSON backups later. Imported backups are limited by file size, tab count, and
restorable URL schemes. Users can delete individual snapshots or clear all
snapshots from the library. Removing the extension deletes extension-local
storage according to Chrome's normal extension data behavior.

## Chrome Web Store User Data Policy

Use of information received from Chrome APIs complies with the Chrome Web Store
User Data Policy, including the Limited Use requirements. Session data is used
only to provide local session snapshot, restore, search, export, and import
features.

## No Ads, Sale, Or Third-Party Transfer

No ads are shown. Session Rescue has no analytics, sale of user data, or third-party transfer
of user data.

## Support

For support, visit `https://session-rescue.pages.dev/support/`.
