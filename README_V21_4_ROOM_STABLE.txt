JARVIS V21.4 — Cloud Room Stable Fix

What this fixes
- ESP32 online/offline status flicker reduced (90-second cloud online window + 5-second heartbeat).
- Light and fan commands can no longer share/mix the same cloud queue.
- Cloud now has two independent command slots: LIGHT and FAN.
- Every command has a unique ID.
- ESP32 stores the last executed LIGHT/FAN command IDs in Preferences, preventing stale KV reads or repeated polls from executing a relay action twice.
- Fan speed relay interlock preserved: all speed relays OFF before a new speed relay turns ON.
- Direct light Mode 1/2/3 endpoints added to local ESP32 web server.

Cloud update
Upload/replace:
  src/index.js

Then verify:
  /api/health
Version must be:
  21.4-cf-room-stable
Storage must remain:
  kv

ESP32 update
Open:
  ESP32_JARVIS_CLOUD_STABLE/ESP32_JARVIS_CLOUD_STABLE.ino

Replace only:
  WIFI_SSID
  WIFI_PASSWORD
  DEVICE_TOKEN

CLOUD_BASE_URL is already set to:
  https://jarvis-cloud-core.vidushathegreat.workers.dev

Board:
  ESP32 Dev Module

Pins:
  Light       GPIO26
  Fan Speed 1 GPIO27
  Fan Speed 2 GPIO25
  Fan Speed 3 GPIO32

After upload, Serial Monitor 115200 should show:
  JARVIS V21.4 Cloud Room Stable Ready
  [CLOUD] status OK

Test in this order:
1. Light ON
2. Light OFF
3. Light Mode 1
4. Light Mode 2
5. Light Mode 3
6. Fan Speed 1
7. Fan Speed 2
8. Fan Speed 3
9. Fan OFF

Do not change 230V wiring while powered.
