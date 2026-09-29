/* mk.js — تفاعلات موقع محمد خالد ومشاهده ثلاثية الأبعاد (بلا مكتبات).
   يعمل على كل الصفحات: يلتقط ما يجده منها (مشهد الواجهة، عارض العقار، الفلاتر...) ويتجاهل الباقي. */
(function () {
'use strict';
document.documentElement.classList.add('js');
const $ = id => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const eo = x => 1 - Math.pow(1 - x, 3);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (reduce) document.documentElement.classList.add('no-anim');
const B = document.body, UP = B.dataset.up || '', PHONE = B.dataset.phone || '963996606813';
const HOME = B.classList.contains('pg-index');
const WA = 'https://wa.me/' + PHONE + '?text=';
const goto = code => { location.href = UP + 'listing/' + code + '.html'; };
const CS = getComputedStyle(document.documentElement), cssv = n => CS.getPropertyValue(n).trim(), rgbv = n => cssv(n).split(',').map(Number);
const FB = cssv('--fb') || "'Cairo',sans-serif";
const THEME = { bg: cssv('--bg'), bg2: cssv('--bg2'), acc: cssv('--gold'), accRgb: rgbv('--acc-rgb'), acc2Rgb: rgbv('--acc2-rgb'), inkRgb: rgbv('--ink-rgb'), bgRgb: rgbv('--bg-rgb') };
const readJson = id => { const e = $(id); if (!e) return null; try { return JSON.parse(e.textContent); } catch (x) { return null; } };
const DATA = (readJson('mk-data') || []).filter(x => x && x.code);

/* canvas plumbing shared by the hero scene and the single-listing viewer */
let cv = null, ctx = null, W = 0, H = 0, DPR = 1, SCENE_KEY = 'plots';
function resize() { if (!cv) return; DPR = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * DPR; cv.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
function setCanvas(el) { cv = el; ctx = el.getContext('2d'); resize(); }
addEventListener('resize', () => { resize(); if (typeof FIT !== 'undefined') FIT.key = ''; staticDirty = true; });

const TYPES = { land: 'أرض', villa: 'فيلا', farm: 'مزرعة', apt: 'شقة' };
/* What to showcase is decided by the data, never by a hand-typed list:
   listings flagged `featured` first, then the newest by code number, with at least one of each type when it exists. */
const codeNum = x => +(String(x.code || '').match(/\d+/) || [0])[0];
function pickShowcase(max) {
  const rank = (a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || codeNum(b) - codeNum(a);
  const byNew = [...DATA].sort(rank), out = [], seen = new Set();
  const add = x => { if (x && !seen.has(x.code) && out.length < max) { seen.add(x.code); out.push(x); } };
  for (const c of ['villa', 'land', 'farm', 'apt']) add(byNew.find(d => d.cat === c));
  byNew.forEach(add);
  return out.sort(rank);
}
/* reads a listing's own words (title, features, note) so its drawing matches it */
const said = (x, ...w) => { const t = [x.title, x.note, ...(x.feats || [])].join(' '); return w.some(k => t.includes(k)); };
const floorsOf = (x, d) => { const t = [x.title, ...(x.feats || [])].join(' '); const m = t.match(/(\d+)\s*طواب/); return m ? Math.min(5, +m[1]) : /طابقين/.test(t) ? 2 : /طابق واحد/.test(t) ? 1 : d; };
const num = n => (Math.round(n * 10) / 10).toString();
const money = n => n == null || isNaN(n) ? '' : n >= 1e6 ? `${num(n / 1e6)} مليون $` : `${num(n / 1e3)} ألف $`;
const size = x => x.area_m2 ? (x.area_m2 >= 1000 ? `${num(x.area_m2 / 1000)} دنم` : `${x.area_m2} م²`) : (x.bua ? `${x.bua} م² بناء` : '');
const price = x => (x.price == null || x.mode === 'ask') ? { main: 'السعر عند الاستفسار', note: 'تواصل معنا', ask: true } : x.mode === 'dunam' ? { main: money(x.price), note: `للدنم · الإجمالي ${money(x.total)}` } : { main: money(x.price), note: 'السعر الإجمالي' };

/* ================= 3D scenes (hand-made engine, no libraries) ================= */
const S3 = { yaw: 0, pitch: .35, vyaw: 0, dist: 10, f: 500, cx: 0, cy: 0, drag: false };
const STEER = { x: 0, y: 0, tx: 0, ty: 0 };
let DT = 1, staticDirty = true;
const LIGHT = (() => { const l = [-.35, .75, .55], n = Math.hypot(l[0], l[1], l[2]); return l.map(v => v / n); })();
const COL = (c, a) => { const t = THEME, r = c === 'acc' ? t.accRgb : c === 'acc2' ? t.acc2Rgb : c === 'bg' ? t.bgRgb : t.inkRgb; return `rgba(${r[0]},${r[1]},${r[2]},${Math.max(0, Math.min(1, a)).toFixed(3)})`; };
const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
};
/* primitives: l = polyline, d = dot, f = polygon (may carry `kids` drawn right after it, e.g. windows) */
const Lp = (p, c = 'acc', a = .5, w = 1, lay = 1, dash = 0) => ({ k: 'l', p, c, a, w, lay, dash });
const Dp = (p, r = 2, c = 'acc', a = 1, lay = 1) => ({ k: 'd', p, r, c, a, lay });
const Fp = (p, s = 'main', lay = 1, cull = true) => ({ k: 'f', p, s, lay, cull });

function box(cx, cy, cz, sx, sy, sz, s = 'main', win = {}) {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2, e = .006;
  const F = [
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],   // +x
    [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]],   // -x
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],   // +y
    [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]],   // -y
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],   // +z
    [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]    // -z
  ].map(p => Fp(p, s));
  const kid = (arr, mk) => (arr || []).map(([u, v, w, h, st]) => Fp(mk(u, v, w / 2, h / 2), st || 'glass'));
  F[0].kids = kid(win.right, (u, v, hw, hh) => [[x1 + e, cy + v - hh, cz + u - hw], [x1 + e, cy + v + hh, cz + u - hw], [x1 + e, cy + v + hh, cz + u + hw], [x1 + e, cy + v - hh, cz + u + hw]]);
  F[1].kids = kid(win.left, (u, v, hw, hh) => [[x0 - e, cy + v - hh, cz + u + hw], [x0 - e, cy + v + hh, cz + u + hw], [x0 - e, cy + v + hh, cz + u - hw], [x0 - e, cy + v - hh, cz + u - hw]]);
  F[4].kids = kid(win.front, (u, v, hw, hh) => [[cx + u - hw, cy + v - hh, z1 + e], [cx + u + hw, cy + v - hh, z1 + e], [cx + u + hw, cy + v + hh, z1 + e], [cx + u - hw, cy + v + hh, z1 + e]]);
  return F;
}
function pyr(cx, by, cz, r, h, s = 'leaf') {
  const ap = [cx, by + h, cz], b = [0, 1, 2, 3].map(i => { const a = Math.PI / 4 + i * Math.PI / 2; return [cx + Math.cos(a) * r, by, cz + Math.sin(a) * r]; }), out = [];
  for (let i = 0; i < 4; i++) {
    let tri = [b[i], b[(i + 1) % 4], ap];
    const n = v3.cross(v3.sub(tri[1], tri[0]), v3.sub(tri[2], tri[0]));
    const m = [(tri[0][0] + tri[1][0] + tri[2][0]) / 3 - cx, (tri[0][1] + tri[1][1] + tri[2][1]) / 3 - (by + h * .3), (tri[0][2] + tri[1][2] + tri[2][2]) / 3 - cz];
    if (v3.dot(n, m) < 0) tri = [tri[1], tri[0], tri[2]];
    out.push(Fp(tri, s));
  }
  return out;
}
const tree = (x, z, h) => [Lp([[x, 0, z], [x, h * .32, z]], 'ink', .55, 1.6), ...pyr(x, h * .22, z, h * .3, h * .82)];
const rectLoop = (x0, z0, x1, z1, y = 0) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]];
const groundGrid = (n, step, a = .06) => { const P = []; for (let i = -n; i <= n; i++) P.push(Lp([[i * step, 0, -n * step], [i * step, 0, n * step]], 'ink', a, 1, 0), Lp([[-n * step, 0, i * step], [n * step, 0, i * step]], 'ink', a, 1, 0)); return P; };

