JARVIS V21.3 — Cloud No-Face + Wake Fix

Changes:
- Cloud face recognition removed.
- Owner password is the cloud unlock gate.
- Saying only "Jarvis" now responds "Yes?" and arms the next command.
- Speech recognition restarts immediately after the wake acknowledgement.
- Wake variants added: Javis, Jarves, Jervis, Charvis.
- Cloud command UI now accepts both `reply` and `response`.
- PWA cache version bumped/network-first to prevent stale old face UI.

Upload/replace these files in the same GitHub jarvis-cloud-core repo:
- public/app.js
- public/index.html
- public/sw.js
- src/index.js

After Cloudflare deploy:
1. Open /api/health and verify version: 21.3-cf-no-face-wake
2. Close/reopen the browser/PWA.
3. If old UI remains, clear site data or reinstall the PWA once.
4. Enable Always listening.
5. Say only "Jarvis". It should say "Yes?" and listen for the next command.
