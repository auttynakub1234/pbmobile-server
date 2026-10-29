#!/usr/bin/env node
/**
 * Point Blank Mobile (PBMobile) Complete Extras Downloader
 * Downloads:
 * - All Announcer & Combat Sound FX
 * - All Minimap Radars & UI Atlases
 * - Iconic Character 3D Models, Masks, and Berets
 */

const fs = require("fs");
const path = require("path");

const BASE_DIR = path.join(__dirname);
const SOUNDS_DIR = path.join(BASE_DIR, "sounds");
const UI_DIR = path.join(BASE_DIR, "ui");
const CHARS_DIR = path.join(BASE_DIR, "extracted", "characters");

[SOUNDS_DIR, UI_DIR, CHARS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

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

  let obj = `# PBMobile Character Model: ${objName}\nmtllib ${objName}.mtl\n`;
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

async function fetchBuffer(url) {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.arrayBuffer();
  } catch (e) {}
  return null;
}

// 1. Download Announcer & Audio FX
async function downloadSounds() {
  console.log(`\n[+] 1. Downloading Announcer & Combat Sounds...`);
  const annDir = path.join(SOUNDS_DIR, "announcer");
  const cbtDir = path.join(SOUNDS_DIR, "combat");
  fs.mkdirSync(annDir, { recursive: true });
  fs.mkdirSync(cbtDir, { recursive: true });

  const announcers = [
    "mv_ann_headshot",
    "mv_ann_double_kill",
    "mv_ann_triple_kill",
    "mv_ann_chain_killer",
    "mv_ann_masskill",
    "mv_ann_chain_slugger",
    "mv_ann_piercing",
    "mv_ann_chain_headshot",
    "mv_ann_helmetprotection",
    "mv_ann_start_mission_1",
    "mv_ann_start_mission_2",
    "mv_ann_start_mission_3",
    "ui_hud_revenge_effect",
    "ui_mission_countdown",
    "ui_mission_countdown_2",
    "ui_mission_countdown_3"
  ];

  for (const ann of announcers) {
    const file = path.join(annDir, `${ann}.wav`);
    if (!fs.existsSync(file)) {
      const url = `https://pbmobile.app/static/game/hud/snd/${ann}.wav`;
      const buf = await fetchBuffer(url);
      if (buf) {
        fs.writeFileSync(file, Buffer.from(buf));
        console.log(`  [Announcer] Downloaded: ${ann}.wav`);
      }
    }
  }

  const combatSounds = [
    { name: "c4_planted.wav", path: "sound/weapon/c4/wm_c4_bomb_planted.wav" },
    { name: "c4_defused.wav", path: "sound/weapon/c4/wm_c4_bomb_defused.wav" },
    { name: "c4_beep.wav", path: "sound/weapon/c4/wm_c4_beep.wav" },
    { name: "k400_explosion.wav", path: "sound/weapon/throw/k-400/wm_k400_explosion.wav" },
    { name: "change_assault.wav", path: "sound/weapon/common/change/wm_change_assault.wav" },
    { name: "change_handgun.wav", path: "sound/weapon/common/change/wm_change_handgun.wav" },
    { name: "change_melee.wav", path: "sound/weapon/common/change/wm_change_melee.wav" },
    { name: "change_throw.wav", path: "sound/weapon/common/change/wm_change_throw.wav" },
    { name: "hit_concrete_1.wav", path: "sound/weapon/common/hit/wm_hit_concrete_1.wav" },
    { name: "hit_human_1.wav", path: "sound/weapon/common/hit/wm_hit_human_1.wav" },
    { name: "head_hit_1.wav", path: "sound/character/action/ch_head_hit_1.wav" },
    { name: "death_man.wav", path: "sound/voice/man/death/mv_hit_death.wav" },
    { name: "death_woman.wav", path: "sound/voice/woman/death/wv_hit_death.wav" },
    { name: "heart_beat.wav", path: "sound/voice/man/death/mv_heart_beat.wav" }
  ];

  for (const cs of combatSounds) {
    const file = path.join(cbtDir, cs.name);
    if (!fs.existsSync(file)) {
      const url = calculateAssetUrl("sound", { path: cs.path });
      const buf = await fetchBuffer(url);
      if (buf) {
        fs.writeFileSync(file, Buffer.from(buf));
        console.log(`  [Combat SFX] Downloaded: ${cs.name}`);
      }
    }
  }
}

// 2. Download Minimaps & Atlases
async function downloadUiAndMinimaps() {
  console.log(`\n[+] 2. Downloading Minimap Radars & UI Atlases...`);
  const mmDir = path.join(UI_DIR, "minimaps");
  const atDir = path.join(UI_DIR, "atlases");
  fs.mkdirSync(mmDir, { recursive: true });
  fs.mkdirSync(atDir, { recursive: true });

  const minfoUrl = "https://pbmobile.app/static/game/hud/minimap/minfo.json";
  const minfoRes = await fetch(minfoUrl);
  if (minfoRes.ok) {
    const minfo = await minfoRes.json();
    fs.writeFileSync(path.join(mmDir, "minfo.json"), JSON.stringify(minfo, null, 2));

    const mapKeys = Object.keys(minfo);
    console.log(`  Found ${mapKeys.length} minimap configurations in minfo.json`);
    for (const k of mapKeys) {
      const img = minfo[k].imgs?.[0] || `mini_${k}`;
      const file = path.join(mmDir, `${img}.png`);
      if (!fs.existsSync(file)) {
        const url = `https://pbmobile.app/static/game/hud/minimap/${img}.png`;
        const buf = await fetchBuffer(url);
        if (buf) {
          fs.writeFileSync(file, Buffer.from(buf));
        }
      }
    }
    console.log(`  [✓] All Minimaps downloaded.`);
  }

  // Atlases & HUD UI
  const uiItems = [
    { name: "hud_v37.png", url: "https://pbmobile.app/static/v37/atlas/hud.png" },
    { name: "feed_bg.png", url: "https://pbmobile.app/static/game/hud/km/feed_bg.png" },
    { name: "feed_hs.png", url: "https://pbmobile.app/static/game/hud/km/feed_hs.png" },
    { name: "btn.png", url: "https://pbmobile.app/static/v37/skin/btn.png" }
  ];

  for (const item of uiItems) {
    const file = path.join(atDir, item.name);
    if (!fs.existsSync(file)) {
      const buf = await fetchBuffer(item.url);
      if (buf) {
        fs.writeFileSync(file, Buffer.from(buf));
        console.log(`  [UI Atlas] Downloaded: ${item.name}`);
      }
    }
  }
}

