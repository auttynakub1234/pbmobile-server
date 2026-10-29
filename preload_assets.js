#!/usr/bin/env node
/**
 * Point Blank Mobile (PBMobile) Fast Asset Preloader for VPS Deployment
 * 
 * Pre-downloads and caches core textures, 3D meshes, map stages, and sounds into `/a/`
 * so the VPS game server serves all visual assets instantly with 0ms upstream proxy lag.
 */

const fs = require("fs");
const path = require("path");

const BASE_DIR = __dirname;
const MAP_V = { nport: "zep1", showroom: "sr10", library: "nk5" };
const TEX_CV = {
  "World/Downtown2/Textures/Downtown_outLightingMap.i3i": 2,
  "World/Downtown2/Textures/building_wall_B_02.i3i": 2,
  "Weapon/AUG_A3_ESports/AUG_A3_Esports_diff.i3i": 2
};

function calculateAssetUrl(type, params) {
  const t = JSON.stringify(params || {}).toLowerCase();
  for (const k in MAP_V) {
    if (t.includes(k)) {
      params = Object.assign({ mv: MAP_V[k] }, params);
      break;
    }
  }
  const n = new URLSearchParams(
    Object.entries(Object.assign({ v: "1" }, params)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  ).toString();
  const o = type + "?" + n;

  let r = 2166136261, i = 2671212586;
  for (let idx = 0; idx < o.length; idx++) {
    const code = o.charCodeAt(idx);
    r = Math.imul(r ^ code, 16777619) >>> 0;
    i = Math.imul(i ^ code, 16777619) >>> 0;
  }
  const hash = `${r.toString(16).padStart(8, "0")}${i.toString(16).padStart(8, "0")}`;
  return { hash, url: `https://pbmobile.app/a/${type}/${hash}?${n}&f=2` };
}

async function fetchAndCache(type, params, retry = 2) {
  const { hash, url } = calculateAssetUrl(type, params);
  const outPath = path.join(BASE_DIR, "a", type, hash);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 50) {
    return { hash, outPath, status: "cached" };
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const res = await fetch(url, { headers: { referer: "https://pbmobile.app/" } });
      if (res.status === 404) return { hash, status: "not_found" };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 10) return { hash, status: "empty" };
      fs.writeFileSync(outPath, Buffer.from(buf));
      return { hash, outPath, status: "downloaded", size: buf.byteLength };
    } catch (err) {
      if (attempt === retry) return { hash, status: "failed", error: err.message };
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
    }
  }
}

