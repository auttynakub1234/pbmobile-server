/**
 * Point Blank Mobile Server - Database & State Store
 * Manages accounts, player profiles, inventory, equipment, and room states.
 */

const fs = require("fs");
const path = require("path");

class PbDatabase {
  constructor() {
    this.users = new Map();
    this.rooms = new Map();
    this.nextRoomId = 1001;

    // Load static game definitions
    this.weapons = [];
    this.goods = {};
    this.titles = [];
    this.ranks = [];
    this.charas = [];

    this.initData();
    // Default server rooms
    const adminUser = this.getOrCreateUser("Commander", "host_admin_sid");
    this.createRoom({ title: "💥 5v5 Deathmatch Burning Hall", map: "BurningHall", mode: "dm", kills: 100, hostUser: adminUser });
    this.createRoom({ title: "💣 8v8 Bomb Mission Luxville", map: "Luxville", mode: "bomb", kills: 160, hostUser: adminUser });
    this.createRoom({ title: "🤖 AI Bot Training (ซ้อมกับบอท)", map: "BurningHall", mode: "dm", kills: 100, ai: 1, enemies: 4, dif: 1, hostUser: adminUser });
  }

  initData() {
    const dataDir = path.join(__dirname, "data");
    try {
      if (fs.existsSync(path.join(dataDir, "weapons.json"))) {
        this.weapons = JSON.parse(fs.readFileSync(path.join(dataDir, "weapons.json"), "utf8")).weapons || [];
      }
      if (fs.existsSync(path.join(dataDir, "goods.json"))) {
        this.goods = JSON.parse(fs.readFileSync(path.join(dataDir, "goods.json"), "utf8")).goods || {};
      }
      if (fs.existsSync(path.join(dataDir, "titles.json"))) {
        this.titles = JSON.parse(fs.readFileSync(path.join(dataDir, "titles.json"), "utf8")).titles || [];
      }
      if (fs.existsSync(path.join(dataDir, "ranks.json"))) {
        this.ranks = JSON.parse(fs.readFileSync(path.join(dataDir, "ranks.json"), "utf8")) || [];
      }
      if (fs.existsSync(path.join(dataDir, "charas.json"))) {
        this.charas = JSON.parse(fs.readFileSync(path.join(dataDir, "charas.json"), "utf8")).charas || [];
      }
    } catch (e) {
      console.warn("[!] Warning loading static data:", e.message);
    }
  }

  getOrCreateUser(nickname, sid) {
    const cleanNick = (nickname || "Player").trim();
    if (!this.users.has(cleanNick)) {
      const newUser = {
        sid: sid,
        login: cleanNick,
        nick: cleanNick,
        pos: Math.floor(Math.random() * 500) + 1,
        clan: "PointBlank_Legends",
        clanRank: "Leader",
        clanLv: 5,
        clanMark: 167839747,
        clanFx: 5,
        card: "3400084",
        ranked: null,
        nc: 1,
        fx: 5,
        stats: {
          exp: 154200,
          rank: 26, // Captain
          kills: 1420,
          deaths: 580,
          heads: 980,
          assists: 310,
          wins: 85,
          loses: 15,
          draws: 2,
          matches: 102,
          base: 100000,
          next: 200000
        },
        points: 500000,
        cash: 100000,
        equip: {
          "1": "aug",        // Primary: AUG A3
          "2": "k5",         // Secondary: K-5 Pistol
          "3": "301004",     // Melee: Fang Blade / Dual Knife
          "4": "k400",       // Throw: K-400 Grenade
          "5": "508001",
          red: "viperred",   // Red Team Character
          blue: "hide",      // Blue Team Character
          Beret: "2700004",  // Champion Beret
          Facegear: "800019",
          namecard: "3400084"
        },
        inventory: [
          "aug", "m4a1", "ak47", "k2", "kriss", "cheytac", "p90", "m1887",
          "k5", "301004", "k400", "viperred", "tarantula", "hide", "acidpol", "leopard",
          "2700004", "800019"
        ]
      };
      this.users.set(cleanNick, newUser);
    }

    const user = this.users.get(cleanNick);
    user.sid = sid;
    return user;
  }

