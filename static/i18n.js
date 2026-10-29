/* i18n.js -- idioma pelo pais do IP (window.CC vem do /cc.js = header CF-IPCountry da Cloudflare) ou o escolhido pelo
   jogador (localStorage pbweb_lang). O codigo continua escrevendo em portugues: um MutationObserver troca cada texto que
   aparece na tela pelo de static/i18n/<lang>.json (gerado a partir de i18n_extrair.py); `{}` = curinga (nome, numero).
   Tambem traduz placeholder/title, alert/confirm/prompt e o texto desenhado em canvas (HUD). Carregar no <head>, antes de tudo. */
'use strict';
(() => {
  const LANGS = { pt: 'Português', en: 'English', id: 'Bahasa Indonesia', th: 'ไทย', vi: 'Tiếng Việt' };
  const BY_CC = { BR: 'pt', PT: 'pt', AO: 'pt', MZ: 'pt', CV: 'pt', ID: 'id', MY: 'id', BN: 'id', TH: 'th', VN: 'vi' };
  let L = null; try { L = localStorage.getItem('pbweb_lang'); } catch (e) { }
  const CC = String(window.CC || '').toUpperCase(), nav = String(navigator.language || '').slice(0, 2).toLowerCase();
  if (!LANGS[L]) L = CC && CC !== 'XX' ? (BY_CC[CC] || 'en') : (LANGS[nav] ? nav : nav === 'ms' ? 'id' : 'pt');
  // robo de busca (Google acessa dos EUA): sempre o portugues da pagina (lang=pt-BR, canonical) -- senao o Google indexava em ingles
  if (/googlebot|bingbot|yandex|baiduspider|duckduckbot|applebot|slurp|Google-|Lighthouse|crawler|spider/i.test(navigator.userAgent)) L = 'pt';
  window.LANG = L; window.LANGS = LANGS;
  window.setLang = l => { try { localStorage.setItem('pbweb_lang', l); } catch (e) { } location.reload(); };
  window.T = s => s;
  if (L === 'pt') return;
  document.documentElement.lang = L;

  // dicionario: sincrono de proposito (texto nenhum aparece em portugues antes); ~100 KB, em cache como os outros scripts
  const me = document.currentScript, v = me && (me.src.match(/[?&]v=(\w+)/) || [])[1] || '';
  let raw = {};
  try { const x = new XMLHttpRequest(); x.open('GET', '/static/i18n/' + L + '.json?v=' + v, false); x.send(); if (x.status === 200) raw = JSON.parse(x.responseText); } catch (e) { }
  const D = new Map(), PAT = [], memo = new Map();
  for (const k in raw) {
    if (!raw[k] || raw[k] === k) continue;
    if (k.includes('{}')) PAT.push([new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\}/g, '([\\s\\S]+?)') + '$'), raw[k]]);
    else D.set(k, raw[k]);
  }
  PAT.sort((a, b) => b[0].source.length - a[0].source.length);     // o mais especifico primeiro
  function tr1(t) {
    let r = D.get(t);
    if (r !== undefined) return r;
    for (const [re, val] of PAT) { const m = re.exec(t); if (m) { let i = 1; return val.replace(/\{\}/g, () => m[i++] ?? ''); } }
    return null;
  }
  const T = s => {
    if (typeof s !== 'string' || s.length < 2 || s.length > 400) return s;
    let r = memo.get(s);
    if (r === undefined) {
      const a = s.match(/^\s*/)[0], b = s.match(/\s*$/)[0], t = s.trim().replace(/\s+/g, ' ');
      let x = t && tr1(t);
      if (x == null && /\n/.test(s.trim())) {      // varias linhas: traduz linha a linha
        let hit = false; const y = s.split('\n').map(l => { const k = l.trim().replace(/\s+/g, ' '), z = k && tr1(k); if (z == null) return l; hit = true; return l.replace(l.trim(), z); });
        if (hit) { r = y.join('\n'); memo.set(s, r); return r; }
      }
      r = x == null ? s : a + x + b;
      if (memo.size > 20000) memo.clear();
      memo.set(s, r);
    }
    return r;
  };
  window.T = T;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']), ATTR = ['placeholder', 'title', 'aria-label'];
  const skipEl = e => !e || SKIP.has(e.nodeName) || e.isContentEditable || (e.closest && e.closest('[data-noi18n]'));
  function text(n) { if (skipEl(n.parentElement)) return; const d = n.data, r = T(d); if (r !== d) n.data = r; }
  function attrs(e) {
    for (const a of ATTR) { const s = e.getAttribute(a); if (s) { const r = T(s); if (r !== s) e.setAttribute(a, r); } }
    if (e.nodeName === 'INPUT' && (e.type === 'button' || e.type === 'submit') && e.value) e.value = T(e.value);
  }
  function walk(root) {
    if (root.nodeType === 3) return text(root);
    if (root.nodeType !== 1 || skipEl(root)) return;
    attrs(root);
    const w = document.createTreeWalker(root, 5);      // elementos + textos
    for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? text(n) : attrs(n);
  }
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'characterData') text(m.target);
      else if (m.type === 'attributes') attrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTR });
  walk(document.documentElement);

  // dialogos nativos e texto desenhado em canvas (HUD do jogo)
  for (const f of ['alert', 'confirm', 'prompt']) { const o = window[f]; if (o) window[f] = function (m, ...r) { return o.call(this, T(String(m ?? '')), ...r); }; }
  const C = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (C) for (const f of ['fillText', 'strokeText', 'measureText']) { const o = C[f]; C[f] = function (s, ...r) { return o.call(this, typeof s === 'string' ? T(s) : s, ...r); }; }
})();
