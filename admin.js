/* لوحة إدارة مخزون محمد خالد — مستقلة، تكتب على GitHub مباشرة.
   المصدر: private.json في المستودع الخاص (كل شي).
   المشتق: data.json + index.html + listing/*.html + sitemap.xml في المستودع العام. */
"use strict";

const $ = id => document.getElementById(id);
const LS = "mk_admin_cfg", LS_DRAFT = "mk_admin_draft";

/* ===== ثوابت الموقع (مطابقة لـ build_site.py) ===== */
const BASE = "https://aqarat-yaafour.github.io";
const PHONE_INTL = "963996606813", PHONE_LOCAL = "0996 606 813";
const NAME = "محمد خالد", ROLE = "مستشار عقاري";
const CAT_EN = { "أرض": "land", "فيلا": "villa", "مزرعة": "farm", "شقة": "apt", "استثماري": "invest" };
const CAT_AR = { land: "أرض", villa: "فيلا", farm: "مزرعة", apt: "شقة", invest: "استثماري" };
const CATS = ["أرض", "فيلا", "مزرعة", "شقة", "استثماري"];
const CAT_KEYS = ["land", "villa", "farm", "apt", "invest"];   /* ترتيب التصنيفات في الفلاتر وصفحات الأصناف */

let CFG = null, ROWS = [], BASE_ROWS = "", PRIV_SHA = null, PRIV_BASE = "", editing = null, quickRow = null;
let feats = [], photos = [], unit = "dunam", mode = "مقطوع", filter = "all", query = "";
let newBlobs = {};   /* مسار الملف -> base64 لصور لم تُرفع بعد */

/* ===== أدوات ===== */
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = n => {
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e6) { const v = +(n / 1e6).toFixed(2); return (v === 1 ? "مليون $" : v + " مليون $"); }
  return Math.round(n / 1000).toLocaleString("en-US") + " ألف $";
};
const totalOf = r => r.mode === "للدنم" ? (+r.price || 0) * (+r.area_m2 || 0) / 1000 : (+r.price || 0);
function sizeOf(r) {
  const a = +r.area_m2;
  if (!a) return r.bua ? [r.bua, "م² بناء"] : ["—", ""];
  if (a >= 1000 && a % 500 === 0) { const v = a / 1000; return [Number.isInteger(v) ? v : v, "دنم"]; }
  return [a.toLocaleString("en-US"), "م²"];
}
function priceTxt(r) {
  if (!r.confirmed) return ["السعر عند التواصل", "", null];
  if (r.mode === "للدنم") return [money(r.price), "للدنم", totalOf(r)];
  return [money(r.price), "السعر الإجمالي", r.price];
}
/* ترميز مطابق لـurllib.parse.quote في بايثون: يرمّز !'()* ويترك / كما هي */
const quote = t => encodeURIComponent(t)
  .replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase())
  .replace(/%2F/g, "/");
const wa = t => "https://wa.me/" + PHONE_INTL + "?text=" + quote(t);
/* التاريخ بالتوقيت المحلي (متل datetime.date.today في بايثون) — مو UTC،
   وإلا اختلف تاريخ الموقع حسب مين نشره وبأي ساعة */
/* تاريخ آخر تعديل للعقار بالتوقيت المحلي — ثابت، فلا تتغيّر صفحات لم تتعدّل (نشر أسرع) */
const dayOf = iso => {
  if (!iso) return null;
  const d = new Date(iso); if (isNaN(d)) return null;
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};
const today = () => {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const b64text = t => b64(new TextEncoder().encode(t));

/* ===== الأرقام: العربية (٠-٩) والفارسية تتحوّل للاتينية، وتُفهم الفواصل ===== */
function toLatinDigits(s) {
  return String(s == null ? "" : s)
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6F0))
    .replace(/٫/g, ".").replace(/[٬،]/g, ",");
}
/** "٢٥٠٬٠٠٠" أو "250,000" أو "1,5" أو "2.5" → رقم، وإلا NaN */
function parseNum(s) {
  let t = toLatinDigits(s).replace(/[\s\u00a0\u200e\u200f]/g, "");
  if (!t) return NaN;
  if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(",", ".");   /* فاصلة عشرية: 1,5 */
  else t = t.replace(/,/g, "");                               /* فاصلة آلاف: 250,000 */
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? parseFloat(t) : NaN;
}
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = s => unb64(s.replace(/-/g, "+").replace(/_/g, "/"));

/* ===== حماية الصور =====
   الصور تعيش في المستودع الخاص فقط. صفحة المعرض في الموقع العام تحمل صوراً مشفّرة (AES-GCM)
   ومفتاح الفك في الرابط بعد # — لا يصل لأي خادم ولا يُخزَّن في أي مستودع. */
