#!/usr/bin/env node
/**
 * Point Blank Mobile (PBMobile) Asset Extractor & Converter
 * Features:
 * - Weapon extraction (.i3s -> .obj, .mtl, .webp textures)
 * - Map extraction (Stage JSON, World geometry .i3s -> .obj, Collision meshes)
 */

const fs = require("fs");
const path = require("path");

const MAP_V = { nport: "zep1", showroom: "sr10", library: "nk5" };

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
  return `https://pbmobile.app/a/${type}/${r.toString(16).padStart(8, "0")}${i.toString(16).padStart(8, "0")}?${n}&f=2`;
}

function convertI3sToObj(buf, objName = "Model") {
  const headLen = new DataView(buf).getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headLen)));
  const base = 8 + headLen + (4 - (8 + headLen) % 4) % 4;

  let obj = `# PBMobile Converted 3D Model: ${objName}\n`;
  obj += `mtllib ${objName}.mtl\n`;

  let vOffset = 1, vtOffset = 1, vnOffset = 1;
  const textures = new Set();

  head.parts.forEach((part, pIdx) => {
    const partName = part.name || `Part_${pIdx}`;
    obj += `g ${partName}\n`;
    if (part.tex) {
      const texBase = path.basename(part.tex).replace(/\.i3i$/i, ".webp");
      obj += `usemtl Mtl_${texBase}\n`;
      textures.add(part.tex);
    }

    const posView = new Float32Array(buf, base + part.pos, 3 * part.nv);
    for (let i = 0; i < posView.length; i += 3) {
      obj += `v ${posView[i].toFixed(5)} ${posView[i + 1].toFixed(5)} ${posView[i + 2].toFixed(5)}\n`;
    }

    if (part.uv != null) {
      const uvView = new Float32Array(buf, base + part.uv, 2 * part.nv);
      for (let i = 0; i < uvView.length; i += 2) {
        obj += `vt ${uvView[i].toFixed(5)} ${(1 - uvView[i + 1]).toFixed(5)}\n`;
      }
    }

    if (part.nrm != null) {
      const nrmView = new Float32Array(buf, base + part.nrm, 3 * part.nv);
      for (let i = 0; i < nrmView.length; i += 3) {
        obj += `vn ${nrmView[i].toFixed(5)} ${nrmView[i + 1].toFixed(5)} ${nrmView[i + 2].toFixed(5)}\n`;
      }
    }

    const idxView = part.i16
      ? new Uint16Array(buf, base + part.idx, part.ni)
      : new Uint32Array(buf, base + part.idx, part.ni);

    for (let i = 0; i < idxView.length; i += 3) {
      const i1 = idxView[i] + vOffset;
      const i2 = idxView[i + 1] + vOffset;
      const i3 = idxView[i + 2] + vOffset;
      if (part.uv != null && part.nrm != null) {
        obj += `f ${i1}/${i1}/${i1} ${i2}/${i2}/${i2} ${i3}/${i3}/${i3}\n`;
      } else if (part.uv != null) {
        obj += `f ${i1}/${i1} ${i2}/${i2} ${i3}/${i3}\n`;
      } else {
        obj += `f ${i1} ${i2} ${i3}\n`;
      }
    }

    vOffset += part.nv;
    vtOffset += part.nv;
    vnOffset += part.nv;
  });

  return { obj, textures: Array.from(textures) };
}

async function extractWeapon(keyword) {
  console.log(`[+] Searching weapon for: "${keyword}"...`);
  const weaponsUrl = "https://pbmobile.app/static/game/weapons.json";
  const res = await fetch(weaponsUrl);
  const data = await res.json();
  const found = data.weapons.find(
    w => (w.id && w.id.toLowerCase() === keyword.toLowerCase()) ||
         (w.name && w.name.toLowerCase().includes(keyword.toLowerCase())) ||
         (w.key && w.key.toLowerCase().includes(keyword.toLowerCase()))
  );

  if (!found) {
    console.error(`[-] Weapon "${keyword}" not found in weapons database!`);
    return;
  }

  console.log(`[+] Found: ${found.name} (Class: ${found.className}, Damage: ${found.damage}, Recoil: V=${found.rec?.vA || 0})`);
  console.log(`[+] Model path: ${found.model}`);

  const outDir = path.join(__dirname, "extracted", found.key || found.name.replace(/\s+/g, "_"));
  fs.mkdirSync(outDir, { recursive: true });

  const modelUrl = calculateAssetUrl("weapon", { path: found.model });
  console.log(`[+] Downloading 3D mesh: ${modelUrl}`);
  const modelRes = await fetch(modelUrl);
  if (!modelRes.ok) {
    console.error(`[-] Failed to fetch model: HTTP ${modelRes.status}`);
    return;
  }
  const modelBuf = await modelRes.arrayBuffer();
  fs.writeFileSync(path.join(outDir, "original.i3s"), Buffer.from(modelBuf));

  const { obj, textures } = convertI3sToObj(modelBuf, found.key || "weapon");
  fs.writeFileSync(path.join(outDir, `${found.key || "weapon"}.obj`), obj);
  console.log(`[✓] Exported Wavefront OBJ: ${found.key || "weapon"}.obj`);

  let mtl = `# Materials for ${found.name}\n`;
  for (const texPath of textures) {
    const texName = path.basename(texPath).replace(/\.i3i$/i, ".webp");
    const texUrl = calculateAssetUrl("tex", { path: texPath });
    try {
      const texRes = await fetch(texUrl);
      if (texRes.ok) {
        const texBuf = await texRes.arrayBuffer();
        fs.writeFileSync(path.join(outDir, texName), Buffer.from(texBuf));
        mtl += `newmtl Mtl_${texName}\nKd 1 1 1\nmap_Kd ${texName}\n\n`;
      }
    } catch (e) {
      console.warn(`[!] Warning: could not download texture ${texPath}`);
    }
  }
  fs.writeFileSync(path.join(outDir, `${found.key || "weapon"}.mtl`), mtl);
  console.log(`[✓] Weapon extraction complete! Saved in: ${outDir}`);
}

