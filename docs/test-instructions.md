# Chrome Web Store Reviewer Instructions

No login, account, backend, API key, or paid service is required.

## Smoke Test

1. Install the submitted package.
2. Open two normal HTTPS pages in the same Chrome window.
3. Click the Session Rescue toolbar button.
4. Click `Snapshot now`.
5. Click `Open library`.
6. Confirm the new snapshot appears with the expected tab count.
7. Search for one tab title or domain.
8. Click `Export JSON` and confirm a backup file downloads from the browser.
9. Delete the snapshot, then import the exported JSON backup.
10. Click `Restore` on the imported snapshot and confirm Chrome opens the saved
    URLs in a new window.

The extension does not operate on Chrome Web Store pages or `chrome://` pages.
It stores only tab metadata, not page content.