async function photoBytes(path) {
  if (newBlobs[path]) return unb64(newBlobs[path]);
  const b = await ghRaw(CFG.priv, path);
  if (b) return b;
  /* صور قديمة لم تُرحَّل بعد: ما زالت في الموقع العام */
  try { const r = await fetch(BASE + "/" + path, { cache: "no-store" }); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch (e) { }
  return null;
}
const photoUrls = new Map();
function loadPhoto(path) {
  if (newBlobs[path]) return Promise.resolve("data:image/jpeg;base64," + newBlobs[path]);
  if (!photoUrls.has(path)) photoUrls.set(path, photoBytes(path).then(b => {
    if (!b) { photoUrls.delete(path); return null; }
    return URL.createObjectURL(new Blob([b], { type: "image/jpeg" }));
  }));
  return photoUrls.get(path);
}
function setPhoto(img, path) {
  img.removeAttribute("src");
  loadPhoto(path).then(u => { if (u) img.src = u; });
}
function newSecret() { const b = new Uint8Array(16); crypto.getRandomValues(b); return b64url(b); }
/** صور -> ملف واحد: [عدد][طول+IV+مشفّر]… */
async function encryptPhotos(secret, list) {
  const key = await crypto.subtle.importKey("raw", unb64url(secret), "AES-GCM", false, ["encrypt"]);
  const parts = [], head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, list.length); parts.push(head);
  for (const bytes of list) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
    const l = new Uint8Array(4); new DataView(l.buffer).setUint32(0, 12 + ct.length);
    parts.push(l, iv, ct);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ===== GitHub ===== */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function gh(path, opts) {
  for (let a = 0; ; a++) {
    const r = await fetch("https://api.github.com" + path, Object.assign({
      headers: {
        Authorization: "Bearer " + CFG.token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    }, opts || {}));
    if (r.status === 404) return null;
    if (r.ok) return r.status === 204 ? true : r.json();
    let m = r.status + "";
    try { m = (await r.json()).message || m; } catch (e) { }
    /* حدّ سرعة GitHub: ننتظر ونعيد المحاولة بدل ما نفشل النشر */
    const limited = r.status === 429 || (r.status === 403 && (r.headers.get("retry-after") || /rate limit|abuse/i.test(m)));
    if (limited && a < 3) { await sleep(((+r.headers.get("retry-after")) || 2 ** (a + 1)) * 1000); continue; }
    if (r.status === 401) m = "المفتاح غير صالح أو انتهت صلاحيته.";
    if (r.status === 403) m = "المفتاح ما عنده صلاحية الكتابة على هالمستودع.";
    throw new Error(m);
  }
}
const ghPost = (p, body) => gh(p, { method: "POST", body: JSON.stringify(body) });

/** ملف JSON مع بصمته (sha): البصمة تكشف إن تغيّر الملف من جهاز آخر */
async function readFile(repo, file, ref) {
  const res = await gh(`/repos/${CFG.owner}/${repo}/contents/${file}${ref ? "?ref=" + ref : ""}`);
  if (!res) return null;
  const txt = new TextDecoder().decode(Uint8Array.from(atob(res.content.replace(/\n/g, "")), c => c.charCodeAt(0)));
  return { json: JSON.parse(txt), sha: res.sha || null };
}
async function readJson(repo, file) {
  const f = await readFile(repo, file);
  return f ? f.json : null;
}

/** ملف خام من مستودع (الصور في المستودع الخاص، تُقرأ بمفتاحك فقط) */
async function ghRaw(repo, path, ref) {
  try {
    const r = await fetch(`https://api.github.com/repos/${CFG.owner}/${repo}/contents/${quote(path)}${ref ? "?ref=" + ref : ""}`, {
      headers: { Authorization: "Bearer " + CFG.token, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" }
    });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch (e) { return null; }
}

/** لقطة المستودع: آخر commit وشجرته وبصمة (sha) كل ملف */
async function repoTree(repo) {
  const o = CFG.owner;
  const ref = await gh(`/repos/${o}/${repo}/git/ref/heads/main`);
  if (!ref) throw new Error(`ما لقيت فرع main في ${repo}. تأكد أن المستودع فيه ملف واحد على الأقل.`);
  const head = ref.object.sha;
  const base = (await gh(`/repos/${o}/${repo}/git/commits/${head}`)).tree.sha;
  const t = await gh(`/repos/${o}/${repo}/git/trees/${base}?recursive=1`);
  const map = new Map((t && t.tree || []).filter(e => e.type === "blob").map(e => [e.path, e.sha]));
  return { head, base, map, truncated: !!(t && t.truncated) };
}

/** بصمة Git للملف محلياً: نعرف قبل الرفع إن كان تغيّر فعلاً */
async function gitSha(bytes) {
  const h = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(h.length + bytes.length); all.set(h); all.set(bytes, h.length);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", all)), v => v.toString(16).padStart(2, "0")).join("");
}
/** تنفيذ متوازٍ بحدّ أقصى n في الوقت نفسه */
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** commit واحد يحمل كل الملفات المتغيّرة فقط. files: [{path, content|b64}] ، deletes: [مسار]
    النص يُرسل داخل الشجرة مباشرة (طلب واحد لكل النصوص)، والملفات الثنائية بالتوازي.
    يرجع null إن لم يتغيّر شيء. */
async function commit(repo, files, message, deletes, snap, retried) {
  const o = CFG.owner;
  snap = snap || await repoTree(repo);
  const tree = [], bins = [];
  for (const f of files) {
    const bytes = f.b64 ? unb64(f.b64) : new TextEncoder().encode(f.content);
    if (snap.map.get(f.path) === await gitSha(bytes)) continue;      /* لم يتغيّر */
    if (f.b64) bins.push(f);
    else tree.push({ path: f.path, mode: "100644", type: "blob", content: f.content });
  }
  const shas = await pool(bins, 4, f => ghPost(`/repos/${o}/${repo}/git/blobs`, { content: f.b64, encoding: "base64" }));
  bins.forEach((f, i) => tree.push({ path: f.path, mode: "100644", type: "blob", sha: shas[i].sha }));
  /* sha: null يحذف الملف من الشجرة */
  for (const p of (deletes || [])) if (snap.map.has(p)) tree.push({ path: p, mode: "100644", type: "blob", sha: null });
  if (!tree.length) return null;

  const newTree = await ghPost(`/repos/${o}/${repo}/git/trees`, { base_tree: snap.base, tree });
  const c = await ghPost(`/repos/${o}/${repo}/git/commits`, { message, tree: newTree.sha, parents: [snap.head] });
  try {
    await gh(`/repos/${o}/${repo}/git/refs/heads/main`, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
  } catch (e) {
    /* الفرع تحرّك أثناء النشر (تعديل من مكان آخر): نعيد اللقطة ونحاول مرة واحدة تلقائياً */
    if (!retried && /fast.?forward/i.test(e.message)) return commit(repo, files, message, deletes, null, true);
    throw e;
  }
  return {
    sha: c.sha, changed: tree.length,
    written: tree.filter(e => e.sha !== null).map(e => e.path),
    removed: tree.filter(e => e.sha === null).map(e => e.path)
  };
}

/* ===== مولّد الموقع — التصميم الجديد (زمرّد ملكي + خط جريء عريض) =====
   كل صفحة هنا HTML كامل جاهز لمحركات البحث، ثم يحسّنه assets/mk.css و assets/mk.js
   (وهما ملفان ثابتان في المستودع لا تلمسهما لوحة الإدارة). */
const ASSET_V = "3";   /* ارفع الرقم عند تعديل mk.css أو mk.js ليُحمَّل الجديد عند الزوار */
const jsonInline = v => JSON.stringify(v).replace(/</g, "\\u003c");   /* آمن داخل <script> */
const WA_SVG = '<svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3zm5.8 15.7c-.3-.2-1.9-.9-2.2-1s-.5-.2-.7.2-.8 1-1 1.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.6.3-.5.9-1.7a.6.6 0 0 0 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6a1.2 1.2 0 0 0-.9.4 3.6 3.6 0 0 0-1.1 2.7 6.3 6.3 0 0 0 1.3 3.3 14.4 14.4 0 0 0 5.5 4.9c2 .9 2.8.9 3.8.8a3.3 3.3 0 0 0 2.1-1.5 2.7 2.7 0 0 0 .2-1.5c-.1-.2-.3-.3-.6-.4z"/></svg>';
const TEL_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
const CHEV_R = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const CHEV_L = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

/* صورة المعاينة عند مشاركة الرابط على واتساب وفيسبوك */
const OG_V = "1";   /* ارفعه عند تغيير تصميم البطاقة ليُعاد رسمها ويتحدّث كاش واتساب */
/* بصمة قصيرة (cyrb53) لبيانات البطاقة: تدخل في اسم الملف فيتغيّر الرابط لما يتغيّر السعر أو العنوان
   (واتساب يحفظ المعاينة حسب الرابط، فبدون هذا يبقى يعرض البطاقة القديمة) */
function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return ((h2 >>> 0).toString(36) + (h1 >>> 0).toString(36)).slice(0, 8);
}
/* السعر المخفي ما بيدخل في البصمة: اسم الملف علني، وبصمة فيها السعر ممكن تُخمَّن بالتجربة */
const ogPath = x => {
  if (!x) return `og/site-${OG_V}.jpg`;
  const shown = x.confirmed !== false;
  return `og/${x.code}-${hashStr(OG_V + JSON.stringify([x.code, x.cat, x.title, x.area, x.area_m2, x.bua, shown ? x.mode : null, shown ? x.price : null, shown && !!x.nego, shown, regionOf(x.area)]))}.jpg`;
};
function ogImage(x) {
  return `${BASE}/${ogPath(x)}`;
}
function headHtml(title, desc, canonical, jsonld, extra, image, bodyCls) {
  const up = canonical.indexOf("/listing/") >= 0 ? "../" : "";
  const og = image || ogImage(null);
  return `<!doctype html>
<html lang="ar" dir="rtl" class="solid">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NAME} - ${ROLE}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:locale" content="ar_SY">
<meta property="og:image" content="${og}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${og}">
<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${BASE}/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="${BASE}/apple-touch-icon.png">
<link rel="manifest" href="${BASE}/site.webmanifest">
<meta name="theme-color" content="#06231b">
<link rel="preload" href="${BASE}/assets/fonts/lalezar-arabic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="${BASE}/assets/fonts/cairo-arabic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${BASE}/assets/mk.css?v=${ASSET_V}">
<script type="application/ld+json">${JSON.stringify(jsonld)}<\/script>
${extra || ""}
</head>
<body class="${bodyCls || ""}" data-up="${up}" data-phone="${PHONE_INTL}">
`;
}
const NAV = up => `<header class="nav">
  <a class="brand" href="${up}index.html"><img src="${up}img/mohammad-khaled.jpg" width="40" height="40" alt="${NAME}"><span><b>${NAME}</b><small>${ROLE}</small></span></a>
  <a class="wa" href="${wa("مرحباً أستاذ محمد، أرغب بالاستفسار عن عقار.")}" target="_blank" rel="noopener">واتساب</a>
</header>
`;
const FOOT = () => `<footer class="site">
  <div><b>${NAME}</b> · ${ROLE} · يعفور وقرى الشام، ريف دمشق</div>
  <div>واتساب: <a href="tel:+${PHONE_INTL}" dir="ltr">${PHONE_LOCAL}</a></div>
  <div>الأسعار والتوفر قابلة للتغيير. الأوراق تُعرض كاملة قبل أي عربون.</div>
</footer>
<nav class="dock"><a class="wa" href="${wa("مرحباً أستاذ محمد، أرغب بالاستفسار عن عقار.")}" target="_blank" rel="noopener">${WA_SVG}تواصل على واتساب</a><a class="call" href="tel:+${PHONE_INTL}" aria-label="اتصال">${TEL_SVG}</a></nav>
<script src="${BASE}/assets/mk.js?v=${ASSET_V}" defer><\/script>
</body></html>
`;
/* سطر عقار في القوائم (الرئيسية، صفحات التصفّح، المشابهة) */
function rowHtml(x, i, up) {
  const [main, unit2, total] = priceTxt(x), [n, u] = sizeOf(x), sz = u ? n + " " + u : "";
  return `<a class="row rv" href="${up}listing/${x.code}.html" data-cat="${CAT_EN[x.cat]}" data-area="${esc(x.area)}" data-total="${total ? Math.round(total) : 0}">
  <span class="n">${String(i + 1).padStart(2, "0")}</span>
  <div><h3 class="t">${esc(x.title)}</h3><div class="m">${x.cat} · ${esc(x.area)}${sz ? " · " + sz : ""} · <span class="ltr">${x.code}</span></div></div>
  <div class="p">${main}${unit2 ? `<small>${unit2}</small>` : ""}</div>
  <div class="thumb"><div class="cover" data-cat="${CAT_EN[x.cat]}" data-size="${esc(sz)}" data-seed="${i + 11}"></div></div>
</a>`;
}
const newestFirst = (a, b) => b.code.localeCompare(a.code);

function listingPage(x, live) {
  const [n, u] = sizeOf(x), [main, unit2, total] = priceTxt(x);
  const title = `${x.cat} للبيع في ${x.area} - ${n} ${u} | ${NAME} مستشار عقاري`;
  const desc = `${x.title} في ${x.area}، مساحة ${n} ${u}. ${main}${unit2 ? " " + unit2 : ""}. كود ${x.code}. للاستفسار والمعاينة مع ${NAME}، مستشار عقاري في يعفور وقرى الشام: ${PHONE_LOCAL}.`;
  const canonical = `${BASE}/listing/${x.code}.html`;
  const offer = { "@type": "Offer", priceCurrency: "USD", availability: "https://schema.org/InStock" };
  if (total) offer.price = Math.round(total);
  const jsonld = {
    "@context": "https://schema.org", "@type": "RealEstateListing", name: x.title, url: canonical,
    description: desc, datePosted: dayOf(x.updatedAt) || today(),
    about: {
      "@type": "Place", name: `${x.cat} في ${x.area}`,
      address: { "@type": "PostalAddress", addressLocality: x.area, addressRegion: regionOf(x.area), addressCountry: "SY" }
    },
    offers: offer
  };
  jsonld.broker = { "@type": "RealEstateAgent", name: NAME, telephone: "+" + PHONE_INTL, areaServed: ["يعفور", "قرى الشام", "الصبورة", "ريف دمشق"], url: BASE + "/" };
  const areaPage = AREA_SLUG[x.area] + ".html";
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "العقارات", item: BASE + "/" },
      { "@type": "ListItem", position: 2, name: "عقارات " + x.area, item: BASE + "/" + areaPage },
      { "@type": "ListItem", position: 3, name: x.title, item: canonical }]
  };
  const extra = `<script type="application/ld+json">${JSON.stringify(crumbs)}<\/script>`;
  const rel = live.filter(y => y.cat === x.cat && y.code !== x.code).sort(newestFirst).slice(0, 3);
  const specs = [["النوع", x.cat], ["المنطقة", x.area + " · " + regionOf(x.area)], ["المساحة", n + " " + u]];
  if (x.bua) specs.push(["مساحة البناء", x.bua + " م²"]);
  if (x.papers) specs.push(["نوع الأوراق", esc(x.papers)]);
  specs.push(["كود العقار", `<span class="ltr">${x.code}</span>`]);
  const body = `${NAV("../")}
<main class="lpage">
  <div class="wrap">
    <nav class="crumbs"><a href="../index.html">العقارات</a> <span>›</span> <a href="../${areaPage}">عقارات ${esc(x.area)}</a> <span>›</span> <span>${esc(x.title)}</span></nav>
    <div class="ltop"><span class="lbadge">للبيع · ${x.cat}</span><span class="lcode">${x.code}</span></div>
    <h1 class="ltitle">${esc(x.title)}<small>${esc(x.area)} · ${esc(regionOf(x.area))}</small></h1>
  </div>
  <div class="stage">
    <canvas id="tile3d" aria-hidden="true"></canvas>
    ${u ? `<div class="stage-size">${n}<small>${u}</small></div>` : ""}
    <div class="stage-hint">اسحب لتدوير العقار</div>
  </div>
  <div class="wrap">
    <div class="lprice"><b>${main}</b>${unit2 ? `<span class="u">${unit2}</span>` : ""}${x.nego ? '<span class="nego">قابل للتفاوض</span>' : ""}</div>
    <div class="specs">${specs.map(([k, v]) => `<div class="spec"><small>${k}</small><b>${v}</b></div>`).join("")}</div>
    ${(x.feats || []).length ? `<ul class="feats">${x.feats.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    ${x.note ? `<p class="lnote">ملاحظة: ${esc(x.note)}</p>` : ""}
    <p class="llead">للمعاينة أو لطلب صور وأوراق هذا العقار، تواصل مع ${NAME}، ${ROLE} في يعفور وقرى الشام، واذكر الكود ${x.code}.</p>
    <div class="actions">
      <a class="btn btn-primary" target="_blank" rel="noopener" href="${wa(`مرحباً أستاذ محمد، أستفسر عن العقار ${x.code} (${x.title} - ${x.area}).`)}">${WA_SVG}استفسر على واتساب</a>
      <a class="btn btn-ghost" href="tel:+${PHONE_INTL}" dir="ltr">${PHONE_LOCAL}</a>
      ${shareHtml(x)}
    </div>
    ${rel.length ? `<section class="related"><h2>عقارات مشابهة</h2><div class="index" style="padding:0">${rel.map((y, i) => rowHtml(y, i, "../")).join("")}</div></section>` : ""}
  </div>
</main>
<script type="application/json" id="mk-item">${jsonInline(publicData([x])[0])}<\/script>
${FOOT()}`;
  return headHtml(title, desc, canonical, jsonld, extra, ogImage(x), "pg-listing") + body;
}
/* ===== المناطق =====
   الأساسية (تخصصك): هي وحدها تُذكر في نصوص الموقع. أي منطقة أخرى تُنشأ من نموذج العقار نفسه
   (الاسم + رابط إنكليزي + المحافظة)، وتحصل على صفحتها وفلترها وبطاقة مشاركتها تلقائياً. */
const CORE_AREAS = ["يعفور", "قرى الشام", "الصبورة"];
const KNOWN_SLUGS = { "يعفور": "yaafour", "قرى الشام": "qura-alsham", "الصبورة": "sabboura", "صحنايا": "sahnaya" };
const DEFAULT_REGION = "ريف دمشق";
const RESERVED_SLUGS = new Set(["index", "404", "admin", "sitemap", "listing", "assets", "img", "og", "p", "tests", "data", "google", "v3", "favicon"]);
let AREA_ORDER = CORE_AREAS.slice(), AREA_SLUG = Object.assign({}, KNOWN_SLUGS), AREA_REGION = {};
const regionOf = a => AREA_REGION[a] || DEFAULT_REGION;
const normArea = t => String(t || "").replace(/[\u064B-\u0652\u0640]/g, "").replace(/\s+/g, " ").trim();
/** اقتراح رابط إنكليزي من الاسم العربي (تقريبي: الحروف المتحركة غير مكتوبة، فيُعدَّل يدوياً) */
function translit(name) {
  const m = { "ا": "a", "أ": "a", "إ": "a", "آ": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh", "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q", "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "ة": "a", "و": "w", "ي": "y", "ى": "a", "ئ": "y", "ؤ": "w", "ء": "" };
  return normArea(name).replace(/^ال(?=\S)/, "").split("").map(c => c === " " ? "-" : (m[c] !== undefined ? m[c] : (/[a-z0-9]/i.test(c) ? c.toLowerCase() : ""))).join("").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
const pageNamesOf = slug => [slug + ".html"].concat(CAT_KEYS.map(c => `${CAT_SLUG[c]}-${slug}.html`));
/** null إن كان الرابط صالحاً، وإلا سبب الرفض (بالنسبة لمنطقة forArea التي قد تكون جديدة) */
function slugProblem(slug, forArea) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug) || /--|-$/.test(slug)) return "الرابط: حروف إنكليزية صغيرة وأرقام وشرطة فقط، يبدأ بحرف (مثال: sahnaya).";
  if (RESERVED_SLUGS.has(slug)) return "هذا الاسم محجوز للموقع، اختر غيره.";
  const mine = new Set(pageNamesOf(slug));
  for (const a of AREA_ORDER) {
    if (a === forArea) continue;
    if (pageNamesOf(AREA_SLUG[a]).some(n => mine.has(n))) return "هذا الرابط مستعمل أو يتعارض مع منطقة «" + a + "». اختر غيره.";
  }
  return null;
}
function uniqueSlug(base, forArea) {
  let s = base || "area", i = 2;
  while (slugProblem(s, forArea)) { s = (base || "area") + "-" + i++; if (i > 50) break; }
  return s;
}
/** يبني قائمة المناطق من العقارات: الأساسية أولاً، ثم أي منطقة وُجد فيها عقار (حتى المباع أو الموقوف) */
function syncAreas(rows) {
  AREA_SLUG = Object.assign({}, KNOWN_SLUGS); AREA_REGION = {};
  AREA_ORDER = CORE_AREAS.slice();
  const extra = [];
  for (const r of rows) {
    const a = normArea(r.area);
    if (!a) continue;
    if (!CORE_AREAS.includes(a) && !extra.includes(a)) extra.push(a);
    if (!KNOWN_SLUGS[a] && !AREA_SLUG[a] && r.area_slug && !slugProblem(r.area_slug, a)) AREA_SLUG[a] = r.area_slug;
    if (r.area_region && !AREA_REGION[a]) AREA_REGION[a] = r.area_region;
  }
  extra.sort((x, y) => x.localeCompare(y, "ar"));
  AREA_ORDER = CORE_AREAS.concat(extra);
  for (const a of extra) if (!AREA_SLUG[a]) AREA_SLUG[a] = uniqueSlug(translit(a), a);   /* عقار قديم بلا رابط محفوظ */
}
const AREAS = ["يعفور", "قرى الشام", "الصبورة", "ريف دمشق"];
const WHY = [
  ["pin", "خبرة في المنطقة", "أعمل في يعفور وقرى الشام والصبورة بريف دمشق، وأعرف عقاراتها وأسعارها عن قرب."],
  ["globe", "مرافقة المغتربين", "أساعد المشترين الذين لا يستطيعون الحضور: صور العقار وأوراقه ومتابعة عن بُعد."],
  ["doc", "تدقيق الأوراق", "التحقق من أوراق العقار ومتابعة الإجراءات حتى التسجيل."],
  ["tools", "تقدير كلفة البناء", "أتابع أعمال البناء والإكساء، فأقدّر لك الكلفة قبل الشراء."]
];
const ICONS = {
  area: '<path d="M3 3h18v18H3V3Zm2 2v14h14V5H5Zm2 2h4v2H9v2H7V7Zm10 10h-4v-2h2v-2h2v4Z"/>',
  type: '<path d="M12 3 2 10h3v10h5v-6h4v6h5V10h3L12 3Z"/>',
  build: '<path d="M4 21V9l8-6 8 6v12h-6v-6h-4v6H4Z"/>',
  pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/>',
  globe: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.4 0 2.9 2.6 3.3 6H8.7C9.1 6.6 10.6 4 12 4ZM4.3 11h3.4c-.1 1.3-.1 2.7 0 4H4.3a8 8 0 0 1 0-4Zm0 6h3.7c.4 1.9 1 3.4 1.7 4.4A8 8 0 0 1 4.3 17ZM12 20c-1.4 0-2.9-2.6-3.3-6h6.6c-.4 3.4-1.9 6-3.3 6Zm3.7-8H8.3c-.1-1.3-.1-2.7 0-4h7.4c.1 1.3.1 2.7 0 4Zm.6 9.4c.7-1 1.3-2.5 1.7-4.4h3.7a8 8 0 0 1-5.4 4.4ZM16.3 15c.1-1.3.1-2.7 0-4h3.4a8 8 0 0 1 0 4h-3.4Z"/>',
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm-3 16-3.5-3.5 1.4-1.4L11 15.2l4.1-4.1 1.4 1.4L11 18Z"/>',
  tools: '<path d="M21 3 15 9l-1.5-1.5-2 2 6 6 2-2L18 12l6-6-3-3Zm-9.5 8.5-8 8L5 21l8-8-1.5-1.5Z"/><path d="M4 4h5v2H6v3H4V4Z"/>'
};
function whyHtml() {
  return `<div class="why">` + WHY.map(([key, h, t]) =>
    `<div class="why-card rv">` +
    `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICONS[key]}</svg></span>` +
    `<h3>${h}</h3><p>${t}</p></div>`).join("") + `</div>`;
}
function specRow(x) {
  const [n, u] = sizeOf(x);
  const items = [["area", u ? n + " " + u : String(n)], ["type", x.cat]];
  if (x.papers) items.push(["doc", x.papers]);
  else if (x.bua) items.push(["build", x.bua + " م² بناء"]);
  return items.map(([k, v]) => `<span>${esc(v)}</span>`).join("");
}
/* الفلاتر (السكربت نفسه في assets/mk.js) */
function searchHtml(live) {
  const optsArea = AREA_ORDER.filter(a => live.some(x => x.area === a))
    .map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  const optsCat = CAT_KEYS.filter(k => live.some(x => CAT_EN[x.cat] === k))
    .map(k => `<option value="${k}">${CAT_AR[k]}</option>`).join("");
  const budgets = [["", "كل الميزانيات"], ["0-500000", "حتى 500 ألف $"],
    ["500000-1000000", "500 ألف — مليون $"], ["1000000-3000000", "1 — 3 مليون $"],
    ["3000000-", "أكثر من 3 مليون $"]];
  const optsB = budgets.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  return `<div class="filters" role="search">
    <div class="sel"><select id="fArea" aria-label="المنطقة"><option value="">كل المناطق</option>${optsArea}</select></div>
    <div class="sel"><select id="fCat" aria-label="نوع العقار"><option value="">كل الأنواع</option>${optsCat}</select></div>
    <div class="sel"><select id="fBudget" aria-label="الميزانية">${optsB}</select></div>
  </div>`;
}
function shareHtml(x) {
  const [n, u] = sizeOf(x), [main, unit2] = priceTxt(x);
  const txt = `${x.title} في ${x.area}\n${n} ${u} · ${main}${unit2 ? " " + unit2 : ""}\nكود ${x.code}`;
  return `<button class="btn btn-ghost" type="button" id="shareBtn" `
    + `data-txt="${esc(txt)}">شارك العقار</button>`;
}
/* نموذج «دوّرلي على عقار» */
function requestHtml(live) {
  const cats = CATS.map(v => `<option value="${v}">${v}</option>`).join("");
  const areas = AREA_ORDER.filter(a => CORE_AREAS.includes(a) || (live || []).some(x => x.area === a)).map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  const sizes = ["حتى دنم", "1 — 5 دنم", "5 — 10 دنم", "أكثر من 10 دنم"];
  const optsSize = sizes.map(v => `<option value="${v}">${v}</option>`).join("");
  const budgets = ["حتى 500 ألف $", "500 ألف — مليون $", "1 — 3 مليون $", "أكثر من 3 مليون $"];
  const optsB = budgets.map(v => `<option value="${v}">${v}</option>`).join("");
  return `<section class="req rv" id="request">
    <p class="kicker">ما لقيت طلبك؟</p>
    <h2 class="h2">دوّرلي على عقار</h2>
    <p class="lead">حدّد اللي بتدوّر عليه وابعتلي — وإذا إجاني عقار يناسبك بخبّرك أول واحد.</p>
    <div class="fields">
      <div><label for="reqCat">النوع</label><select id="reqCat"><option value="">أي نوع</option>${cats}</select></div>
      <div><label for="reqArea">المنطقة</label><select id="reqArea"><option value="">أي منطقة</option>${areas}</select></div>
      <div><label for="reqSize">المساحة</label><select id="reqSize"><option value="">أي مساحة</option>${optsSize}</select></div>
      <div><label for="reqBudget">الميزانية</label><select id="reqBudget"><option value="">أي ميزانية</option>${optsB}</select></div>
      <div class="wide"><label for="reqNote">ملاحظة (اختياري)</label><input type="text" id="reqNote" placeholder="مثلاً: قريبة من الأوتوستراد، أو فيها بئر ماء"></div>
    </div>
    <button class="btn btn-primary" type="button" id="reqGo">${WA_SVG}ابعت الطلب على واتساب</button>
  </section>`;
}

/* ===== صفحات التصفّح ===== */
const CAT_SLUG = { land: "land", villa: "villas", farm: "farms", apt: "apartments", invest: "investment" };
const CAT_PL = { land: "أراضٍ", villa: "فلل", farm: "مزارع", apt: "شقق", invest: "عقارات استثمارية" };
const MIN_CAT = 2;

function nProp(n) {
  if (n === 1) return "عقار واحد";
  if (n === 2) return "عقاران";
  if (n >= 3 && n <= 10) return n + " عقارات";
  return n + " عقاراً";
}
function collectionsAll(live) {
  const out = [];
  for (const a of AREA_ORDER) {
    const items = live.filter(x => x.area === a);
    if (!items.length) continue;
    out.push({
      slug: AREA_SLUG[a] + ".html", h1: "عقارات " + a,
      title: `عقارات ${a} — أراضٍ وفلل ومزارع للبيع | ${NAME} مستشار عقاري`,
      crumb: "عقارات " + a, area: a, items
    });
    for (const c of CAT_KEYS) {
      const sub = items.filter(x => CAT_EN[x.cat] === c);
      if (sub.length < MIN_CAT) continue;
      out.push({
        slug: `${CAT_SLUG[c]}-${AREA_SLUG[a]}.html`, h1: `${CAT_PL[c]} للبيع في ${a}`,
        title: `${CAT_PL[c]} للبيع في ${a} — ${nProp(sub.length)} | ${NAME} مستشار عقاري`,
        crumb: `${CAT_PL[c]} في ${a}`, area: a, items: sub
      });
    }
  }
  return out;
}
function collectionLinks(cols, current) {
  const ls = cols.filter(c => c.slug !== current)
    .map(c => `<a href="${c.slug}">${esc(c.crumb)}</a>`).join("");
  return `<nav class="browse"><h2>تصفّح حسب المنطقة والنوع</h2><div class="browse-links">${ls}</div></nav>`;
}
function collectionPage(c, cols) {
  const items = c.items;
  /* السعر المخفي («عند التواصل») ما بيدخل في أي نطاق أسعار علني */
  const totals = items.filter(x => x.confirmed !== false).map(totalOf).filter(t => t > 0).sort((a, b) => a - b);
  let rng = "";
  if (totals.length) {
    rng = totals[0] !== totals[totals.length - 1]
      ? ` الأسعار من ${money(totals[0])} إلى ${money(totals[totals.length - 1])}.`
      : ` السعر ${money(totals[0])}.`;
  }
  const desc = `${c.h1}: ${nProp(items.length)} متاحة الآن مع ${NAME}، ${ROLE} في يعفور وقرى الشام.`
    + `${rng} معاينة على الأرض ومرافقة من المعاينة حتى التسجيل. واتساب ${PHONE_LOCAL}.`;
  const canonical = `${BASE}/${c.slug}`;
  const jsonld = {
    "@context": "https://schema.org", "@type": "CollectionPage", name: c.h1,
    url: canonical, description: desc,
    about: {
      "@type": "Place", name: c.area,
      address: { "@type": "PostalAddress", addressLocality: c.area, addressRegion: regionOf(c.area), addressCountry: "SY" }
    },
    mainEntity: {
      "@type": "ItemList", numberOfItems: items.length,
      itemListElement: items.map((x, i) => ({
        "@type": "ListItem", position: i + 1, url: `${BASE}/listing/${x.code}.html`, name: x.title
      }))
    },
    provider: { "@type": "RealEstateAgent", name: NAME, telephone: "+" + PHONE_INTL, url: BASE + "/" }
  };
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "العقارات", item: BASE + "/" },
      { "@type": "ListItem", position: 2, name: c.crumb, item: canonical }]
  };
  const extra = `<script type="application/ld+json">${JSON.stringify(crumbs)}<\/script>`;
  const sorted = items.slice().sort(newestFirst);
  const body = `${NAV("")}
<main class="lpage">
  <div class="wrap">
    <nav class="crumbs"><a href="index.html">العقارات</a> <span>›</span> <span>${esc(c.crumb)}</span></nav>
    <div class="chead">
      <div class="eyebrow"><i></i>${esc(c.area)} · ${esc(regionOf(c.area))}</div>
      <h1>${esc(c.h1)}</h1>
      <p class="ccount">${nProp(items.length)}</p>
    </div>
    <p class="lead">${esc(desc)}</p>
  </div>
  <div class="index two" style="margin-top:14px">${sorted.map((x, i) => rowHtml(x, i, "")).join("")}</div>
  <div class="wrap">
    ${collectionLinks(cols, c.slug)}
    <div class="actions">
      <a class="btn btn-primary" target="_blank" rel="noopener" href="${wa(`مرحباً أستاذ محمد، بدوّر على ${c.h1}.`)}">${WA_SVG}استفسر على واتساب</a>
      <a class="btn btn-ghost" href="index.html">كل العقارات</a>
    </div>
  </div>
</main>
<script type="application/json" id="mk-data">${jsonInline(publicData(items))}<\/script>
${FOOT()}`;
  return headHtml(c.title, desc, canonical, jsonld, extra, null, "pg-collection") + body;
}

function indexPage(live) {
  const title = "عقارات يعفور وقرى الشام والصبورة | أراضٍ وفلل ومزارع للبيع - محمد خالد";
  const desc = `أراضٍ وفلل ومزارع وشقق للبيع في يعفور وقرى الشام والصبورة بريف دمشق. ${live.length} عقاراً متاحاً مع ${NAME}، ${ROLE} — مرافقة من المعاينة حتى التسجيل. واتساب ${PHONE_LOCAL}.`;
  const jsonld = {
    "@context": "https://schema.org", "@type": "RealEstateAgent", name: NAME, jobTitle: ROLE,
    url: BASE + "/", telephone: "+" + PHONE_INTL, image: ogImage(null), description: desc,
    areaServed: AREAS.map(a => ({ "@type": "Place", name: a })),
    address: { "@type": "PostalAddress", addressLocality: "يعفور", addressRegion: "ريف دمشق", addressCountry: "SY" },
    knowsLanguage: ["ar"],
    makesOffer: ["بيع وشراء الأراضي", "بيع الفلل والمزارع", "الاستشارات العقارية", "متابعة الأوراق والتسجيل العقاري", "الإشراف على البناء والإكساء"]
      .map(s => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s } }))
  };
  const list = live.slice().sort(newestFirst);
  const maxDunam = Math.round(Math.max(0, ...live.map(x => (+x.area_m2 || 0) / 1000)));
  const nAreas = new Set(live.map(x => x.area)).size;
  const stats = [[live.length, "عقاراً متاحاً"], ...(maxDunam ? [[maxDunam, "دنم أكبر أرض"]] : []), [nAreas, nAreas === 1 ? "منطقة" : "مناطق"]];
  const body = `${NAV("")}
<section class="hero" id="hero">
  <canvas id="hero3d" aria-hidden="true"></canvas>
  <div class="hcopy" id="hcopy">
    <div class="eyebrow"><i></i>عقارات مختارة · ريف دمشق</div>
    <h1 id="htitle"><span class="giant"><span class="w" style="animation-delay:.1s">يعفور</span></span><span class="giant2"><span class="w gtext" style="animation-delay:.25s">وقرى الشام</span></span></h1>
    <p class="sr">${esc(desc)}</p>
  </div>
  <div class="touchhint" id="thint"><i></i>اسحب للتنقل بين العقارات · المس قطعة لاختيارها</div>
  <div class="pcard" id="pcard" hidden aria-live="polite">
    <div class="pc-top"><span class="pc-type" id="pcType"></span><span class="pc-code" id="pcCode"></span><span class="pc-dots" id="pcDots"></span></div>
    <div class="pc-title" id="pcTitle"></div>
    <div class="pc-row"><b id="pcPrice"></b><small id="pcMeta"></small></div>
    <div class="pc-actions">
      <button class="pc-nav" id="pcPrev" type="button" aria-label="السابق">${CHEV_R}</button>
      <a class="pc-wa" id="pcWa" href="#" target="_blank" rel="noopener">استفسر على واتساب</a>
      <a class="pc-more" id="pcMore" href="#">التفاصيل</a>
      <button class="pc-nav" id="pcNext" type="button" aria-label="التالي">${CHEV_L}</button>
    </div>
  </div>
  <div class="hbottom"><p>أراضٍ وفلل ومزارع — معاينة، تدقيق أوراق، ومرافقة حتى التسجيل.</p><a class="round" target="_blank" rel="noopener" href="${wa("مرحباً أستاذ محمد، أرغب بالاستفسار عن العقارات المتوفرة لديك.")}">تواصل<br>الآن</a></div>
</section>
<div class="marquee" aria-hidden="true"><div class="mrow" id="m1"></div><div class="mrow" id="m2"></div></div>
<section class="sec"><div class="wrap">
  <p class="kicker rv">بالأرقام <b>01</b></p>
  <h2 class="h2 rv">أرضك <span class="gtext">موجودة هنا</span></h2>
  <div class="stats">${stats.map(([v, l]) => `<div class="stat rv"><b data-count="${v}">${v}</b><small>${l}</small></div>`).join("")}</div>
</div></section>
<section class="sec" id="listings">
  <div class="wrap"><p class="kicker rv">كل العقارات <b>02</b></p><h2 class="h2 rv">أراضٍ وفلل ومزارع<br><span class="gtext">للبيع في يعفور وقرى الشام</span></h2></div>
  ${searchHtml(live)}
  <p class="rcount" id="rcount">${live.length} عقار متاح</p>
  <div class="index" id="listings-grid">${list.map((x, i) => rowHtml(x, i, "")).join("")}</div>
  <p class="rnone" id="rnone" hidden>ما في عقار مطابق لهالبحث. جرّب توسّع الميزانية، أو <a href="#request">ابعتلي طلبك</a> وبدوّرلك.</p>
  <div class="wrap">${collectionLinks(collectionsAll(live))}</div>
</section>
<div class="wrap">
  ${requestHtml(live)}
  ${whyHtml()}
  <section id="about" class="about">
    <h2 class="h2 rv">من أنا</h2>
    <p class="rv">أنا ${NAME}، ${ROLE} أعمل في يعفور وقرى الشام والصبورة بريف دمشق. أساعد المشترين، ومنهم المغتربون الذين لا يستطيعون الحضور، على اختيار الأرض أو الفيلا المناسبة، والتحقق من الأوراق، ومتابعة الإجراءات حتى التسجيل. وإلى جانب الوساطة العقارية أتابع أعمال البناء والإكساء، فأستطيع تقدير كلفة البناء أو الإكساء قبل الشراء.</p>
    <h2 class="h2 rv" style="margin-top:40px">أسئلة متكررة</h2>
    <dl class="faq">
      <dt>في أي مناطق تعمل؟</dt><dd>يعفور وقرى الشام والصبورة وما حولها في ريف دمشق.</dd>
      <dt>هل عندك عقارات في الصبورة؟</dt><dd>الصبورة من مناطق عملي. المعروض على الموقع اليوم في يعفور وقرى الشام الملاصقتين لها — تواصل معي وبشوفلك المتوفر بالصبورة.</dd>
      <dt>شو المتوفر عندك؟</dt><dd>أراضٍ زراعية وسكنية ومرخّصة، وفلل ومزارع وشقق، بمساحات من دنم حتى 100 دنم.</dd>
      <dt>هل أستطيع الشراء وأنا خارج سوريا؟</dt><dd>نعم. أرسل لك صور العقار وأوراقه، وأرافق الإجراءات حتى التسجيل حسب ما يسمح به القانون ووكالتك.</dd>
      <dt>كيف أستفسر عن عقار؟</dt><dd>افتح صفحة العقار وأرسل رسالة واتساب فيها كود العقار، مثل MK-012.</dd>
    </dl>
  </section>
</div>
<section class="reveal" id="reveal"><div class="reveal-in"><div class="circle" id="circle">
  <div class="h2">قلّي شو بدك،<br>وأنا بدوّرلك</div>
  <p>أرسل طلبك وأرشّح لك العقارات المناسبة خلال يوم.</p>
  <a target="_blank" rel="noopener" href="${wa("مرحباً أستاذ محمد، أرغب بالاستفسار عن العقارات المتوفرة لديك.")}">أرسل طلبك على واتساب</a>
</div></div></section>
<script type="application/json" id="mk-data">${jsonInline(publicData(live))}<\/script>
${FOOT()}`;
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
      { "@type": "Question", name: "في أي مناطق يعمل محمد خالد؟", acceptedAnswer: { "@type": "Answer", text: "يعفور وقرى الشام والصبورة وما حولها في ريف دمشق." } },
      { "@type": "Question", name: "هل توجد عقارات في الصبورة؟", acceptedAnswer: { "@type": "Answer", text: "الصبورة من مناطق العمل. المعروض حالياً في يعفور وقرى الشام الملاصقتين لها في ريف دمشق." } },
      { "@type": "Question", name: "ما العقارات المتوفرة في يعفور وقرى الشام؟", acceptedAnswer: { "@type": "Answer", text: "أراضٍ زراعية وسكنية ومرخّصة، وفلل ومزارع وشقق، بمساحات من دنم حتى 100 دنم." } },
      { "@type": "Question", name: "هل يمكن الشراء من خارج سوريا؟", acceptedAnswer: { "@type": "Answer", text: "نعم، مع إرسال صور العقار وأوراقه ومرافقة الإجراءات حتى التسجيل حسب القانون والوكالة." } }]
  };
  return headHtml(title, desc, BASE + "/", jsonld,
    `<script type="application/ld+json">${JSON.stringify(faq)}<\/script>`, null, "pg-index") + body;
}
function sitemapXml(live) {
  const days = live.map(x => dayOf(x.updatedAt)).filter(Boolean).sort();
  const last = days[days.length - 1] || today();
  const urls = [[BASE + "/", "1.0", last]]
    .concat(collectionsAll(live).map(c => [`${BASE}/${c.slug}`, "0.9", last]))
    .concat(live.map(x => [`${BASE}/listing/${x.code}.html`, "0.8", dayOf(x.updatedAt) || last]));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(([u, p, d]) => `  <url><loc>${u}</loc><lastmod>${d}</lastmod><priority>${p}</priority></url>\n`).join("")
    + "</urlset>\n";
}
/* البيانات العامة — نفس حقول public.json */
function publicData(live) {
  return live.map(x => {
    const conf = x.confirmed !== false;
    return {
      code: x.code, cat: CAT_EN[x.cat], title: x.title, area: x.area,
      area_m2: x.area_m2 || null, bua: x.bua || null,
      price: conf ? x.price : null, mode: conf ? (x.mode === "للدنم" ? "dunam" : "total") : "ask",
      nego: conf ? !!x.nego : false, feats: x.feats || [], note: x.note || "",
      total: conf ? totalOf(x) : null, unconfirmed: !conf,
      papers: x.papers || "", photos: [], featured: !!x.featured
    };
  });
}

/* ===================== بطاقة المنشور 1080×1080 =====================
   منقولة عن مولّد الكتالوج القديم بنفس التصميم المعتمد. */
function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function glowBlob(ctx, cx, cy, r, color, alpha) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r); ctx.restore();
}
function glassPanel(ctx, x, y, w, h, r, strength) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 44; ctx.shadowOffsetY = 16;
  ctx.fillStyle = `rgba(4,30,22,${.35 + strength * .4})`; rrect(ctx, x, y, w, h, r); ctx.fill();
  ctx.restore();
  ctx.fillStyle = `rgba(230,184,76,${strength * .55})`; rrect(ctx, x, y, w, h, r); ctx.fill();
  const sheen = ctx.createLinearGradient(x, y, x, y + h);
  sheen.addColorStop(0, "rgba(247,211,122,.16)"); sheen.addColorStop(.4, "rgba(247,211,122,0)");
  ctx.fillStyle = sheen; rrect(ctx, x, y, w, h, r); ctx.fill();
  ctx.strokeStyle = "rgba(247,211,122,.42)"; ctx.lineWidth = 2.5; rrect(ctx, x, y, w, h, r); ctx.stroke();
}
function metalGrad(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  [[0, "#e6b84c"], [.5, "#f7d37a"], [1, "#e6b84c"]]
    .forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}
function wrapText(ctx, text, maxW) {
  const words = String(text).split(" "), lines = []; let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}
function fitLine(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  const parts = text.split(" · ");
  while (parts.length > 1 && ctx.measureText(parts.join(" · ")).width > maxW) parts.pop();
  return parts.join(" · ");
}

let avatarImg = null;
function loadAvatar() {
  if (avatarImg) return Promise.resolve(avatarImg);
  return new Promise(res => {
    const im = new Image();
    im.onload = () => { avatarImg = im; res(im); };
    im.onerror = () => res(null);
    im.src = "img/mohammad-khaled.jpg";
  });
}

function postCaption(x) {
  const [n, u] = sizeOf(x), [main, unit2, total] = priceTxt(x);
  const tags = { land: "#أراضي_للبيع", villa: "#فلل_للبيع", farm: "#مزارع_للبيع", apt: "#شقق_للبيع", invest: "#عقارات_استثمارية" };
  const ask = x.confirmed === false;
  const priceLine = ask ? "السعر عند التواصل" : (unit2 === "للدنم" ? `${main} للدنم` : main);
  const lines = [
    `للبيع | ${n} ${u} في ${x.area}: ${x.title} | ${priceLine}`,
    ``,
    `• المساحة: ${n} ${u}${x.bua && x.area_m2 ? `، ومساحة البناء ${x.bua} م²` : ""}`,
    `• السعر: ${ask ? "عند التواصل" : `${main} ${unit2}`}${x.nego ? " (قابل للتفاوض)" : ""}`
  ];
  if (!ask && unit2 === "للدنم" && total) lines.push(`• الإجمالي التقريبي ${money(total)}`);
  if (x.papers) lines.push(`• الأوراق: ${x.papers}`);
  (x.feats || []).forEach(f => lines.push(`• ${f}`));
  if (x.note) lines.push(`\nملاحظة: ${x.note}`);
  lines.push(``, `الأوراق تُعرض كاملة قبل أي عربون.`, `كود العقار: ${x.code}`,
    `للاستفسار والمعاينة واتساب: ${PHONE_LOCAL}`, `${NAME} | ${ROLE}`, ``,
    `#${x.area.replace(/\s+/g, "_")} ${tags[CAT_EN[x.cat]]} #عقارات_سوريا #عقارات_ريف_دمشق`);
  return lines.join("\n");
}

async function drawPostCard(x) {
  try {
    await Promise.all(['400 84px \"Lalezar\"', '800 40px \"Cairo\"', '700 34px \"Cairo\"', '500 32px \"Cairo\"']
      .map(f => document.fonts.load(f)));
  } catch (e) { }
  const av = await loadAvatar();
  const c = $("cardCv"), ctx = c.getContext("2d"), W = 1080, H = 1080;
  const INK = "#f3ecd9", INK2 = "#d2cab2", GOLD = "#e6b84c", GOLD_L = "#f7d37a", BLACK = "#06231b";
  const [n, u] = sizeOf(x), [main, unit2] = priceTxt(x);
  const ask = x.confirmed === false;

  ctx.fillStyle = BLACK; ctx.fillRect(0, 0, W, H);
  glowBlob(ctx, 930, 120, 560, "#14775a", .75);
  glowBlob(ctx, 120, 980, 560, "#0f5a44", .8);
  glowBlob(ctx, 420, 520, 300, "#f7d37a", .1);

  ctx.direction = "rtl"; ctx.textAlign = "center";
  ctx.font = '800 32px \"Cairo\"';
  const pillTxt = `للبيع · ${x.cat}`, pillW = ctx.measureText(pillTxt).width + 64;
  glassPanel(ctx, W - 48 - pillW, 44, pillW, 68, 34, .42);
  ctx.fillStyle = GOLD_L; ctx.fillText(pillTxt, W - 48 - pillW / 2, 89);
  ctx.direction = "ltr"; ctx.font = '800 26px \"Cairo\"';
  const codeW = ctx.measureText(x.code).width + 56;
  glassPanel(ctx, 48, 44, codeW, 68, 34, .42);
  ctx.fillStyle = INK; ctx.fillText(x.code, 48 + codeW / 2, 87);

  const mx = 48, my = 138, mw = W - 96, mh = 690;
  glassPanel(ctx, mx, my, mw, mh, 56, .26);
  ctx.direction = "rtl"; ctx.textAlign = "center";
  ctx.fillStyle = GOLD; ctx.font = '800 34px \"Cairo\"'; ctx.fillText(x.area, W / 2, my + 70);

  ctx.fillStyle = metalGrad(ctx, 140, my + 90, 940, my + 260); ctx.font = '400 84px \"Lalezar\"';
  let tl = wrapText(ctx, x.title, 860), lh = 92;
  if (tl.length > 1) { ctx.font = '400 68px \"Lalezar\"'; tl = wrapText(ctx, x.title, 900); lh = 80; }
  tl = tl.slice(0, 2);
  const ty = my + 162;
  tl.forEach((l, i) => ctx.fillText(l, W / 2, ty + i * lh));
  const yEnd = ty + (tl.length - 1) * lh;

  /* اللوح الداخلي: صورة العقار إن وُجدت، وإلا رقم المساحة */
  const px = mx + 64, pw = mw - 128, py = yEnd + 50, pH = tl.length > 1 ? 200 : 250;
  const ph = (x.photos || [])[0];
  let drew = false;
  if (ph) {
    const phUrl = await loadPhoto(ph);
    const im = phUrl && await new Promise(res => {
      const i = new Image(); i.crossOrigin = "anonymous";
      i.onload = () => res(i); i.onerror = () => res(null);
      i.src = phUrl;
    });
    if (im) {
      ctx.save(); rrect(ctx, px, py, pw, pH, 36); ctx.clip();
      const s = Math.max(pw / im.width, pH / im.height);
      ctx.drawImage(im, px + (pw - im.width * s) / 2, py + (pH - im.height * s) / 2, im.width * s, im.height * s);
      ctx.restore();
      ctx.strokeStyle = "rgba(247,211,122,.42)"; ctx.lineWidth = 2.5;
      rrect(ctx, px, py, pw, pH, 36); ctx.stroke();
      drew = true;
    }
  }
  if (!drew) {
    glassPanel(ctx, px, py, pw, pH, 36, .34);
    ctx.fillStyle = INK; ctx.font = `400 ${tl.length > 1 ? 100 : 120}px "Lalezar"`;
    ctx.fillText(String(n), W / 2, py + pH * 0.57);
    ctx.fillStyle = INK2; ctx.font = '800 34px \"Cairo\"'; ctx.fillText(u, W / 2, py + pH - 22);
  }

  const yp = py + pH + 90;
  if (ask) { ctx.fillStyle = INK; ctx.font = '800 54px \"Cairo\"'; ctx.fillText("السعر عند التواصل", W / 2, yp); }
  else {
    ctx.fillStyle = GOLD_L; ctx.font = '400 76px \"Lalezar\"';
    const label = unit2 === "للدنم" ? `${main} للدنم` : main;
    ctx.fillText(label + (x.nego ? " · قابل للتفاوض" : ""), W / 2, yp);
  }
  ctx.fillStyle = INK2; ctx.font = '500 31px \"Cairo\"';
  const extra = (x.photos || []).length && drew ? [String(n) + " " + u].concat(x.feats || []) : (x.feats || []);
  const fl = fitLine(ctx, extra.slice(0, 4).join(" · "), 840);
  if (fl) ctx.fillText(fl, W / 2, Math.min(yp + 56, my + mh - 26));

  const fx = 48, fy = 856, fw = W - 96, fh = 176;
  glassPanel(ctx, fx, fy, fw, fh, 88, .38);
  const R = fx + fw - 30, pcx = R - 58, pcy = fy + fh / 2;
  ctx.save(); ctx.beginPath(); ctx.arc(pcx, pcy, 58, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#fff"; ctx.fillRect(pcx - 58, pcy - 58, 116, 116);
  if (av) { try { ctx.drawImage(av, pcx - 58, pcy - 58, 116, 116); } catch (e) { } }
  ctx.restore();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(pcx, pcy, 60, 0, Math.PI * 2); ctx.stroke();
  ctx.textAlign = "right"; ctx.direction = "rtl";
  ctx.fillStyle = GOLD_L; ctx.font = '400 54px \"Lalezar\"'; ctx.fillText(NAME, R - 140, fy + 84);
  ctx.fillStyle = INK2; ctx.font = '500 28px \"Cairo\"'; ctx.fillText(ROLE, R - 140, fy + 128);
  ctx.direction = "ltr"; ctx.font = '800 44px \"Cairo\"';
  const tel = PHONE_LOCAL, telW = ctx.measureText(tel).width + 70;
  ctx.fillStyle = metalGrad(ctx, fx + 30, fy + 34, fx + 30 + telW, fy + 110);
  rrect(ctx, fx + 30, fy + 34, telW, 76, 38); ctx.fill();
  ctx.textAlign = "center"; ctx.fillStyle = "#1c1403"; ctx.fillText(tel, fx + 30 + telW / 2, fy + 88);
  ctx.direction = "rtl"; ctx.fillStyle = INK2; ctx.font = '500 24px \"Cairo\"';
  ctx.fillText("واتساب · اذكر الكود " + x.code, fx + 30 + telW / 2, fy + 146);

  return new Promise(res => c.toBlob(b => res(b), "image/png"));
}

/* بطاقة المعاينة عند مشاركة الرابط (1200×630): x = عقار، أو null لبطاقة الموقع العامة */
async function drawOgCard(x) {
  try {
    await Promise.all(['400 90px "Lalezar"', '800 40px "Cairo"', '600 30px "Cairo"']
      .map(f => document.fonts.load(f, "أبجد هوز 0123456789")));
  } catch (e) { }
  const av = await loadAvatar();
  const W = 1200, H = 630, R = W - 72;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  const INK = "#f3ecd9", INK2 = "#d2cab2", GOLD = "#e6b84c", GOLD_L = "#f7d37a";

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0b3a2d"); bg.addColorStop(1, "#03160f");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  glowBlob(ctx, 1040, 80, 560, "#14775a", .75);
  glowBlob(ctx, 90, 600, 520, "#0f5a44", .8);
  /* قطع أراضٍ عائمة كزخرفة خفيفة */
  [[170, 210, 120], [330, 120, 74], [110, 400, 84]].forEach(([cx, cy, r]) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * .5); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r * .5); ctx.lineTo(cx - r, cy); ctx.closePath();
    ctx.fillStyle = "rgba(230,184,76,.07)"; ctx.fill();
    ctx.strokeStyle = "rgba(247,211,122,.32)"; ctx.lineWidth = 2; ctx.stroke();
  });
  ctx.strokeStyle = "rgba(247,211,122,.28)"; ctx.lineWidth = 2; rrect(ctx, 22, 22, W - 44, H - 44, 34); ctx.stroke();

  ctx.direction = "rtl"; ctx.textAlign = "right";
  let ty;
  if (x) {
    const [n, u] = sizeOf(x), [main, unit2] = priceTxt(x);
    const ask = x.confirmed === false;
    /* شارة النوع + الكود */
    ctx.font = '800 34px "Cairo"';
    const pill = `للبيع · ${x.cat}`, pw = ctx.measureText(pill).width + 56;
    rrect(ctx, R - pw, 58, pw, 60, 30); ctx.fillStyle = "rgba(230,184,76,.16)"; ctx.fill();
    ctx.strokeStyle = "rgba(247,211,122,.45)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = GOLD_L; ctx.textAlign = "center"; ctx.fillText(pill, R - pw / 2, 100);
    ctx.textAlign = "left"; ctx.direction = "ltr"; ctx.font = '800 30px "Cairo"'; ctx.fillStyle = INK2;
    ctx.fillText(x.code, W - R, 98);
    ctx.direction = "rtl"; ctx.textAlign = "right";

    ctx.fillStyle = GOLD; ctx.font = '800 40px "Cairo"';
    ctx.fillText(`${x.area} · ${regionOf(x.area)}`, R, 178);

    ctx.fillStyle = INK; ctx.font = '400 92px "Lalezar"';
    let tl = wrapText(ctx, x.title, 1000), lh = 98, two = false;
    if (tl.length > 1) { ctx.font = '400 64px "Lalezar"'; tl = wrapText(ctx, x.title, 1000); lh = 70; two = true; }
    tl = tl.slice(0, 2);
    ty = two ? 246 : 272;
    tl.forEach((l, i) => ctx.fillText(l, R, ty + i * lh));
    ty += (tl.length - 1) * lh;

    ctx.fillStyle = INK2; ctx.font = '600 32px "Cairo"';
    const extra = [`${n} ${u}`].concat(x.feats || []).slice(0, 4).join("  ·  ");
    ctx.fillText(fitLine(ctx, extra, 1000), R, ty + (two ? 52 : 62));

    ctx.fillStyle = GOLD_L; ctx.font = `400 ${two ? 80 : 88}px "Lalezar"`;
    const label = ask ? "السعر عند التواصل" : (unit2 === "للدنم" ? `${main} للدنم` : main);
    const py = ty + (two ? 132 : 170);
    ctx.fillText(label, R, py);
    if (x.nego && !ask) {
      const lw = ctx.measureText(label).width;
      ctx.font = '600 30px "Cairo"'; ctx.fillStyle = INK2; ctx.fillText("قابل للتفاوض", R - lw - 26, py - 8);
    }
  } else {
    ctx.fillStyle = GOLD; ctx.font = '800 40px "Cairo"';
    ctx.fillText("أراضٍ · فلل · مزارع · شقق", R, 150);
    ctx.fillStyle = INK; ctx.font = '400 100px "Lalezar"';
    ctx.fillText("عقارات في يعفور", R, 270);
    ctx.fillText("وقرى الشام", R, 372);
    ctx.fillStyle = INK2; ctx.font = '600 34px "Cairo"';
    ctx.fillText("معاينة، تدقيق أوراق، ومرافقة حتى التسجيل", R, 440);
  }

  /* شريط المستشار */
  const fy = 506, fh = 92;
  rrect(ctx, 48, fy, W - 96, fh, 46); ctx.fillStyle = "rgba(3,22,15,.55)"; ctx.fill();
  ctx.strokeStyle = "rgba(247,211,122,.32)"; ctx.lineWidth = 2; ctx.stroke();
  const ax = W - 48 - 46, ay = fy + fh / 2;
  ctx.save(); ctx.beginPath(); ctx.arc(ax, ay, 36, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#fff"; ctx.fillRect(ax - 36, ay - 36, 72, 72);
  if (av) { try { ctx.drawImage(av, ax - 36, ay - 36, 72, 72); } catch (e) { } }
  ctx.restore();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ax, ay, 38, 0, Math.PI * 2); ctx.stroke();
  ctx.direction = "rtl"; ctx.textAlign = "right";
  ctx.fillStyle = GOLD_L; ctx.font = '400 40px "Lalezar"'; ctx.fillText(NAME, ax - 56, fy + 46);
  ctx.fillStyle = INK2; ctx.font = '600 24px "Cairo"'; ctx.fillText(ROLE, ax - 56, fy + 76);
  ctx.direction = "ltr"; ctx.textAlign = "center"; ctx.font = '800 36px "Cairo"';
  const tw = ctx.measureText(PHONE_LOCAL).width + 56;
  rrect(ctx, 70, fy + 14, tw, 64, 32); ctx.fillStyle = GOLD; ctx.fill();
  ctx.fillStyle = "#1c1403"; ctx.fillText(PHONE_LOCAL, 70 + tw / 2, fy + 58);

  const blob = await new Promise(res => c.toBlob(res, "image/jpeg", 0.88));
  return new Uint8Array(await blob.arrayBuffer());
}

