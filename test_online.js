/**
 * Complete Online Multiplayer Two-Player Simulation Test
 */
const cp = require("child_process");

console.log("🚀 Starting dedicated game server for online multiplayer test...");
const serverProc = cp.spawn("node", ["pb_server.js"], {
  cwd: __dirname,
  stdio: ["ignore", "pipe", "pipe"]
});

setTimeout(async () => {
  const port = 3000;
  try {
    console.log("Connecting Player 1 (Host) and Player 2 (Client)...");

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
          console.log(`[P1 Lobby] Room created successfully! Room ID: ${createdRoomId}, AI: ${msg.room.ai}`);
          if (p2Sid && !p2Joined) {
            p2Joined = true;
            p2Lobby.send(JSON.stringify({ t: "join", id: createdRoomId }));
          }
        } else if (!matchStarted) {
          const p2InRoom = (msg.room.members || []).find(m => m.id === p2Sid || m.nick === "Blue_Sniper");
          if (p2InRoom && p2InRoom.ready) {
            matchStarted = true;
            console.log("[P1 Lobby] Both players ready! Red_Leader starting match...");
            p1Lobby.send(JSON.stringify({ t: "start" }));
          }
        }
      } else if (msg.t === "start") {
        console.log("[P1 Lobby] Received START packet! Battle endpoint:", msg.battle.u);
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
        console.log("[P2 Lobby] Received START packet! Connecting to battle...");
        connectP2Battle(msg.battle.u, msg.battle.k);
      }
    };

    let p1Spawned = false, p2Spawned = false;

    function connectP1Battle(u, k) {
      const p1Battle = new WebSocket(`ws://127.0.0.1:${port}${u}?k=${k}`);
      p1Battle.onopen = () => {
        p1Battle.send(JSON.stringify({ t: "resume", sid: p1Sid, nick: "Red_Leader" }));
      };
      p1Battle.onmessage = be => {
        if (typeof be.data === "string") {
          const m = JSON.parse(be.data);
          if (m.t === "welcome") {
            p1Battle.send(JSON.stringify({ t: "ingame" }));
          } else if (m.t === "game") {
            console.log(`[P1 Battle] In-game state loaded! Total entities in match: ${m.game.ents.length}`);
            p1Battle.send(JSON.stringify({ t: "loaded" }));
            p1Battle.send(JSON.stringify({ t: "spawnme" }));
          } else if (m.t === "spawn" && m.id === p1Sid) {
            console.log("[✓] [P1 Battle] Red_Leader spawned into 3D world!");
            p1Spawned = true;
            checkCombat(p1Battle);
          }
        }
      };
    }

    function connectP2Battle(u, k) {
      const p2Battle = new WebSocket(`ws://127.0.0.1:${port}${u}?k=${k}`);
      p2Battle.onopen = () => {
        p2Battle.send(JSON.stringify({ t: "resume", sid: p2Sid, nick: "Blue_Sniper" }));
      };
      p2Battle.onmessage = be => {
        if (typeof be.data === "string") {
          const m = JSON.parse(be.data);
          if (m.t === "welcome") {
            p2Battle.send(JSON.stringify({ t: "ingame" }));
          } else if (m.t === "game") {
            console.log(`[P2 Battle] In-game state loaded! Total entities in match: ${m.game.ents.length}`);
            p2Battle.send(JSON.stringify({ t: "loaded" }));
            p2Battle.send(JSON.stringify({ t: "spawnme" }));
          } else if (m.t === "spawn" && m.id === p2Sid) {
            console.log("[✓] [P2 Battle] Blue_Sniper spawned into 3D world!");
            p2Spawned = true;
          } else if (m.t === "hp") {
            console.log(`[✓] [P2 Battle] Took damage! HP updated: ${m.hp}`);
          } else if (m.t === "kill") {
            console.log(`[✓] [Battle Kill Broadcast] Killer: ${m.killer} -> Victim: ${m.victim} (Headshot: ${m.head})`);
            console.log("\n==================================================");
            console.log("🎉 TWO-PLAYER ONLINE MULTIPLAYER FULLY VERIFIED!");
            console.log("==================================================");
            p1Lobby.close();
            p2Lobby.close();
            serverProc.kill("SIGTERM");
            setTimeout(() => process.exit(0), 400);
          }
        }
      };
    }

    function checkCombat(p1Battle) {
      const checkInterval = setInterval(() => {
        if (p1Spawned && p2Spawned) {
          clearInterval(checkInterval);
          console.log("[Combat] Red_Leader firing AUG-A3 at Blue_Sniper...");
          p1Battle.send(JSON.stringify({
            t: "hit",
            from: p1Sid,
            target: p2Sid,
            dmg: 100,
            head: true,
            w: "100003001"
          }));
        }
      }, 500);
    }

  } catch (err) {
    console.error("Online test failed:", err);
    serverProc.kill("SIGTERM");
    process.exit(1);
  }
}, 2000);