/* ---- the renderer: rotate -> cull back faces -> painter's sort -> draw ---- */
function draw3d(prims, o = {}) {
  const cyw = Math.cos(S3.yaw), syw = Math.sin(S3.yaw), cp = Math.cos(S3.pitch), sp = Math.sin(S3.pitch);
  const V = p => { const x = p[0] * cyw + p[2] * syw, z0 = -p[0] * syw + p[2] * cyw; return [x, p[1] * cp - z0 * sp, p[1] * sp + z0 * cp]; };
  const S = v => { const d = Math.max(.3, S3.dist - v[2]), k = S3.f / d; return [S3.cx + v[0] * k, S3.cy - v[1] * k]; };
  const fogA = z => o.fog ? Math.max(0, Math.min(1, 1 - ((S3.dist - z) - o.fog[0]) / (o.fog[1] - o.fog[0]))) : 1;
  const dimA = z => o.dimBack ? .16 + .84 * Math.max(0, Math.min(1, (z + o.dimBack) / (2 * o.dimBack))) : 1;
  const faceItem = q => {
    const v = q.p.map(V), a = v[0], n = v3.cross(v3.sub(v[1], a), v3.sub(v[2], a)), l = Math.hypot(n[0], n[1], n[2]) || 1;
    n[0] /= l; n[1] /= l; n[2] /= l;
    if (q.cull !== false && (-n[0] * a[0] - n[1] * a[1] + n[2] * (S3.dist - a[2])) <= 0) return null;
    let z = 0; for (const w of v) z += w[2];
    return { q, v, n, z: z / v.length + (q.zb || 0), lay: q.lay };
  };
  const items = [];
  for (const q of prims) {
    if (q.k === 'f') { const it = faceItem(q); if (it) items.push(it); }
    else if (q.k === 'l') { const v = q.p.map(V); let z = 0; for (const w of v) z += w[2]; items.push({ q, v, z: z / v.length + (q.zb || 0), lay: q.lay }); }
    else { const v = V(q.p); items.push({ q, v, z: v[2], lay: q.lay }); }
  }
  items.sort((A, B) => A.lay - B.lay || A.z - B.z);
  const paintFace = it => {
    const q = it.q, am = fogA(it.z) * dimA(it.z);
    if (am < .02) return;
    ctx.beginPath();
    it.v.forEach((w, i) => { const s = S(w); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
    ctx.closePath();
    const dot = v3.dot(it.n, LIGHT), b = .28 + .72 * (q.cull === false ? Math.abs(dot) : Math.max(0, dot));
    let solid = true, fill, stroke = null, lw = 1;
    switch (q.s) {
      case 'roof': fill = COL('acc2', (.1 + .26 * b) * am); stroke = COL('acc2', .9 * am); lw = 1.2; break;
      case 'glass': solid = false; fill = COL('acc2', (.3 + .35 * b) * am); stroke = COL('acc2', .95 * am); lw = .8; break;
      case 'door': fill = COL('acc2', .16 * am); stroke = COL('acc2', .9 * am); break;
      case 'water': solid = false; fill = COL('acc2', .24 * am); stroke = COL('acc2', .8 * am); break;
      case 'tile': fill = COL('ink', (.04 + .1 * b) * am); stroke = COL('ink', .32 * am); break;
      case 'grass': fill = COL('acc', (.05 + .1 * b) * am); stroke = COL('ink', .38 * am); break;
      case 'rock': fill = COL('ink', (.03 + .08 * b) * am); stroke = COL('ink', .3 * am); break;
      case 'leaf': fill = COL('acc', (.1 + .2 * b) * am); stroke = COL('acc', .75 * am); break;
      case 'glow': solid = false; fill = COL('acc2', .38 * am); stroke = COL('acc2', 1 * am); lw = 1.6; break;
      default: fill = COL('acc', (.05 + .2 * b) * am); stroke = COL('acc', .62 * am); lw = 1.1;
    }
    if (solid) { ctx.fillStyle = COL('bg', am); ctx.fill(); }
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.stroke(); }
  };
  ctx.setLineDash([]);
  for (const it of items) {
    const q = it.q;
    if (q.k === 'f') {
      paintFace(it);
      if (q.kids) for (const kq of q.kids) { const kit = faceItem(kq); if (kit) { kit.z = it.z; paintFace(kit); } }
    } else if (q.k === 'l') {
      const am = fogA(it.z) * dimA(it.z); if (am < .02) continue;
      ctx.beginPath(); it.v.forEach((w, i) => { const s = S(w); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
      ctx.strokeStyle = COL(q.c, q.a * am); ctx.lineWidth = q.w; ctx.setLineDash(q.dash ? [5, 6] : []); ctx.stroke(); ctx.setLineDash([]);
    } else {
      const am = fogA(it.z) * dimA(it.z), s = S(it.v);
      ctx.beginPath(); ctx.arc(s[0], s[1], q.r * (o.dimBack ? .6 + .4 * dimA(it.z) : 1), 0, 6.2832);
      ctx.fillStyle = COL(q.c, q.a * am); ctx.fill();
    }
  }
}
function paintBg() {
  const [ar, ag, ab] = THEME.accRgb;
  ctx.fillStyle = THEME.bg; ctx.fillRect(0, 0, W, H);
  const gr = ctx.createRadialGradient(W * .62, H * .55, 10, W * .62, H * .55, W * .95);
  gr.addColorStop(0, `rgba(${ar},${ag},${ab},.16)`); gr.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
}
function cam(dist, fk, cyf, pitch) { S3.dist = dist; S3.pitch = pitch; S3.f = Math.min(W, H * .62) * fk; S3.cx = (W >= 900 && SCENE_KEY === 'plots') ? W * .3 : W / 2; S3.cy = H * cyf; }   // on wide screens the scene sits left, away from the headline
function stepYaw(auto) { if (!S3.drag) { S3.yaw += S3.vyaw * DT + auto * DT; S3.vyaw *= Math.pow(.93, DT); } }
const SC_CACHE = {};
const cached = (k, fn) => SC_CACHE[k] || (SC_CACHE[k] = fn());
let SCENE_T0 = performance.now();
const sceneT = now => Math.max(0, (now - SCENE_T0) / 1000);   // rAF timestamps can be slightly older than performance.now()


function coverArt(x, seed) {
  const r = n => (Math.sin(seed * 9.1 + n * 3.7) + 1) / 2, g = THEME.acc;
  let art = '';
  if (x.cat === 'land') {
    for (let i = 0; i < 8; i++) art += `<path d="M-20 ${110 + i * 24 + r(i) * 10} C 80 ${90 + i * 23} 180 ${140 + i * 22 - r(i + 2) * 30} 420 ${100 + i * 26}" stroke="${g}" stroke-opacity="${.16 + i * .05}" fill="none"/>`;
    art += `<rect x="${110 + r(1) * 40}" y="${60 + r(2) * 20}" width="150" height="110" fill="none" stroke="${g}" stroke-width="1.5" stroke-dasharray="6 6" transform="rotate(${-8 + r(3) * 16} 200 120)"/>`;
  } else if (x.cat === 'villa') {
    art += `<path d="M60 240 H340" stroke="${g}" stroke-opacity=".4"/><rect x="90" y="130" width="150" height="110" fill="none" stroke="${g}" stroke-width="1.6"/><rect x="200" y="85" width="110" height="155" fill="none" stroke="${g}" stroke-width="1.6"/><path d="M80 130 H250 M190 85 H320" stroke="${g}" stroke-width="3"/><rect x="215" y="110" width="36" height="46" fill="${g}" fill-opacity=".18" stroke="${g}"/><rect x="258" y="110" width="36" height="46" fill="${g}" fill-opacity=".18" stroke="${g}"/><rect x="110" y="160" width="46" height="34" fill="${g}" fill-opacity=".18" stroke="${g}"/><rect x="70" y="252" width="200" height="20" rx="6" fill="#3fa9c9" fill-opacity=".25" stroke="#5cc3de" stroke-opacity=".6"/>`;
  } else if (x.cat === 'farm') {
    art += `<path d="M20 235 C120 220 260 240 380 226" stroke="${g}" stroke-opacity=".4" fill="none"/>`;
    for (let i = 0; i < 9; i++) { const cx = 30 + i * 42 + r(i) * 10, cy = 195 + r(i + 5) * 20, rr = 16 + r(i + 1) * 12; art += `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="${g}" fill-opacity=".1" stroke="${g}" stroke-opacity=".55"/><path d="M${cx} ${cy + rr} V${cy + rr + 14}" stroke="${g}" stroke-opacity=".5"/>`; }
    art += `<path d="M150 140 L200 102 L250 140 V180 H150Z" fill="${THEME.bg2}" stroke="${g}" stroke-width="1.6"/>`;
  } else {
    art += `<rect x="130" y="50" width="140" height="200" fill="none" stroke="${g}" stroke-width="1.6"/>`;
    for (let yy = 70; yy < 230; yy += 30) for (let xx = 145; xx < 260; xx += 32) art += `<rect x="${xx}" y="${yy}" width="20" height="16" fill="${g}" fill-opacity="${.08 + r(xx + yy) * .25}" stroke="${g}" stroke-opacity=".5"/>`;
  }
  return `<svg viewBox="0 0 400 290" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${art}</svg>${x.sz ? `<span class="meas">${x.sz}</span>` : ''}`;
}

/* ---- 5. floating land parcels: every tile is a real listing ---- */
const zb = (q, v = .35) => (q.zb = v, q);   // depth bias so ground details win the painter's sort against their own slab
const areaScale = x => Math.max(.84, Math.min(1.1, Math.sqrt((x.area_m2 || x.bua || 3000) / 5500)));
function tileLocal(x, seed) {
  const h = areaScale(x), top = .09, P = [], depth = 1.25 * h;
  P.push(...box(0, 0, 0, 2 * h, .18, 2 * h, 'grass'));
  P.push(...pyr(0, -top, 0, h * 1.4142, -depth, 'rock'));                       // the rock the island hangs on
  for (const f of [.3, .58, .82]) { const r = h * (1 - f); P.push(Lp(rectLoop(-r, -r, r, r, -top - depth * f), 'ink', .2, 1)); }
  const treeAt = (px, pz, th) => [Lp([[px, top, pz], [px, top + th * .3, pz]], 'ink', .55, 1.6), ...pyr(px, top + th * .2, pz, th * .28, th * .82)];
  const pool = said(x, 'مسبح'), well = said(x, 'بئر'), walled = said(x, 'مسوّر', 'مسور', 'سور'), shell = said(x, 'عظم', 'هيكل');
  const poolAt = (x0, z0, x1, z1) => P.push(zb(Fp([[x0, top + .01, z0], [x1, top + .01, z0], [x1, top + .01, z1], [x0, top + .01, z1]], 'water', 1, false)), zb(Lp(rectLoop(x0, z0, x1, z1, top + .02), 'acc2', .95, 1.3)));
  const wellAt = (px, pz) => P.push(...box(px, top + .13, pz, .22, .26, .22, 'main'), Lp([[px, top + .26, pz], [px, top + .5, pz]], 'acc2', .9, 1.3), Dp([px, top + .52, pz], 2, 'acc2', 1));
  const house = (cx, cz, w, d, floors, win) => {   // a house whose height follows its floors; a bare shell has no roof slab or windows
    const fh = .34, hh = fh * floors + .12, kw = shell ? {} : win;
    P.push(...box(cx, top + hh / 2, cz, w, hh, d, 'main', kw));
    if (!shell) P.push(...box(cx, top + hh + .035, cz, w + .12, .07, d + .12, 'roof'));
    return hh;
  };
  let labelY = 1.3, kind = x.cat;
  if (kind === 'land') {
    const a = .74 * h, y = top + .01;
    P.push(zb(Lp(rectLoop(-a, -a, a, a, y), 'acc', .95, 1.4, 1, 1)));
    for (let i = 0; i < 4; i++) { const z0 = -a + (i + .6) * a * .4; P.push(zb(Lp([[-a, y, z0], [-a * .3, y, z0 + .12 * ((seed + i) % 3 - 1)], [a * .35, y, z0 - .08], [a, y, z0 + .1]], 'acc', .38, 1))); }
    [[-a, -a], [a, -a], [a, a], [-a, a]].forEach(([px, pz]) => P.push(Lp([[px, top, pz], [px, top + (walled ? .3 : .42), pz]], 'acc2', .95, 1.5), Dp([px, top + (walled ? .32 : .44), pz], 2.4, 'acc2', 1)));
    if (walled) P.push(Lp(rectLoop(-a, -a, a, a, top + .3), 'acc2', .9, 1.8));
    if (well) wellAt(-.4 * a, -.4 * a);
    if (said(x, 'سكن', 'مرخّص', 'مرخص')) house(.35 * a, -.35 * a, .5 * h, .45 * h, 1, { front: [[0, .02, .16, .18]] });
    if (said(x, 'شجر', 'مزروع', 'زيتون')) P.push(...treeAt(-.5 * a, .45 * a, .6), ...treeAt(-.15 * a, .55 * a, .55));
    P.push(Lp([[0, top, a * .58], [0, top + .72, a * .58]], 'ink', .7, 1.6), ...box(0, top + .84, a * .58, .66, .3, .05, 'roof'));
    labelY = 1.35;
  } else if (kind === 'villa') {
    const fl = floorsOf(x, 2), a1 = house(-.3 * h, -.1 * h, .95 * h, .8 * h, Math.min(2, fl), { front: [[0, .02, .25, .25]], left: [[0, .02, .22, .25]] });
    const a2 = fl >= 3 ? house(.42 * h, -.05 * h, .58 * h, .58 * h, fl, { front: [[0, .12, .2, .24]], right: [[0, .12, .2, .24]] }) : a1;
    if (pool) poolAt(-.55 * h, .5 * h, .35 * h, .84 * h); else P.push(...treeAt(-.1 * h, .7 * h, .6));
    P.push(...treeAt(.72 * h, .7 * h, .7), ...treeAt(-.75 * h, -.68 * h, .75));
    if (well) wellAt(.6 * h, -.75 * h);
    labelY = 1.05 + Math.max(a1, a2);
  } else if (kind === 'farm') {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) P.push(...treeAt(-.62 * h + c * .41 * h, -.58 * h + r * .38 * h, .62));
    if (said(x, 'فيل', 'استراح', 'بيت', 'سكن')) house(.42 * h, .62 * h, .6 * h, .38 * h, 1, { front: [[0, .02, .2, .2]] });
    else P.push(...box(.32 * h, top + .2, .66 * h, .7 * h, .4, .4 * h, 'main'), ...pyr(.32 * h, top + .4, .66 * h, .5 * h, .3, 'roof'));
    if (pool) poolAt(-.7 * h, .5 * h, -.15 * h, .85 * h);
    if (well || !pool) wellAt(-.62 * h, .68 * h);
    labelY = 1.25;
  } else {                                                        // apartments, and any type we have not met yet
    const fl = floorsOf(x, kind === 'apt' && said(x, 'أرضي') ? 1 : 4), win = [];
    for (let f = 0; f < fl; f++) for (const u of [-.2, .2]) win.push([u * h, -.34 * (fl - 1) / 2 + f * .34 - .02 + (fl > 1 ? 0 : 0), .2, .18]);
    const hh = house(0, -.1 * h, fl === 1 ? 1.1 * h : .8 * h, fl === 1 ? .7 * h : .8 * h, fl, { front: fl === 1 ? [[-.3 * h, .02, .22, .2], [.3 * h, .02, .22, .2]] : win, right: fl === 1 ? [] : win });
    P.push(...box(0, top + .1, .5 * h, .5 * h, .2, .3 * h, 'roof'), ...treeAt(-.7 * h, .6 * h, .7), ...treeAt(.72 * h, .55 * h, .65));
    if (pool) poolAt(-.5 * h, .5 * h, .3 * h, .85 * h);
    labelY = 1.05 + hh;
  }
  const m = h * 1.07; P.marks = [Lp(rectLoop(-m, -m, m, m, top + .012), 'acc2', 1, 2.4)];
  P.labelY = labelY;
  return P;
}
const PLS = { items: [], tgt: null, lastUser: 0, lastAuto: 0, t0: 0, lift: [], zoom: 0, cardSel: -1, fresh: true, tags: [], ready: false };
const plotsPick = () => pickShowcase(7);
function plotsRebuild() {
  if (!DATA.length) { PLS.items = []; $('pcard').hidden = true; return; }
  for (const k of Object.keys(SC_CACHE)) if (k.startsWith('ptile:')) delete SC_CACHE[k];
  PLS.items = plotsPick(); PLS.lift = PLS.items.map(() => 0); PLS.tags = []; PLS.cardSel = -1; PLS.tgt = 0; PLS.fresh = true; PLS.t0 = performance.now(); PLS.lastUser = performance.now();
  $('pcDots').innerHTML = PLS.items.map(() => '<i></i>').join(''); $('pcard').hidden = !PLS.items.length;
}
function plotsCard(sel) {
  const x = PLS.items[sel]; if (!x) return; PLS.cardSel = sel;
  const p = price(x), t = $('pcTitle'); t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  $('pcType').textContent = (TYPES[x.cat] || 'عقار'); $('pcCode').textContent = x.code; t.textContent = x.title;
  $('pcPrice').textContent = p.main; $('pcMeta').textContent = [size(x), x.area, x.mode === 'dunam' ? 'السعر للدنم' : ''].filter(Boolean).join(' · ');
  $('pcMore').href = UP + 'listing/' + x.code + '.html'; $('pcWa').href = WA + encodeURIComponent(`مرحباً أستاذ محمد، أستفسر عن العقار ${x.code} — ${x.title}`);
  [...$('pcDots').children].forEach((d, i) => d.classList.toggle('on', i === sel));
}
function plotGo(d) {
  if (!PLS.items.length) return; const n = PLS.items.length; PLS.lastUser = performance.now();
  PLS.tgt = (((PLS.tgt != null ? PLS.tgt : PLS.cardSel) + d) % n + n) % n;
}
function plotTap(px, py) {
  if (!PLS.tags.length) return;
  let best = -1, bd = 1e9;
  PLS.tags.forEach((g, i) => { if (!g) return; const d = Math.hypot(px - g.sx, py - g.sy); if (d < g.r * 1.25 && d - g.z * 4 < bd) { bd = d - g.z * 4; best = i; } });
  if (best < 0) return;
  PLS.lastUser = performance.now();
  if (best === PLS.cardSel) goto(PLS.items[best].code); else PLS.tgt = best;
}
function proj(p) {
  const cyw = Math.cos(S3.yaw), syw = Math.sin(S3.yaw), cp = Math.cos(S3.pitch), sp = Math.sin(S3.pitch);
  const x = p[0] * cyw + p[2] * syw, z0 = -p[0] * syw + p[2] * cyw, y = p[1] * cp - z0 * sp, z = p[1] * sp + z0 * cp, k = S3.f / Math.max(.3, S3.dist - z);
  return [S3.cx + x * k, S3.cy - y * k, z, k];
}
function pill(x, y, text, big, alpha) {
  const fs = big ? 15 : 12, h = big ? 32 : 24;
  ctx.save(); ctx.globalAlpha = alpha; ctx.font = `800 ${fs}px ${FB}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + (big ? 30 : 20), r = h / 2, x0 = x - w / 2, y0 = y - h / 2;
  ctx.beginPath(); ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r); ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r); ctx.arcTo(x0, y0 + h, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.closePath();
  ctx.fillStyle = COL('bg', .86); ctx.fill(); ctx.strokeStyle = COL('acc', big ? 1 : .55); ctx.lineWidth = big ? 1.6 : 1; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y0 + h); ctx.lineTo(x, y0 + h + (big ? 12 : 8)); ctx.stroke();
  ctx.fillStyle = big ? COL('acc2', 1) : COL('ink', .95); ctx.fillText(text, x, y + 1); ctx.restore();
}
const ringPts = (r, y, cx = 0, cz = 0, n = 48) => { const o = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; o.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]); } return o; };
const wrapPi = d => ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
const eoC = x => 1 - Math.pow(1 - x, 3);
/* fit the whole ring into the free band between the headline and the info card, on any screen */
const FIT = { key: '', f: 500, cy: 0 };
function plotsFit(n, R) {
  const wide = W >= 900, ti = $('htitle'), pc = $('pcard');
  const top = wide ? 84 : ti.offsetTop + ti.offsetHeight + 10, bottom = (pc.offsetTop || H - 190) - 8, availW = wide ? W * .56 : W * 1.5;   // on phones the ring may run past the edges, like a carousel
  const key = [W, H, top, bottom, n, R].join();
  if (key === FIT.key) return;
  FIT.key = key;
  const P = .43, D = 13.8, cp = Math.cos(P), sp = Math.sin(P); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const yy of [2.5, -1.9]) for (let i = 0; i < 36; i++) {
    const a = i / 36 * Math.PI * 2, x = Math.cos(a) * (R + 1.05), z = Math.sin(a) * (R + 1.05), k = 1 / (D - (yy * sp + z * cp)), sy = -(yy * cp - z * sp) * k;
    x0 = Math.min(x0, x * k); x1 = Math.max(x1, x * k); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  FIT.f = Math.max(120, Math.min((bottom - top) / (y1 - y0), availW / (x1 - x0)) * .93);
  FIT.cy = (top + bottom) / 2 - (y0 + y1) / 2 * FIT.f;
}
function drawPlots(now) {
  paintBg();
  if (!PLS.items.length) { plotsRebuild(); if (!PLS.items.length) return; }
  const n = PLS.items.length, step = Math.PI * 2 / n, t = sceneT(now), tt = (now - PLS.t0) / 1000, R = n < 2 ? 0 : Math.min(4.1, 1.7 + n * .6), GY = -2.5;
  const front = yaw => ((Math.round((yaw + Math.PI / 2) / step) % n) + n) % n;
  if (PLS.fresh) { S3.yaw = -Math.PI / 2; S3.vyaw = 0; PLS.fresh = false; }
  let settled = false;
  if (!S3.drag) {
    S3.yaw += S3.vyaw * DT; S3.vyaw *= Math.pow(.93, DT);
    if (Math.abs(S3.vyaw) < .006) {
      if (PLS.tgt == null) PLS.tgt = front(S3.yaw);
      const base = PLS.tgt * step - Math.PI / 2, goal = base + Math.PI * 2 * Math.round((S3.yaw - base) / (Math.PI * 2));
      S3.yaw += (goal - S3.yaw) * (1 - Math.pow(.88, DT)); settled = Math.abs(goal - S3.yaw) < .03;
    }
  } else PLS.tgt = null;
  const sel = front(S3.yaw);
  if (!S3.drag && settled && now - PLS.lastUser > 5200 && now - PLS.lastAuto > 4300) { PLS.lastAuto = now; PLS.tgt = (sel + 1) % n; }   // gentle auto tour while nobody touches it
  PLS.zoom += ((settled ? 1 : 0) - PLS.zoom) * (1 - Math.pow(.92, DT));
  if (sel !== PLS.cardSel) plotsCard(sel);
  plotsFit(n, R);
  cam(13.8 - 1.3 * PLS.zoom, 1, .5, .43 - .03 * PLS.zoom + STEER.y * .04);
  S3.f = FIT.f; S3.cy = FIT.cy;

  const P = [], ph = (t * .6) % 1;
  P.push(Lp(ringPts(R, GY), 'acc', .3, 1.2, 0, 1), Lp(ringPts(R * .5, GY), 'acc', .16, 1, 0), Lp(ringPts(R * 1.3, GY), 'ink', .1, 1, 0, 1));
  const tagged = [];
  for (let i = 0; i < n; i++) {
    const x = PLS.items[i], a = i * step, tx = Math.cos(a) * R, tz = Math.sin(a) * R;
    const en = eoC(Math.max(0, Math.min(1, (tt - i * .11) / 1.1)));
    PLS.lift[i] += ((i === sel ? 1 : 0) - PLS.lift[i]) * (1 - Math.pow(.9, DT));
    const L = PLS.lift[i], ty = Math.sin(t * .9 + i * 1.3) * .18 + .25 + L * .5 - (1 - en) * 6.5, sc = (1 + L * .1) * .88;
    const free = t * .2 + i * 1.7, sp = free + wrapPi(-S3.yaw - free) * L, c = Math.cos(sp), s = Math.sin(sp);
    const T = p => { const px = p[0] * sc, pz = p[2] * sc; return [px * c + pz * s + tx, p[1] * sc + ty, -px * s + pz * c + tz]; };
    const xf = q => { const nq = { ...q, p: q.k === 'd' ? T(q.p) : q.p.map(T) }; if (q.kids) nq.kids = q.kids.map(kq => ({ ...kq, p: kq.p.map(T) })); P.push(nq); };
    const loc = cached('ptile:' + x.code, () => tileLocal(x, i));
    for (const q of loc) xf(q);
    if (i === sel) for (const q of loc.marks) xf(q);
    P.push(Lp(ringPts(.95 * sc, GY, tx, tz, 28), 'ink', .2 + .1 * L, 1, 0), Lp([[tx, ty - 1.2 * sc, tz], [tx, GY, tz]], 'acc2', .08 + .3 * L, 1, 0));
    if (i === sel) P.push(Lp(ringPts(1 + ph * 1.1, GY, tx, tz, 32), 'acc2', (1 - ph) * .85, 1.6, 0));
    tagged.push({ i, pos: [tx, ty + (loc.labelY + .2) * sc, tz], ctr: [tx, ty + .4 * sc, tz], sc, en });
  }
  for (let j = 0; j < 24; j++) {   // floating dust
    const u = Math.sin(j * 91.7) * .5 + .5, v = Math.sin(j * 47.3 + 1) * .5 + .5, w = Math.sin(j * 12.9 + 2) * .5 + .5, rr = 1.6 + u * 4.4, aa = v * 6.283 + t * .06;
    P.push(Dp([Math.cos(aa) * rr, -1.6 + w * 4.2 + Math.sin(t * .5 + j) * .15, Math.sin(aa) * rr], 1.1 + u, 'acc2', .25 + .3 * v));
  }
  draw3d(P);

  PLS.tags = [];
  const tg = tagged.map(g => ({ ...g, pr: proj(g.pos), pc: proj(g.ctr) })).sort((A, B) => A.pr[2] - B.pr[2]);
  for (const g of tg) {
    const x = PLS.items[g.i], isSel = g.i === sel, dep = Math.max(0, Math.min(1, (g.pr[2] + R) / (2 * R)));
    PLS.tags[g.i] = { sx: g.pc[0], sy: g.pc[1], r: 1.15 * g.sc * g.pc[3], z: g.pc[2] };
    const dIdx = Math.min((g.i - sel + n) % n, (sel - g.i + n) % n);
    if (!isSel && dIdx > 1) continue;
    const p = price(x), txt = p.ask ? 'اسأل عن السعر' : p.main + (x.mode === 'dunam' ? ' / دنم' : '');
    pill(Math.max(50, Math.min(W - 50, g.pr[0])), Math.max(FIT.cy - 200, g.pr[1]), txt, isSel, Math.min(1, g.en) * (isSel ? 1 : .3 + .45 * dep));
  }
}


/* ---------- the single-listing viewer: this listing's own parcel, turning slowly ---------- */
const TILE = { item: null, seed: 1, vis: true };
function drawTile(now) {
  paintBg();
  const it = TILE.item, t = sceneT(now), GY = -3.1;
  stepYaw(.0045);
  cam(10.8, 1, .64, .4 + STEER.y * .04);
  S3.f = Math.min(W * 1.4, H * 1.9);
  const loc = cached('tile', () => tileLocal(it, TILE.seed)), sc = clamp(3.5 / (loc.labelY + .3), 1.05, 1.55), ty = Math.sin(t * .8) * .1 + .1;
  const T = p => [p[0] * sc, p[1] * sc + ty, p[2] * sc], P = [];
  const xf = q => { const nq = { ...q, p: q.k === 'd' ? T(q.p) : q.p.map(T) }; if (q.kids) nq.kids = q.kids.map(kq => ({ ...kq, p: kq.p.map(T) })); P.push(nq); };
  for (const q of loc) xf(q);
  for (const q of loc.marks) xf(q);
  P.push(Lp(ringPts(3.3, GY), 'acc', .3, 1.2, 0, 1), Lp(ringPts(1.8, GY), 'acc', .18, 1, 0), Lp(ringPts(1.15 * sc, GY, 0, 0, 32), 'ink', .22, 1, 0), Lp([[0, ty - 1.3 * sc, 0], [0, GY, 0]], 'acc2', .3, 1, 0));
  const ph = (t * .5) % 1; P.push(Lp(ringPts(1 + ph * 1.6, GY, 0, 0, 40), 'acc2', (1 - ph) * .7, 1.5, 0));
  for (let j = 0; j < 26; j++) {
    const u = Math.sin(j * 91.7) * .5 + .5, v = Math.sin(j * 47.3 + 1) * .5 + .5, w = Math.sin(j * 12.9 + 2) * .5 + .5, rr = 1.4 + u * 3.2, aa = v * 6.283 + t * .07;
    P.push(Dp([Math.cos(aa) * rr, -2.2 + w * 5 + Math.sin(t * .5 + j) * .15, Math.sin(aa) * rr], 1.1 + u, 'acc2', .25 + .3 * v));
  }
  draw3d(P);
  const g = proj([0, ty + (loc.labelY + .25) * sc, 0]), p = price(it);
  pill(g[0], g[1], p.ask ? 'اسأل عن السعر' : p.main + (it.mode === 'dunam' ? ' / دنم' : ''), true, 1);
}

/* ---------- pointer input: drag rotates, position steers ---------- */
function bindStage(el, tapFn) {
  let down = false, lastX = 0, tap = null;
  const steer = e => { const r = el.getBoundingClientRect(); STEER.tx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1); STEER.ty = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1); };
  el.addEventListener('pointerdown', e => { tap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; PLS.lastUser = performance.now(); down = true; lastX = e.clientX; S3.drag = true; S3.vyaw = 0; steer(e); const h = $('thint'); if (h) h.style.opacity = 0; });
  el.addEventListener('pointermove', e => {
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 9) tap.moved = true;
    if (down) { const dx = e.clientX - lastX; lastX = e.clientX; S3.yaw += dx * .0085; S3.vyaw = S3.vyaw * .5 + dx * .0085 * .5; }
    if (e.pointerType === 'mouse' || down) steer(e);
  });
  const up = e => {
    if (e && e.type === 'pointerup' && tapFn && tap && !tap.moved && performance.now() - tap.t < 450) { const r = cv.getBoundingClientRect(); tapFn(e.clientX - r.left, e.clientY - r.top); }
    tap = null; down = false; S3.drag = false; STEER.tx = 0; STEER.ty = 0; PLS.lastUser = performance.now();
  };
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, up));
}

/* ---------- page features ---------- */
const heroEl = $('hero'), heroCv = $('hero3d'), tileCv = $('tile3d'), item = readJson('mk-item');
const HERO = !!(heroEl && heroCv && DATA.length), TILEV = !!(tileCv && item);
if (HERO) {
  setCanvas(heroCv); heroEl.classList.add('has3d');
  bindStage(heroEl, plotTap);
  $('pcard').addEventListener('pointerdown', e => e.stopPropagation());
  $('pcPrev').onclick = () => plotGo(-1); $('pcNext').onclick = () => plotGo(1);
  setTimeout(() => { const h = $('thint'); if (h) h.style.opacity = 0; }, 6500);
}
if (TILEV) {
  TILE.item = item; setCanvas(tileCv); bindStage(tileCv, null);
  new IntersectionObserver(es => { TILE.vis = es[0].isIntersecting; }).observe(tileCv);
}
/* the line-art picture of each property (cards, hover thumbs) */
document.querySelectorAll('.cover[data-cat]').forEach((el, i) => { el.innerHTML = coverArt({ cat: el.dataset.cat, sz: el.dataset.size || '' }, +el.dataset.seed || i + 1); });
/* the big moving words */
(function () {
  const a = $('m1'), b = $('m2'); if (!a || !b) return;
  const words = ['يعفور', 'قرى الشام', 'الصبورة', 'أراضٍ', 'فلل', 'مزارع'];
  const fill = (el, o) => { const c = words.map(w => `<span${o ? ' class="o"' : ''}>${w}</span><span class="dot">✦</span>`).join(''); el.innerHTML = c + c + c; };
  fill(a, false); fill(b, true);
})();
/* filters over the listing rows */
(function () {
  const list = $('listings-grid'); if (!list) return;
  const rows = [...list.querySelectorAll('.row')], fa = $('fArea'), fc = $('fCat'), fb = $('fBudget'), cnt = $('rcount'), none = $('rnone');
  function apply() {
    const a = fa && fa.value, c = fc && fc.value, b = fb && fb.value; let lo = 0, hi = Infinity, n = 0;
    if (b) { const p = b.split('-'); lo = +p[0]; hi = p[1] ? +p[1] : Infinity; }
    rows.forEach(el => {
      let ok = (!a || el.getAttribute('data-area') === a) && (!c || el.getAttribute('data-cat') === c);
      if (ok && b) { const t = +el.getAttribute('data-total'); ok = t > 0 && t >= lo && t < hi; }
      el.hidden = !ok; if (ok) n++;
    });
    if (cnt) cnt.textContent = n === rows.length ? n + ' عقار متاح' : n + ' من ' + rows.length + ' عقار';
    if (none) none.hidden = n > 0;
  }
  [fa, fc, fb].forEach(s => s && s.addEventListener('change', apply)); apply();
})();
/* "دوّرلي على عقار" → WhatsApp */
(function () {
  const go = $('reqGo'); if (!go) return;
  go.addEventListener('click', () => {
    const lines = ['مرحباً أستاذ محمد، بدوّر على عقار:'];
    [['reqCat', 'النوع'], ['reqArea', 'المنطقة'], ['reqSize', 'المساحة'], ['reqBudget', 'الميزانية']].forEach(([id, l]) => { const v = $(id).value; if (v) lines.push('▪️ ' + l + ': ' + v); });
    const note = $('reqNote').value.trim(); if (note) lines.push('▪️ ملاحظة: ' + note);
    window.open(WA + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
  });
})();
/* share this listing */
(function () {
  const b = $('shareBtn'); if (!b) return;
  b.addEventListener('click', () => {
    const txt = b.getAttribute('data-txt'), url = location.href;
    if (navigator.share) { navigator.share({ title: document.title, text: txt, url }).catch(() => {}); return; }
    window.open('https://wa.me/?text=' + encodeURIComponent(txt + '\n' + url), '_blank', 'noopener');
  });
})();

/* ---------- one loop: scroll-driven motion + the 3D canvases ---------- */
let REVEAL = [...document.querySelectorAll('.rv')], COUNTS = [...document.querySelectorAll('[data-count]')], ROWSEL = [...document.querySelectorAll('.row')];
let lastY = scrollY, VEL = 0, lastT = performance.now(), m1x = 0, m2x = 0;
const root = document.documentElement.style;
function frame(now) {
  const dt = Math.min(50, now - lastT) / 16.67; lastT = now; DT = dt;
  const y = scrollY, vh = innerHeight, dv = y - lastY; lastY = y; VEL += (dv - VEL) * .15;
  root.setProperty('--navbg', HOME ? clamp(y / (vh * .4)).toFixed(3) : 1);
  root.setProperty('--dock', (HOME ? clamp((y - vh * .7) / (vh * .3)) : clamp((y - 240) / 200)).toFixed(3));
  STEER.x += (STEER.tx - STEER.x) * .08; STEER.y += (STEER.ty - STEER.y) * .08;
  if (HERO && y < vh * 1.05) { if (!reduce || staticDirty) { staticDirty = false; drawPlots(now); } }
  if (TILEV && TILE.vis) { if (!reduce || staticDirty) { staticDirty = false; drawTile(now); } }
  if (!reduce) {
    if (HERO) { const hc = $('hcopy'); hc.style.transform = `translateY(${y * .4}px)`; hc.style.opacity = 1 - clamp(y / (vh * .7)); }
    const a = $('m1'), b = $('m2');
    if (a && b) {
      const sp = 1.2 + Math.abs(VEL) * .9, dir = VEL < -.2 ? -1 : 1, w1 = a.scrollWidth / 3, w2 = b.scrollWidth / 3;
      if (w1 > 0) { m1x = (m1x - sp * dir * dt + w1) % w1; m2x = (m2x + sp * dir * dt * .8 + w2) % w2; a.style.transform = `translateX(${-m1x}px)`; b.style.transform = `translateX(${-w2 + m2x}px)`; }
    }
    for (const el of REVEAL) {
      const r = el.getBoundingClientRect(); if (r.top > vh * 1.2 || r.bottom < -vh * .2) continue;
      const p = eo(clamp((vh * .96 - r.top) / (vh * .26))); el.style.opacity = p; el.style.transform = `translateY(${(1 - p) * 40}px)`;
    }
    for (const el of ROWSEL) { const r = el.getBoundingClientRect(); if (r.top > vh * 1.2 || r.bottom < -40) continue; el.style.setProperty('--lx', eo(clamp((vh * .98 - r.top) / (vh * .4))).toFixed(3)); }
    const rv = $('reveal');
    if (rv) { const r = rv.getBoundingClientRect(); $('circle').style.setProperty('--cr', (6 + eo(clamp(-r.top / (r.height - vh * 1.05))) * 94).toFixed(1) + '%'); }
    for (const el of COUNTS) { const r = el.getBoundingClientRect(); el.textContent = Math.round(+el.dataset.count * eo(clamp((vh * .95 - r.top) / (vh * .3)))); }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
})();
