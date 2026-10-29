#!/usr/bin/env node
/**
 * Point Blank Mobile (PBMobile) Bulk Asset Downloader & Converter
 * Downloads:
 * - All 42 Maps (Stage JSON, 3D World OBJ, Collision OBJ, Textures)
 * - All Shop Weapons (3D Mesh OBJ, Materials, Textures)
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

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch (e) {
      if (attempt === retries) throw e;
    }
    await new Promise(r => setTimeout(r, 800 * attempt));
  }
  return null;
}

// 1. Download and convert a map
async function downloadMap(mapName, index, total) {
  const outDir = path.join(__dirname, "extracted", "maps", mapName);
  const targetObj = path.join(outDir, `${mapName}_World.obj`);
  if (fs.existsSync(targetObj)) {
    console.log(`[MAP ${index}/${total}] Skipping "${mapName}" (already extracted).`);
    return;
  }

  console.log(`[MAP ${index}/${total}] Downloading "${mapName}"...`);
  fs.mkdirSync(outDir, { recursive: true });

  try {
    const stageUrl = calculateAssetUrl("stage", { name: mapName });
    const stageRes = await fetchWithRetry(stageUrl);
    if (!stageRes) {
      console.warn(`[!] Could not fetch stage data for ${mapName}`);
      return;
    }
    const stageData = await stageRes.json();
    fs.writeFileSync(path.join(outDir, "stage.json"), JSON.stringify(stageData, null, 2));

    const stage = stageData.stage;
    if (stage.world) {
      const worldUrl = calculateAssetUrl("mesh", { path: stage.world });
      const worldRes = await fetchWithRetry(worldUrl);
      if (worldRes) {
        const worldBuf = await worldRes.arrayBuffer();
        const { obj, textures } = convertI3sToObj(worldBuf, mapName);
        fs.writeFileSync(targetObj, obj);

        // Download up to 20 key textures per map
        let mtl = `# Materials for ${mapName}\n`;
        const texToFetch = textures.slice(0, 30);
        await Promise.all(
          texToFetch.map(async texPath => {
            const texName = path.basename(texPath).replace(/\.i3i$/i, ".webp");
            const texFile = path.join(outDir, texName);
            if (!fs.existsSync(texFile)) {
              try {
                const texUrl = calculateAssetUrl("tex", { path: texPath });
                const texRes = await fetchWithRetry(texUrl);
                if (texRes) {
                  const texBuf = await texRes.arrayBuffer();
                  fs.writeFileSync(texFile, Buffer.from(texBuf));
                }
              } catch (e) {}
            }
            mtl += `newmtl Mtl_${texName}\nKd 1 1 1\nmap_Kd ${texName}\n\n`;
          })
        );
        fs.writeFileSync(path.join(outDir, `${mapName}.mtl`), mtl);
      }
    }

    // Collision mesh
    if (stage.cols?.hero) {
      const colUrl = calculateAssetUrl("mesh", { path: stage.cols.hero });
      const colRes = await fetchWithRetry(colUrl);
      if (colRes) {
        const colBuf = await colRes.arrayBuffer();
        const { obj } = convertI3sToObj(colBuf, `${mapName}_Col_Hero`);
        fs.writeFileSync(path.join(outDir, `${mapName}_Col_Hero.obj`), obj);
      }
    }

    console.log(`[✓] [MAP ${index}/${total}] "${mapName}" finished!`);
  } catch (err) {
    console.error(`[!] Failed map "${mapName}":`, err.message);
  }
}

// 2. Download and convert a shop weapon
async function downloadWeapon(w, index, total) {
  const safeName = (w.key || w.name || w.id).replace(/[^a-zA-Z0-9_-]/g, "_");
  const outDir = path.join(__dirname, "extracted", "weapons", safeName);
  const targetObj = path.join(outDir, `${safeName}.obj`);
  if (fs.existsSync(targetObj)) {
    return;
  }

  fs.mkdirSync(outDir, { recursive: true });

  try {
    const modelUrl = calculateAssetUrl("weapon", { path: w.model });
    const modelRes = await fetchWithRetry(modelUrl);
    if (!modelRes) {
      return;
    }
    const modelBuf = await modelRes.arrayBuffer();
    const { obj, textures } = convertI3sToObj(modelBuf, safeName);
    fs.writeFileSync(targetObj, obj);

    let mtl = `# Materials for ${w.name}\n`;
    await Promise.all(
      textures.map(async texPath => {
        const texName = path.basename(texPath).replace(/\.i3i$/i, ".webp");
        const texFile = path.join(outDir, texName);
        if (!fs.existsSync(texFile)) {
          try {
            const texUrl = calculateAssetUrl("tex", { path: texPath });
            const texRes = await fetchWithRetry(texUrl);
            if (texRes) {
              const texBuf = await texRes.arrayBuffer();
              fs.writeFileSync(texFile, Buffer.from(texBuf));
            }
          } catch (e) {}
        }
        mtl += `newmtl Mtl_${texName}\nKd 1 1 1\nmap_Kd ${texName}\n\n`;
      })
    );
    fs.writeFileSync(path.join(outDir, `${safeName}.mtl`), mtl);

    if (index % 10 === 0 || index === total) {
      console.log(`[WEAPON ${index}/${total}] Extracted "${w.name}"`);
    }
  } catch (err) {
    console.error(`[!] Failed weapon "${w.name}":`, err.message);
  }
}

// Worker pool to download with controlled concurrency
async function pool(items, concurrency, fn) {
  let idx = 0;
  const workers = Array(concurrency).fill(0).map(async () => {
    while (idx < items.length) {
      const current = idx++;
      await fn(items[current], current + 1, items.length);
    }
  });
  await Promise.all(workers);
}

async function main() {
  console.log(`
======================================================
  PBMobile Bulk Downloader & 3D Converter
======================================================
`);

  // 1. Download All 42 Maps
  const maps = ["Downtown","Downtown2","BurningHall","Luxville","Crackdown","Hospital","Helispot","Sentrybase","Uptown","NPort","NStation","BlackPanther","Giran2","Tutorial","C_Sandstorm","Kickpoint","Outpost","Breakdown","DSquad","Metro","RushHour","StillRaid","Provence","MachuPichu","CargoPort","TwoTowers","SafeHouse","Blowcity","Stormtube","SandStorm","Under23","Junkyard","Library","TinyTown","PumpkinHollow","Construction","BreedingNest","Wilderness","Historic_Site","DesertCamp","D_BreakDown","D_Uptown"];

  console.log(`\n[+] Starting Maps Download: ${maps.length} maps (Concurrency: 4)...`);
  await pool(maps, 4, downloadMap);
  console.log(`\n[✓] All 42 Maps completed!\n`);

  // 2. Download All Shop Weapons
  const goodsData = JSON.parse(fs.readFileSync(path.join(__dirname, "goods.json"), "utf8"));
  const weaponsData = JSON.parse(fs.readFileSync(path.join(__dirname, "weapons.json"), "utf8"));
  const shopItemIds = new Set(Object.keys(goodsData.goods).map(Number));

  const shopWeapons = weaponsData.weapons.filter(w => (shopItemIds.has(w.item) || shopItemIds.has(+w.id)) && w.model);
  console.log(`[+] Starting Shop Weapons Download: ${shopWeapons.length} weapons (Concurrency: 6)...`);
  await pool(shopWeapons, 6, downloadWeapon);
  console.log(`\n[✓] All ${shopWeapons.length} Shop Weapons completed!\n`);

  console.log(`
======================================================
  Download & Conversion Finished Successfully!
  Maps Directory:    /root/pbmobile_analysis/extracted/maps/
  Weapons Directory: /root/pbmobile_analysis/extracted/weapons/
======================================================
`);
}

main().catch(console.error);
