JARVIS V21.5 — PC Cloud Access Fix

Why this fix exists
Cloudflare Workers KV is eventually consistent. A phone request at one edge can briefly read
an older PC heartbeat written by the PC agent at another edge. That can falsely show PC OFFLINE.

Fixes
- Remote PC commands are NEVER blocked only because the KV heartbeat looks stale.
- PC online lease widened to 5 minutes to reduce false offline status.
- New /api/pc/heartbeat endpoint.
- PC agent sends an explicit heartbeat every 5 seconds.
- PC agent reports whether local JARVIS at 127.0.0.1:8775 is reachable.
- Phone UI uses PC STATUS SYNCING instead of incorrectly declaring OFFLINE while KV catches up.
- Phone status refreshes every 5 seconds.

Cloud files to replace in GitHub:
  src/index.js
  public/app.js
  public/sw.js

PC file to replace:
  Hybrid_Cloud\pc_agent\cloud_pc_agent.py
Use the file inside PC_AGENT_V21_5.

Keep START_CLOUD_PC_AGENT.bat if yours already works.

After Cloudflare deployment:
  /api/health version must be 21.5-cf-pc-access
  storage must remain kv

Then restart PC Agent.
Expected:
  cloud: heartbeat OK | local JARVIS: ON
When RUN_JARVIS.bat is running.

IMPORTANT:
Rotate any PC token previously exposed in screenshots/chat.
