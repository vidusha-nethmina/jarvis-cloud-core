JARVIS V21.1 CLOUDFLARE WORKER CORE
===================================

This folder is designed for Cloudflare Workers GitHub deployment.

Repository root must contain:
  package.json
  wrangler.jsonc
  src/index.js
  public/...

Cloudflare GitHub deploy settings:
  Build command: npm install
  Deploy command: npx wrangler deploy

IMPORTANT AFTER FIRST DEPLOY
----------------------------
Set these Worker secrets/variables in Cloudflare Dashboard -> Settings -> Variables and Secrets:
  JARVIS_OWNER_PASSWORD
  JARVIS_DEVICE_TOKEN
  JARVIS_PC_TOKEN

Do NOT commit real passwords/tokens to GitHub.

Recommended for reliable 24/7 queue/state storage:
1. Create a Workers KV namespace.
2. Add a KV binding to the Worker with variable name exactly: JARVIS_KV
3. Redeploy.

Without JARVIS_KV, the Worker uses a memory fallback for initial deployment/testing only.

Health test:
  https://<your-worker>.workers.dev/api/health

Expected:
  {"ok":true,"service":"JARVIS Cloud Core","version":"21.1-cf",...}

Then the existing V21 ESP32 firmware and PC Agent use the same API endpoints.