let postUrl = null;
async function openPost(x) {
  $("postTitle").textContent = "بطاقة منشور · " + x.code;
  $("postCap").value = postCaption(x);
  $("postMsg").hidden = true;
  $("postImg").removeAttribute("src");
  $("postDlg").showModal();
  const blob = await drawPostCard(x);
  if (postUrl) URL.revokeObjectURL(postUrl);
  postUrl = URL.createObjectURL(blob);
  $("postImg").src = postUrl;
  const a = $("postSave");
  a.href = postUrl;
  a.setAttribute("download", x.code + ".png");
}

/* ===================== تمويه أجزاء من الصورة ===================== */
let blurState = null;
async function openBlur(path) {
  const src = await loadPhoto(path);
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = function () {
    const cv = $("blurCv"), ctx = cv.getContext("2d");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    /* نسخة مبكسلة نرسم منها تحت الفرشاة */
    const px = document.createElement("canvas");
    const f = 22;                       /* قوة التبكسل */
    px.width = Math.max(1, Math.round(cv.width / f));
    px.height = Math.max(1, Math.round(cv.height / f));
    const pc = px.getContext("2d");
    pc.imageSmoothingEnabled = true;
    pc.drawImage(img, 0, 0, px.width, px.height);
    blurState = { path, img, cv, ctx, px, drawing: false, touched: false };
    $("blurDlg").showModal();
  };
  img.onerror = function () {
    const s = upStat(); s.hidden = false; s.className = "upstat bad";
    s.textContent = "ما قدرت أفتح الصورة للتمويه.";
  };
  if (!src) { img.onerror(); return; }
  img.src = src;
}
function blurAt(ev) {
  const st = blurState; if (!st) return;
  const r = st.cv.getBoundingClientRect();
  const t = ev.touches ? ev.touches[0] : ev;
  const x = (t.clientX - r.left) * (st.cv.width / r.width);
  const y = (t.clientY - r.top) * (st.cv.height / r.height);
  const rad = (+$("blurSize").value) * (st.cv.width / r.width) / 2;
  const c = st.ctx;
  c.save();
  c.beginPath(); c.arc(x, y, rad, 0, Math.PI * 2); c.clip();
  c.imageSmoothingEnabled = false;
  c.drawImage(st.px, 0, 0, st.px.width, st.px.height, 0, 0, st.cv.width, st.cv.height);
  c.restore();
  st.touched = true;
}

