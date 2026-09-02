const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const ONLINE_WINDOW_SECONDS = 300;

// Memory fallback lets the Worker deploy before KV is configured.
// For 24/7 reliability add a Workers KV binding named JARVIS_KV.
const mem = globalThis.__JARVIS_MEM__ || (globalThis.__JARVIS_MEM__ = {
  roomQueue: [],
  pcQueue: [],
  roomState: { online: false, light: "unknown", light_mode: 1, fan: "off", fan_speed: 0, last_seen: 0 },
  pcState: { online: false, last_seen: 0 },
  sessions: new Map(),
});

const j = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
});
const now = () => Math.floor(Date.now() / 1000);
const rand = (bytes = 24) => {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return [...a].map(x => x.toString(16).padStart(2, "0")).join("");
};
const safeEqual = (a, b) => {
  a = String(a ?? ""); b = String(b ?? "");
  if (a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};
const bearer = req => (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();

async function kvGet(env, key, type = "json") {
  if (!env.JARVIS_KV) return null;
  try { return await env.JARVIS_KV.get(key, { type }); } catch { return null; }
}
async function kvPut(env, key, val, opts = {}) {
  if (!env.JARVIS_KV) return false;
  try {
    await env.JARVIS_KV.put(key, typeof val === "string" ? val : JSON.stringify(val), opts);
    return true;
  } catch { return false; }
}
async function kvDel(env, key) {
  if (!env.JARVIS_KV) return false;
  try { await env.JARVIS_KV.delete(key); return true; } catch { return false; }
}

async function sessionValid(env, token) {
  if (!token) return false;
  if (env.JARVIS_KV) {
    const exp = Number(await env.JARVIS_KV.get(`session:${token}`) || 0);
    if (!exp || exp < now()) { if (exp) await kvDel(env, `session:${token}`); return false; }
    return true;
  }
  const exp = mem.sessions.get(token) || 0;
  if (exp < now()) { mem.sessions.delete(token); return false; }
  return Boolean(exp);
}
async function requireOwner(req, env) {
  return await sessionValid(env, bearer(req));
}
function deviceAuth(req, env) {
  return Boolean(env.JARVIS_DEVICE_TOKEN && safeEqual(req.headers.get("x-device-token") || "", env.JARVIS_DEVICE_TOKEN));
}
function pcAuth(req, env) {
  return Boolean(env.JARVIS_PC_TOKEN && safeEqual(req.headers.get("x-pc-token") || "", env.JARVIS_PC_TOKEN));
}

async function getRoomState(env) {
  if (env.JARVIS_KV) return (await kvGet(env, "state:room")) || mem.roomState;
  return { ...mem.roomState };
}
async function putRoomState(env, st) {
  mem.roomState = { ...st };
  if (env.JARVIS_KV) await kvPut(env, "state:room", st);
}
async function getPcState(env) {
  if (env.JARVIS_KV) return (await kvGet(env, "state:pc")) || mem.pcState;
  return { ...mem.pcState };
}
async function putPcState(env, st) {
  mem.pcState = { ...st };
  if (env.JARVIS_KV) await kvPut(env, "state:pc", st);
}

async function queuePush(env, kind, item) {
  if (!env.JARVIS_KV) {
    const q = kind === "room" ? mem.roomQueue : mem.pcQueue;
    q.push(item); if (q.length > 30) q.shift(); return;
  }
  // Per-command keys avoid one shared JSON queue. The index is intentionally tiny.
  const idxKey = `queue:${kind}:index`;
  let idx = (await kvGet(env, idxKey)) || [];
  idx = idx.filter(x => x && x.id).slice(-29);
  idx.push({ id: item.id, ts: item.ts });
  await kvPut(env, `queue:${kind}:cmd:${item.id}`, item, { expirationTtl: 3600 });
  await kvPut(env, idxKey, idx, { expirationTtl: 3600 });
}
async function queuePop(env, kind) {
  if (!env.JARVIS_KV) {
    const q = kind === "room" ? mem.roomQueue : mem.pcQueue;
    return q.length ? q.shift() : null;
  }
  const idxKey = `queue:${kind}:index`;
  let idx = (await kvGet(env, idxKey)) || [];
  while (idx.length) {
    const head = idx.shift();
    const item = await kvGet(env, `queue:${kind}:cmd:${head.id}`);
    await kvDel(env, `queue:${kind}:cmd:${head.id}`);
    await kvPut(env, idxKey, idx, { expirationTtl: 3600 });
    if (item) return item;
  }
  await kvPut(env, idxKey, [], { expirationTtl: 3600 });
  return null;
}


function roomSubsystem(action) {
  return String(action || "").startsWith("fan_") ? "fan" : "light";
}
async function setRoomCommand(env, action, value = null) {
  const subsystem = roomSubsystem(action);
  const item = { id: rand(12), action, value, ts: now(), issued_ms: Date.now() };
  if (env.JARVIS_KV) {
    await kvPut(env, `cmd:room:${subsystem}`, item, { expirationTtl: 3600 });
  } else {
    mem[`room_${subsystem}_cmd`] = item;
  }
  return item;
}
async function getRoomCommand(env, subsystem) {
  if (env.JARVIS_KV) return await kvGet(env, `cmd:room:${subsystem}`);
  return mem[`room_${subsystem}_cmd`] || null;
}
async function ackRoomCommand(env, subsystem, ackId) {
  if (!ackId) return;
  const cur = await getRoomCommand(env, subsystem);
  if (cur && safeEqual(cur.id, ackId)) {
    if (env.JARVIS_KV) await kvDel(env, `cmd:room:${subsystem}`);
    else mem[`room_${subsystem}_cmd`] = null;
  }
}

function roomCmd(text) {
  const t = String(text || "").toLowerCase().replaceAll("'", " ").replace(/\s+/g, " ").trim();
  if (["good night", "going to sleep", "sleep mode", "bedtime"].some(x => t.includes(x))) return [[ ["light_off", null], ["fan_speed", 3] ], "Sleep mode activated."];
  if (t.includes("light") && (t.includes("off") || t.includes(" of"))) return [[["light_off", null]], "Room light off."];
  if (t.includes("light") && t.includes("on")) return [[["light_on", null]], "Room light on."];
  if (t.includes("light") && (t.includes("mode") || t.includes("mood"))) {
    for (const [n, w] of [[3,"three"],[2,"two"],[1,"one"]]) if (t.includes(String(n)) || t.includes(w)) return [[["light_mode", n]], `Light mode ${n}.`];
  }
  if ((t.includes("fan") || t.includes("fun")) && (t.includes("off") || t.includes("stop"))) return [[["fan_off", null]], "Fan off."];
  if ((t.includes("fan") || t.includes("fun")) && (t.includes("speed") || t.includes("speet"))) {
    for (const [n, w] of [[3,"three"],[2,"two"],[1,"one"]]) if (t.includes(String(n)) || t.includes(w)) return [[["fan_speed", n]], `Fan speed ${n}.`];
  }
  return [null, null];
}

async function bodyJson(req) { try { return await req.json(); } catch { return {}; } }

async function api(req, env, url) {
  const p = url.pathname;

  if (p === "/api/health" && req.method === "GET") {
    return j({ ok: true, service: "JARVIS Cloud Core", version: "21.5-cf-pc-access", storage: env.JARVIS_KV ? "kv" : "memory-fallback", configured: {
      owner_password: Boolean(env.JARVIS_OWNER_PASSWORD), device_token: Boolean(env.JARVIS_DEVICE_TOKEN), pc_token: Boolean(env.JARVIS_PC_TOKEN)
    }});
  }

  if (p === "/api/login" && req.method === "POST") {
    if (!env.JARVIS_OWNER_PASSWORD) return j({ ok:false, error:"Owner password not configured on cloud server." }, 503);
    const b = await bodyJson(req);
    if (!safeEqual(String(b.password || ""), env.JARVIS_OWNER_PASSWORD)) return j({ ok:false, error:"Invalid password." }, 403);
    const token = rand(32), exp = now() + SESSION_TTL_SECONDS;
    if (env.JARVIS_KV) await kvPut(env, `session:${token}`, String(exp), { expirationTtl: SESSION_TTL_SECONDS });
    else mem.sessions.set(token, exp);
    return j({ ok:true, token, face_required:false, cloud:true });
  }

  if (p === "/api/status" && req.method === "GET") {
    if (!(await requireOwner(req, env))) return j({ok:false,error:"Unauthorized"},401);
    const room = await getRoomState(env), pc = await getPcState(env), n = now();
    room.online = Boolean(n - Number(room.last_seen || 0) < ONLINE_WINDOW_SECONDS);
    pc.online = Boolean(n - Number(pc.last_seen || 0) < ONLINE_WINDOW_SECONDS);
    return j({ok:true,cloud:true,room,pc,pc_online:pc.online});
  }

  if (p === "/api/room/status" && req.method === "GET") {
    if (!(await requireOwner(req, env))) return j({ok:false,error:"Unauthorized"},401);
    const st = await getRoomState(env); st.online = Boolean(now() - Number(st.last_seen || 0) < ONLINE_WINDOW_SECONDS);
    return j({ok:true,enabled:true,name:"My Room",...st});
  }

  if (p === "/api/room/action" && req.method === "POST") {
    if (!(await requireOwner(req, env))) return j({ok:false,error:"Unauthorized"},401);
    const b = await bodyJson(req), a = String(b.action || ""), v = b.value ?? null;
    const allowed = new Set(["light_on","light_off","light_next_mode","light_mode","fan_off","fan_speed"]);
    if (!allowed.has(a)) return j({ok:false,error:"Invalid action"},400);
    const cmd = await setRoomCommand(env, a, v);
    return j({ok:true,queued:true,action:a,value:v,command_id:cmd.id,slot:roomSubsystem(a)});
  }

  if (p === "/api/command" && req.method === "POST") {
    if (!(await requireOwner(req, env))) return j({ok:false,error:"Unauthorized"},401);
    const b = await bodyJson(req), text = String(b.text || "").trim();
    const [acts, msg] = roomCmd(text);
    if (acts) {
      const queued = [];
      for (const [a,v] of acts) queued.push(await setRoomCommand(env, a, v));
      return j({ok:true,reply:msg,route:"cloud-room",queued:queued.map(x=>x.id)});
    }
    const cmd = {id:rand(8),text,ts:now()};
    await queuePush(env, "pc", cmd);
    const pc = await getPcState(env), online = Boolean(now() - Number(pc.last_seen || 0) < ONLINE_WINDOW_SECONDS);
    // Never block remote PC access purely because Workers KV can return a stale heartbeat
    // from another Cloudflare edge. The PC agent is the authority: if it is running,
    // it will poll and execute this command.
    return j({
      ok:true,
      reply: online ? "Sent to your home PC." : "Sent to your home PC queue. Waiting for the PC agent.",
      route:"pc",
      command_id:cmd.id,
      pc_status_hint:online ? "online" : "unknown"
    });
  }

  if (p === "/api/device/poll" && req.method === "GET") {
    if (!deviceAuth(req, env)) return j({ok:false,error:"Unauthorized"},401);
    const light = await getRoomCommand(env, "light");
    const fan = await getRoomCommand(env, "fan");
    return j({
      ok:true,
      light_id: light?.id || "",
      light_action: light?.action || "",
      light_value: light?.value ?? 0,
      fan_id: fan?.id || "",
      fan_action: fan?.action || "",
      fan_value: fan?.value ?? 0,
      server_time: now()
    });
  }

  if (p === "/api/device/status" && req.method === "POST") {
    if (!deviceAuth(req, env)) return j({ok:false,error:"Unauthorized"},401);
    const b = await bodyJson(req), st = await getRoomState(env);
    for (const k of ["light","light_mode","fan","fan_speed"]) if (k in b) st[k] = b[k];
    st.last_seen = now(); st.online = true; await putRoomState(env, st);
    await ackRoomCommand(env, "light", String(b.ack_light_id || ""));
    await ackRoomCommand(env, "fan", String(b.ack_fan_id || ""));
    return j({ok:true});
  }

  if (p === "/api/pc/heartbeat" && req.method === "POST") {
    if (!pcAuth(req, env)) return j({ok:false,error:"Unauthorized"},401);
    const st = await getPcState(env);
    st.online = true; st.last_seen = now();
    const b = await bodyJson(req);
    if (b && b.name) st.name = String(b.name).slice(0,80);
    if (b && b.jarvis_running !== undefined) st.jarvis_running = Boolean(b.jarvis_running);
    await putPcState(env, st);
    return j({ok:true,last_seen:st.last_seen});
  }

  if (p === "/api/pc/poll" && req.method === "GET") {
    if (!pcAuth(req, env)) return j({ok:false,error:"Unauthorized"},401);
    const st = await getPcState(env); st.online = true; st.last_seen = now(); await putPcState(env, st);
    return j({ok:true,command:await queuePop(env,"pc")});
  }

  if (p === "/api/pc/result" && req.method === "POST") {
    if (!pcAuth(req, env)) return j({ok:false,error:"Unauthorized"},401);
    const st = await getPcState(env); st.online = true; st.last_seen = now(); await putPcState(env, st);
    return j({ok:true});
  }

  return j({ok:false,error:"Not found"},404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return api(req, env, url);
    if (env.ASSETS) return env.ASSETS.fetch(req);
    return new Response("JARVIS Cloud Core", {status:200});
  }
};
