# Chrome Reviewer Checklist

Run before submitting a package:

```bash
npm run verify
```

Manual review expectations:

- `docs/cws/listing.json` is the source of truth for listing URLs, permission
  justifications, privacy-practices answers, and reviewer notes.
- Official, homepage, support, privacy, and reviewer-instruction URLs are public
  HTTPS Cloudflare Pages URLs, not GitHub source-viewer URLs.
- The privacy policy includes Chrome Web Store User Data Policy and Limited Use
  language.
- The ZIP contains only `manifest.json`, `assets/`, and `src/`.
- No host permissions are declared.
- `tabs` is used only to read open tab metadata and restore selected sessions.
- `alarms` is used only for low-frequency local recovery snapshots.
- No page content, cookies, form fields, passwords, analytics, ads, remote
  JavaScript, remote WebAssembly, or `eval` are used.