/* ===================== مكتبة الصور الخاصة =====================
   الصور لا تُنشر على الموقع العام أبداً. لكل عقار صفحة صور برابط عشوائي
   طويل: غير مفهرسة، غير مربوطة بأي رابط، ولا تُذكر في خريطة الموقع.
   يُرسل الرابط لمشترٍ جدّي فقط، ويمكن إبطاله بتوليد رابط جديد. */

const GAL_DIR = "p";   /* مجلد الصفحات الخاصة */

function newKey() {
  const a = "abcdefghijkmnopqrstuvwxyz23456789";   /* بلا أحرف تلتبس */
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return Array.from(b, v => a[v % a.length]).join("");
}
const galPath = key => `${GAL_DIR}/${key}.html`;
const binPath = key => `${GAL_DIR}/${key}.bin`;
const galUrl = (key, secret) => `${BASE}/${galPath(key)}#${secret}`;
const galReady = r => !!(r.galKey && r.galSecret);

/** صفحة الصور الخاصة — تصميم الموقع نفسه، noindex، بلا روابط للموقع */
function galleryPage(x, previewUrls) {
  const [n, u] = sizeOf(x), [main, unit2] = priceTxt(x);
  /* المعاينة من اللوحة: صور جاهزة. الصفحة المنشورة: مشفّرة تُفك عند الفتح بالمفتاح الذي في الرابط */
  const imgs = previewUrls
    ? previewUrls.map((u, i) => `<figure class="gshot"><img src="${esc(u)}" alt="${esc(x.title)} — صورة ${i + 1}"></figure>`).join("")
    : "";
  const dec = previewUrls ? "" : `<script>
(async function(){var st=document.getElementById("gst"),box=document.getElementById("gs");
try{var k=location.hash.slice(1);if(!k)throw 1;
var key=await crypto.subtle.importKey("raw",Uint8Array.from(atob(k.replace(/-/g,"+").replace(/_/g,"/")),function(c){return c.charCodeAt(0)}),"AES-GCM",false,["decrypt"]);
var r=await fetch(${JSON.stringify(x.galKey + ".bin")});if(!r.ok)throw 2;
var d=new Uint8Array(await r.arrayBuffer()),dv=new DataView(d.buffer),n=dv.getUint32(0),o=4;
for(var i=0;i<n;i++){var len=dv.getUint32(o);o+=4;
var pt=await crypto.subtle.decrypt({name:"AES-GCM",iv:d.slice(o,o+12)},key,d.slice(o+12,o+len));o+=len;
var f=document.createElement("figure");f.className="gshot";var im=new Image();im.alt="صورة "+(i+1);
im.src=URL.createObjectURL(new Blob([pt],{type:"image/jpeg"}));f.appendChild(im);box.appendChild(f)}
st.hidden=true}catch(e){st.textContent=${JSON.stringify("الرابط ناقص أو غير صالح. اطلب من " + NAME + " إرسال الرابط كاملاً كما هو.")}}})();
</script>`;
  const waTxt = `مرحباً أستاذ محمد، شفت صور العقار ${x.code} (${x.title}) وبدي أستفسر.`;
  return `<!doctype html>
<html lang="ar" dir="rtl" class="solid">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>صور ${esc(x.code)} — ${esc(x.title)}</title>
<meta name="robots" content="noindex,nofollow,noarchive,noimageindex">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#06231b">
<link rel="preload" href="${BASE}/assets/fonts/lalezar-arabic.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${BASE}/assets/mk.css?v=${ASSET_V}">
</head>
<body class="pg-gallery">
<div class="gwrap">
  <header class="ghead">
    <p class="eyebrow"><i></i>صور خاصة · ${esc(x.code)}</p>
    <h1>${esc(x.title)}</h1>
    <p class="where">${esc(x.area)} · ${esc(regionOf(x.area))}</p>
    <div class="gspecs">${specRow(x)}</div>
    <div class="gprice">${main}${unit2 ? `<small>${unit2}</small>` : ""}</div>
    <div class="actions">
      <a class="btn btn-primary" target="_blank" rel="noopener" href="${wa(waTxt)}">${WA_SVG}استفسر على واتساب</a>
      <a class="btn btn-ghost" href="tel:+${PHONE_INTL}" dir="ltr">${PHONE_LOCAL}</a>
    </div>
  </header>
  <div class="gshots" id="gs">${imgs || '<p class="gnote" id="gst">جارٍ فتح الصور…</p>'}</div>
  <p class="gnote">هذه الصفحة خاصة — أُرسلت لك من ${NAME}، ${ROLE}.<br>الأوراق تُعرض كاملة قبل أي عربون.</p>
</div>
${dec}</body></html>`;
}

