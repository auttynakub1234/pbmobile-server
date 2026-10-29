#!/usr/bin/env node
/**
 * Point Blank Mobile (PBMobile) Protocol Inspector & Live Sniffer
 * Features:
 * - Live Rooms Explorer (Map, Mode, Players, Host, State)
 * - Player Profile & Stats Inspector (KD, Headshot %, Loadout)
 * - Live Event & Chat Sniffer
 */

function createWsClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://pbmobile.app/ws", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          t: "hello",
          nick: "Inspector_" + Math.floor(Math.random() * 1000),
          plat: "pc",
          cross: false,
          dev: "dev-" + Math.random().toString(36).slice(2),
          fp: "a1b2c3d4.100",
          sts: 1,
          bin: 1
        })
      );
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.t === "welcome") {
          resolve({ ws, welcome: msg });
        }
      } catch (e) {}
    };
    ws.onerror = reject;
    setTimeout(() => reject(new Error("Timeout connecting to WebSocket")), 6000);
  });
}

function sendRpc(ws, data) {
  return new Promise((resolve, reject) => {
    const reqId = Math.floor(Math.random() * 100000);
    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.req === reqId || msg.t === data.t) {
          ws.removeEventListener("message", handler);
          resolve(msg);
        }
      } catch (e) {}
    };
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify(Object.assign({ req: reqId }, data)));
    setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error("RPC Timeout for " + data.t));
    }, 6000);
  });
}

async function showRooms() {
  console.log(`[+] Connecting to live PBMobile server...`);
  const { ws } = await createWsClient();
  const res = await sendRpc(ws, { t: "rooms" });
  ws.close();

  const rooms = res.list || [];
  console.log(`\n========================================================================`);
  console.log(`  PBMOBILE LIVE MATCHES (Total Active: ${rooms.length})`);
  console.log(`========================================================================`);

  if (rooms.length === 0) {
    console.log(`  (No active matches currently)`);
  } else {
    console.log(
      `ID    | MAP             | PLAYERS | STATE     | MODE | HOST NICKNAME       | ROOM TITLE`
    );
    console.log(`------+-----------------+---------+-----------+------+---------------------+-------------------`);
    rooms.forEach((r) => {
      const id = String(r.id).padEnd(5);
      const map = (r.map || "Unknown").padEnd(15);
      const players = `${r.players || 0}/16`.padEnd(7);
      const state = (r.state || "Waiting").padEnd(9);
      const mode = (r.mode || "dm").toUpperCase().padEnd(4);
      const host = (r.hostNick || "Unknown").padEnd(19);
      const title = r.title || "";
      console.log(`${id} | ${map} | ${players} | ${state} | ${mode} | ${host} | ${title}`);
    });
  }
  console.log(`========================================================================\n`);
}

async function showProfile(nickname) {
  console.log(`[+] Inspecting profile for player: "${nickname}"...`);
  const { ws } = await createWsClient();
  const res = await sendRpc(ws, { t: "profile", nick: nickname });
  ws.close();

  const p = res.profile;
  if (!p) {
    console.log(`[-] Player "${nickname}" not found or has no profile.`);
    return;
  }

  const s = p.stats || {};
  const kd = s.deaths > 0 ? ((s.kills / s.deaths) * 100).toFixed(1) + "%" : "100%";
  const hsRate = s.kills > 0 ? (((s.heads || 0) / s.kills) * 100).toFixed(1) + "%" : "0%";
  const winRate = (s.wins + s.loses) > 0 ? (((s.wins) / (s.wins + s.loses)) * 100).toFixed(1) + "%" : "0%";

  console.log(`
======================================================
  PLAYER PROFILE: ${p.nick}
======================================================
  Clan:             ${p.clan || "No Clan"} (${p.clanRank || "-"})
  Rank Position:    #${p.pos || "N/A"}
  Experience (EXP): ${s.exp || 0} (Next Rank: ${s.next || 0})

  [COMBAT STATISTICS]
  Matches Played:   ${s.matches || 0} (W: ${s.wins || 0} / L: ${s.loses || 0} / D: ${s.draws || 0})
  Win Rate:         ${winRate}
  Kills / Deaths:   ${s.kills || 0} / ${s.deaths || 0} (K/D: ${kd})
  Headshots:        ${s.heads || 0} (HS Rate: ${hsRate})
  Assists:          ${s.assists || 0}

  [LOADOUT / EQUIPPED]
  Red Team Chara:   ${p.equip?.red || "-"}
  Blue Team Chara:  ${p.equip?.blue || "-"}
  Primary Weapon:   ${p.equip?.["1"] || "-"}
  Secondary Pistol: ${p.equip?.["2"] || "-"}
  Melee Knife:      ${p.equip?.["3"] || "-"}
  Explosive:        ${p.equip?.["4"] || "-"}
  Beret / Headgear: ${p.equip?.Beret || "None"}
======================================================
`);
}

async function liveStream() {
  console.log(`[+] Starting Live Protocol Monitor (Streaming real-time events)...`);
  const { ws, welcome } = await createWsClient();
  console.log(`[✓] Connected! Session: ${welcome.sid}`);
  console.log(`[+] Listening for chat, room updates, and announcements... (Ctrl+C to stop)\n`);

  ws.send(JSON.stringify({ t: "rooms" }));

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") {
      console.log(`[BINARY FRAME] Received ${event.data.byteLength} bytes`);
      return;
    }
    const msg = JSON.parse(event.data);
    const time = new Date().toLocaleTimeString();

    if (msg.t === "chat") {
      console.log(`[${time}] 💬 [CHAT] [${msg.from}]: ${msg.text}`);
    } else if (msg.t === "whisper") {
      console.log(`[${time}] 🔒 [WHISPER] [${msg.from}]: ${msg.text}`);
    } else if (msg.t === "notice" || msg.t === "center") {
      console.log(`[${time}] 📢 [NOTICE] ${msg.text || msg.msg}`);
    } else if (msg.t === "rooms") {
      console.log(`[${time}] 🔄 [ROOMS UPDATE] ${msg.list ? msg.list.length : 0} active match(es)`);
    } else if (msg.t === "pg") {
      ws.send(JSON.stringify({ t: "po", s: msg.s }));
    }
  };
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "rooms") {
  showRooms().catch(console.error);
} else if (cmd === "profile") {
  showProfile(args[1] || "INF_Feruzi").catch(console.error);
} else if (cmd === "live") {
  liveStream().catch(console.error);
} else {
  console.log(`
PBMobile Protocol Inspector & Live Sniffer
Usage:
  node protocol_inspector.js rooms              (View all live rooms/matches)
  node protocol_inspector.js profile <nickname> (View player stats, K/D, equipment)
  node protocol_inspector.js live               (Stream real-time chat & events)
`);
}