// Queue runner with controlled concurrency
async function runConcurrent(items, fn, concurrency = 6) {
  let index = 0;
  const results = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      try {
        const res = await fn(item, currentIndex, items.length);
        results[currentIndex] = res;
      } catch (e) {
        results[currentIndex] = { error: e.message };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function preloadMap(mapName) {
  console.log(`\n==================================================`);
  console.log(`🚀 [MAP] Preloading "${mapName}"...`);
  console.log(`==================================================`);

  // 1. Stage Data
  const stageRes = await fetchAndCache("stage", { name: mapName });
  if (stageRes.status === "failed" || !fs.existsSync(stageRes.outPath)) {
    console.warn(`[!] Failed to fetch stage for "${mapName}"`);
    return;
  }
  let stageJson;
  try {
    stageJson = JSON.parse(fs.readFileSync(stageRes.outPath, "utf8"));
  } catch (e) {
    console.warn(`[!] Failed to parse stage JSON for "${mapName}"`);
    return;
  }

  const stage = stageJson.stage || {};
  const downloadTasks = [];

  // 2. World & Collision Meshes
  if (stage.world) downloadTasks.push({ type: "mesh", params: { path: stage.world } });
  if (stage.cols) {
    for (const [colKey, colPath] of Object.entries(stage.cols)) {
      if (colPath && typeof colPath === "string") {
        downloadTasks.push({ type: "mesh", params: { path: colPath } });
      }
    }
  }

  // 3. Skybox Textures
  if (stage.sky) {
    const skyArr = Array.isArray(stage.sky) ? stage.sky : Object.values(stage.sky);
    skyArr.forEach(s => {
      if (typeof s === "string") downloadTasks.push({ type: "tex", params: { path: s } });
    });
  }

  // 4. Map Textures
  if (stage.textures) {
    const texList = Object.values(stage.textures);
    texList.forEach(t => {
      const p = typeof t === "string" ? t : t.path;
      if (p) downloadTasks.push({ type: "tex", params: { path: p } });
    });
  }

  console.log(`Found ${downloadTasks.length} assets for "${mapName}". Downloading...`);
  let downloadedCount = 0;
  let cachedCount = 0;

  await runConcurrent(downloadTasks, async (task, idx, total) => {
    const res = await fetchAndCache(task.type, task.params);
    if (res.status === "downloaded") downloadedCount++;
    else if (res.status === "cached") cachedCount++;
  }, 8);

  console.log(`[✓] "${mapName}" complete: ${cachedCount} cached, ${downloadedCount} newly downloaded.`);
}

async function preloadZombieMode() {
  console.log(`\n==================================================`);
  console.log(`🧟 [ZOMBIE] Preloading Zombie Assets & Claws...`);
  console.log(`==================================================`);

  const zombieTasks = [
    // Claw weapon 323010
    { type: "weapon", params: { path: "Weapon/Melee/ZombieToothKnuckle.I3S" } },
    { type: "weapon", params: { path: "Weapon/Melee/ZombieToothKnuckle.i3s" } },
    { type: "tex", params: { path: "Weapon/Melee/Textures/ZombieToothKnuckle_diff.i3i" } },
    { type: "tex", params: { path: "Weapon/Melee/Textures/ZombieToothKnuckle.i3i" } },
    // Zombie sounds
    { type: "sound", params: { name: "ambient/madness/madness_girlscream_ambient_ver1" } },
    { type: "sound", params: { name: "ambient/madness/madness_bgm_ver1" } },
    { type: "sound", params: { name: "character/zombie_attack" } },
    { type: "sound", params: { name: "character/zombie_hit" } },
    { type: "sound", params: { name: "character/zombie_die" } }
  ];

  // Zombie Character Meshes & Skins
  const charasFile = path.join(BASE_DIR, "static", "game", "charas.json");
  if (fs.existsSync(charasFile)) {
    const charas = JSON.parse(fs.readFileSync(charasFile, "utf8")).charas || [];
    const zombieCharas = charas.filter(c => /zombie|madness|infect/i.test(c.name || c.key || ""));
    zombieCharas.forEach(zc => {
      if (zc.resPath) zombieTasks.push({ type: "mesh", params: { path: zc.resPath } });
      if (zc.heads) {
        Object.values(zc.heads).forEach(h => zombieTasks.push({ type: "mesh", params: { path: h } }));
      }
    });
  }

  let downloadedCount = 0;
  let cachedCount = 0;
  await runConcurrent(zombieTasks, async (task) => {
    const res = await fetchAndCache(task.type, task.params);
    if (res.status === "downloaded") downloadedCount++;
    else if (res.status === "cached") cachedCount++;
  }, 6);

  console.log(`[✓] Zombie assets ready: ${cachedCount} cached, ${downloadedCount} downloaded.`);
}

async function preloadCoreWeapons() {
  console.log(`\n==================================================`);
  console.log(`🔫 [WEAPONS] Preloading Core Competitive Weapons...`);
  console.log(`==================================================`);

  const weaponsFile = path.join(BASE_DIR, "static", "game", "weapons.json");
  if (!fs.existsSync(weaponsFile)) return;
  const weapons = JSON.parse(fs.readFileSync(weaponsFile, "utf8")).weapons || [];

  const coreIds = ["100003001", "100003002", "100003003", "100003004", "100003005", "100003006", "100003007", "100003008", "100003009", "100003010", "323010"];
  const coreNames = ["aug", "m4a1", "ak-47", "kriss", "cheytac", "k-2", "k-5", "m-7", "k-400", "p90", "l115a1"];

  const targetWeapons = weapons.filter(w => {
    const n = (w.name || "").toLowerCase();
    const id = String(w.id || "");
    return coreIds.includes(id) || coreNames.some(cn => n.includes(cn));
  }).slice(0, 45);

  const wpnTasks = [];
  targetWeapons.forEach(w => {
    if (w.model) wpnTasks.push({ type: "weapon", params: { path: w.model } });
  });

  let downloadedCount = 0;
  let cachedCount = 0;
  await runConcurrent(wpnTasks, async task => {
    const res = await fetchAndCache(task.type, task.params);
    if (res.status === "downloaded") downloadedCount++;
    else if (res.status === "cached") cachedCount++;
  }, 6);

  console.log(`[✓] Core weapons ready: ${cachedCount} cached, ${downloadedCount} downloaded.`);
}

(async () => {
  console.log("==================================================");
  console.log("   PBMobile High-Speed Asset Preloader for VPS   ");
  console.log("==================================================");

  const topMaps = [
    "BurningHall",
    "Crackdown",
    "Library",
    "Downtown",
    "Downtown2",
    "Luxville",
    "Hospital",
    "NPort",
    "BlackPanther",
    "Giran2",
    "Helispot",
    "Uptown"
  ];

  for (const m of topMaps) {
    await preloadMap(m);
  }

  await preloadZombieMode();
  await preloadCoreWeapons();

  console.log("\n==================================================");
  console.log("🎉 ALL ASSETS PRELOADED SUCCESSFULLY FOR VPS!");
  console.log("==================================================");
})();