/** نافذة مشاركة الرابط الخاص */
let galRow = null;
function openGallery(r) {
  galRow = r;
  const has = (r.photos || []).length;
  $("galTitle").textContent = "صور " + r.code + " — رابط خاص";
  $("galSub").textContent = r.title + " · " + r.area
    + (has ? ` · ${has} صورة` : " · ما في صور بعد");
  const key = galReady(r) ? r.galKey : "";
  $("galLink").value = key ? galUrl(key, r.galSecret) : "";
  $("galLink").disabled = !key;
  $("galCopy").disabled = !key;
  $("galOpen").href = key ? galUrl(key, r.galSecret) : "#";
  $("galOpen").hidden = !key;
  $("galWa").hidden = !key;
  if (key) {
    $("galWa").href = "https://wa.me/?text=" + encodeURIComponent(
      `صور العقار ${r.code} — ${r.title} (${r.area})\n${galUrl(key, r.galSecret)}`);
  }
  $("galNew").textContent = key ? "رابط جديد (يُبطل القديم)" : "أنشئ الرابط";
  $("galMsg").hidden = true;
  $("galNew").disabled = r.status === "مباع";
  if (r.status === "مباع") { $("galMsg").hidden = false; $("galMsg").className = "upstat"; $("galMsg").textContent = "العقار مباع — رابطه الخاص ما بينشر."; }
  $("galDlg").showModal();
}

/* ===== حالة التعديلات ===== */
/* ===== دورة حياة العقار: متاح · موقوف · مباع ===== */
const STALE_DAYS = 60;      /* بعد كم يوم بلا تأكيد نطلب مراجعة العقار */
const isLive = r => r.status !== "موقوف" && r.status !== "مباع";
const touchedAt = r => Date.parse(r.confirmedAt) || Date.parse(r.updatedAt) || null;
const ageDays = r => { const t = touchedAt(r); return t ? Math.max(0, Math.floor((Date.now() - t) / 864e5)) : null; };
const isStale = r => isLive(r) && (ageDays(r) || 0) >= STALE_DAYS;
const nowIso = () => new Date().toISOString();
const normTitle = t => String(t || "").replace(/[\s\u064B-\u0652ـ،.\-_]/g, "").toLowerCase();
/** عقارات تشبه b: نفس النوع والمنطقة، ومساحة وسعر متقاربان (±10%) أو نفس العنوان */
function findSimilar(b) {
  const near = (x, y) => x > 0 && y > 0 && Math.abs(x - y) <= 0.1 * Math.max(x, y);
  return ROWS.filter(r => r.code !== b.code && r.cat === b.cat && r.area === b.area && (
    normTitle(r.title) === normTitle(b.title) ||
    (near(+b.area_m2 || +b.bua, +r.area_m2 || +r.bua) && near(totalOf(b), totalOf(r)))));
}
function markSold(r) {
  if (!confirm("«" + r.code + "» صار مباعاً؟\nبيختفي من الموقع بعد «نشر»، وبيبقى محفوظ عندك بتاريخ البيع.")) return;
  Object.assign(r, { status: "مباع", soldAt: today(), featured: false, updatedAt: nowIso(), confirmedAt: nowIso() });
  render();
}
function markAvailable(r) {
  if (!confirm("ترجّع «" + r.code + "» متاحاً وينعرض على الموقع بعد «نشر»؟")) return;
  r.status = "متاح"; delete r.soldAt; r.updatedAt = r.confirmedAt = nowIso();
  render();
}
function confirmFresh(r) {
  if (!confirm("تؤكد أن «" + r.code + "» ما زال متاحاً وسعره صحيح؟")) return;
  r.confirmedAt = nowIso();
  render();
}
const liveRows = () => ROWS.filter(isLive)
  .sort((a, b) => a.code.localeCompare(b.code));
const snapshot = () => JSON.stringify(ROWS);
const isDirty = () => snapshot() !== BASE_ROWS;

/* المسودة: البيانات في localStorage، والصور غير المنشورة في IndexedDB.
   (حدّ localStorage نحو 5 ميغابايت: مع 10 صور كانت المسودة تضيع بصمت.) */
let IDBP = null, IDB_OK = true, DRAFT_WARN = false, draftBusy = false, draftAgain = false;
const idbMirror = new Map();   /* مسار الصورة -> آخر نصّ كُتب في IndexedDB */
function idbDb() {
  if (!IDBP) IDBP = new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("no indexedDB"));
    const q = indexedDB.open("mk_admin", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("blobs");
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  return IDBP;
}
const idbDone = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
async function idbSync(blobs) {
  const db = await idbDb(), tx = db.transaction("blobs", "readwrite"), st = tx.objectStore("blobs");
  for (const k of [...idbMirror.keys()]) if (!(k in blobs)) { st.delete(k); idbMirror.delete(k); }
  for (const k in blobs) if (idbMirror.get(k) !== blobs[k]) { st.put(blobs[k], k); idbMirror.set(k, blobs[k]); }
  await idbDone(tx);
}
async function idbLoadAll() {
  const db = await idbDb(), tx = db.transaction("blobs"), st = tx.objectStore("blobs");
  const keys = st.getAllKeys(), vals = st.getAll();
  await idbDone(tx);
  const o = {}; keys.result.forEach((k, i) => { o[k] = vals.result[i]; });
  return o;
}
async function clearDraft() {
  try { localStorage.removeItem(LS_DRAFT); } catch (e) { }
  try { const db = await idbDb(), tx = db.transaction("blobs", "readwrite"); tx.objectStore("blobs").clear(); await idbDone(tx); } catch (e) { }
  idbMirror.clear();
}
function draftWarn(on) { if (DRAFT_WARN !== on) { DRAFT_WARN = on; updateBar(); } }
async function flushBlobs() {
  if (draftBusy) { draftAgain = true; return; }
  if (!Object.keys(newBlobs).length && !idbMirror.size) return;
  draftBusy = true;
  try { do { draftAgain = false; await idbSync(newBlobs); } while (draftAgain); draftWarn(false); }
  catch (e) { idbMirror.clear(); IDB_OK = false; saveDraft(); }   /* IndexedDB غير متاح (تصفح خاص…): نرجع للطريقة القديمة */
  finally { draftBusy = false; }
}
function saveDraft() {
  if (IDB_OK) {
    try { localStorage.setItem(LS_DRAFT, JSON.stringify({ rows: ROWS, idb: 1 })); } catch (e) { draftWarn(true); return; }
    flushBlobs();
  } else {
    try { localStorage.setItem(LS_DRAFT, JSON.stringify({ rows: ROWS, blobs: newBlobs })); draftWarn(false); } catch (e) { draftWarn(true); }
  }
}
function updateBar() {
  const d = isDirty();
  $("pubBar").hidden = false;
  $("pubBtn").disabled = !d;
  $("dropBtn").hidden = !d;
  const m = $("pubMsg");
  if (!m.dataset.busy) {
    m.className = "msg" + (d ? " warn" : "");
    m.textContent = d ? "عندك تعديلات ما اننشرت" + (DRAFT_WARN ? " · ⚠️ تعذّر حفظ مسودة على هذا الجهاز: انشر الآن ولا تغلق الصفحة" : "") : "الموقع محدّث ✓";
  }
}
function say(text, kind, busy) {
  const m = $("pubMsg");
  m.dataset.busy = busy ? "1" : "";
  m.className = "msg" + (kind ? " " + kind : "");
  m.textContent = text;
}

/* ===== العرض ===== */
function render() {
  syncAreas(ROWS);
  const g = $("grid"), q = query.trim();
  const list = ROWS.filter(r => {
    const sold = r.status === "مباع";
    /* المباع ما بيزاحم القائمة: يظهر بفلتره، أو حين تبحث عنه */
    if (filter === "مباع") { if (!sold) return false; }
    else if (sold && !q) return false;
    if (filter === "موقوف") { if (r.status !== "موقوف") return false; }
    else if (filter === "stale") { if (!isStale(r)) return false; }
    else if (filter !== "all" && filter !== "مباع" && r.cat !== filter) return false;
    if (!q) return true;
    return [r.code, r.title, r.area, (r.feats || []).join(" "), r.note].join(" ").includes(q);
  }).sort((a, b) => filter === "stale" ? (touchedAt(a) || 0) - (touchedAt(b) || 0) : a.code.localeCompare(b.code));

  g.textContent = "";
  if (!list.length) {
    const d = document.createElement("div");
    d.className = "empty";
    d.textContent = ROWS.length ? "ما في عقار مطابق للبحث." : "ما في عقارات بعد. اضغط «عقار جديد».";
    g.appendChild(d);
  }
  for (const r of list) {
    const card = document.createElement("div");
    card.className = "card" + (r._new ? " dirty" : "");
    const b = document.createElement("button");
    b.type = "button"; b.className = "card-open";
    b.addEventListener("click", () => openForm(r));
    card.appendChild(b);
    const acts = document.createElement("div"); acts.className = "card-acts";
    card.appendChild(acts);

    const cam = document.createElement("button");
    cam.type = "button"; cam.className = "card-cam";
    const np = (r.photos || []).length;
    cam.textContent = "📷 " + (np ? np : "صور");
    cam.setAttribute("aria-label", "صور " + r.code);
    cam.addEventListener("click", ev => { ev.stopPropagation(); openPhotos(r); });
    acts.appendChild(cam);

    const pc = document.createElement("button");
    pc.type = "button"; pc.className = "card-post";
    pc.textContent = "🖼 بطاقة";
    pc.setAttribute("aria-label", "بطاقة منشور " + r.code);
    pc.addEventListener("click", ev => { ev.stopPropagation(); openPost(r); });
    acts.appendChild(pc);

    const gl = document.createElement("button");
    gl.type = "button"; gl.className = "card-gal";
    gl.textContent = "🔗 رابط";
    gl.setAttribute("aria-label", "الرابط الخاص لصور " + r.code);
    gl.addEventListener("click", ev => { ev.stopPropagation(); openGallery(r); });
    acts.appendChild(gl);

    if (r.status === "مباع") {
      const av = document.createElement("button");
      av.type = "button"; av.className = "card-sold"; av.textContent = "↩︎ رجّعه متاحاً";
      av.addEventListener("click", ev => { ev.stopPropagation(); markAvailable(r); });
      acts.appendChild(av);
    } else {
      if (isStale(r)) {
        const ok = document.createElement("button");
        ok.type = "button"; ok.className = "card-ok"; ok.textContent = "✓ ما زال متاحاً";
        ok.addEventListener("click", ev => { ev.stopPropagation(); confirmFresh(r); });
        acts.appendChild(ok);
      }
      const sd = document.createElement("button");
      sd.type = "button"; sd.className = "card-sold"; sd.textContent = "💰 مباع";
      sd.setAttribute("aria-label", "تم بيع " + r.code);
      sd.addEventListener("click", ev => { ev.stopPropagation(); markSold(r); });
      acts.appendChild(sd);
    }

    const row = document.createElement("div"); row.className = "row1";
    const code = document.createElement("span"); code.className = "code"; code.textContent = r.code;
    row.appendChild(code);
    const t = document.createElement("span");
    if (r.status === "مباع") { t.className = "tag sold"; t.textContent = "مباع"; }
    else if (r.status === "موقوف") { t.className = "tag hold"; t.textContent = "موقوف"; }
    else if (r.confirmed === false) { t.className = "tag ask"; t.textContent = "بلا سعر"; }
    else { t.className = "tag"; t.textContent = r.cat; }
    row.appendChild(t);
    b.appendChild(row);

    if ((r.photos || []).length) {
      const th = document.createElement("div"); th.className = "thumb";
      const im = document.createElement("img");
      setPhoto(im, r.photos[0]); im.alt = r.title || r.code; im.loading = "lazy";
      th.appendChild(im); b.appendChild(th);
    }
    const h = document.createElement("h3"); h.textContent = r.title || "بلا عنوان"; b.appendChild(h);
    const m = document.createElement("div"); m.className = "meta";
    const s = sizeOf(r); m.textContent = r.area + " · " + s[0] + " " + s[1]; b.appendChild(m);
    const p = document.createElement("div"); p.className = "price";
    p.textContent = r.confirmed === false ? "السعر عند التواصل"
      : money(totalOf(r)) + (r.mode === "للدنم" ? "  (" + money(r.price) + " للدنم)" : "");
    b.appendChild(p);
    const ag = document.createElement("div"); ag.className = "age";
    if (r.status === "مباع") ag.textContent = "بِيع" + (r.soldAt ? " بتاريخ " + r.soldAt : "");
    else {
      const a = ageDays(r);
      ag.textContent = a === null ? "بلا تاريخ تحديث" : "آخر تحديث " + (a === 0 ? "اليوم" : "منذ " + a + " يوماً");
      if (isStale(r)) ag.classList.add("stale");
    }
    b.appendChild(ag);
    g.appendChild(card);
  }
  const held = ROWS.filter(r => r.status === "موقوف").length, soldN = ROWS.filter(r => r.status === "مباع").length,
    staleN = ROWS.filter(isStale).length, total = filter === "مباع" ? soldN : ROWS.length - soldN;
  $("count").textContent = list.length + " من " + total + " عقار"
    + (held ? " · " + held + " موقوف ما بينشر" : "")
    + (soldN && filter !== "مباع" ? " · " + soldN + " مباع" : "")
    + (staleN ? " · " + staleN + " تحتاج مراجعة" : "");
  updateBar();
  saveDraft();
}

/* ===== الصور ===== */
const photoBox = () => $(quickRow ? "qPhotoBox" : "photoBox");
const upStat = () => $(quickRow ? "qUpstat" : "upstat");

function drawPhotos() {
  const box = photoBox();
  box.textContent = "";
  if (!photos.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "ما في صور بعد — العقار بيعرض رقم المساحة مكان الصورة.";
    box.appendChild(p);
    return;
  }
  photos.forEach((path, i) => {
    const fig = document.createElement("div"); fig.className = "ph";
    const img = document.createElement("img");
    setPhoto(img, path); img.alt = "صورة " + (i + 1); img.loading = "lazy";
    img.title = "اضغط للمعاينة الكاملة والتمويه";
    img.addEventListener("click", () => openBlur(path));
    fig.appendChild(img);
    if (i === 0) {
      const t = document.createElement("span"); t.className = "main-tag"; t.textContent = "رئيسية";
      fig.appendChild(t);
    }
    const act = document.createElement("div"); act.className = "ph-act";
    if (i > 0) {
      const m = document.createElement("button"); m.type = "button"; m.textContent = "رئيسية";
      m.addEventListener("click", () => { photos.unshift(photos.splice(i, 1)[0]); drawPhotos(); syncQuick(); });
      act.appendChild(m);
    }
    const bl = document.createElement("button"); bl.type = "button"; bl.textContent = "تمويه";
    bl.addEventListener("click", () => openBlur(path));
    act.appendChild(bl);
    const d = document.createElement("button"); d.type = "button"; d.className = "del"; d.textContent = "حذف";
    d.addEventListener("click", () => { photos.splice(i, 1); drawPhotos(); syncQuick(); });
    act.appendChild(d);
    fig.appendChild(act);
    box.appendChild(fig);
  });
}
function shrink(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1600;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return reject(new Error("bad"));
      const s = Math.min(1, MAX / Math.max(w, h));
      w = Math.round(w * s); h = Math.round(h * s);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      c.toBlob(b => b ? resolve(b) : reject(new Error("blob")), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad")); };
    img.src = url;
  });
}
function nextPhotoPath(code) {
  let n = 1;
  const used = new Set(ROWS.flatMap(r => r.photos || []).concat(photos));
  while (used.has(`img/${code}-${n}.jpg`)) n++;
  return `img/${code}-${n}.jpg`;
}
async function addPhotos(files) {
  if (!files.length) return;
  const code = (quickRow ? quickRow.code : toLatinDigits($("f_code").value).trim().toUpperCase());
  if (!/^MK-\d{3}$/.test(code)) {
    const s = upStat(); s.hidden = false; s.className = "upstat bad";
    s.textContent = "اكتب كود العقار أولاً.";
    return;
  }
  const stat = upStat();
  stat.hidden = false; stat.className = "upstat";
  let done = 0;
  for (const f of files) {
    stat.textContent = "جارٍ تجهيز " + (done + 1) + " من " + files.length + "…";
    try {
      const blob = await shrink(f);
      const buf = new Uint8Array(await blob.arrayBuffer());
      const path = nextPhotoPath(code);
      newBlobs[path] = b64(buf);
      photos.push(path);
      done++;
      drawPhotos();
    } catch (e) {
      stat.className = "upstat bad";
      stat.textContent = "ما زبطت الصورة «" + f.name + "».";
      return;
    }
  }
  syncQuick();
  stat.textContent = done + " صورة جاهزة — اضغط «نشر» لتنحفظ بشكل خاص.";
  setTimeout(() => { stat.hidden = true; }, 4500);
}
/* في وضع الصور السريع بنكتب على السطر مباشرة */
function syncQuick() {
  if (!quickRow) return;
  quickRow.photos = photos.slice();
  render();
}
function openPhotos(r) {
  quickRow = r;
  photos = (r.photos || []).slice();
  $("qTitle").textContent = "صور " + r.code;
  $("qSub").textContent = r.title + " · " + r.area;
  $("qUpstat").hidden = true;
  $("q_photos").value = "";
  drawPhotos();
  $("photoDlg").showModal();
}

