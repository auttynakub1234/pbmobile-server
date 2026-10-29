#!/usr/bin/env node
/**
 * Point Blank Mobile (PBMobile) Custom Dedicated Game Server
 * Features:
 * - Lobby WebSocket Server (Handshake, Rooms, Matchmaking, Profile, Chat, Shop)
 * - Battle Dedicated WebSocket Server (Binary Entity State Sync at 30Hz, Combat Events)
 * - Admin REST APIs for "UI Pro Max" Control Center
 * - Static Assets & Fallback Proxy
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const zlib = require("zlib");
const db = require("./pb_database");

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".obj": "text/plain",
  ".mtl": "text/plain"
};

const COMPRESSIBLE_EXTS = new Set([".js", ".json", ".html", ".css", ".txt", ".obj", ".mtl", ".svg"]);

function serveStaticFile(req, res, filePath, explicitMime) {
  const ext = path.extname(filePath).toLowerCase();
  const isHtml = ext === ".html";
  const contentType = explicitMime || MIME_TYPES[ext] || "application/octet-stream";
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": isHtml ? "no-cache" : "public, max-age=31536000, immutable"
  };

  const acceptEncoding = req.headers["accept-encoding"] || "";
  if (COMPRESSIBLE_EXTS.has(ext) && acceptEncoding.includes("gzip")) {
    headers["Content-Encoding"] = "gzip";
    res.writeHead(200, headers);
    const raw = fs.createReadStream(filePath);
    const gzip = zlib.createGzip({ level: 6 });
    return raw.pipe(gzip).pipe(res);
  }

  res.writeHead(200, headers);
  return fs.createReadStream(filePath).pipe(res);
}

// Connected Lobby Clients: sid -> { socket, user }
const lobbyClients = new Map();
// Battle Rooms: roomId -> { clients: Map(sid -> socket), state: Map(sid -> playerEntity), tickTimer }
const battleRooms = new Map();

// -----------------------------------------------------------------------------
// HTTP & REST Routing
// -----------------------------------------------------------------------------
function proxyHttpRequest(req, res, targetUrl) {
  const parsed = url.parse(targetUrl);
  const options = {
    hostname: parsed.hostname,
    port: 443,
    path: parsed.path,
    method: req.method,
    headers: {
      ...req.headers,
      host: parsed.hostname,
      "user-agent": req.headers["user-agent"] && !/python|curl|node/i.test(req.headers["user-agent"])
        ? req.headers["user-agent"]
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      referer: "https://pbmobile.app/",
      origin: "https://pbmobile.app",
      "accept-encoding": "identity"
    }
  };

  const proxyReq = https.request(options, upstreamRes => {
    // If successful GET request, cache asset to local disk for offline / independent standalone hosting
    if (req.method === "GET" && upstreamRes.statusCode === 200 && parsed.pathname) {
      try {
        const relPath = parsed.pathname.startsWith("/") ? parsed.pathname.slice(1) : parsed.pathname;
        const safePath = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, "");
        const localSavePath = path.join(BASE_DIR, safePath);
        fs.mkdirSync(path.dirname(localSavePath), { recursive: true });
        const fileStream = fs.createWriteStream(localSavePath);
        fileStream.on("error", err => console.warn("[Cache Error]", err.message));
        upstreamRes.pipe(fileStream);
      } catch (err) {
        console.warn("[Cache Failed]", err.message);
      }
    }

    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  proxyReq.setTimeout(6000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504);
      res.end("Gateway Timeout");
    }
  });
  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Upstream unavailable");
    }
  });
  req.pipe(proxyReq);
}

const MAP_V_SERVER = { nport: "zep1", showroom: "sr10", library: "nk5" };
function calcAssetHash(type, params) {
  const p = { ...params };
  const t = JSON.stringify(p).toLowerCase();
  for (const k in MAP_V_SERVER) {
    if (t.includes(k)) {
      p.mv = MAP_V_SERVER[k];
      break;
    }
  }
  const norm = Object.entries(Object.assign({ v: "1" }, p)).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const n = new URLSearchParams(norm).toString();
  const o = type + "?" + n;
  let r = 2166136261, i = 2671212586;
  for (let idx = 0; idx < o.length; idx++) {
    const code = o.charCodeAt(idx);
    r = Math.imul(r ^ code, 16777619) >>> 0;
    i = Math.imul(i ^ code, 16777619) >>> 0;
  }
  return `${r.toString(16).padStart(8, "0")}${i.toString(16).padStart(8, "0")}`;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // 1. Admin UI Endpoint
  if (pathname === "/admin" || pathname === "/admin/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(BASE_DIR, "public", "admin", "index.html")).pipe(res);
  }

  // Build version endpoint (Prevents 403 Cloudflare block and infinite reload loop)
  if (pathname === "/build.json") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(JSON.stringify({ v: "202610262100" }));
  }

  // 2. 3D Studio Viewer Endpoint
  if (pathname === "/viewer") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(BASE_DIR, "viewer.html")).pipe(res);
  }

  // 3. Admin REST APIs
  if (pathname === "/api/admin/stats") {
    const mem = process.memoryUsage();
    return res.end(
      JSON.stringify({
        onlinePlayers: lobbyClients.size,
        activeRooms: db.rooms.size,
        totalUsers: db.users.size,
        uptime: Math.floor(process.uptime()),
        memoryRssMB: Math.round(mem.rss / 1024 / 1024),
        memoryHeapMB: Math.round(mem.heapUsed / 1024 / 1024),
        tickRate: 30
      })
    );
  }

  if (pathname === "/api/admin/rooms") {
    return res.end(JSON.stringify(Array.from(db.rooms.values())));
  }

  if (pathname === "/api/admin/users") {
    return res.end(JSON.stringify(Array.from(db.users.values())));
  }

  if (pathname === "/api/assets") {
    const mapsDir = path.join(BASE_DIR, "extracted", "maps");
    const wpnsDir = path.join(BASE_DIR, "extracted", "weapons");
    const maps = fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir).filter(f => !f.startsWith(".")) : [];
    const weapons = fs.existsSync(wpnsDir) ? fs.readdirSync(wpnsDir).filter(f => !f.startsWith(".")) : [];
    return res.end(JSON.stringify({ maps, weapons }));
  }

  // 4. Patched Network Files & Cloudflare Bypasses
  if (pathname === "/static/game/net.js") {
    return serveStaticFile(req, res, path.join(BASE_DIR, "net.patched.js"), "application/javascript; charset=utf-8");
  }
  if (pathname === "/static/game/pb.js") {
    return serveStaticFile(req, res, path.join(BASE_DIR, "pb.patched.js"), "application/javascript; charset=utf-8");
  }
  if (pathname === "/static/client.js" || pathname === "/client.js") {
    return serveStaticFile(req, res, path.join(BASE_DIR, "client.patched.js"), "application/javascript; charset=utf-8");
  }
  if (pathname === "/cc.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=31536000" });
    return res.end("window.CC = 'TH';\nwindow.TS_KEY = '';\n");
  }
  if (pathname.startsWith("/cdn-cgi/trace")) {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end("fl=114f11\nh=localhost\nip=127.0.0.1\nts=1700000000\nvisit_scheme=http\nuag=Mozilla/5.0\ncolo=BKK\nsliver=none\nhttp=http/1.1\nloc=TH\ntls=off\nsni=off\nwarp=off\ngateway=off\nrwarp=off\n");
  }
  if (pathname.startsWith("/cdn-cgi/")) {
    res.writeHead(204);
    return res.end();
  }

  // 5. Check Local Files (Game client, UI, Sounds, Extracted Assets)
  let localFile = null;
  if (pathname === "/" || pathname === "/index.html") {
    localFile = path.join(BASE_DIR, "index.html");
  } else if (pathname === "/jogo" || pathname === "/game.html") {
    localFile = path.join(BASE_DIR, "jogo.html");
    if (!fs.existsSync(localFile)) localFile = path.join(BASE_DIR, "index.html");
  } else if (pathname.startsWith("/a/")) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length >= 3) {
      const aType = parts[1];
      const aHash = parts[2];
      const direct = path.join(BASE_DIR, "a", aType, aHash);
      if (fs.existsSync(direct) && fs.statSync(direct).size > 50) {
        localFile = direct;
      } else if (parsed.query && parsed.query.path) {
        const pStr = parsed.query.path;
        const hNoRs = calcAssetHash(aType, { path: pStr });
        const hRs1 = calcAssetHash(aType, { path: pStr, rs: "1" });
        const fNoRs = path.join(BASE_DIR, "a", aType, hNoRs);
        const fRs1 = path.join(BASE_DIR, "a", aType, hRs1);
        if (fs.existsSync(fNoRs) && fs.statSync(fNoRs).size > 50) {
          try { fs.copyFileSync(fNoRs, direct); } catch (e) {}
          localFile = direct;
        } else if (fs.existsSync(fRs1) && fs.statSync(fRs1).size > 50) {
          try { fs.copyFileSync(fRs1, direct); } catch (e) {}
          localFile = direct;
        }
      }
    }
  } else {
    const candidate = path.join(BASE_DIR, pathname.startsWith("/") ? pathname.slice(1) : pathname);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      localFile = candidate;
    } else {
      const rootCandidate = path.join(BASE_DIR, path.basename(pathname));
      if (fs.existsSync(rootCandidate) && fs.statSync(rootCandidate).isFile()) {
        localFile = rootCandidate;
      }
    }
  }

  if (localFile && fs.existsSync(localFile)) {
    return serveStaticFile(req, res, localFile);
  }

  // 6. Proxy missing assets directly to pbmobile.app
  proxyHttpRequest(req, res, `https://pbmobile.app${req.url}`);
});

// -----------------------------------------------------------------------------
// WebSocket Engine (Lobby + Battle Sync)
// -----------------------------------------------------------------------------
function parseWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const isFinal = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0f;
  const isMasked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  let maskingKey = null;
  if (isMasked) {
    if (buffer.length < offset + 4) return null;
    maskingKey = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) return null;
  const payload = buffer.slice(offset, offset + payloadLength);
  if (isMasked && maskingKey) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= maskingKey[i % 4];
    }
  }

  return {
    opcode,
    payload,
    totalLength: offset + payloadLength
  };
}

function makeWebSocketFrame(data, isBinary = false) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  const length = payload.length;
  let header;

  if (length <= 125) {
    header = Buffer.alloc(2);
    header[0] = (isBinary ? 0x82 : 0x81);
    header[1] = length;
  } else if (length <= 65535) {
    header = Buffer.alloc(4);
    header[0] = (isBinary ? 0x82 : 0x81);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = (isBinary ? 0x82 : 0x81);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, payload]);
}

function sendWs(socket, data, isBinary = false) {
  if (socket.writable) {
    socket.write(makeWebSocketFrame(data, isBinary));
  }
}

// -----------------------------------------------------------------------------
// Lobby WebSocket Handlers (/ws)
// -----------------------------------------------------------------------------
function formatAcct(u) {
  if (!u) return null;
  return {
    login: u.login,
    name: u.nick,
    gold: u.points,
    cash: u.cash,
    owned: Object.fromEntries((u.inventory || []).map(id => [id, 1])),
    equip: u.equip || {},
    stats: u.stats || {},
    items: [],
    nick: { nc: u.nc || 1, fx: u.fx || 5 }
  };
}

function formatRoom(r) {
  if (!r) return null;
  const hostSlot = (r.slots || []).find(s => s.id === r.host || s.sid === r.host);
  const hostTeam = hostSlot ? hostSlot.team : 0;
  const isAi = r.ai ? 1 : 0;
  const enemies = r.enemies !== undefined ? r.enemies : (isAi ? 4 : 0);
  const dif = r.dif || 1;
  const bots = isAi ? (hostTeam === 0 ? [0, enemies] : [enemies, 0]) : (r.bots || [0, 0]);

  return {
    id: r.id,
    title: r.title,
    map: r.map,
    kills: r.kills,
    time: r.time,
    mode: r.mode || "dm",
    pw: r.pw || false,
    lock: r.lock || { p: true, s: true, m: true, t: true, rpg: false },
    obs: r.obs || { tp: false, fc: false, en: false, hp: false },
    joinBlock: !!r.joinBlock,
    balance: r.balance !== undefined ? r.balance : 1,
    ban: r.ban || [],
    tag: r.tag || null,
    state: r.state || "Esperando",
    host: r.host,
    hostNick: r.hostNick,
    members: (r.slots || []).map(s => ({
      id: s.id || s.sid,
      sid: s.sid || s.id,
      nick: s.nick,
      team: s.team !== undefined ? s.team : 0,
      chara: s.chara || "redbulls",
      weapon: s.weapon || "aug",
      ready: !!s.ready,
      host: (s.id || s.sid) === r.host,
      pos: s.pos || 1,
      rank: s.rank || 26,
      card: s.card || "",
      nc: s.nc || 0,
      fx: s.fx || 0
    })),
    bots: bots,
    closed: r.closed || [new Array(8).fill(false), new Array(8).fill(false)],
    sp: r.sp || "",
    fun: r.fun || "",
    event: r.event || null,
    ai: isAi,
    enemies: enemies,
    dif: dif
  };
}

function broadcastRoom(r) {
  if (!r) return;
  const payload = JSON.stringify({ t: "room", room: formatRoom(r) });
  (r.slots || []).forEach(slot => {
    const slotClient = lobbyClients.get(slot.id || slot.sid);
    if (slotClient && slotClient.socket) {
      sendWs(slotClient.socket, payload);
    }
  });
}

function handleLobbyMessage(socket, sid, messageStr) {
  let msg;
  try {
    msg = JSON.parse(messageStr);
  } catch (e) {
    return;
  }

  const client = lobbyClients.get(sid);
  let user = client?.user;

  switch (msg.t) {
    case "hello":
    case "resume": {
      const nick = msg.nick || msg.login || "Soldier_" + sid.slice(0, 4);
      user = db.getOrCreateUser(nick, sid);
      lobbyClients.set(sid, { socket, user });

      const existingRoom = db.getRoomByUser(sid);

      // Welcome reply with authenticated account
      sendWs(
        socket,
        JSON.stringify({
          t: "welcome",
          sid: sid,
          tok: "tok_" + sid,
          edge: "",
          bin: false,
          acct: formatAcct(user),
          room: existingRoom ? formatRoom(existingRoom) : null,
          accounts: true,
          req: msg.req
        })
      );
      break;
    }

    case "rooms": {
      sendWs(
        socket,
        JSON.stringify({
          t: "rooms",
          list: db.getRoomList(),
          req: msg.req
        })
      );
      break;
    }

    case "create": {
      if (!user) return;
      const rData = msg.room || msg;
      const room = db.createRoom({
        title: rData.title || "Custom Room",
        map: rData.map || "BurningHall",
        mode: rData.mode || "dm",
        kills: rData.kills || 100,
        time: rData.time || 10,
        ai: rData.ai ? 1 : 0,
        enemies: rData.enemies || (rData.ai ? 4 : 0),
        dif: rData.dif || 1,
        pw: rData.pw || false,
        lock: rData.lock,
        obs: rData.obs,
        joinBlock: rData.joinBlock,
        balance: rData.balance,
        sp: rData.sp,
        hostUser: user
      });

      sendWs(socket, JSON.stringify({ t: "room", room: formatRoom(room), req: msg.req }));
      broadcastLobby({ t: "rooms", list: db.getRoomList() });
      break;
    }

    case "join": {
      if (!user) return;
      const room = db.joinRoom(msg.id, user);
      if (room) {
        broadcastRoom(room);
        broadcastLobby({ t: "rooms", list: db.getRoomList() });
      } else {
        sendWs(socket, JSON.stringify({ t: "error", text: "Sala cheia ou não encontrada", req: msg.req }));
      }
      break;
    }

    case "cfg": {
      if (!user) return;
      const room = db.getRoomByUser(sid);
      if (room && room.host === sid) {
        if (msg.title !== undefined) room.title = String(msg.title).slice(0, 30);
        if (msg.map !== undefined) room.map = msg.map;
        if (msg.mode !== undefined) room.mode = msg.mode;
        if (msg.kills !== undefined) room.kills = Number(msg.kills);
        if (msg.time !== undefined) room.time = Number(msg.time);
        if (msg.ai !== undefined) room.ai = msg.ai ? 1 : 0;
        if (msg.enemies !== undefined) {
          room.enemies = Number(msg.enemies);
          const hostSlot = room.slots.find(s => s.id === sid || s.sid === sid);
          const hostTeam = hostSlot ? hostSlot.team : 0;
          room.bots = hostTeam === 0 ? [0, room.enemies] : [room.enemies, 0];
        }
        if (msg.dif !== undefined) room.dif = Number(msg.dif);
        if (msg.lock !== undefined) room.lock = msg.lock;
        if (msg.obs !== undefined) room.obs = msg.obs;
        if (msg.joinBlock !== undefined) room.joinBlock = !!msg.joinBlock;
        if (msg.balance !== undefined) room.balance = msg.balance;
        if (msg.bots !== undefined && Array.isArray(msg.bots)) room.bots = msg.bots;

        broadcastRoom(room);
        broadcastLobby({ t: "rooms", list: db.getRoomList() });
      }
      break;
    }

    case "set": {
      if (!user) return;
      const room = db.getRoomByUser(sid);
      if (room) {
        const slot = room.slots.find(s => s.id === sid || s.sid === sid);
        if (slot) {
          if (msg.ready !== undefined) slot.ready = !!msg.ready;
          if (msg.team !== undefined) {
            slot.team = Number(msg.team);
            if (room.ai) {
              room.bots = slot.team === 0 ? [0, room.enemies || 4] : [room.enemies || 4, 0];
            }
          }
          if (msg.chara !== undefined) slot.chara = msg.chara;
          if (msg.weapon !== undefined) slot.weapon = msg.weapon;
          if (msg.card !== undefined) slot.card = msg.card;
        }
        broadcastRoom(room);
      }
      break;
    }

    case "swapteams": {
      if (!user) return;
      const room = db.getRoomByUser(sid);
      if (room && room.host === sid) {
        room.slots.forEach(s => {
          s.team = s.team === 0 ? 1 : 0;
        });
        if (room.ai) {
          const hostSlot = room.slots.find(s => s.id === sid || s.sid === sid);
          const hostTeam = hostSlot ? hostSlot.team : 0;
          room.bots = hostTeam === 0 ? [0, room.enemies || 4] : [room.enemies || 4, 0];
        }
        broadcastRoom(room);
      }
      break;
    }

    case "close": {
      if (!user) return;
      const room = db.getRoomByUser(sid);
      if (room && room.host === sid) {
        const team = Number(msg.team);
        const idx = Number(msg.idx);
        if (room.closed && room.closed[team] && idx >= 0 && idx < 8) {
          room.closed[team][idx] = !room.closed[team][idx];
          broadcastRoom(room);
        }
      }
      break;
    }

    case "kick": {
      if (!user) return;
      const room = db.getRoomByUser(sid);
      if (room && room.host === sid) {
        const targetSid = msg.id;
        const targetIdx = room.slots.findIndex(s => s.id === targetSid || s.sid === targetSid);
        if (targetIdx !== -1) {
          const targetSlot = room.slots[targetIdx];
          room.slots.splice(targetIdx, 1);
          room.players = room.slots.length;
          const targetClient = lobbyClients.get(targetSlot.id || targetSlot.sid);
          if (targetClient && targetClient.socket) {
            sendWs(targetClient.socket, JSON.stringify({ t: "leave", ok: true, kicked: true }));
          }
          broadcastRoom(room);
          broadcastLobby({ t: "rooms", list: db.getRoomList() });
        }
      }
      break;
    }

    case "owner": {
      if (!user) return;
      const room = db.getRoomByUser(sid);
      if (room && room.host === sid) {
        const targetSid = msg.id;
        const targetSlot = room.slots.find(s => s.id === targetSid || s.sid === targetSid);
        if (targetSlot) {
          room.slots.forEach(s => { s.host = false; });
          targetSlot.host = true;
          room.host = targetSlot.id || targetSlot.sid;
          room.hostNick = targetSlot.nick;
          broadcastRoom(room);
          broadcastLobby({ t: "rooms", list: db.getRoomList() });
        }
      }
      break;
    }

    case "reqhost": {
      if (!user) return;
      const room = db.getRoomByUser(sid);
      if (room) {
        const isCurrentHostOnline = lobbyClients.has(room.host);
        if (!isCurrentHostOnline || room.slots.length === 1) {
          room.slots.forEach(s => { s.host = false; });
          const mySlot = room.slots.find(s => s.id === sid || s.sid === sid);
          if (mySlot) {
            mySlot.host = true;
            room.host = sid;
            room.hostNick = user.nick;
            broadcastRoom(room);
            broadcastLobby({ t: "rooms", list: db.getRoomList() });
          }
        }
      }
      break;
    }

    case "leave": {
      const res = db.leaveRoom(sid);
      sendWs(socket, JSON.stringify({ t: "leave", ok: true, req: msg.req }));
      if (res && res.room) {
        broadcastRoom(res.room);
      }
      broadcastLobby({ t: "rooms", list: db.getRoomList() });
      break;
    }

    case "start": {
      // Host triggers match start
      const room = Array.from(db.rooms.values()).find(r => r.host === sid);
      if (room) {
        room.state = "Jogando";
        const battleInfo = {
          u: `/b${room.id}`,
          k: "key_" + crypto.randomBytes(4).toString("hex")
        };
        // Broadcast start to all players in the room
        room.slots.forEach(slot => {
          const slotClient = lobbyClients.get(slot.id || slot.sid);
          if (slotClient && slotClient.socket) {
            sendWs(
              slotClient.socket,
              JSON.stringify({
                t: "start",
                room: formatRoom(room),
                battle: battleInfo
              })
            );
          }
        });
        broadcastLobby({ t: "rooms", list: db.getRoomList() });
      }
      break;
    }

    case "ingame": {
      const dbRoom = db.getRoomByUser(sid) || Array.from(db.rooms.values())[0];
      const slots = dbRoom?.slots || [{ id: sid, nick: user?.nick || "Player", team: 0, chara: "redbulls", weapon: "aug" }];
      sendWs(socket, JSON.stringify({
        t: "game",
        you: sid,
        title: dbRoom?.title || "Battle Match",
        game: {
          map: dbRoom?.map || "BurningHall",
          mode: dbRoom?.mode || "dm",
          kills: dbRoom?.kills || 100,
          time: dbRoom?.time || 10,
          ents: slots.map(s => ({
            id: s.id || s.sid,
            name: s.nick,
            team: s.team !== undefined ? s.team : 0,
            chara: s.chara || "redbulls",
            weapon: s.weapon || "aug",
            card: s.card || "",
            nc: s.nc || 0,
            fx: s.fx || 0,
            rank: s.rank || 26
          }))
        }
      }));
      break;
    }

    case "loaded":
    case "spawnme": {
      sendWs(socket, JSON.stringify({ t: "spawn", id: sid }));
      break;
    }

    case "profile": {
      const targetNick = msg.nick || user?.nick;
      const targetUser = targetNick ? db.users.get(targetNick) || db.getOrCreateUser(targetNick, "bot") : user;
      sendWs(
        socket,
        JSON.stringify({
          t: "profile",
          profile: targetUser,
          req: msg.req
        })
      );
      break;
    }

    case "equip": {
      if (user && msg.slot && msg.id) {
        user.equip[msg.slot] = msg.id;
        sendWs(socket, JSON.stringify({ t: "equip", ok: true, slot: msg.slot, id: msg.id, req: msg.req }));
      }
      break;
    }

    case "chat": {
      broadcastLobby({
        t: "chat",
        from: user?.nick || "Anonymous",
        text: String(msg.text || "").slice(0, 150),
        team: msg.team || false
      });
      break;
    }

    case "cf_top": {
      sendWs(
        socket,
        JSON.stringify({
          t: "cf_top",
          list: [
            { nick: "PointBlank_Legends", rank: 60, card: "3400084", nc: 1, fx: 5, cn: "Legends", cm: 103088387, cf: 6 }
          ],
          req: msg.req
        })
      );
      break;
    }

    case "acct": {
      if (user) {
        sendWs(socket, JSON.stringify({ t: "acct", acct: formatAcct(user), req: msg.req }));
      }
      break;
    }

    case "buy": {
      if (user) {
        const goodsId = msg.goods;
        let itemId = String(goodsId);
        if (db.goods && db.goods[goodsId]) {
          itemId = db.goods[goodsId].item || itemId;
        }
        if (!user.inventory.includes(itemId)) {
          user.inventory.push(itemId);
        }
        sendWs(socket, JSON.stringify({ t: "buy", ok: true, acct: formatAcct(user), req: msg.req }));
      }
      break;
    }

    case "nickcheck": {
      sendWs(socket, JSON.stringify({ t: "nickcheck", ok: true, req: msg.req }));
      break;
    }

    case "setnick": {
      if (user && msg.nick) {
        user.nick = msg.nick.trim();
        sendWs(socket, JSON.stringify({ t: "setnick", ok: true, nick: user.nick, acct: formatAcct(user), req: msg.req }));
      }
      break;
    }

    case "pg": {
      sendWs(socket, JSON.stringify({ t: "po", s: msg.s }));
      break;
    }

    default:
      if (msg.req) {
        sendWs(socket, JSON.stringify({ req: msg.req, ok: true }));
      }
  }
}

function broadcastLobby(msgObj) {
  const jsonStr = JSON.stringify(msgObj);
  lobbyClients.forEach(({ socket }) => {
    sendWs(socket, jsonStr);
  });
}

// -----------------------------------------------------------------------------
// Battle WebSocket Engine (/b{roomId}) - Binary Real-Time Tick Relay
// -----------------------------------------------------------------------------
function broadcastBattle(bRoom, msgObj, excludeSid = null) {
  if (!bRoom) return;
  const jsonStr = typeof msgObj === "string" ? msgObj : JSON.stringify(msgObj);
  bRoom.clients.forEach((cSocket, cSid) => {
    if (excludeSid && cSid === excludeSid) return;
    sendWs(cSocket, jsonStr);
  });
}

function getOrCreateBattleRoom(roomId) {
  if (!battleRooms.has(roomId)) {
    const dbRoom = db.rooms.get(Number(roomId));
    const roomState = {
      id: roomId,
      dbRoom: dbRoom,
      clients: new Map(), // sid -> socket
      entities: new Map(), // sid -> { p: [x,y,z], y: yaw, pi: pitch, w: weapon, c, g, r, mv }
      players: new Map(), // sid -> { id, nick, team, hp, maxHp, dead, kills, deaths, isZombie, spawned }
      scores: { red: 0, blue: 0 },
      tickTimer: null,
      zombieTimer: null,
      alphaChosen: false
    };

    // 30 Hz Real-Time Tick Loop (State Sync)
    roomState.tickTimer = setInterval(() => {
      if (roomState.clients.size === 0) return;
      const ents = Array.from(roomState.entities.values()).map(st => ({
        id: st.id,
        p: st.p || [0, 0, 0],
        y: st.y || 0,
        pi: st.pi || 0,
        c: st.c || 0,
        g: st.g !== undefined ? st.g : 1,
        r: st.r || 0,
        mv: st.mv || [0, 0],
        w: st.w || "aug"
      }));

      if (ents.length > 0) {
        const tickPacket = JSON.stringify({
          t: "st",
          ts: Date.now(),
          ents: ents
        });

        roomState.clients.forEach(clientSocket => {
          sendWs(clientSocket, tickPacket);
        });
      }
    }, 33); // ~30 fps

    battleRooms.set(roomId, roomState);
  }
  return battleRooms.get(roomId);
}

function handleBattleMessage(socket, sid, battleRoomId, bMsg) {
  const bRoom = battleRooms.get(battleRoomId);
  if (!bRoom) return;
  const dbRoom = db.rooms.get(Number(battleRoomId));

  // Bind player to their lobby SID if sent in hello/resume
  if ((bMsg.t === "hello" || bMsg.t === "resume") && bMsg.sid && bMsg.sid !== socket.playerSid) {
    const oldSid = socket.playerSid || sid;
    bRoom.clients.delete(oldSid);
    bRoom.entities.delete(oldSid);
    bRoom.players.delete(oldSid);
    socket.playerSid = bMsg.sid;
    bRoom.clients.set(socket.playerSid, socket);
    console.log(`[⚔️ BATTLE] Mapped player ${oldSid} -> Lobby SID: ${socket.playerSid} in #${battleRoomId}`);
  }
  const pSid = socket.playerSid || sid;

  switch (bMsg.t) {
    case "hello":
    case "resume": {
      // 1. Handshake response (CRITICAL: Unblocks await h.connect in /jogo)
      sendWs(
        socket,
        JSON.stringify({
          t: "welcome",
          sid: pSid,
          tok: "tok_" + pSid,
          bin: false,
          req: bMsg.req
        })
      );
      break;
    }

    case "ingame":
    case "watch": {
      const slots = dbRoom?.slots || [{ id: pSid, nick: bMsg.nick || "Player", team: 0, chara: "redbulls", weapon: "aug" }];
      // Initialize player combat tracking
      let slot = slots.find(s => s.id === pSid || s.sid === pSid);
      if (!slot) {
        slot = { id: pSid, nick: bMsg.nick || "Soldier", team: 0, chara: "redbulls", weapon: "aug" };
        slots.push(slot);
      }
      const maxHp = dbRoom?.mode === "zombie" ? 1000 : 100;
      if (!bRoom.players.has(pSid)) {
        bRoom.players.set(pSid, {
          id: pSid,
          nick: slot.nick,
          team: slot.team !== undefined ? slot.team : 0,
          hp: maxHp,
          maxHp: maxHp,
          dead: false,
          kills: 0,
          deaths: 0,
          isZombie: false,
          spawned: false
        });
      }

      const allEnts = slots.map(s => ({
        id: s.id || s.sid,
        name: s.nick,
        team: s.team !== undefined ? s.team : 0,
        chara: s.chara || "redbulls",
        weapon: s.weapon || "aug",
        card: s.card || "",
        nc: s.nc || 0,
        fx: s.fx || 0,
        rank: s.rank || 26
      }));

      const nowSec = Date.now() / 1000;
      const matchDuration = (dbRoom?.time || 10) * 60;

      sendWs(
        socket,
        JSON.stringify({
          t: "game",
          you: pSid,
          now: nowSec,
          title: dbRoom?.title || "Battle Match",
          game: {
            map: dbRoom?.map || "BurningHall",
            mode: dbRoom?.mode || "dm",
            kills: dbRoom?.kills || 100,
            time: dbRoom?.time || 10,
            score: [bRoom.scores.red || 0, bRoom.scores.blue || 0],
            ends: nowSec + matchDuration,
            start: nowSec,
            ents: allEnts
          }
        })
      );

      // Broadcast 'joined' with this player's entity to all other players in the battle room!
      const myEnt = allEnts.find(e => e.id === pSid);
      if (myEnt) {
        broadcastBattle(bRoom, { t: "joined", ent: myEnt }, pSid);
      }
      break;
    }

    case "loaded":
    case "spawnme": {
      const player = bRoom.players.get(pSid);
      if (player) {
        player.spawned = true;
        player.dead = false;
        player.hp = player.maxHp || 100;
      }
      // Broadcast spawn of this player to all clients in battle
      broadcastBattle(bRoom, { t: "spawn", id: pSid });

      // Send existing spawned players to this client so they show up
      bRoom.players.forEach((p, otherSid) => {
        if (otherSid !== pSid && p.spawned) {
          sendWs(socket, JSON.stringify({ t: "spawn", id: otherSid }));
        }
      });

      // Send current snapshot of all active entities so the newly spawned player sees everyone immediately
      if (bRoom.entities.size > 0) {
        sendWs(
          socket,
          JSON.stringify({
            t: "st",
            ts: Date.now(),
            ents: Array.from(bRoom.entities.values())
          })
        );
      }

      // If mode is zombie, start alpha countdown
      if (dbRoom?.mode === "zombie" && !bRoom.alphaChosen && !bRoom.zombieTimer) {
        bRoom.zombieTimer = setTimeout(() => {
          bRoom.alphaChosen = true;
          const playerIds = Array.from(bRoom.players.keys());
          if (playerIds.length > 0) {
            const alphaSid = playerIds[Math.floor(Math.random() * playerIds.length)];
            const alphaPlayer = bRoom.players.get(alphaSid);
            if (alphaPlayer) {
              alphaPlayer.isZombie = true;
              alphaPlayer.hp = 2000;
              alphaPlayer.maxHp = 2000;
            }
            broadcastBattle(bRoom, { t: "zinf", ids: [alphaSid], alpha: true });
          }
        }, 12000); // 12s countdown to alpha infection
      }
      break;
    }

    case "st": {
      // 1. Update entities in battle room memory
      if (Array.isArray(bMsg.ents)) {
        for (const ent of bMsg.ents) {
          if (ent && ent.id) {
            bRoom.entities.set(ent.id, {
              id: ent.id,
              p: ent.p || [0, 0, 0],
              y: ent.y || 0,
              pi: ent.pi || 0,
              c: ent.c || 0,
              g: ent.g !== undefined ? ent.g : 1,
              r: ent.r || 0,
              mv: ent.mv || [0, 0],
              w: ent.w || "aug",
              ts: bMsg.ts || Date.now()
            });
          }
        }
      }

      // 2. Immediately forward this client's movement to all other clients in this battle room
      const fwd = JSON.stringify({
        t: "st",
        ts: bMsg.ts || Date.now(),
        from: pSid,
        ents: bMsg.ents || []
      });
      bRoom.clients.forEach((cSocket, cSid) => {
        if (cSid !== pSid && cSocket !== socket) {
          sendWs(cSocket, fwd);
        }
      });
      break;
    }

    case "hit": {
      // { t: "hit", target: string, from: string, dmg: number, head: boolean, helm: number, w: any }
      const target = bRoom.players.get(bMsg.target);
      const shooter = bRoom.players.get(bMsg.from || pSid);
      if (target && !target.dead) {
        const dmg = Math.round(Number(bMsg.dmg) || 25);
        target.hp = Math.max(0, target.hp - dmg);

        if (target.hp <= 0) {
          target.hp = 0;
          target.dead = true;
          target.deaths = (target.deaths || 0) + 1;
          if (shooter) shooter.kills = (shooter.kills || 0) + 1;

          // Broadcast kill packet
          broadcastBattle(bRoom, {
            t: "kill",
            victim: target.id,
            killer: shooter ? shooter.id : pSid,
            head: !!bMsg.head,
            w: bMsg.w || "aug"
          });

          // Update scores
          if (shooter) {
            if (shooter.team === 0) bRoom.scores.red++;
            else bRoom.scores.blue++;
          }
          broadcastBattle(bRoom, {
            t: "round",
            score: [bRoom.scores.red, bRoom.scores.blue]
          });

          // Zombie mode infection handling
          if (dbRoom?.mode === "zombie") {
            target.dead = false;
            target.hp = 1000;
            target.maxHp = 1000;
            target.isZombie = true;
            broadcastBattle(bRoom, { t: "zinf", ids: [target.id] });
            const survivors = Array.from(bRoom.players.values()).filter(p => !p.isZombie);
            if (survivors.length === 1) {
              broadcastBattle(bRoom, { t: "zlast", id: survivors[0].id });
            } else if (survivors.length === 0) {
              broadcastBattle(bRoom, {
                t: "rend",
                type: "zombie_win",
                score: [bRoom.scores.red, bRoom.scores.blue]
              });
            }
          }

          // Check win condition for Deathmatch
          const killLimit = dbRoom?.kills || 100;
          if (bRoom.scores.red >= killLimit || bRoom.scores.blue >= killLimit) {
            broadcastBattle(bRoom, {
              t: "end",
              winner: bRoom.scores.red >= killLimit ? 0 : 1,
              score: [bRoom.scores.red, bRoom.scores.blue],
              ents: Array.from(bRoom.players.values())
            });
          }
        } else {
          // Broadcast updated HP
          broadcastBattle(bRoom, {
            t: "hp",
            id: target.id,
            hp: target.hp
          });
        }
      }
      break;
    }

    case "fx": {
      // Relay animation/action fx (e.g. up animation, nade, radio) to other players
      broadcastBattle(bRoom, bMsg, pSid);
      break;
    }

    case "chat": {
      const sender = bRoom.players.get(pSid);
      broadcastBattle(bRoom, {
        t: "chat",
        from: sender?.nick || "Soldier",
        text: String(bMsg.text || "").slice(0, 150),
        team: bMsg.team || false
      });
      break;
    }

    case "arm":
    case "disarm":
    case "planted": {
      broadcastBattle(bRoom, bMsg, pSid);
      break;
    }

    case "pg": {
      sendWs(socket, JSON.stringify({ t: "po", s: bMsg.s }));
      break;
    }

    case "leavegame": {
      broadcastBattle(bRoom, { t: "gone", id: pSid });
      bRoom.clients.delete(pSid);
      bRoom.entities.delete(pSid);
      bRoom.players.delete(pSid);
      break;
    }

    default:
      if (bMsg.req) {
        sendWs(socket, JSON.stringify({ req: bMsg.req, ok: true }));
      }
  }
}

// -----------------------------------------------------------------------------
// WebSocket Upgrade Listener
// -----------------------------------------------------------------------------
server.on("upgrade", (req, socket) => {
  const reqUrl = url.parse(req.url, true);
  const pathname = reqUrl.pathname;
  const sid = crypto.randomBytes(8).toString("hex");

  const secKey = req.headers["sec-websocket-key"];
  if (!secKey) {
    socket.destroy();
    return;
  }

  const sha1 = crypto.createHash("sha1");
  sha1.update(secKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  const acceptKey = sha1.digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  let rawBuffer = Buffer.alloc(0);

  // Check route: Lobby or Battle
  const isBattle = pathname.startsWith("/b");
  const battleRoomId = isBattle ? pathname.slice(2) : null;

  if (isBattle) {
    const battle = getOrCreateBattleRoom(battleRoomId);
    battle.clients.set(sid, socket);
    console.log(`[⚔️ BATTLE] Player ${sid} joined battle room: #${battleRoomId}`);
  } else {
    lobbyClients.set(sid, { socket, user: null });
    console.log(`[👑 LOBBY] Client ${sid} connected to Lobby.`);
  }

  socket.on("data", chunk => {
    rawBuffer = Buffer.concat([rawBuffer, chunk]);

    while (rawBuffer.length > 0) {
      const frame = parseWebSocketFrame(rawBuffer);
      if (!frame) break;
      rawBuffer = rawBuffer.slice(frame.totalLength);

      if (frame.opcode === 0x08) {
        // Close frame
        socket.end();
        break;
      }

      if (frame.opcode === 0x01) {
        // Text JSON Frame
        const text = frame.payload.toString("utf8");
        if (isBattle) {
          // Handle in-game events (fire, hits, chat, spawn, sync)
          try {
            const bMsg = JSON.parse(text);
            handleBattleMessage(socket, sid, battleRoomId, bMsg);
          } catch (e) {}
        } else {
          handleLobbyMessage(socket, sid, text);
        }
      } else if (frame.opcode === 0x02) {
        // Binary State Frame (Type 1 S(e) packet from client)
        if (isBattle) {
          const bRoom = battleRooms.get(battleRoomId);
          if (bRoom) {
            const senderSid = socket.playerSid || sid;
            // Forward / update entity state to all other players
            bRoom.clients.forEach((cSocket, cSid) => {
              if (cSid !== senderSid && cSocket !== socket) {
                sendWs(cSocket, frame.payload, true);
              }
            });
          }
        }
      }
    }
  });

  socket.on("close", () => {
    if (isBattle) {
      const bRoom = battleRooms.get(battleRoomId);
      if (bRoom) {
        const pSid = socket.playerSid || sid;
        broadcastBattle(bRoom, { t: "gone", id: pSid });
        bRoom.clients.delete(pSid);
        bRoom.clients.delete(sid);
        bRoom.entities.delete(pSid);
        bRoom.entities.delete(sid);
        bRoom.players.delete(pSid);
        bRoom.players.delete(sid);
        if (bRoom.clients.size === 0) {
          clearInterval(bRoom.tickTimer);
          if (bRoom.zombieTimer) clearTimeout(bRoom.zombieTimer);
          battleRooms.delete(battleRoomId);
        }
      }
    } else {
      const res = db.leaveRoom(sid);
      if (res && res.room) {
        broadcastRoom(res.room);
      }
      lobbyClients.delete(sid);
      broadcastLobby({ t: "rooms", list: db.getRoomList() });
    }
  });

  socket.on("error", () => {});
});

// -----------------------------------------------------------------------------
// Start Server
// -----------------------------------------------------------------------------
server.listen(PORT, "0.0.0.0", () => {
  console.log(`
======================================================
  POINT BLANK DEDICATED GAME SERVER (Node.js)
======================================================
  [HTTP / Web]
  🎮 Game Client:    http://localhost:${PORT}/
  📊 Admin Studio:   http://localhost:${PORT}/admin
  🎯 3D Viewer:      http://localhost:${PORT}/viewer

  [WebSocket Endpoints]
  👑 Lobby Server:   ws://localhost:${PORT}/ws
  ⚔️ Battle Server:  ws://localhost:${PORT}/b{roomId}
======================================================
`);
});
