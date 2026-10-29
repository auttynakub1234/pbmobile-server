#!/usr/bin/env node
/**
 * Point Blank Mobile (PBMobile) Real-time WebSocket Packet Sniffer
 * Connects to the lobby server and inspects live room events, system notices, and chats.
 */

const nick = "Observer_" + Math.floor(Math.random() * 10000);
const wsUrl = "wss://pbmobile.app/ws";

console.log(`[+] Connecting to PBMobile WebSocket: ${wsUrl}`);
console.log(`[+] Temporary Observer Nickname: ${nick}`);

const ws = new WebSocket(wsUrl, {
  headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
});

ws.onopen = () => {
  console.log(`[✓] WebSocket Connected! Sending handshake 'hello'...`);
  ws.send(
    JSON.stringify({
      t: "hello",
      nick: nick,
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
  const raw = event.data;
  if (typeof raw !== "string") {
    console.log(`[BINARY PACKET] Received ${raw.byteLength || raw.length} bytes`);
    return;
  }

  try {
    const msg = JSON.parse(raw);
    const time = new Date().toLocaleTimeString();

    switch (msg.t) {
      case "welcome":
        console.log(`[${time}] [WELCOME] Session ID: ${msg.sid} | Edge server: ${msg.edge || "default"}`);
        // Request rooms & online users
        ws.send(JSON.stringify({ t: "rooms" }));
        break;

      case "rooms":
        console.log(`[${time}] [ROOMS] Active Rooms: ${msg.rooms ? msg.rooms.length : 0}`);
        if (msg.rooms && msg.rooms.length > 0) {
          msg.rooms.forEach((r, idx) => {
            console.log(`   #${idx + 1} [${r.name}] Map: ${r.map} | Mode: ${r.mode} | Players: ${r.cur}/${r.max} | State: ${r.state}`);
          });
        } else {
          console.log(`   (No active matches currently in lobby)`);
        }
        break;

      case "chat":
        console.log(`[${time}] [CHAT] [${msg.from}]: ${msg.text}`);
        break;

      case "whisper":
        console.log(`[${time}] [WHISPER] [${msg.from}]: ${msg.text}`);
        break;

      case "notice":
      case "center":
        console.log(`[${time}] [ANNOUNCEMENT] ${msg.text || msg.msg}`);
        break;

      case "pg":
        // Ping response to keep alive
        ws.send(JSON.stringify({ t: "po", s: msg.s }));
        break;

      default:
        console.log(`[${time}] [${msg.t}] ${JSON.stringify(msg).slice(0, 150)}`);
    }
  } catch (err) {
    console.error(`[!] Error parsing message:`, err.message);
  }
};

ws.onerror = (e) => console.error(`[!] WS Error:`, e.message);
ws.onclose = (e) => console.log(`[-] Connection closed. Code: ${e.code}, Reason: ${e.reason}`);

// Keep running for 15 seconds unless interrupted
setTimeout(() => {
  console.log(`\n[+] Sniffer completed run. Disconnecting...`);
  ws.close();
  process.exit(0);
}, 15000);