/* ===== النموذج ===== */
function nextCode() {
  let max = 0;
  for (const r of ROWS) { const m = /^MK-(\d+)$/.exec(r.code || ""); if (m) max = Math.max(max, +m[1]); }
  return "MK-" + String(max + 1).padStart(3, "0");
}
function setSeg(box, val, attr) {
  for (const b of box.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset[attr] === val));
}
function drawFeats() {
  const box = $("featBox"), input = $("f_featIn");
  for (const el of [...box.querySelectorAll(".feat")]) el.remove();
  feats.forEach((f, i) => {
    const s = document.createElement("span"); s.className = "feat";
    s.appendChild(document.createTextNode(f));
    const x = document.createElement("button"); x.type = "button"; x.textContent = "×";
    x.setAttribute("aria-label", "حذف " + f);
    x.addEventListener("click", () => { feats.splice(i, 1); drawFeats(); });
    s.appendChild(x);
    box.insertBefore(s, input);
  });
}
const landToInput = m2 => !m2 ? "" : (unit === "dunam" ? String(+(m2 / 1000).toFixed(3)) : String(m2));
function inputToM2() {
  const v = parseNum($("f_land").value);
  if (!isFinite(v) || v <= 0) return null;
  return Math.round(unit === "dunam" ? v * 1000 : v);
}
function updateTotal() {
  const m2 = inputToM2() || 0, price = parseNum($("f_price").value) || 0;
  const t = mode === "للدنم" ? price * m2 / 1000 : price;
  $("totalVal").textContent = t > 0 ? money(t) : "—";
}
const NEW_AREA = "__new__";
function fillAreaSelect(selected) {
  const sel = $("f_area"); sel.textContent = "";
  for (const a of AREA_ORDER) { const o = document.createElement("option"); o.value = a; o.textContent = a; sel.appendChild(o); }
  const n = document.createElement("option"); n.value = NEW_AREA; n.textContent = "＋ منطقة جديدة…"; sel.appendChild(n);
  sel.value = selected && AREA_ORDER.includes(selected) ? selected : AREA_ORDER[0];
  $("newAreaBox").hidden = true;
}
function openForm(r) {
  quickRow = null;
  editing = r || null;
  $("dlgTitle").textContent = r ? "تعديل " + r.code : "عقار جديد";
  $("err").hidden = true;
  $("delBtn").hidden = !r;
  $("f_code").value = r ? r.code : nextCode();
  $("f_code").readOnly = !!r;
  $("f_cat").value = r && CATS.includes(r.cat) ? r.cat : "أرض";
  syncAreas(ROWS);
  fillAreaSelect(r ? normArea(r.area) : "يعفور");
  $("f_area_new").value = ""; $("f_area_slug").value = ""; $("f_area_region").value = DEFAULT_REGION;
  $("f_area_slug").dataset.touched = "";
  $("f_title").value = r ? (r.title || "") : "";
  const m2 = r ? +r.area_m2 || 0 : 0;
  unit = (!m2 || (m2 >= 1000 && m2 % 500 === 0)) ? "dunam" : "m2";
  setSeg($("unitSeg"), unit, "u");
  $("landHint").textContent = unit === "dunam" ? "اكتب 5 يعني 5 دنم." : "اكتب المساحة بالمتر المربع.";
  $("f_land").value = landToInput(m2);
  $("f_bua").value = r && r.bua ? r.bua : "";
  mode = r && r.mode === "للدنم" ? "للدنم" : "مقطوع";
  setSeg($("modeSeg"), mode, "m");
  $("f_price").value = r && r.price ? r.price : "";
  $("f_nego").checked = !!(r && r.nego);
  $("f_conf").checked = r ? r.confirmed !== false : true;
  $("f_feat").checked = !!(r && r.featured);
  $("f_papers").value = r ? (r.papers || "") : "";
  $("f_status").value = r ? (r.status || "متاح") : "متاح";
  $("f_sold").value = r && r.soldAt ? r.soldAt : "";
  $("soldBox").hidden = $("f_status").value !== "مباع";
  $("f_note").value = r ? (r.note || "") : "";
  feats = r && Array.isArray(r.feats) ? r.feats.slice() : [];
  drawFeats();
  photos = r && Array.isArray(r.photos) ? r.photos.slice() : [];
  drawPhotos();
  $("upstat").hidden = true;
  $("f_photos").value = "";
  $("p_place").value = r ? (r.src_place || "") : "";
  $("p_by").value = r ? (r.src_by || "") : "";
  $("p_comm").value = r ? (r.commission || "") : "";
  $("p_notes").value = r ? (r.src_notes || "") : "";
  updateTotal();
  $("dlg").showModal();
}
/** فحص سعر شاذّ عن باقي عقاراتك: يمنع "صفرين زيادة" من الوصول للموقع دون انتباه */
function priceSanity(b) {
  if (b.confirmed === false) return null;
  const total = totalOf(b);
  if (!(total > 0)) return null;
  const perDunam = x => x.cat === "أرض" && +x.area_m2 > 0;
  const metric = x => perDunam(x) ? totalOf(x) / (x.area_m2 / 1000) : totalOf(x);
  const m = metric(b), what = perDunam(b) ? "سعر الدنم" : "السعر";
  if (total < 5000) return `الإجمالي ${money(total)} فقط — رقم صغير جداً`;
  const peers = ROWS.filter(r => r.code !== b.code && r.cat === b.cat && r.confirmed !== false && totalOf(r) > 0)
    .map(metric).sort((x, y) => x - y);
  if (peers.length >= 2) {
    const med = peers[peers.length >> 1];
    if (m > med * 4 || m < med / 4) return `${what} ${money(m)}، بينما عقاراتك المشابهة (${b.cat}) حوالي ${money(med)}`;
  }
  if (total >= 5e7) return `الإجمالي ${money(total)} — مبلغ ضخم جداً`;
  return null;
}
function fail(msg, focus) {
  const e = $("err"); e.textContent = msg; e.hidden = false;
  if (focus) $(focus).focus();
}
function save() {
  const code = toLatinDigits($("f_code").value).trim().toUpperCase();
  if (!/^MK-\d{3}$/.test(code)) return fail("الكود لازم يكون بصيغة MK-022.", "f_code");
  if (!editing && ROWS.some(r => r.code === code)) return fail("الكود " + code + " مستعمل من قبل.", "f_code");
  const title = $("f_title").value.trim();
  if (!title) return fail("اكتب عنوان العقار.", "f_title");
  const m2 = inputToM2(), bua = parseNum($("f_bua").value);
  if (!m2 && !(isFinite(bua) && bua > 0)) return fail("لازم مساحة أرض أو مساحة بناء.", "f_land");
  const price = parseNum($("f_price").value);
  if (!isFinite(price) || price <= 0) return fail("اكتب السعر بأرقام (مثلاً 250000).", "f_price");
  if (mode === "للدنم" && !m2) return fail("سعر الدنم بدّو مساحة أرض.", "f_land");

  /* المنطقة: موجودة، أو جديدة (اسم + رابط إنكليزي + محافظة) */
  let area = $("f_area").value, areaSlug = null, areaRegion = null;
  if (area === NEW_AREA) {
    area = normArea($("f_area_new").value);
    if (!area) return fail("اكتب اسم المنطقة الجديدة.", "f_area_new");
    const same = AREA_ORDER.find(a => normArea(a) === area);
    if (same) area = same;                                   /* موجودة أصلاً: نستعملها بدل ما نكرّرها */
    else {
      areaSlug = $("f_area_slug").value.trim().toLowerCase();
      const prob = slugProblem(areaSlug, area);
      if (prob) return fail(prob, "f_area_slug");
      areaRegion = normArea($("f_area_region").value) || DEFAULT_REGION;
    }
  } else if (!CORE_AREAS.includes(area) && !KNOWN_SLUGS[area]) { areaSlug = AREA_SLUG[area]; if (AREA_REGION[area]) areaRegion = AREA_REGION[area]; }
  const status = $("f_status").value, nowT = nowIso();
  const body = {
    code, status, cat: $("f_cat").value, title,
    area, area_m2: m2, bua: isFinite(bua) && bua > 0 ? Math.round(bua) : null,
    mode, price: Math.round(price), nego: $("f_nego").checked, confirmed: $("f_conf").checked,
    featured: status === "مباع" ? false : $("f_feat").checked,
    papers: $("f_papers").value, feats: feats.slice(), photos: photos.slice(),
    note: $("f_note").value.trim(),
    src_place: $("p_place").value.trim(), src_by: $("p_by").value.trim(),
    commission: $("p_comm").value.trim(), src_notes: $("p_notes").value.trim(),
    updatedAt: nowT, confirmedAt: nowT
  };
  if (status === "مباع") body.soldAt = $("f_sold").value || today();
  if (areaSlug) body.area_slug = areaSlug;
  if (areaRegion && areaRegion !== DEFAULT_REGION) body.area_region = areaRegion;
  /* السعر لم يتغيّر في تعديل عقار قائم؟ لا نزعجك بالتنبيه */
  const same = editing && +editing.price === body.price && editing.mode === body.mode
    && +editing.area_m2 === +body.area_m2 && editing.cat === body.cat;
  if (!same) {
    const warn = priceSanity(body);
    if (warn && !confirm("⚠️ دقّق السعر:\n" + warn + "\n\nموافق = احفظ كما هو\nإلغاء = ارجع وعدّل")) return;
  }
  /* عقار جديد أو تغيّرت مواصفاته وهو متاح: هل هو تكرار لعقار عندك؟ */
  const sameFacts = same && editing.area === body.area && (+editing.bua || 0) === (+body.bua || 0)
    && editing.title === body.title && editing.status === body.status;
  if (status === "متاح" && !sameFacts) {
    const sim = findSimilar(body);
    if (sim.length && !confirm("⚠️ يشبه عقاراً عندك:\n" + sim.slice(0, 3).map(r => r.code + " — " + r.title + (r.status === "مباع" ? " (مباع)" : r.status === "موقوف" ? " (موقوف)" : "")).join("\n")
        + "\n\nنفس النوع والمنطقة ومساحة وسعر متقاربان.\nموافق = احفظه كعقار مستقل\nإلغاء = ارجع وراجع")) return;
  }
  if (editing) { delete editing.area_slug; delete editing.area_region; Object.assign(editing, body); if (status !== "مباع") delete editing.soldAt; }
  else { body._new = true; ROWS.push(body); }
  $("dlg").close();
  render();
}
function removeIt() {
  if (!editing) return;
  if (!confirm("متأكد بدك تحذف " + editing.code + " نهائياً؟\n\nلو بدك بس توقفه عن النشر بدّل الحالة لـ«موقوف»، ولو انباع بدّلها لـ«مباع» (بيبقى محفوظ عندك).")) return;
  ROWS = ROWS.filter(r => r !== editing);
  $("dlg").close();
  render();
}

/* ===== فحص جودة المخرجات قبل الرفع =====
   اللوحة هي مولّد الموقع وتنشر مباشرة: أي خلل فيها (أو في تعديل مستقبلي) كان سيصل للزوار.
   الآن أي مشكلة توقف النشر، والموقع يبقى كما هو. */