// 3. Download Iconic Character Models, Masks, and Berets
async function downloadCharacters() {
  console.log(`\n[+] 3. Downloading Character Models, Masks & Berets...`);

  const iconicAvatars = [
    // Masks
    { name: "Mask_RedBulls", path: "Avatar/Mask/M_M_RedBulls/M_M_RedBulls_X_LOD1.i3s" },
    { name: "Mask_Tarantula", path: "Avatar/Mask/F_M_Tarantula/F_M_Tarantula_X_LOD1.i3s" },
    { name: "Mask_ViperRed", path: "Avatar/Mask/F_M_ViperRed/F_M_ViperRed_X_LOD1.i3s" },
    { name: "Mask_AcidPol", path: "Avatar/Mask/M_M_AcidPol/M_M_AcidPol_X_LOD1.i3s" },
    // Berets
    { name: "Beret_Black", path: "Avatar/Beret/A_E_Beret_Black/A_E_Beret_Black.I3S" },
    { name: "Beret_Champion", path: "Avatar/Beret/A_E_Beret_Black_Target/A_E_Beret_Black_Target.I3S" },
    // Uppers (Torsos)
    { name: "Upper_RedBulls", path: "Avatar/Upper/O_U_RedBulls_Ori/O_U_RedBulls_Ori_LOD0.i3s" },
    { name: "Upper_AcidPol_SWAT", path: "Avatar/Upper/M_U_AcidPol_SWAT/M_U_AcidPol_SWAT_LOD0.i3s" },
    { name: "Upper_ViperRed", path: "Avatar/Upper/O_U_ViperRed/O_U_ViperRed_LOD0.i3s" },
    { name: "Upper_Tarantula", path: "Avatar/Upper/O_U_Tarantula/O_U_Tarantula_LOD0.i3s" },
    { name: "Upper_Leopard", path: "Avatar/Upper/M_U_Leopard/M_U_Leopard_LOD0.i3s" },
    { name: "Upper_Hide", path: "Avatar/Upper/F_U_Hide/F_U_Hide_LOD0.i3s" },
    // Lowers (Legs)
    { name: "Lower_RedBulls", path: "Avatar/Lower/O_L_RedBulls_Ori/O_L_RedBulls_Ori_LOD1.i3s" },
    { name: "Lower_AcidPol_SWAT", path: "Avatar/Lower/M_L_AcidPol_SWAT/M_L_AcidPol_SWAT_LOD1.i3s" },
    { name: "Lower_ViperRed", path: "Avatar/Lower/O_L_ViperRed/O_L_ViperRed_LOD1.i3s" }
  ];

  for (const av of iconicAvatars) {
    const outDir = path.join(CHARS_DIR, av.name);
    const targetObj = path.join(outDir, `${av.name}.obj`);
    if (fs.existsSync(targetObj)) continue;

    fs.mkdirSync(outDir, { recursive: true });
    try {
      const url = calculateAssetUrl("mesh", { path: av.path });
      const buf = await fetchBuffer(url);
      if (buf) {
        const { obj, textures } = convertI3sToObj(buf, av.name);
        fs.writeFileSync(targetObj, obj);

        let mtl = `# Materials for ${av.name}\n`;
        for (const texPath of textures) {
          const texName = path.basename(texPath).replace(/\.i3i$/i, ".webp");
          const texFile = path.join(outDir, texName);
          const texUrl = calculateAssetUrl("tex", { path: texPath });
          const texBuf = await fetchBuffer(texUrl);
          if (texBuf) {
            fs.writeFileSync(texFile, Buffer.from(texBuf));
          }
          mtl += `newmtl Mtl_${texName}\nKd 1 1 1\nmap_Kd ${texName}\n\n`;
        }
        fs.writeFileSync(path.join(outDir, `${av.name}.mtl`), mtl);
        console.log(`  [Character 3D] Extracted: ${av.name}`);
      }
    } catch (e) {
      console.warn(`  [!] Could not extract ${av.name}:`, e.message);
    }
  }
}

async function main() {
  console.log(`
======================================================
  PBMobile Complete Extras Extraction Tool
======================================================
`);
  await downloadSounds();
  await downloadUiAndMinimaps();
  await downloadCharacters();

  console.log(`
======================================================
  All Extras Downloaded & Extracted Successfully!
  Sounds Directory:     /root/pbmobile_analysis/sounds/
  UI/Minimaps:          /root/pbmobile_analysis/ui/
  Characters Directory: /root/pbmobile_analysis/extracted/characters/
======================================================
`);
}

main().catch(console.error);