  createRoom({ title, map, mode, kills, time, ai, enemies, dif, pw, lock, obs, joinBlock, balance, sp, hostUser }) {
    const roomId = this.nextRoomId++;
    const isAi = ai ? 1 : 0;
    const enemyCount = Number(enemies) || (isAi ? 4 : 0);
    const roomDif = Number(dif) || 1;
    const hostTeam = 0;
    const bots = isAi ? [0, enemyCount] : [0, 0];

    const room = {
      id: roomId,
      title: title || `Room #${roomId}`,
      map: map || "BurningHall",
      mode: mode || "dm",
      kills: Number(kills) || 100,
      time: Number(time) || 10,
      state: "Esperando", // Esperando = Waiting, Jogando = Playing
      pw: pw || false,
      lock: lock || { p: true, s: true, m: true, t: true, rpg: false },
      obs: obs || { tp: false, fc: false, en: false, hp: false },
      joinBlock: !!joinBlock,
      balance: balance !== undefined ? balance : 1,
      sp: sp || "",
      srv: null,
      cfr: false,
      tag: null,
      ban: [],
      ai: isAi,
      enemies: enemyCount,
      dif: roomDif,
      bots: bots,
      closed: [new Array(8).fill(false), new Array(8).fill(false)],
      nov: true,
      players: 1,
      host: hostUser.sid,
      hostNick: hostUser.nick,
      reg: "asia",
      slots: [
        {
          id: hostUser.sid,
          sid: hostUser.sid,
          nick: hostUser.nick,
          team: hostTeam,
          ready: true,
          host: true,
          chara: hostUser.equip?.red || hostUser.chara || "redbulls",
          weapon: hostUser.equip?.[1] || hostUser.weapon || "aug",
          pos: hostUser.pos || 1,
          rank: hostUser.stats?.rank || 26,
          card: hostUser.card || "",
          nc: hostUser.nc || 0,
          fx: hostUser.fx || 0
        }
      ],
      score: { red: 0, blue: 0 },
      createdAt: Date.now()
    };
    this.rooms.set(roomId, room);
    return room;
  }

  joinRoom(roomId, user) {
    const room = this.rooms.get(Number(roomId));
    if (!room) return null;
    let existing = room.slots.find(s => s.sid === user.sid || s.id === user.sid || s.nick === user.nick);
    if (existing) {
      existing.id = user.sid;
      existing.sid = user.sid;
      return room;
    }
    if (room.slots.length >= 16) {
      return null;
    }

    // Auto-balance teams (0 = Red, 1 = Blue)
    const redCount = room.slots.filter(s => s.team === 0).length;
    const blueCount = room.slots.filter(s => s.team === 1).length;
    const team = redCount <= blueCount ? 0 : 1;

    room.slots.push({
      id: user.sid,
      sid: user.sid,
      nick: user.nick,
      team: team,
      ready: false,
      host: false,
      chara: team === 0 ? (user.equip?.red || "redbulls") : (user.equip?.blue || "acidpol"),
      weapon: user.equip?.[1] || user.weapon || "aug",
      pos: user.pos || 1,
      rank: user.stats?.rank || 26,
      card: user.card || "",
      nc: user.nc || 0,
      fx: user.fx || 0
    });
    room.players = room.slots.length;
    return room;
  }

  leaveRoom(userSid) {
    for (const [roomId, room] of this.rooms.entries()) {
      const idx = room.slots.findIndex(s => s.sid === userSid || s.id === userSid);
      if (idx !== -1) {
        const wasHost = room.slots[idx].host;
        room.slots.splice(idx, 1);
        room.players = room.slots.length;

        if (room.slots.length === 0) {
          this.rooms.delete(roomId);
          return { roomId, closed: true };
        } else if (wasHost) {
          room.slots[0].host = true;
          room.slots[0].ready = true;
          room.host = room.slots[0].id || room.slots[0].sid;
          room.hostNick = room.slots[0].nick;
        }
        return { roomId, closed: false, room };
      }
    }
    return null;
  }

  getRoomByUser(userSid) {
    for (const room of this.rooms.values()) {
      if (room.slots.some(s => s.sid === userSid || s.id === userSid)) {
        return room;
      }
    }
    return null;
  }

  getRoomList() {
    return Array.from(this.rooms.values()).map(r => ({
      id: r.id,
      title: r.title,
      map: r.map,
      kills: r.kills,
      time: r.time,
      state: r.state,
      mode: r.mode,
      pw: r.pw,
      lock: r.lock,
      obs: r.obs,
      joinBlock: r.joinBlock,
      balance: r.balance,
      sp: r.sp,
      srv: r.srv,
      cfr: r.cfr,
      tag: r.tag,
      ban: r.ban,
      ai: r.ai ? 1 : 0,
      enemies: r.enemies || 4,
      dif: r.dif || 1,
      bots: r.bots || [0, 0],
      nov: r.nov,
      players: r.players,
      host: r.host,
      hostNick: r.hostNick,
      reg: r.reg
    }));
  }
}

module.exports = new PbDatabase();