function validateOutput(files, live, cols, pubHas) {
  const bad = [], add = m => { if (bad.length < 6) bad.push(m); };
  const byPath = new Map(files.map(f => [f.path, f]));
  const has = p => byPath.has(p) || pubHas.has(p);
  for (const f of files) {
    const p = f.path, c = f.content;
    if (typeof c !== "string" || p.startsWith(GAL_DIR + "/") || !/\.(html|xml)$/.test(p)) continue;
    const m = c.match(/undefined|\bNaN\b|\[object /);
    if (m) add(`${p}: فيه «${m[0]}»`);
    if (/\.html$/.test(p) && (c.length < 1000 || !/^<!doctype html>/i.test(c))) add(`${p}: صفحة ناقصة`);
    for (const j of c.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.parse(j[1]); } catch (e) { add(`${p}: البيانات المنظمة معطوبة`); }
    }
  }
  const data = byPath.get("data.json");
  try {
    const arr = JSON.parse(data.content);
    if (arr.length !== live.length) add(`data.json فيه ${arr.length} عقار والمتاح ${live.length}`);
    if (arr.some(x => !x.code || !x.title || !x.area)) add("data.json فيه عقار ناقص (كود أو عنوان أو منطقة)");
  } catch (e) { add("data.json معطوب"); }
  const idx = byPath.get("index.html");
  for (const x of live) {
    const pg = byPath.get(`listing/${x.code}.html`);
    if (!pg) { add(`صفحة ${x.code} غير موجودة`); continue; }
    if (!/<title>[^<]{3,}<\/title>/.test(pg.content)) add(`${x.code}: عنوان الصفحة فارغ`);
    if (idx && idx.content.indexOf(`listing/${x.code}.html`) < 0) add(`الرئيسية لا تحتوي ${x.code}`);
    if (x.confirmed !== false && !(isFinite(+x.price) && +x.price > 0)) add(`${x.code}: السعر غير صالح`);
    const og = (pg.content.match(/og:image" content="[^"]*?\/(og\/[^"]+)"/) || [])[1];
    if (og && !has(og)) add(`${x.code}: بطاقة المشاركة ناقصة`);
  }
  for (const c of cols) if (!byPath.has(c.slug)) add(`صفحة ${c.slug} غير موجودة`);
  const sm = byPath.get("sitemap.xml");
  if (sm && (sm.content.match(/<loc>/g) || []).length !== 1 + cols.length + live.length) add("خريطة الموقع لا تطابق الصفحات");
  if (bad.length) throw new Error("فحص الجودة أوقف النشر (الموقع ما تغيّر): " + bad.join(" · "));
}

/* ===== دمج تعديلات جهاز آخر =====
   لو فتحت اللوحة على جهازين ونشرت من أحدهما، النشر من الثاني ما بيمحو شي: نقارن كل عقار
   بثلاث نسخ (وقت الفتح · نسختك · اللي على GitHub الآن) ونأخذ من كل طرف ما غيّره. */
const rowKey = r => r ? JSON.stringify(Object.assign({}, r, { _new: undefined })) : "";
function mergeRows(base, ours, theirs) {
  const B = new Map(base.map(r => [r.code, r])), O = new Map(ours.map(r => [r.code, r])), T = new Map(theirs.map(r => [r.code, r]));
  const order = ours.map(r => r.code).concat(theirs.map(r => r.code).filter(c => !O.has(c)));
  const rows = [], taken = [], conflicts = [];
  for (const code of order) {
    const b = B.get(code), o = O.get(code), t = T.get(code);
    const oc = rowKey(o) !== rowKey(b), tc = rowKey(t) !== rowKey(b);
    if (!tc) { if (o) rows.push(o); }                       /* الطرف الآخر ما لمسه */
    else if (!oc) { if (t) rows.push(t); taken.push(code); } /* أنت ما لمسته: نأخذ نسخته */
    else if (rowKey(o) === rowKey(t)) { if (o) rows.push(o); } /* غيّرتماه بنفس الشكل */
    else { conflicts.push(code); if (o) rows.push(o); }      /* تعديلان مختلفان: نسختك هي المعتمدة بعد سؤالك */
  }
  return { rows, taken, conflicts };
}
/** يرجع null إن لم يتغيّر شي بالمستودع، وإلا يدمج ويحدّث ROWS ويرجع ملخّصاً؛ يرمي خطأ إن ألغيت */
async function syncWithRemote() {
  const remote = await readFile(CFG.priv, "private.json");
  const sha = remote ? remote.sha : null;
  if (sha === PRIV_SHA) return null;
  const theirs = remote ? remote.json : [];
  const m = mergeRows(JSON.parse(PRIV_BASE), ROWS, theirs);
  if (m.conflicts.length && !confirm("تعديلات من جهاز آخر على نفس العقارات التي عدّلتها هنا:\n" + m.conflicts.join("، ")
      + "\n\nموافق = تعتمد نسختك لهذه العقارات\nإلغاء = يتوقف النشر وما يتغيّر شي")) {
    throw new Error("توقّف النشر بسبب تعارض مع تعديلات جهاز آخر. لم يتغيّر شيء.");
  }
  ROWS = m.rows; BASE_ROWS = PRIV_BASE = JSON.stringify(theirs); PRIV_SHA = sha;
  return m;
}

/* ===== التحقق من أن الموقع تحدّث فعلاً =====
   "نُشر" على GitHub لا يعني أن الموقع تغيّر: GitHub Pages يبنيه بعد ذلك وقد يفشل بصمت.
   نفحص الموقع الحي حتى يطابق ما نشرناه، ونسأل GitHub عن حالة البناء إن سمح المفتاح. */
const VERIFY = { every: 6000, max: 240000 };   /* الاختبارات تصغّرها */
let VERIFY_ID = 0, RUNS_OK = true;
async function pagesBuild(sha) {
  if (!RUNS_OK || !sha) return null;
  try {
    const r = await gh(`/repos/${CFG.owner}/${CFG.pub}/actions/runs?head_sha=${sha}&per_page=5`);
    if (!r) { RUNS_OK = false; return null; }
    const run = (r.workflow_runs || []).find(x => /pages/i.test(x.name || ""));
    return run ? { status: run.status, conclusion: run.conclusion, url: run.html_url } : null;
  } catch (e) { RUNS_OK = false; return null; }   /* المفتاح ما عنده صلاحية قراءة Actions: نكتفي بفحص الموقع */
}
async function verifyLive(res, files, note, kind) {
  const id = ++VERIFY_ID, cur = () => id === VERIFY_ID;
  const link = $("pubActions"); link.hidden = true;
  const show = (t, k) => { if (cur()) say(note + t, k || kind, true); };   /* busy: updateBar ما بيمحوها */
  const text = new Map(files.filter(f => typeof f.content === "string").map(f => [f.path, f.content]));
  const written = res ? res.written : [];
  const pref = ["data.json", "index.html"];
  const targets = pref.filter(p => written.includes(p)).concat(written.filter(p => text.has(p) && !pref.includes(p))).slice(0, 3);
  const gone = res ? res.removed.find(p => /\.html$/.test(p)) : null;
  if (!res || (!targets.length && !gone)) { show(" · ما في تغيير على الموقع نفسه", kind); setTimeout(() => { if (cur()) { say("", ""); updateBar(); } }, 6000); return; }
  const t0 = Date.now(); let net = 0, tick = 0;
  while (cur() && Date.now() - t0 < VERIFY.max) {
    const secs = Math.round((Date.now() - t0) / 1000);
    try {
      let ok = true;
      if (targets.length) {
        for (const p of targets) {
          const r = await fetch(`${BASE}/${p}?v=${Date.now()}`, { cache: "no-store" });
          if (!r.ok || (await r.text()) !== text.get(p)) { ok = false; break; }
        }
      } else ok = (await fetch(`${BASE}/${gone}?v=${Date.now()}`, { cache: "no-store" })).status === 404;
      net = 0;
      if (ok) { show(" · الموقع تحدّث فعلاً ✓ (بعد " + secs + " ث)", "ok"); setTimeout(() => { if (cur()) { say("", ""); updateBar(); } }, 15000); return; }
    } catch (e) {
      if (++net >= 3) { show(" (تعذّر التحقق الآلي من هذا المتصفح، افتح الموقع وتأكد بنفسك)", "warn"); return; }
    }
    if (tick++ % 2 === 1) {   /* كل مرتين: هل فشل بناء GitHub Pages؟ */
      const b = await pagesBuild(res.sha);
      if (b && b.status === "completed" && b.conclusion && b.conclusion !== "success") {
        if (cur()) { link.href = b.url; link.hidden = false; }
        show(" — لكن بناء الموقع على GitHub فشل (" + b.conclusion + "). افتح سجل البناء.", "bad"); return;
      }
    }
    show(" · جارٍ التأكد من تحديث الموقع… " + secs + " ث", kind);
    await sleep(VERIFY.every);
  }
  if (cur()) {
    link.href = `https://github.com/${CFG.owner}/${CFG.pub}/actions`; link.hidden = false;
    show(" — لكن الموقع ما تحدّث خلال " + Math.round(VERIFY.max / 60000) + " دقائق. ممكن بناء GitHub متأخر أو فشل: افتح سجل البناء.", "bad");
  }
}

/* ===== فحص الاتصال: قراءة فقط، يكشف المشاكل قبل النشر ===== */
async function runChecks() {
  const box = $("chkList"); box.textContent = "";
  const icon = { ok: "✓ ", warn: "⚠️ ", bad: "✗ ", wait: "… " };
  const put = (el, st, name, info) => { el.className = "chk " + st; el.textContent = icon[st] + name + (info ? " — " + info : ""); };
  let bad = 0, warn = 0;
  const step = async (name, fn) => {
    const el = document.createElement("div"); box.appendChild(el); put(el, "wait", name);
    try { const r = (await fn()) || {}; if (r.warn) warn++; put(el, r.warn ? "warn" : "ok", name, r.info); }
    catch (e) { bad++; put(el, "bad", name, e.message); }
  };
  const repoInfo = async (name, mustBePrivate) => {
    const i = await gh(`/repos/${CFG.owner}/${name}`);
    if (!i) throw new Error("ما لقيت المستودع، أو المفتاح ما بيوصله");
    if (!i.permissions || !i.permissions.push) throw new Error("المفتاح ما عنده صلاحية كتابة عليه");
    if (mustBePrivate && i.private === false) throw new Error("المستودع «عام» وصورك وبياناتك مكشوفة! حوّله لخاص من إعداداته");
    return { info: mustBePrivate ? "خاص، وفيه صلاحية كتابة" : "فيه صلاحية كتابة" };
  };
  await step("المستودع العام (الموقع)", () => repoInfo(CFG.pub, false));
  await step("المستودع الخاص (البيانات والصور)", () => repoInfo(CFG.priv, true));
  let pf = null;
  await step("قراءة بيانات المخزون", async () => {
    pf = await readFile(CFG.priv, "private.json");
    if (!pf) return { warn: true, info: "ما في private.json بعد (بيتعمل عند أول نشر)" };
    return { info: pf.json.length + " عقار" };
  });
  let privSnap = null;
  await step("شجرة ملفات المستودعين", async () => {
    const [a, b] = await Promise.all([repoTree(CFG.pub), repoTree(CFG.priv)]);
    privSnap = b;
    if (a.truncated || b.truncated) throw new Error("الشجرة كبيرة وتقطّعت: النشر ممكن يفوّت ملفات");
    return { info: a.map.size + " ملف عام · " + b.map.size + " ملف خاص" };
  });
  await step("النسخ السابقة", async () => {
    const l = await gh(`/repos/${CFG.owner}/${CFG.priv}/commits?path=private.json&per_page=10`);
    return { info: (l ? l.length : 0) + " نسخة محفوظة" };
  });
  await step("قراءة صور المستودع الخاص", async () => {
    const p = privSnap && [...privSnap.map.keys()].find(k => k.startsWith("img/"));
    if (!p) return { info: "ما في صور بعد" };
    if (!(await ghRaw(CFG.priv, p))) throw new Error("ما قدرت أقرأ " + p);
    return { info: "قرأت " + p };
  });
  await step("قراءة الموقع الحي", async () => {
    const r = await fetch(`${BASE}/data.json?v=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error("الموقع ردّ " + r.status);
    const n = (await r.json()).length, mine = pf ? pf.json.filter(isLive).length : null;
    return mine !== null && n !== mine ? { warn: true, info: n + " عقار على الموقع، و" + mine + " متاح عندك (ممكن نشر لم يكتمل)" } : { info: n + " عقار منشور" };
  });
  await step("حالة بناء الموقع (Actions)", async () => {
    RUNS_OK = true;
    let r = null; try { r = await gh(`/repos/${CFG.owner}/${CFG.pub}/actions/runs?per_page=5`); } catch (e) { r = null; }
    if (!r) return { warn: true, info: "المفتاح ما بيقرأ Actions، فالتحقق بعد النشر بيعتمد على فحص الموقع (كافٍ)" };
    const run = (r.workflow_runs || []).find(x => /pages/i.test(x.name || ""));
    if (!run) return { info: "ما في عمليات بناء بعد" };
    if (run.conclusion && run.conclusion !== "success") return { warn: true, info: "آخر بناء: " + run.conclusion };
    return { info: "آخر بناء: " + (run.conclusion || run.status) };
  });
  await step("حدود GitHub وساعة الجهاز", async () => {
    const r = await fetch("https://api.github.com/rate_limit", { headers: { Authorization: "Bearer " + CFG.token } });
    if (!r.ok) throw new Error("ردّ " + r.status);
    const j = await r.json(), c = j.resources.core, dh = r.headers.get("date");
    const skew = dh ? Math.abs(Date.now() - Date.parse(dh)) / 60000 : 0;
    const bits = ["متبقّي " + c.remaining + " من " + c.limit + " طلب"];
    if (skew > 10) bits.push("ساعة جهازك متأخرة/متقدمة " + Math.round(skew) + " دقيقة: تواريخ العقارات ستكون خاطئة");
    return { warn: c.remaining < 200 || skew > 10, info: bits.join(" · ") };
  });
  const sum = document.createElement("div");
  sum.className = "chk " + (bad ? "bad" : warn ? "warn" : "ok");
  sum.textContent = bad ? `✗ ${bad} مشكلة تحتاج إصلاحاً قبل النشر` : warn ? `⚠️ الاتصال شغّال، مع ${warn} ملاحظة` : "✓ كل شي سليم، فيك تنشر";
  box.appendChild(sum);
}

/* ===== النشر ===== */
async function publish() {
  if (!isDirty()) return;
  $("pubBtn").disabled = true;
  try {
    say("جارٍ فحص تعديلات الأجهزة الأخرى…", "warn", true);
    const merged = await syncWithRemote();
    syncAreas(ROWS);
    const live = liveRows();

    /* روابط صور قديمة (بلا مفتاح تشفير) غير آمنة: تُلغى، ويُنشأ رابط جديد مشفّر عند الطلب */
    for (const r of ROWS) if (r.galKey && !r.galSecret) delete r.galKey;

    /* الصور تُحفظ في المستودع الخاص فقط: الجديد يُرفع، والقديم في الموقع العام يُرحَّل */
    say("جارٍ حفظ بياناتك وصورك في المستودع الخاص…", "warn", true);
    const usedPhotos = new Set(ROWS.flatMap(r => r.photos || []));
    const [privSnap, pubSnap] = await Promise.all([repoTree(CFG.priv), repoTree(CFG.pub)]);
    const privPaths = privSnap.map;
    const privFiles = [];
    const unsafe = new Set();      /* صور تعذّر ترحيلها: لا نحذف نسختها العامة */
    await pool([...usedPhotos], 4, async p => {
      if (newBlobs[p]) privFiles.push({ path: p, b64: newBlobs[p] });
      else if (!privPaths.has(p)) {
        const bytes = await photoBytes(p);
        if (bytes) privFiles.push({ path: p, b64: b64(bytes) });
        else unsafe.add(p);
      }
    });
    const privDeletes = [...privPaths.keys()].filter(p => p.startsWith("img/") && !usedPhotos.has(p));
    const clean = ROWS.map(r => { const c = Object.assign({}, r); delete c._new; return c; });
    /* بياناتك أولاً: هي الأصل. لو انقطع النت بعدها، ما بتضيع ولا معلومة. */
    const privJson = JSON.stringify(clean, null, 1);
    await commit(CFG.priv, [{ path: "private.json", content: privJson }].concat(privFiles),
      "تحديث بيانات المخزون", privDeletes, privSnap);
    PRIV_SHA = await gitSha(new TextEncoder().encode(privJson)); PRIV_BASE = JSON.stringify(clean);

    say("جارٍ تجهيز صفحات الموقع…", "warn", true);
    const cols = collectionsAll(live);
    const files = [
      { path: "data.json", content: JSON.stringify(publicData(live), null, 1) },
      { path: "index.html", content: indexPage(live) },
      { path: "sitemap.xml", content: sitemapXml(live) }
    ];
    for (const c of cols) files.push({ path: c.slug, content: collectionPage(c, cols) });
    for (const x of live) files.push({ path: `listing/${x.code}.html`, content: listingPage(x, live) });

    const existing = [...pubSnap.map.keys()];
    const pubHas = pubSnap.map;
    /* صفحات الصور الخاصة: صفحة عامة بلا صور + ملف صور مشفّر لا يُفتح بدون المفتاح */
    const galKeep = new Set();
    for (const r of ROWS) {
      if (!galReady(r) || !(r.photos || []).length || r.status === "مباع") continue;   /* المباع: لا صفحة صور خاصة */
      files.push({ path: galPath(r.galKey), content: galleryPage(r) });
      galKeep.add(galPath(r.galKey)); galKeep.add(binPath(r.galKey));
      const base = JSON.parse(BASE_ROWS).find(b => b.code === r.code);
      const changed = !pubHas.has(binPath(r.galKey)) || !base || base.galKey !== r.galKey
        || base.galSecret !== r.galSecret || JSON.stringify(base.photos) !== JSON.stringify(r.photos)
        || r.photos.some(p => newBlobs[p]);
      if (!changed) continue;
      say("جارٍ تشفير صور " + r.code + "…", "warn", true);
      const list = (await pool(r.photos, 4, p => photoBytes(p))).filter(Boolean);
      files.push({ path: binPath(r.galKey), b64: b64(await encryptPhotos(r.galSecret, list)) });
    }

    /* بطاقات المعاينة للمشاركة: اسم الملف فيه بصمة البيانات، فلا يُرسم إلا الجديد أو المتغيّر */
    const ogKeep = new Set();
    for (const x of live.concat([null])) {
      const p = ogPath(x); ogKeep.add(p);
      if (pubHas.has(p)) continue;
      say("جارٍ رسم بطاقة المشاركة" + (x ? " " + x.code : "") + "…", "warn", true);
      files.push({ path: p, b64: b64(await drawOgCard(x)) });
    }

    /* صفحات عقارات ما عادت متاحة (انحذفت أو صارت موقوفة) تُشال من الموقع
       حتى ما يوصلها زبون من جوجل ويتصل على عقار مباع */
    const keep = new Set(live.map(x => `listing/${x.code}.html`));
    /* صفحات المناطق والأصناف: ما كان في خريطة الموقع السابقة ولم يعد مستحقّاً يُحذف (المناطق ديناميكية).
       لا يُحذف أبداً ملف خارج هذا النمط (index.html و404.html و admin.html وملفات Google). */
    const colNames = new Set();
    for (const a of AREA_ORDER) for (const n of pageNamesOf(AREA_SLUG[a])) colNames.add(n);
    try {
      const sm = await ghRaw(CFG.pub, "sitemap.xml");
      if (sm) for (const m of new TextDecoder().decode(sm).matchAll(/<loc>[^<]*?\/([a-z0-9-]+\.html)<\/loc>/g)) colNames.add(m[1]);
    } catch (e) { }
    const PROTECTED = new Set(["index.html", "404.html", "admin.html"]);
    const colKeep = new Set(cols.map(c => c.slug));
    const deletes = existing.filter(p =>
      (p.startsWith("listing/") && p.endsWith(".html") && !keep.has(p)) ||
      (colNames.has(p) && !colKeep.has(p) && !PROTECTED.has(p) && !/^google/.test(p)) ||
      /* رابط خاص أُبطل أو عقار ما عاد له صور */
      (p.startsWith(GAL_DIR + "/") && /\.(html|bin)$/.test(p) && !galKeep.has(p)) ||
      (p.startsWith("og/") && !ogKeep.has(p)) ||
      /* كل صور العقارات تغادر المستودع العام (ما عدا صورتك الشخصية) */
      (p.startsWith("img/") && p !== "img/mohammad-khaled.jpg" && !unsafe.has(p)));

    say("جارٍ فحص الجودة…", "warn", true);
    validateOutput(files, live, cols, pubHas);
    say("جارٍ الرفع…", "warn", true);
    const pubRes = await commit(CFG.pub, files, "تحديث المخزون من لوحة الإدارة", deletes, pubSnap);

    for (const p in newBlobs) photoUrls.delete(p);
    newBlobs = {};
    ROWS.forEach(r => { delete r._new; });
    BASE_ROWS = snapshot();
    await clearDraft();
    const took = merged && merged.taken.length;
    render();
    /* بعد render حتى لا تمحو رسالة النجاح: تبقى ظاهرة (أطول لو دُمجت تعديلات من جهاز آخر) */
    const note = "اننشر ✓" + (unsafe.size ? " (تعذّر ترحيل " + unsafe.size + " صورة)" : "")
      + (took ? " · دُمجت تعديلات من جهاز آخر: " + merged.taken.join("، ") : "");
    verifyLive(pubRes, files, note, unsafe.size || took ? "warn" : "ok").catch(() => { });
  } catch (e) {
    say("ما زبط النشر: " + e.message, "bad");
    $("pubBtn").disabled = false;
  }
}

/* ===== الربط ===== */
$("addBtn").addEventListener("click", () => openForm(null));
$("closeBtn").addEventListener("click", () => $("dlg").close());
$("cancelBtn").addEventListener("click", () => $("dlg").close());
$("saveBtn").addEventListener("click", save);
$("delBtn").addEventListener("click", removeIt);
/* أي رقم عربي يُكتب في هذه الحقول يتحوّل فوراً للاتيني ليراه صاحبه */
for (const id of ["f_land", "f_bua", "f_price", "f_code"]) {
  $(id).addEventListener("input", ev => {
    const el = ev.target, v = el.value;
    if (/[٠-٩۰-۹٫٬،]/.test(v)) { const pos = el.selectionStart; el.value = toLatinDigits(v); try { el.setSelectionRange(pos, pos); } catch (e) { } }
  });
}
$("f_price").addEventListener("input", updateTotal);
$("f_land").addEventListener("input", updateTotal);
$("q").addEventListener("input", e => { query = e.target.value; render(); });
$("filters").addEventListener("click", e => {
  const b = e.target.closest("button[data-f]"); if (!b) return;
  filter = b.dataset.f;
  for (const c of $("filters").querySelectorAll("button")) c.setAttribute("aria-pressed", String(c === b));
  render();
});
$("unitSeg").addEventListener("click", e => {
  const b = e.target.closest("button[data-u]"); if (!b) return;
  const m2 = inputToM2();
  unit = b.dataset.u;
  setSeg($("unitSeg"), unit, "u");
  $("landHint").textContent = unit === "dunam" ? "اكتب 5 يعني 5 دنم." : "اكتب المساحة بالمتر المربع.";
  $("f_land").value = landToInput(m2 || 0);
  updateTotal();
});
$("modeSeg").addEventListener("click", e => {
  const b = e.target.closest("button[data-m]"); if (!b) return;
  mode = b.dataset.m; setSeg($("modeSeg"), mode, "m"); updateTotal();
});
$("f_featIn").addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === "," || e.key === "،") {
    e.preventDefault();
    const v = e.target.value.trim();
    if (v && !feats.includes(v)) { feats.push(v); drawFeats(); }
    e.target.value = "";
  } else if (e.key === "Backspace" && !e.target.value && feats.length) { feats.pop(); drawFeats(); }
});
$("featBox").addEventListener("click", e => { if (e.target === e.currentTarget) $("f_featIn").focus(); });
for (const id of ["f_photos", "q_photos"]) {
  $(id).addEventListener("change", async e => {
    const files = [...e.target.files]; e.target.value = "";
    await addPhotos(files);
  });
}
/* --- الرابط الخاص للصور --- */
$("galClose").addEventListener("click", () => $("galDlg").close());
$("galDone").addEventListener("click", () => $("galDlg").close());
$("galCopy").addEventListener("click", async () => {
  const m = $("galMsg"); m.hidden = false; m.className = "upstat";
  try { await navigator.clipboard.writeText($("galLink").value); m.textContent = "انتسخ الرابط ✓"; }
  catch (e) { $("galLink").select(); m.textContent = "حدّد الرابط وانسخه يدوياً."; }
  setTimeout(() => { m.hidden = true; }, 3000);
});
/* معاينة: الصفحة تُنشأ على الموقع عند «نشر» فقط، فقبل النشر نعرضها من اللوحة نفسها */
$("galOpen").addEventListener("click", ev => {
  if (!galRow || !galReady(galRow)) return;
  const base = JSON.parse(BASE_ROWS).find(b => b.code === galRow.code);
  const live = base && base.galKey === galRow.galKey && base.galSecret === galRow.galSecret
    && (base.photos || []).length && JSON.stringify(base.photos) === JSON.stringify(galRow.photos || []);
  if (live) return;                       /* منشورة فعلاً: يفتح الرابط الحقيقي */
  ev.preventDefault();
  const m = $("galMsg"); m.hidden = false; m.className = "upstat";
  if (!(galRow.photos || []).length) { m.textContent = "ما في صور لهذا العقار — أضف صوراً أولاً ليصير للرابط صفحة."; return; }
  const w = window.open("", "_blank");
  m.textContent = "جارٍ تجهيز المعاينة…";
  Promise.all(galRow.photos.map(loadPhoto)).then(urls => {
    const html = galleryPage(galRow, urls.filter(Boolean));
    const u = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    if (w) w.location.href = u; else window.open(u, "_blank");
    m.textContent = "هذه معاينة من اللوحة — الرابط الحقيقي يشتغل بعد «نشر».";
  });
});
$("galNew").addEventListener("click", () => {
  if (!galRow) return;
  if (galReady(galRow) && !confirm("الرابط القديم رح يبطل فوراً وما حدا يقدر يفتحه. متأكد؟")) return;
  galRow.galKey = newKey();
  galRow.galSecret = newSecret();
  galRow.updatedAt = new Date().toISOString();
  openGallery(galRow);
  render();
  const m = $("galMsg"); m.hidden = false; m.className = "upstat";
  m.textContent = "انعمل الرابط — اضغط «نشر» ليصير شغّال.";
});

/* --- بطاقة المنشور --- */
$("postClose").addEventListener("click", () => $("postDlg").close());
$("postDone").addEventListener("click", () => $("postDlg").close());
$("postCopy").addEventListener("click", async () => {
  const m = $("postMsg"); m.hidden = false; m.className = "upstat";
  try { await navigator.clipboard.writeText($("postCap").value); m.textContent = "انتسخ النص ✓"; }
  catch (e) { $("postCap").select(); m.textContent = "حدّد النص وانسخه يدوياً."; }
  setTimeout(() => { m.hidden = true; }, 3000);
});

/* --- تمويه الصورة --- */
(function () {
  const cv = $("blurCv");
  const down = e => { if (!blurState) return; blurState.drawing = true; blurAt(e); e.preventDefault(); };
  const move = e => { if (blurState && blurState.drawing) { blurAt(e); e.preventDefault(); } };
  const up = () => { if (blurState) blurState.drawing = false; };
  cv.addEventListener("pointerdown", down);
  cv.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  cv.addEventListener("touchstart", down, { passive: false });
  cv.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", up);
})();
$("blurReset").addEventListener("click", () => {
  if (!blurState) return;
  blurState.ctx.drawImage(blurState.img, 0, 0);
  blurState.touched = false;
});
$("blurClose").addEventListener("click", () => $("blurDlg").close());
$("blurCancel").addEventListener("click", () => $("blurDlg").close());
$("blurApply").addEventListener("click", () => {
  const st = blurState;
  if (!st) return;
  if (!st.touched) { $("blurDlg").close(); return; }
  st.cv.toBlob(async b => {
    const buf = new Uint8Array(await b.arrayBuffer());
    newBlobs[st.path] = b64(buf);      /* نفس المسار: الصورة الجديدة تستبدل القديمة عند النشر */
    $("blurDlg").close();
    drawPhotos();
    render();
    const s2 = upStat();
    s2.hidden = false; s2.className = "upstat";
    s2.textContent = "انطبق التمويه — اضغط «نشر» ليتحفظ.";
    setTimeout(() => { s2.hidden = true; }, 4500);
  }, "image/jpeg", 0.82);
});
$("blurDlg").addEventListener("close", () => { blurState = null; });

$("qClose").addEventListener("click", () => $("photoDlg").close());
$("qDone").addEventListener("click", () => $("photoDlg").close());
$("photoDlg").addEventListener("close", () => { quickRow = null; });
$("pubBtn").addEventListener("click", publish);
$("dropBtn").addEventListener("click", async () => {
  if (!confirm("بدك تتراجع عن كل التعديلات اللي ما اننشرت؟")) return;
  await clearDraft();
  location.reload();
});
/* ===== النسخ السابقة: كل نشر يحفظ نسخة في المستودع الخاص، ومنها نرجع لأي حالة ===== */
const dayTxt = iso => new Date(iso).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" });
function diffText(cur, ver) {
  const C = new Map(cur.map(r => [r.code, r])), V = new Map(ver.map(r => [r.code, r]));
  const back = [...V.keys()].filter(c => !C.has(c)), gone = [...C.keys()].filter(c => !V.has(c));
  const chg = [...V.keys()].filter(c => C.has(c) && rowKey(C.get(c)) !== rowKey(V.get(c)));
  const list = a => a.slice(0, 4).join("، ") + (a.length > 4 ? ` و${a.length - 4} غيرها` : "");
  const parts = [];
  if (back.length) parts.push("يرجع: " + list(back));
  if (gone.length) parts.push("يُحذف: " + list(gone));
  if (chg.length) parts.push("يتغيّر: " + list(chg));
  return parts.join(" · ");
}
async function openVersions() {
  const box = $("verList");
  box.textContent = "جارٍ التحميل…";
  $("verDlg").showModal();
  try {
    const list = await gh(`/repos/${CFG.owner}/${CFG.priv}/commits?path=private.json&per_page=10`);
    const vs = (await pool(list || [], 4, async c => {
      const f = await readFile(CFG.priv, "private.json", c.sha);
      return f ? { sha: c.sha, date: c.commit.committer.date, rows: f.json } : null;
    })).filter(Boolean);
    const cur = JSON.parse(PRIV_BASE || "[]");
    box.textContent = "";
    let shown = 0;
    for (const v of vs) {
      const d = diffText(cur, v.rows);
      if (!d) continue;                       /* نفس الحالة الحالية: ما في شي نرجعه */
      shown++;
      const el = document.createElement("div"); el.className = "ver";
      const txt = document.createElement("div");
      const b = document.createElement("b"); b.textContent = dayTxt(v.date) + " · " + v.rows.length + " عقار";
      const sm = document.createElement("small"); sm.textContent = d;
      txt.appendChild(b); txt.appendChild(sm); el.appendChild(txt);
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn btn-ghost btn-sm"; btn.textContent = "استرجع هذه النسخة";
      btn.addEventListener("click", () => restoreVersion(v, d));
      el.appendChild(btn); box.appendChild(el);
    }
    if (!shown) box.textContent = "ما في نسخ سابقة مختلفة عن الحالية بعد.";
  } catch (e) { box.textContent = "ما قدرت أحمّل النسخ: " + e.message; }
}
async function restoreVersion(v, d) {
  if (isDirty() && !confirm("عندك تعديلات ما اننشرت وبتضيع لو رجّعت نسخة قديمة. متأكد؟")) return;
  if (!confirm("ترجّع نسخة " + dayTxt(v.date) + "؟\n" + d + "\n\nما بيتغيّر شي على الموقع قبل ما تضغط «نشر».")) return;
  try {
    /* صور تلك النسخة التي انحذفت من المستودع الخاص بعد نشرات لاحقة: نستعيدها من تاريخ النسخة نفسه */
    const now = (await repoTree(CFG.priv)).map;
    const need = [...new Set(v.rows.flatMap(r => r.photos || []))].filter(p => !now.has(p));
    const back = {}; let lost = 0;
    await pool(need, 4, async p => { const b = await ghRaw(CFG.priv, p, v.sha); if (b) back[p] = b64(b); else lost++; });
    for (const p in newBlobs) photoUrls.delete(p);
    newBlobs = back;
    ROWS = v.rows.map(r => Object.assign({}, r));
    $("verDlg").close();
    render();
    say("رجّعت نسخة " + dayTxt(v.date) + " — اضغط «نشر» لتطبيقها على الموقع." + (lost ? " (تعذّر استرجاع " + lost + " صورة)" : ""), "warn", true);
    setTimeout(() => { say("", ""); updateBar(); }, 15000);
  } catch (e) { alert("ما زبط الاسترجاع: " + e.message); }
}
$("f_area").addEventListener("change", () => {
  $("newAreaBox").hidden = $("f_area").value !== NEW_AREA;
  if (!$("newAreaBox").hidden) $("f_area_new").focus();
});
$("f_area_new").addEventListener("input", () => {
  if ($("f_area_slug").dataset.touched) return;       /* لو عدّلت الرابط بيدك ما نلمسه */
  const name = normArea($("f_area_new").value), ex = AREA_ORDER.find(a => normArea(a) === name);
  $("f_area_slug").value = name && !ex ? uniqueSlug(KNOWN_SLUGS[name] || translit(name), name) : "";
});
$("f_area_slug").addEventListener("input", () => { $("f_area_slug").dataset.touched = "1"; });
$("f_status").addEventListener("change", () => {
  const sold = $("f_status").value === "مباع";
  $("soldBox").hidden = !sold;
  if (sold && !$("f_sold").value) $("f_sold").value = today();
});
$("verBtn").addEventListener("click", openVersions);
$("chkBtn").addEventListener("click", () => { $("chkDlg").showModal(); runChecks(); });
$("chkAgain").addEventListener("click", runChecks);
$("chkClose").addEventListener("click", () => $("chkDlg").close());
$("chkDone").addEventListener("click", () => $("chkDlg").close());
$("verClose").addEventListener("click", () => $("verDlg").close());
$("verDone").addEventListener("click", () => $("verDlg").close());
$("outBtn").addEventListener("click", () => {
  if (isDirty() && !confirm("عندك تعديلات ما اننشرت. بدك تفتح الإعدادات وتخسرها؟")) return;
  openSetup();
});
window.addEventListener("beforeunload", e => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

/* ===== الإقلاع ===== */
$("s_go").addEventListener("click", async () => {
  const cfg = {
    token: $("s_token").value.trim(),
    owner: $("s_owner").value.trim(),
    pub: $("s_pub").value.trim(),
    priv: $("s_priv").value.trim()
  };
  if (!cfg.token || !cfg.owner || !cfg.pub || !cfg.priv) {
    $("s_err").textContent = "عبّي كل الحقول."; $("s_err").hidden = false; return;
  }
  $("s_err").hidden = true;
  CFG = cfg;
  try {
    for (const r of [cfg.pub, cfg.priv]) {
      const info = await gh(`/repos/${cfg.owner}/${r}`);
      if (!info) throw new Error(`ما لقيت المستودع ${r} — تأكد من الاسم ومن أن المفتاح بيوصله.`);
      if (!info.permissions || !info.permissions.push) throw new Error(`المفتاح ما عنده صلاحية كتابة على ${r}.`);
    }
    try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { }
    $("setup").hidden = true;
    boot();
  } catch (e) {
    CFG = null;
    $("s_err").textContent = e.message; $("s_err").hidden = false;
  }
});

async function boot() {
  $("loading").hidden = false;
  $("app").hidden = true;
  try {
    const pf = await readFile(CFG.priv, "private.json");
    PRIV_SHA = pf ? pf.sha : null;
    let rows = pf ? pf.json : null;
    if (!rows) {
      const pub = await readJson(CFG.pub, "data.json");
      rows = pub ? pub.map(p => ({
        code: p.code, status: "متاح", cat: CAT_AR[p.cat] || "أرض", title: p.title, area: p.area,
        area_m2: p.area_m2, bua: p.bua, mode: p.mode === "dunam" ? "للدنم" : "مقطوع",
        price: p.price, nego: !!p.nego, confirmed: !p.unconfirmed, papers: p.papers || "",
        feats: p.feats || [], photos: p.photos || [], note: p.note || "",
        src_place: "", src_by: "", commission: "", src_notes: ""
      })) : [];
    }
    ROWS = rows;
    BASE_ROWS = snapshot();
    PRIV_BASE = BASE_ROWS;      /* الحالة التي يطابقها sha الملف الخاص: أساس الدمج */

    /* مسودّة محفوظة من جلسة سابقة */
    let restoreNote = "";
    try {
      const d = JSON.parse(localStorage.getItem(LS_DRAFT) || "null");
      if (d && d.rows && JSON.stringify(d.rows) !== BASE_ROWS) {
        if (confirm("عندك تعديلات ما اننشرت من آخر مرة. بدك ترجّعها؟")) {
          ROWS = d.rows; newBlobs = d.blobs || {};
          if (d.idb) { try { newBlobs = await idbLoadAll(); } catch (e) { newBlobs = {}; } }
          for (const k in newBlobs) idbMirror.set(k, newBlobs[k]);
          /* صور أُضيفت ولم تُنشر ولم نجد بياناتها: نشيلها من العقار بدل ما تبقى مسارات فارغة */
          const known = new Set(JSON.parse(BASE_ROWS).flatMap(r => r.photos || []));
          let lost = 0;
          for (const r of ROWS) r.photos = (r.photos || []).filter(p => { const ok = known.has(p) || newBlobs[p]; if (!ok) lost++; return ok; });
          if (lost) restoreNote = "رجّعت مسودتك، لكن تعذّر استرجاع " + lost + " صورة (أضفها من جديد).";
        } else await clearDraft();
      }
    } catch (e) { }

    $("loading").hidden = true;
    $("app").hidden = false;
    render();
    if (restoreNote) { say(restoreNote, "warn", true); setTimeout(() => { say("", ""); updateBar(); }, 12000); }
  } catch (e) {
    /* غالباً تغيّر اسم الحساب أو المستودع — نفتح الإعدادات والمفتاح محفوظ */
    openSetup("ما قدرت أوصل لمستودعاتك: " + e.message + " — دقّق الأسماء تحت واضغط «اتصل».");
  }
}

/** يفتح شاشة الإعداد وفيها ما هو محفوظ (المفتاح يبقى) — لتعديل الأسماء بلا إعادة إدخاله */
function openSetup(msg) {
  const c = CFG || {};
  $("s_token").value = c.token || "";
  if (c.owner) $("s_owner").value = c.owner;
  if (c.pub) $("s_pub").value = c.pub;
  if (c.priv) $("s_priv").value = c.priv;
  if (msg) { $("s_err").textContent = msg; $("s_err").hidden = false; }
  $("loading").hidden = true;
  $("app").hidden = true;
  $("setup").hidden = false;
}

(function start() {
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) { }
  if (!cfg || !cfg.token) { $("loading").hidden = true; $("setup").hidden = false; return; }

  /* تحديث تلقائي للاسم القديم بعد تغيير اسم الحساب على GitHub */
  const OLD = "mka121", NEW = "aqarat-yaafour";
  let moved = false;
  for (const k of ["owner", "pub", "priv"]) {
    if (typeof cfg[k] === "string" && cfg[k].indexOf(OLD) >= 0) {
      cfg[k] = cfg[k].split(OLD).join(NEW);
      moved = true;
    }
  }
  if (moved) { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) { } }

  CFG = cfg;
  boot();
})();