async function extractMap(mapName) {
  console.log(`[+] Extracting Map: "${mapName}"...`);
  const stageUrl = calculateAssetUrl("stage", { name: mapName });
  const stageRes = await fetch(stageUrl);
  if (!stageRes.ok) {
    console.error(`[-] Failed to load stage metadata: HTTP ${stageRes.status}`);
    return;
  }
  const stageData = await stageRes.json();
  const stage = stageData.stage;
  console.log(`[+] World mesh path: ${stage.world}`);
  console.log(`[+] Collision meshes: Hero=${stage.cols?.hero}, Hit=${stage.cols?.hit}`);

  const outDir = path.join(__dirname, "extracted", "maps", mapName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "stage.json"), JSON.stringify(stageData, null, 2));

  // 1. Download World Mesh
  const worldUrl = calculateAssetUrl("mesh", { path: stage.world });
  console.log(`[+] Downloading World 3D geometry...`);
  const worldRes = await fetch(worldUrl);
  if (worldRes.ok) {
    const worldBuf = await worldRes.arrayBuffer();
    const { obj, textures } = convertI3sToObj(worldBuf, mapName);
    fs.writeFileSync(path.join(outDir, `${mapName}_World.obj`), obj);
    console.log(`[✓] Exported Map OBJ: ${mapName}_World.obj`);

    let mtl = `# Materials for ${mapName}\n`;
    for (const texPath of textures) {
      const texName = path.basename(texPath).replace(/\.i3i$/i, ".webp");
      const texUrl = calculateAssetUrl("tex", { path: texPath });
      try {
        const texRes = await fetch(texUrl);
        if (texRes.ok) {
          const texBuf = await texRes.arrayBuffer();
          fs.writeFileSync(path.join(outDir, texName), Buffer.from(texBuf));
          mtl += `newmtl Mtl_${texName}\nKd 1 1 1\nmap_Kd ${texName}\n\n`;
        }
      } catch (e) {}
    }
    fs.writeFileSync(path.join(outDir, `${mapName}.mtl`), mtl);
  }

  // 2. Download Collision Geometry if present
  if (stage.cols?.hero) {
    const colUrl = calculateAssetUrl("mesh", { path: stage.cols.hero });
    const colRes = await fetch(colUrl);
    if (colRes.ok) {
      const colBuf = await colRes.arrayBuffer();
      const { obj } = convertI3sToObj(colBuf, `${mapName}_Collision_Hero`);
      fs.writeFileSync(path.join(outDir, `${mapName}_Col_Hero.obj`), obj);
      console.log(`[✓] Exported Player Collision Geometry: ${mapName}_Col_Hero.obj`);
    }
  }

  console.log(`[✓] Map extraction complete! Saved in: ${outDir}`);
}

async function listMaps() {
  const maps = ["Downtown","Downtown2","BurningHall","Luxville","Crackdown","Hospital","Helispot","Sentrybase","Uptown","NPort","NStation","BlackPanther","Giran2","Tutorial","C_Sandstorm","Kickpoint","Outpost","Breakdown","DSquad","Metro","RushHour","StillRaid","Provence","MachuPichu","CargoPort","TwoTowers","SafeHouse","Blowcity","Stormtube","SandStorm","Under23","Junkyard","Library","TinyTown","PumpkinHollow","Construction","BreedingNest","Wilderness","Historic_Site","DesertCamp","D_BreakDown","D_Uptown"];
  console.log(`\n=== Total Maps: ${maps.length} ===`);
  console.log(maps.join(", "));
}

async function listWeapons() {
  const res = await fetch("https://pbmobile.app/static/game/weapons.json");
  const data = await res.json();
  console.log(`\n=== Total Weapons: ${data.weapons.length} ===`);
  const grouped = {};
  data.weapons.forEach(w => {
    const cls = w.className || "Other";
    grouped[cls] = grouped[cls] || [];
    grouped[cls].push(`${w.name} (ID: ${w.id})`);
  });
  for (const [cls, list] of Object.entries(grouped)) {
    console.log(`\n[${cls}] (${list.length})`);
    console.log("  " + list.slice(0, 8).join("\n  ") + (list.length > 8 ? `\n  ... and ${list.length - 8} more` : ""));
  }
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === "weapon") {
  extractWeapon(args[1] || "ak47");
} else if (cmd === "map") {
  extractMap(args[1] || "BurningHall");
} else if (cmd === "list-weapons") {
  listWeapons();
} else if (cmd === "list-maps") {
  listMaps();
} else {
  console.log(`
PBMobile Asset Extractor
Usage:
  node pb_extractor.js weapon <name>   (e.g., aug, kriss, cheytac, fang)
  node pb_extractor.js map <name>      (e.g., BurningHall, Luxville, Downtown)
  node pb_extractor.js list-weapons
  node pb_extractor.js list-maps
`);
}
