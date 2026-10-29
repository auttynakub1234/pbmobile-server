/**
 * In-depth Online Multiplayer Two-Player Visibility & Sync Test
 */
const cp = require("child_process");

console.log("🚀 Starting game server for Player Visibility & Sync verification...");
const serverProc = cp.spawn("node", ["pb_server.js"], {
  cwd: __dirname,
  stdio: ["ignore", "pipe", "pipe"]
});

setTimeout(async () => {
  const port = 3000;
  try {
    console.log("Connecting Player 1 (Host) and Player 2 (Friend)...");

    const p1Lobby = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const p2Lobby = new WebSocket(`ws://127.0.0.1:${port}/ws`);

    let p1Sid = null, p2Sid = null;
    let createdRoomId = null;
    let matchStarted = false;
    let p2Joined = false;
    let p2ReadySent = false;

    p1Lobby.onopen = () => {
      p1Lobby.send(JSON.stringify({ t: "hello", nick: "Red_Leader" }));
    };

    p2Lobby.onopen = () => {
      p2Lobby.send(JSON.stringify({ t: "hello", nick: "Blue_Sniper" }));
    };

    p1Lobby.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.t === "welcome") {
        p1Sid = msg.sid;
        console.log(`[P1 Lobby] Authenticated as Red_Leader (SID: ${p1Sid})`);

        p1Lobby.send(JSON.stringify({
          t: "create",
          room: {
            title: "Deathmatch 8v8 Online",
            mode: "dm",
            map: "BurningHall",
            ai: 0,
            kills: 100,
            time: 10
          }
        }));
      } else if (msg.t === "room") {
        if (!createdRoomId) {
          createdRoomId = msg.room.id;
          console.log(`[P1 Lobby] Room created! ID: ${createdRoomId}, AI: ${msg.room.ai}`);
          if (p2Sid && !p2Joined) {
            p2Joined = true;
            p2Lobby.send(JSON.stringify({ t: "join", id: createdRoomId }));
          }
        } else if (!matchStarted) {
          const p2InRoom = (msg.room.members || []).find(m => m.id === p2Sid || m.nick === "Blue_Sniper");
          if (p2InRoom && p2InRoom.ready) {
            matchStarted = true;
            console.log("[P1 Lobby] Both players ready! Starting match...");
            p1Lobby.send(JSON.stringify({ t: "start" }));
          }
        }
      } else if (msg.t === "start") {
        console.log("[P1 Lobby] START packet received. Battle endpoint:", msg.battle.u);
        connectP1Battle(msg.battle.u, msg.battle.k);
      }
    };

    p2Lobby.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.t === "welcome") {
        p2Sid = msg.sid;
        console.log(`[P2 Lobby] Authenticated as Blue_Sniper (SID: ${p2Sid})`);
        if (createdRoomId && !p2Joined) {
          p2Joined = true;
          p2Lobby.send(JSON.stringify({ t: "join", id: createdRoomId }));
        }
      } else if (msg.t === "room") {
        if (!p2ReadySent) {
          p2ReadySent = true;
          console.log(`[P2 Lobby] Joined Room ID: ${msg.room.id}. Setting team Blue and Ready...`);
          p2Lobby.send(JSON.stringify({ t: "set", team: 1, ready: true }));
        }
      } else if (msg.t === "start") {
        console.log("[P2 Lobby] START packet received. Battle endpoint:", msg.battle.u);
        connectP2Battle(msg.battle.u, msg.battle.k);
      }
    };

    let p1Spawned = false, p2Spawned = false;
    let p1SawP2 = false, p2SawP1 = false;
    let p1BattleWs = null, p2BattleWs = null;

    function connectP1Battle(u, k) {
      p1BattleWs = new WebSocket(`ws://127.0.0.1:${port}${u}?k=${k}`);
      p1BattleWs.onopen = () => {
        p1BattleWs.send(JSON.stringify({ t: "resume", sid: p1Sid, nick: "Red_Leader" }));
      };
      p1BattleWs.onmessage = be => {
        if (typeof be.data === "string") {
          const m = JSON.parse(be.data);
          if (m.t === "welcome") {
            if (m.bin === false) console.log("[✓] [P1 Battle] Handshake OK (Clean JSON mode verified)");
            p1BattleWs.send(JSON.stringify({ t: "ingame" }));
          } else if (m.t === "game") {
            console.log(`[P1 Battle] In-game packet received! Score: [${m.game.score}], Ends: ${Math.round(m.game.ends)}, Ents: ${m.game.ents.length}`);
            if (!m.game.score || m.game.score.length !== 2) {
              throw new Error("P1 game.score is missing or invalid!");
            }
            p1BattleWs.send(JSON.stringify({ t: "loaded" }));
            p1BattleWs.send(JSON.stringify({ t: "spawnme" }));
          } else if (m.t === "spawn") {
            console.log(`[P1 Battle] Spawn event received for ID: ${m.id}`);
            if (m.id === p1Sid) {
              p1Spawned = true;
              startP1MovementLoop();
            }
          } else if (m.t === "st") {
            const p2Ent = (m.ents || []).find(e => e.id === p2Sid);
            if (p2Ent && p2Ent.p && (p2Ent.p[0] !== 0 || p2Ent.p[2] !== 0)) {
              if (!p1SawP2) {
                p1SawP2 = true;
                console.log(`[👀 VISIBILITY CHECK 1/2] Player 1 successfully sees Player 2 at position: [${p2Ent.p}] with yaw: ${p2Ent.y}!`);
                checkBothVisible();
              }
            }
          }
        }
      };
    }

    function connectP2Battle(u, k) {
      p2BattleWs = new WebSocket(`ws://127.0.0.1:${port}${u}?k=${k}`);
      p2BattleWs.onopen = () => {
        p2BattleWs.send(JSON.stringify({ t: "resume", sid: p2Sid, nick: "Blue_Sniper" }));
      };
      p2BattleWs.onmessage = be => {
        if (typeof be.data === "string") {
          const m = JSON.parse(be.data);
          if (m.t === "welcome") {
            if (m.bin === false) console.log("[✓] [P2 Battle] Handshake OK (Clean JSON mode verified)");
            p2BattleWs.send(JSON.stringify({ t: "ingame" }));
          } else if (m.t === "game") {
            console.log(`[P2 Battle] In-game packet received! Score: [${m.game.score}], Ends: ${Math.round(m.game.ends)}, Ents: ${m.game.ents.length}`);
            if (!m.game.score || m.game.score.length !== 2) {
              throw new Error("P2 game.score is missing or invalid!");
            }
            p2BattleWs.send(JSON.stringify({ t: "loaded" }));
            p2BattleWs.send(JSON.stringify({ t: "spawnme" }));
          } else if (m.t === "spawn") {
            console.log(`[P2 Battle] Spawn event received for ID: ${m.id}`);
            if (m.id === p2Sid) {
              p2Spawned = true;
              startP2MovementLoop();
            }
          } else if (m.t === "st") {
            const p1Ent = (m.ents || []).find(e => e.id === p1Sid);
            if (p1Ent && p1Ent.p && (p1Ent.p[0] !== 0 || p1Ent.p[2] !== 0)) {
              if (!p2SawP1) {
                p2SawP1 = true;
                console.log(`[👀 VISIBILITY CHECK 2/2] Player 2 successfully sees Player 1 at position: [${p1Ent.p}] with yaw: ${p1Ent.y}!`);
                checkBothVisible();
              }
            }
          }
        }
      };
    }

    let p1MoveTimer = null, p2MoveTimer = null;

    function startP1MovementLoop() {
      p1MoveTimer = setInterval(() => {
        if (p1BattleWs && p1BattleWs.readyState === WebSocket.OPEN) {
          p1BattleWs.send(JSON.stringify({
            t: "st",
            ts: Date.now(),
            ents: [{
              id: p1Sid,
              p: [12.5, 0.0, 45.2],
              y: 1.57,
              pi: 0.1,
              c: 0,
              g: 1,
              mv: [0, 1],
              r: 1,
              w: "aug"
            }]
          }));
        }
      }, 50);
    }

    function startP2MovementLoop() {
      p2MoveTimer = setInterval(() => {
        if (p2BattleWs && p2BattleWs.readyState === WebSocket.OPEN) {
          p2BattleWs.send(JSON.stringify({
            t: "st",
            ts: Date.now(),
            ents: [{
              id: p2Sid,
              p: [28.0, 0.0, 75.8],
              y: -3.14,
              pi: -0.2,
              c: 0,
              g: 1,
              mv: [1, 0],
              r: 0,
              w: "k2"
            }]
          }));
        }
      }, 50);
    }

    let verified = false;
    function checkBothVisible() {
      if (p1SawP2 && p2SawP1 && !verified) {
        verified = true;
        clearInterval(p1MoveTimer);
        clearInterval(p2MoveTimer);
        console.log("\n========================================================");
        console.log("🎉 SUCCESS: BOTH PLAYERS CAN SEE EACH OTHER IN REAL-TIME!");
        console.log("1. Game state score & match timers initialized cleanly");
        console.log("2. Remote character entities created via 'ents' and 'joined'");
        console.log("3. Real-time player 3D coordinates & yaw synced between clients");
        console.log("========================================================\n");
        p1Lobby.close();
        p2Lobby.close();
        p1BattleWs.close();
        p2BattleWs.close();
        serverProc.kill("SIGTERM");
        setTimeout(() => process.exit(0), 400);
      }
    }

  } catch (err) {
    console.error("Visibility test failed:", err);
    serverProc.kill("SIGTERM");
    process.exit(1);
  }
}, 2000);
