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
const CAT_EN = { "أرض": "land", "فيلا": "villa", "مزرعة": "farm", "شقة": "apt" };
const CAT_AR = { land: "أرض", villa: "فيلا", farm: "مزرعة", apt: "شقة" };
const CATS = ["أرض", "فيلا", "مزرعة", "شقة"];

let CFG = null, ROWS = [], BASE_ROWS = "", editing = null, quickRow = null;
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

/* ===== GitHub ===== */
async function gh(path, opts) {
  const r = await fetch("https://api.github.com" + path, Object.assign({
    headers: {
      Authorization: "Bearer " + CFG.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  }, opts || {}));
  if (r.status === 404) return null;
  if (!r.ok) {
    let m = r.status + "";
    try { m = (await r.json()).message || m; } catch (e) { }
    if (r.status === 401) m = "المفتاح غير صالح أو انتهت صلاحيته.";
    if (r.status === 403) m = "المفتاح ما عنده صلاحية الكتابة على هالمستودع.";
    throw new Error(m);
  }
  return r.status === 204 ? true : r.json();
}
const ghPost = (p, body) => gh(p, { method: "POST", body: JSON.stringify(body) });

async function readJson(repo, file) {
  const res = await gh(`/repos/${CFG.owner}/${repo}/contents/${file}`);
  if (!res) return null;
  const txt = new TextDecoder().decode(Uint8Array.from(atob(res.content.replace(/\n/g, "")), c => c.charCodeAt(0)));
  return JSON.parse(txt);
}

/** كل مسارات الملفات الموجودة حالياً في المستودع */
async function repoPaths(repo) {
  const o = CFG.owner;
  const ref = await gh(`/repos/${o}/${repo}/git/ref/heads/main`);
  if (!ref) return [];
  const t = await gh(`/repos/${o}/${repo}/git/trees/${ref.object.sha}?recursive=1`);
  return (t && t.tree || []).filter(e => e.type === "blob").map(e => e.path);
}

/** commit واحد يحمل كل الملفات. files: [{path, content|b64}] ، deletes: [مسار] */
async function commit(repo, files, message, deletes) {
  const o = CFG.owner;
  const ref = await gh(`/repos/${o}/${repo}/git/ref/heads/main`);
  if (!ref) throw new Error(`ما لقيت فرع main في ${repo}. تأكد أن المستودع فيه ملف واحد على الأقل.`);
  const head = ref.object.sha;
  const base = (await gh(`/repos/${o}/${repo}/git/commits/${head}`)).tree.sha;

  const tree = [];
  for (const f of files) {
    const blob = await ghPost(`/repos/${o}/${repo}/git/blobs`,
      f.b64 ? { content: f.b64, encoding: "base64" } : { content: f.content, encoding: "utf-8" });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  /* sha: null يحذف الملف من الشجرة */
  for (const p of (deletes || [])) tree.push({ path: p, mode: "100644", type: "blob", sha: null });

  const newTree = await ghPost(`/repos/${o}/${repo}/git/trees`, { base_tree: base, tree });
  const c = await ghPost(`/repos/${o}/${repo}/git/commits`, { message, tree: newTree.sha, parents: [head] });
  await gh(`/repos/${o}/${repo}/git/refs/heads/main`, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
  return c.sha;
}

/* ===== مولّد الموقع (منقول حرفياً عن build_site.py) ===== */
/* صورة المعاينة عند مشاركة الرابط على واتساب وفيسبوك */
function ogImage(x) {
  return BASE + "/img/mohammad-khaled.jpg";
}
function headHtml(title, desc, canonical, jsonld, extra, image) {
  const up = canonical.indexOf("/listing/") >= 0 ? "../" : "";
  const og = image || ogImage(null);
  return `<!doctype html>
<html lang="ar" dir="rtl">
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
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${og}">
<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">
<link rel="icon" href="${BASE}/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="${BASE}/apple-touch-icon.png">
<link rel="manifest" href="${BASE}/site.webmanifest">
<meta name="theme-color" content="#0B0B0C">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Tajawal:wght@400;500;700;800&display=swap">
<link rel="stylesheet" href="${up}style.css">
<script type="application/ld+json">${JSON.stringify(jsonld)}<\/script>
${extra || ""}
</head>
<body>
`;
}
const NAV = up => `<header class="topbar">
  <a class="brand" href="${up}index.html"><img src="${up}img/mohammad-khaled.jpg" width="44" height="44" alt="${NAME}"><span><b>${NAME}</b><small>${ROLE}</small></span></a>
  <nav><a href="${up}index.html">العقارات</a><a href="${up}index.html#about">من أنا</a><a class="wa" href="${wa("مرحباً أستاذ محمد، أرغب بالاستفسار عن عقار.")}" target="_blank" rel="noopener">واتساب</a></nav>
</header>
`;
const FOOT = () => `<footer class="site">
  <div><b>${NAME}</b> · ${ROLE} · يعفور وقرى الشام، ريف دمشق</div>
  <div>واتساب: <a href="tel:+${PHONE_INTL}" dir="ltr">${PHONE_LOCAL}</a></div>
  <div class="fine">الأسعار والتوفر قابلة للتغيير. الأوراق تُعرض كاملة قبل أي عربون.</div>
</footer>
</body></html>
`;
/* الموقع العام لا يعرض صور العقارات إطلاقاً (حماية من كشف الموقع).
   تُرسل الصور برابط خاص للمشتري الجدّي — انظر مكتبة الصور أدناه. */
function mediaHtml(x, up, big) {
  const [n, u] = sizeOf(x);
  const note = big ? '<span class="soon">الصور تُرسل عند التواصل</span>' : "";
  return `<div class="media${big ? " big" : ""}"><span class="num">${n}</span><span class="unit">${u}</span>${note}</div>`;
}
function cardHtml(x, up) {
  up = up || "";
  const [main, unit2, total] = priceTxt(x);
  return `<article class="card glass" data-cat="${CAT_EN[x.cat]}" data-area="${esc(x.area)}" data-total="${total ? Math.round(total) : 0}">
  <a class="cardlink" href="${up}listing/${x.code}.html">
    <div class="shot">${mediaHtml(x, up, false)}<span class="badge">للبيع</span><span class="code">${x.code}</span></div>
    <div class="body">
      <h3>${esc(x.title)}</h3>
      <p class="where"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS.pin}</svg>${esc(x.area)} · ريف دمشق</p>
      <div class="specrow">${specRow(x)}</div>
      <div class="pricebar"><span class="main">${main}</span>${unit2 ? `<span class="u">${unit2}</span>` : ""}<span class="ar">←</span></div>
    </div>
  </a>
</article>`;
}
function listingPage(x, live) {
  const [n, u] = sizeOf(x), [main, unit2, total] = priceTxt(x);
  const title = `${x.cat} للبيع في ${x.area} - ${n} ${u} | ${NAME} مستشار عقاري`;
  const desc = `${x.title} في ${x.area}، مساحة ${n} ${u}. ${main}${unit2 ? " " + unit2 : ""}. كود ${x.code}. للاستفسار والمعاينة مع ${NAME}، مستشار عقاري في يعفور وقرى الشام: ${PHONE_LOCAL}.`;
  const canonical = `${BASE}/listing/${x.code}.html`;
  const offer = { "@type": "Offer", priceCurrency: "USD", availability: "https://schema.org/InStock" };
  if (total) offer.price = Math.round(total);
  const jsonld = {
    "@context": "https://schema.org", "@type": "RealEstateListing", name: x.title, url: canonical,
    description: desc, datePosted: today(),
    about: {
      "@type": "Place", name: `${x.cat} في ${x.area}`,
      address: { "@type": "PostalAddress", addressLocality: x.area, addressRegion: "ريف دمشق", addressCountry: "SY" }
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
  const rel = live.filter(y => y.cat === x.cat && y.code !== x.code).slice(0, 3);
  const body = `${NAV("../")}
<main class="wrap">
  <nav class="crumbs"><a href="../index.html">العقارات</a> <span>›</span> <a href="../${areaPage}">عقارات ${esc(x.area)}</a> <span>›</span> ${esc(x.title)}</nav>
  <article class="detail glass">
    <div class="top"><span class="badge">للبيع · ${x.cat}</span><span class="code">${x.code}</span></div>
    <h1>${esc(x.title)} في ${esc(x.area)}</h1>
    ${mediaHtml(x, "../", true)}
    <div class="price big"><span class="main">${main}</span>${unit2 ? `<span class="u">${unit2}</span>` : ""}${x.nego ? ' <span class="nego">قابل للتفاوض</span>' : ""}</div>
    <table class="specs">
      <tr><th>النوع</th><td>${x.cat}</td></tr>
      <tr><th>المنطقة</th><td>${esc(x.area)} · ريف دمشق</td></tr>
      <tr><th>المساحة</th><td>${n} ${u}</td></tr>
      ${x.bua ? `<tr><th>مساحة البناء</th><td>${x.bua} م²</td></tr>` : ""}
      ${x.papers ? `<tr><th>نوع الأوراق</th><td>${esc(x.papers)}</td></tr>` : ""}
      <tr><th>كود العقار</th><td dir="ltr">${x.code}</td></tr>
    </table>
    ${(x.feats || []).length ? `<ul class="feats big">${x.feats.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    ${x.note ? `<p class="note">ملاحظة: ${esc(x.note)}</p>` : ""}
    <p class="lead">للمعاينة أو لطلب صور وأوراق هذا العقار، تواصل مع ${NAME}، ${ROLE} في يعفور وقرى الشام، واذكر الكود ${x.code}.</p>
    <div class="actions">
      <a class="btn btn-primary" target="_blank" rel="noopener" href="${wa(`مرحباً أستاذ محمد، أستفسر عن العقار ${x.code} (${x.title} - ${x.area}).`)}">استفسر على واتساب</a>
      <a class="btn btn-ghost" href="tel:+${PHONE_INTL}" dir="ltr">${PHONE_LOCAL}</a>
      ${shareHtml(x)}
    </div>
  </article>
  ${rel.length ? `<section class="related"><h2>عقارات مشابهة</h2><div class="grid">${rel.map(y => cardHtml(y, "../")).join("")}</div></section>` : ""}
</main>
${FOOT()}
<script>${SHARE_JS}<\/script>`;
  return headHtml(title, desc, canonical, jsonld, extra, ogImage(x)) + body;
}
const AREA_ORDER = ["يعفور", "قرى الشام", "الصبورة"];   /* مناطق العقارات المسموحة */
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
  return WHY.map(([key, h, t]) =>
    `<div class="why-card glass">` +
    `<span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICONS[key]}</svg></span>` +
    `<h3>${h}</h3><p>${t}</p></div>`).join("");
}

/* العقار المميّز: الأغلى إجمالاً (نفس ترتيب build_site.py) */
function featured(live) {
  const ok = live.filter(x => totalOf(x) > 0 && x.confirmed !== false);
  if (!ok.length) return live[0] || null;
  return ok.slice().sort((a, b) => (totalOf(b) - totalOf(a)) || a.code.localeCompare(b.code))[0];
}
function heroStyle(live) {
  return "";
}
function specRow(x) {
  const [n, u] = sizeOf(x);
  const items = [["area", u ? n + " " + u : String(n)], ["type", x.cat]];
  if (x.papers) items.push(["doc", x.papers]);
  else if (x.bua) items.push(["build", x.bua + " م² بناء"]);
  return items.map(([k, v]) =>
    `<span><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[k]}</svg>${esc(v)}</span>`).join("");
}
function featureHtml(live) {
  const x = featured(live);
  if (!x) return "";
  const [main, unit2] = priceTxt(x);
  return `<aside class="feature glass">
      <p class="tag">عقار مميّز</p>
      <h2>${esc(x.title)}</h2>
      <p class="where"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS.pin}</svg>${esc(x.area)} · ريف دمشق</p>
      <div class="specrow">${specRow(x)}</div>
      <div class="fprice"><span class="main">${main}</span>${unit2 ? `<span class="u">${unit2}</span>` : ""}</div>
      <a class="flink" href="listing/${x.code}.html">تفاصيل العقار <span class="ar">←</span></a>
    </aside>`;
}
/* نص السكربت مطابق حرفياً لـSEARCH_JS في build_site.py */
const SEARCH_JS = `
(function(){
  var g=document.getElementById('listings-grid');
  if(!g) return;
  var cards=Array.prototype.slice.call(g.querySelectorAll('.card'));
  var fa=document.getElementById('fArea'),fc=document.getElementById('fCat'),
      fb=document.getElementById('fBudget'),cnt=document.getElementById('rcount'),
      none=document.getElementById('rnone');
  function apply(){
    var a=fa.value,c=fc.value,b=fb.value,lo=0,hi=Infinity,n=0;
    if(b){var p=b.split('-');lo=+p[0];hi=p[1]?+p[1]:Infinity;}
    cards.forEach(function(el){
      var ok=(!a||el.getAttribute('data-area')===a)&&(!c||el.getAttribute('data-cat')===c);
      if(ok&&b){var t=+el.getAttribute('data-total');ok=t>0&&t>=lo&&t<hi;}
      el.hidden=!ok; if(ok)n++;
    });
    cnt.textContent=n===cards.length?(n+' عقار متاح'):(n+' من '+cards.length+' عقار');
    none.hidden=n>0;
  }
  [fa,fc,fb].forEach(function(s){s.addEventListener('change',apply);});
  document.getElementById('fGo').addEventListener('click',function(){
    apply();
    document.getElementById('listings').scrollIntoView({behavior:'smooth',block:'start'});
  });
  apply();
})();
`;
function searchHtml(live) {
  const optsArea = AREA_ORDER.filter(a => live.some(x => x.area === a))
    .map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  const optsCat = ["land", "villa", "farm", "apt"].map(k => `<option value="${k}">${CAT_AR[k]}</option>`).join("");
  const budgets = [["", "كل الميزانيات"], ["0-500000", "حتى 500 ألف $"],
    ["500000-1000000", "500 ألف — مليون $"], ["1000000-3000000", "1 — 3 مليون $"],
    ["3000000-", "أكثر من 3 مليون $"]];
  const optsB = budgets.map(([v, t]) => `<option value="${v}">${t}</option>`).join("");
  return `<form class="search glass" role="search" onsubmit="return false">
    <div class="sf"><label for="fArea">المنطقة</label>
      <select id="fArea"><option value="">كل المناطق</option>${optsArea}</select></div>
    <div class="sf"><label for="fCat">نوع العقار</label>
      <select id="fCat"><option value="">كل الأنواع</option>${optsCat}</select></div>
    <div class="sf"><label for="fBudget">الميزانية</label>
      <select id="fBudget">${optsB}</select></div>
    <button class="btn btn-primary" type="button" id="fGo">بحث</button>
  </form>`;
}

/* ===== زر المشاركة (مطابق لـ SHARE_JS / share_html في build_site.py) ===== */
const SHARE_JS = `
(function(){
  var b=document.getElementById('shareBtn'); if(!b) return;
  var txt=b.getAttribute('data-txt'), url=location.href;
  b.addEventListener('click',function(){
    if(navigator.share){
      navigator.share({title:document.title,text:txt,url:url}).catch(function(){});
      return;
    }
    window.open('https://wa.me/?text='+encodeURIComponent(txt+'\\n'+url),'_blank','noopener');
  });
})();
`;
function shareHtml(x) {
  const [n, u] = sizeOf(x), [main, unit2] = priceTxt(x);
  const txt = `${x.title} في ${x.area}\n${n} ${u} · ${main}${unit2 ? " " + unit2 : ""}\nكود ${x.code}`;
  return `<button class="btn btn-ghost" type="button" id="shareBtn" `
    + `data-txt="${esc(txt)}">شارك العقار</button>`;
}

/* ===== نموذج «دوّرلي على عقار» ===== */
const REQUEST_JS = `
(function(){
  var f=document.getElementById('reqForm'); if(!f) return;
  var go=document.getElementById('reqGo');
  function val(id){var e=document.getElementById(id);return e.value;}
  go.addEventListener('click',function(){
    var lines=['مرحباً أستاذ محمد، بدوّر على عقار:'];
    var map=[['reqCat','النوع'],['reqArea','المنطقة'],['reqSize','المساحة'],['reqBudget','الميزانية']];
    for(var i=0;i<map.length;i++){
      var v=val(map[i][0]);
      if(v) lines.push('▪️ '+map[i][1]+': '+v);
    }
    var note=val('reqNote').trim();
    if(note) lines.push('▪️ ملاحظة: '+note);
    window.open('https://wa.me/963996606813?text='+encodeURIComponent(lines.join('\\n')),'_blank','noopener');
  });
})();
`;
function requestHtml() {
  const cats = ["أرض", "فيلا", "مزرعة", "شقة"].map(v => `<option value="${v}">${v}</option>`).join("");
  const areas = AREA_ORDER.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
  const sizes = ["حتى دنم", "1 — 5 دنم", "5 — 10 دنم", "أكثر من 10 دنم"];
  const optsSize = sizes.map(v => `<option value="${v}">${v}</option>`).join("");
  const budgets = ["حتى 500 ألف $", "500 ألف — مليون $", "1 — 3 مليون $", "أكثر من 3 مليون $"];
  const optsB = budgets.map(v => `<option value="${v}">${v}</option>`).join("");
  return `<section class="request glass" id="request">
    <div>
      <p class="eyebrow">ما لقيت طلبك؟</p>
      <h2>دوّرلي على عقار</h2>
      <p class="lead">حدّد اللي بتدوّر عليه وابعتلي — وإذا إجاني عقار يناسبك بخبّرك أول واحد.</p>
    </div>
    <form id="reqForm" onsubmit="return false">
      <div class="fields">
        <div class="sf"><label for="reqCat">النوع</label>
          <select id="reqCat"><option value="">أي نوع</option>${cats}</select></div>
        <div class="sf"><label for="reqArea">المنطقة</label>
          <select id="reqArea"><option value="">أي منطقة</option>${areas}</select></div>
        <div class="sf"><label for="reqSize">المساحة</label>
          <select id="reqSize"><option value="">أي مساحة</option>${optsSize}</select></div>
        <div class="sf"><label for="reqBudget">الميزانية</label>
          <select id="reqBudget"><option value="">أي ميزانية</option>${optsB}</select></div>
        <div class="sf wide"><label for="reqNote">ملاحظة (اختياري)</label>
          <input type="text" id="reqNote" placeholder="مثلاً: قريبة من الأوتوستراد، أو فيها بئر ماء"></div>
      </div>
      <button class="btn btn-primary" type="button" id="reqGo">ابعت الطلب على واتساب <span class="ar">←</span></button>
    </form>
  </section>`;
}

/* ===== صفحات التصفّح (مطابقة لـ collections_all في build_site.py) ===== */
const AREA_SLUG = { "يعفور": "yaafour", "قرى الشام": "qura-alsham", "الصبورة": "sabboura" };
const CAT_SLUG = { land: "land", villa: "villas", farm: "farms", apt: "apartments" };
const CAT_PL = { land: "أراضٍ", villa: "فلل", farm: "مزارع", apt: "شقق" };
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
    for (const c of ["land", "villa", "farm", "apt"]) {
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
  const totals = items.map(totalOf).filter(t => t > 0).sort((a, b) => a - b);
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
      address: { "@type": "PostalAddress", addressLocality: c.area, addressRegion: "ريف دمشق", addressCountry: "SY" }
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
  const body = `${NAV("")}
<main class="wrap">
  <nav class="crumbs"><a href="index.html">العقارات</a> <span>›</span> ${esc(c.crumb)}</nav>
  <div class="sechead">
    <div>
      <p class="eyebrow">${esc(c.area)} · ريف دمشق</p>
      <h1>${esc(c.h1)}</h1>
    </div>
    <div class="side"><p class="rcount">${nProp(items.length)}</p></div>
  </div>
  <p class="lead">${esc(desc)}</p>
  <div class="grid">${items.map(x => cardHtml(x, "")).join("")}</div>
  ${collectionLinks(cols, c.slug)}
  <div class="actions" style="margin-top:var(--s5)">
    <a class="btn btn-primary" target="_blank" rel="noopener" href="${wa(`مرحباً أستاذ محمد، بدوّر على ${c.h1}.`)}">استفسر على واتساب <span class="ar">←</span></a>
    <a class="btn btn-ghost" href="index.html">كل العقارات</a>
  </div>
</main>
${FOOT()}`;
  return headHtml(c.title, desc, canonical, jsonld, extra) + body;
}

function indexPage(live) {
  const title = "عقارات يعفور وقرى الشام والصبورة | أراضٍ وفلل ومزارع للبيع - محمد خالد";
  const desc = `أراضٍ وفلل ومزارع وشقق للبيع في يعفور وقرى الشام والصبورة بريف دمشق. ${live.length} عقاراً متاحاً مع ${NAME}، ${ROLE} — مرافقة من المعاينة حتى التسجيل. واتساب ${PHONE_LOCAL}.`;
  const jsonld = {
    "@context": "https://schema.org", "@type": "RealEstateAgent", name: NAME, jobTitle: ROLE,
    url: BASE + "/", telephone: "+" + PHONE_INTL, image: BASE + "/img/mohammad-khaled.jpg", description: desc,
    areaServed: AREAS.map(a => ({ "@type": "Place", name: a })),
    address: { "@type": "PostalAddress", addressLocality: "يعفور", addressRegion: "ريف دمشق", addressCountry: "SY" },
    knowsLanguage: ["ar"],
    makesOffer: ["بيع وشراء الأراضي", "بيع الفلل والمزارع", "الاستشارات العقارية", "متابعة الأوراق والتسجيل العقاري", "الإشراف على البناء والإكساء"]
      .map(s => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s } }))
  };
  const stats = ["land", "villa", "farm", "apt"]
    .map(en => [en, live.filter(x => CAT_EN[x.cat] === en).length])
    .filter(([, v]) => v)
    .map(([en, v]) => `${v} ${CAT_AR[en]}`)
    .join(" · ");
  const body = `${NAV("")}
<section class="hero">
  <div class="hero-bg"${heroStyle(live)}></div>
  <div class="hero-inner">
    <div class="hero-txt">
      <p class="eyebrow">يعفور · قرى الشام · الصبورة</p>
      <h1>عقارات يعفور<br><span class="g">وقرى الشام</span></h1>
      <p class="lead">أراضٍ وفلل ومزارع وشقق للبيع، معاينة على الأرض.<br>مرافقة من المعاينة حتى التسجيل.</p>
      <div class="actions">
        <a class="btn btn-primary" target="_blank" rel="noopener" href="${wa("مرحباً أستاذ محمد، أرغب بالاستفسار عن العقارات المتوفرة لديك.")}">تواصل على واتساب <span class="ar">←</span></a>
        <a class="btn btn-ghost" href="#listings">تصفّح العقارات</a>
      </div>
      <div class="who">
        <img class="avatar" src="img/mohammad-khaled.jpg" width="128" height="128" alt="${NAME} مستشار عقاري في يعفور وقرى الشام">
        <div><b>${NAME}</b><small>${ROLE} · يعفور وقرى الشام</small></div>
      </div>
    </div>
    ${featureHtml(live)}
  </div>
</section>
<div class="wrap">${searchHtml(live)}</div>
<main class="wrap">
  <div class="sechead">
    <div>
      <p class="eyebrow">العقارات المتاحة</p>
      <h2 id="listings">أراضٍ وفلل ومزارع<br><span class="g">للبيع في يعفور وقرى الشام</span></h2>
    </div>
    <div class="side">
      <p class="rcount" id="rcount">${live.length} عقار متاح</p>
      <p class="statline">${stats}</p>
    </div>
  </div>
  <div class="grid" id="listings-grid">${live.map(x => cardHtml(x, "")).join("")}</div>
  <p class="rnone" id="rnone" hidden>ما في عقار مطابق لهالبحث. جرّب توسّع الميزانية، أو <a href="#request">ابعتلي طلبك</a> وبدوّرلك.</p>
  ${collectionLinks(collectionsAll(live))}
  ${requestHtml()}
  <section class="why">
    <div class="why-grid">${whyHtml()}</div>
  </section>
  <section id="about" class="about glass">
    <h2>من أنا</h2>
    <p>أنا ${NAME}، ${ROLE} أعمل في يعفور وقرى الشام والصبورة بريف دمشق. أساعد المشترين، ومنهم المغتربون الذين لا يستطيعون الحضور، على اختيار الأرض أو الفيلا المناسبة، والتحقق من الأوراق، ومتابعة الإجراءات حتى التسجيل. وإلى جانب الوساطة العقارية أتابع أعمال البناء والإكساء، فأستطيع تقدير كلفة البناء أو الإكساء قبل الشراء.</p>
    <h2>أسئلة متكررة</h2>
    <dl class="faq">
      <dt>في أي مناطق تعمل؟</dt><dd>يعفور وقرى الشام والصبورة وما حولها في ريف دمشق.</dd>
      <dt>هل عندك عقارات في الصبورة؟</dt><dd>الصبورة من مناطق عملي. المعروض على الموقع اليوم في يعفور وقرى الشام الملاصقتين لها — تواصل معي وبشوفلك المتوفر بالصبورة.</dd>
      <dt>شو المتوفر عندك؟</dt><dd>أراضٍ زراعية وسكنية ومرخّصة، وفلل ومزارع وشقق، بمساحات من دنم حتى 100 دنم.</dd>
      <dt>هل أستطيع الشراء وأنا خارج سوريا؟</dt><dd>نعم. أرسل لك صور العقار وأوراقه، وأرافق الإجراءات حتى التسجيل حسب ما يسمح به القانون ووكالتك.</dd>
      <dt>كيف أستفسر عن عقار؟</dt><dd>افتح صفحة العقار وأرسل رسالة واتساب فيها كود العقار، مثل MK-012.</dd>
    </dl>
  </section>
</main>
${FOOT()}
<script>${SEARCH_JS}${REQUEST_JS}<\/script>`;
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
      { "@type": "Question", name: "في أي مناطق يعمل محمد خالد؟", acceptedAnswer: { "@type": "Answer", text: "يعفور وقرى الشام والصبورة وما حولها في ريف دمشق." } },
      { "@type": "Question", name: "هل توجد عقارات في الصبورة؟", acceptedAnswer: { "@type": "Answer", text: "الصبورة من مناطق العمل. المعروض حالياً في يعفور وقرى الشام الملاصقتين لها في ريف دمشق." } },
      { "@type": "Question", name: "ما العقارات المتوفرة في يعفور وقرى الشام؟", acceptedAnswer: { "@type": "Answer", text: "أراضٍ زراعية وسكنية ومرخّصة، وفلل ومزارع وشقق، بمساحات من دنم حتى 100 دنم." } },
      { "@type": "Question", name: "هل يمكن الشراء من خارج سوريا؟", acceptedAnswer: { "@type": "Answer", text: "نعم، مع إرسال صور العقار وأوراقه ومرافقة الإجراءات حتى التسجيل حسب القانون والوكالة." } }]
  };
  return headHtml(title, desc, BASE + "/", jsonld,
    `<script type="application/ld+json">${JSON.stringify(faq)}<\/script>`) + body;
}
function sitemapXml(live) {
  const urls = [[BASE + "/", "1.0"]]
    .concat(collectionsAll(live).map(c => [`${BASE}/${c.slug}`, "0.9"]))
    .concat(live.map(x => [`${BASE}/listing/${x.code}.html`, "0.8"]));
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(([u, p]) => `  <url><loc>${u}</loc><lastmod>${today()}</lastmod><priority>${p}</priority></url>\n`).join("")
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
      papers: x.papers || "", photos: []
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
  ctx.fillStyle = `rgba(28,24,14,${.35 + strength * .4})`; rrect(ctx, x, y, w, h, r); ctx.fill();
  ctx.restore();
  ctx.fillStyle = `rgba(212,175,55,${strength * .55})`; rrect(ctx, x, y, w, h, r); ctx.fill();
  const sheen = ctx.createLinearGradient(x, y, x, y + h);
  sheen.addColorStop(0, "rgba(252,246,186,.16)"); sheen.addColorStop(.4, "rgba(252,246,186,0)");
  ctx.fillStyle = sheen; rrect(ctx, x, y, w, h, r); ctx.fill();
  ctx.strokeStyle = "rgba(252,246,186,.42)"; ctx.lineWidth = 2.5; rrect(ctx, x, y, w, h, r); ctx.stroke();
}
function metalGrad(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  [[0, "#AA771C"], [.18, "#D4AF37"], [.38, "#FCF6BA"], [.55, "#C9A13B"], [.72, "#F5E7A1"], [1, "#B38728"]]
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
  const tags = { land: "#أراضي_للبيع", villa: "#فلل_للبيع", farm: "#مزارع_للبيع", apt: "#شقق_للبيع" };
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
    await Promise.all(['700 84px "Amiri"', '800 40px "Tajawal"', '700 34px "Tajawal"', '500 32px "Tajawal"']
      .map(f => document.fonts.load(f)));
  } catch (e) { }
  const av = await loadAvatar();
  const c = $("cardCv"), ctx = c.getContext("2d"), W = 1080, H = 1080;
  const INK = "#F3EDE1", INK2 = "#CFC3A3", GOLD = "#D4AF37", GOLD_L = "#F5D77A", BLACK = "#0B0B0C";
  const [n, u] = sizeOf(x), [main, unit2] = priceTxt(x);
  const ask = x.confirmed === false;

  ctx.fillStyle = BLACK; ctx.fillRect(0, 0, W, H);
  glowBlob(ctx, 930, 120, 560, "#D4AF37", .7);
  glowBlob(ctx, 120, 980, 560, "#B38728", .6);
  glowBlob(ctx, 420, 520, 300, "#FCF6BA", .14);

  ctx.direction = "rtl"; ctx.textAlign = "center";
  ctx.font = '800 32px "Tajawal"';
  const pillTxt = `للبيع · ${x.cat}`, pillW = ctx.measureText(pillTxt).width + 64;
  glassPanel(ctx, W - 48 - pillW, 44, pillW, 68, 34, .42);
  ctx.fillStyle = GOLD_L; ctx.fillText(pillTxt, W - 48 - pillW / 2, 89);
  ctx.direction = "ltr"; ctx.font = '800 26px "Tajawal"';
  const codeW = ctx.measureText(x.code).width + 56;
  glassPanel(ctx, 48, 44, codeW, 68, 34, .42);
  ctx.fillStyle = INK; ctx.fillText(x.code, 48 + codeW / 2, 87);

  const mx = 48, my = 138, mw = W - 96, mh = 690;
  glassPanel(ctx, mx, my, mw, mh, 56, .26);
  ctx.direction = "rtl"; ctx.textAlign = "center";
  ctx.fillStyle = GOLD; ctx.font = '800 34px "Tajawal"'; ctx.fillText(x.area, W / 2, my + 70);

  ctx.fillStyle = metalGrad(ctx, 140, my + 90, 940, my + 260); ctx.font = '700 84px "Amiri"';
  let tl = wrapText(ctx, x.title, 860), lh = 92;
  if (tl.length > 1) { ctx.font = '700 68px "Amiri"'; tl = wrapText(ctx, x.title, 900); lh = 80; }
  tl = tl.slice(0, 2);
  const ty = my + 162;
  tl.forEach((l, i) => ctx.fillText(l, W / 2, ty + i * lh));
  const yEnd = ty + (tl.length - 1) * lh;

  /* اللوح الداخلي: صورة العقار إن وُجدت، وإلا رقم المساحة */
  const px = mx + 64, pw = mw - 128, py = yEnd + 50, pH = tl.length > 1 ? 200 : 250;
  const ph = (x.photos || [])[0];
  let drew = false;
  if (ph) {
    const im = await new Promise(res => {
      const i = new Image(); i.crossOrigin = "anonymous";
      i.onload = () => res(i); i.onerror = () => res(null);
      i.src = newBlobs[ph] ? "data:image/jpeg;base64," + newBlobs[ph] : "/" + ph;
    });
    if (im) {
      ctx.save(); rrect(ctx, px, py, pw, pH, 36); ctx.clip();
      const s = Math.max(pw / im.width, pH / im.height);
      ctx.drawImage(im, px + (pw - im.width * s) / 2, py + (pH - im.height * s) / 2, im.width * s, im.height * s);
      ctx.restore();
      ctx.strokeStyle = "rgba(252,246,186,.42)"; ctx.lineWidth = 2.5;
      rrect(ctx, px, py, pw, pH, 36); ctx.stroke();
      drew = true;
    }
  }
  if (!drew) {
    glassPanel(ctx, px, py, pw, pH, 36, .34);
    ctx.fillStyle = INK; ctx.font = `700 ${tl.length > 1 ? 100 : 120}px "Amiri"`;
    ctx.fillText(String(n), W / 2, py + pH * 0.57);
    ctx.fillStyle = INK2; ctx.font = '800 34px "Tajawal"'; ctx.fillText(u, W / 2, py + pH - 22);
  }

  const yp = py + pH + 90;
  if (ask) { ctx.fillStyle = INK; ctx.font = '800 54px "Tajawal"'; ctx.fillText("السعر عند التواصل", W / 2, yp); }
  else {
    ctx.fillStyle = GOLD_L; ctx.font = '700 76px "Amiri"';
    const label = unit2 === "للدنم" ? `${main} للدنم` : main;
    ctx.fillText(label + (x.nego ? " · قابل للتفاوض" : ""), W / 2, yp);
  }
  ctx.fillStyle = INK2; ctx.font = '500 31px "Tajawal"';
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
  ctx.fillStyle = GOLD_L; ctx.font = '700 54px "Amiri"'; ctx.fillText(NAME, R - 140, fy + 84);
  ctx.fillStyle = INK2; ctx.font = '500 28px "Tajawal"'; ctx.fillText(ROLE, R - 140, fy + 128);
  ctx.direction = "ltr"; ctx.font = '800 44px "Tajawal"';
  const tel = PHONE_LOCAL, telW = ctx.measureText(tel).width + 70;
  ctx.fillStyle = metalGrad(ctx, fx + 30, fy + 34, fx + 30 + telW, fy + 110);
  rrect(ctx, fx + 30, fy + 34, telW, 76, 38); ctx.fill();
  ctx.textAlign = "center"; ctx.fillStyle = BLACK; ctx.fillText(tel, fx + 30 + telW / 2, fy + 88);
  ctx.direction = "rtl"; ctx.fillStyle = INK2; ctx.font = '500 24px "Tajawal"';
  ctx.fillText("واتساب · اذكر الكود " + x.code, fx + 30 + telW / 2, fy + 146);

  return new Promise(res => c.toBlob(b => res(b), "image/png"));
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
function openBlur(path) {
  const src = newBlobs[path] ? "data:image/jpeg;base64," + newBlobs[path] : "/" + path;
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
const galUrl = key => `${BASE}/${galPath(key)}`;

/** صفحة الصور الخاصة — تصميم الموقع نفسه، noindex، بلا روابط للموقع */
function galleryPage(x) {
  const [n, u] = sizeOf(x), [main, unit2] = priceTxt(x);
  const imgs = (x.photos || []).map((p, i) =>
    `<figure class="gshot"><img src="${BASE}/${esc(p)}" alt="${esc(x.title)} — صورة ${i + 1}" loading="lazy"></figure>`
  ).join("");
  const waTxt = `مرحباً أستاذ محمد، شفت صور العقار ${x.code} (${x.title}) وبدي أستفسر.`;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>صور ${esc(x.code)} — ${esc(x.title)}</title>
<meta name="robots" content="noindex,nofollow,noarchive,noimageindex">
<meta name="referrer" content="no-referrer">
<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">
<meta name="theme-color" content="#0B0B0C">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Tajawal:wght@400;500;700;800&display=swap">
<link rel="stylesheet" href="${BASE}/style.css">
<style>
.gwrap{max-width:900px;margin-inline:auto;padding:var(--s5) var(--s4) var(--s7)}
.ghead{padding:var(--s5);border-radius:var(--r3);margin-bottom:var(--s5)}
.ghead h1{font-size:var(--f-sec);color:var(--ink);margin:var(--s2) 0}
.gshots{display:grid;gap:var(--s4)}
.gshot{margin:0;border:1px solid var(--glass-line);border-radius:var(--r3);overflow:hidden;background:rgba(0,0,0,.4)}
.gshot img{width:100%;display:block}
.gnote{margin-top:var(--s5);font-size:var(--f2);color:var(--muted);text-align:center;line-height:1.8}
</style>
</head>
<body>
<div class="gwrap">
  <header class="ghead glass">
    <p class="eyebrow">صور خاصة · ${esc(x.code)}</p>
    <h1>${esc(x.title)}</h1>
    <p class="where"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS.pin}</svg>${esc(x.area)} · ريف دمشق</p>
    <div class="specrow">${specRow(x)}</div>
    <div class="fprice"><span class="main">${main}</span>${unit2 ? `<span class="u">${unit2}</span>` : ""}</div>
    <div class="actions" style="margin-top:var(--s4)">
      <a class="btn btn-primary" target="_blank" rel="noopener" href="${wa(waTxt)}">استفسر على واتساب <span class="ar">←</span></a>
      <a class="btn btn-ghost" href="tel:+${PHONE_INTL}" dir="ltr">${PHONE_LOCAL}</a>
    </div>
  </header>
  <div class="gshots">${imgs || '<p class="gnote">ما في صور بعد لهذا العقار.</p>'}</div>
  <p class="gnote">هذه الصفحة خاصة — أُرسلت لك من ${NAME}، ${ROLE}.<br>الأوراق تُعرض كاملة قبل أي عربون.</p>
</div>
</body></html>`;
}

/** نافذة مشاركة الرابط الخاص */
let galRow = null;
function openGallery(r) {
  galRow = r;
  const has = (r.photos || []).length;
  $("galTitle").textContent = "صور " + r.code + " — رابط خاص";
  $("galSub").textContent = r.title + " · " + r.area
    + (has ? ` · ${has} صورة` : " · ما في صور بعد");
  const key = r.galKey || "";
  $("galLink").value = key ? galUrl(key) : "";
  $("galLink").disabled = !key;
  $("galCopy").disabled = !key;
  $("galOpen").href = key ? galUrl(key) : "#";
  $("galOpen").hidden = !key;
  $("galWa").hidden = !key;
  if (key) {
    $("galWa").href = "https://wa.me/?text=" + encodeURIComponent(
      `صور العقار ${r.code} — ${r.title} (${r.area})\n${galUrl(key)}`);
  }
  $("galNew").textContent = key ? "رابط جديد (يُبطل القديم)" : "أنشئ الرابط";
  $("galMsg").hidden = true;
  $("galDlg").showModal();
}

/* ===== حالة التعديلات ===== */
const liveRows = () => ROWS.filter(r => r.status !== "موقوف")
  .sort((a, b) => a.code.localeCompare(b.code));
const snapshot = () => JSON.stringify(ROWS);
const isDirty = () => snapshot() !== BASE_ROWS;

function saveDraft() {
  try { localStorage.setItem(LS_DRAFT, JSON.stringify({ rows: ROWS, blobs: newBlobs })); } catch (e) { }
}
function updateBar() {
  const d = isDirty();
  $("pubBar").hidden = false;
  $("pubBtn").disabled = !d;
  $("dropBtn").hidden = !d;
  const m = $("pubMsg");
  if (!m.dataset.busy) {
    m.className = "msg" + (d ? " warn" : "");
    m.textContent = d ? "عندك تعديلات ما اننشرت" : "الموقع محدّث ✓";
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
  const g = $("grid"), q = query.trim();
  const list = ROWS.filter(r => {
    if (filter === "موقوف") { if (r.status !== "موقوف") return false; }
    else if (filter !== "all" && r.cat !== filter) return false;
    if (!q) return true;
    return [r.code, r.title, r.area, (r.feats || []).join(" "), r.note].join(" ").includes(q);
  }).sort((a, b) => a.code.localeCompare(b.code));

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

    const cam = document.createElement("button");
    cam.type = "button"; cam.className = "card-cam";
    const np = (r.photos || []).length;
    cam.textContent = "📷 " + (np ? np : "صور");
    cam.setAttribute("aria-label", "صور " + r.code);
    cam.addEventListener("click", ev => { ev.stopPropagation(); openPhotos(r); });
    card.appendChild(cam);

    const pc = document.createElement("button");
    pc.type = "button"; pc.className = "card-post";
    pc.textContent = "🖼 بطاقة";
    pc.setAttribute("aria-label", "بطاقة منشور " + r.code);
    pc.addEventListener("click", ev => { ev.stopPropagation(); openPost(r); });
    card.appendChild(pc);

    const gl = document.createElement("button");
    gl.type = "button"; gl.className = "card-gal";
    gl.textContent = "🔗 رابط";
    gl.setAttribute("aria-label", "الرابط الخاص لصور " + r.code);
    gl.addEventListener("click", ev => { ev.stopPropagation(); openGallery(r); });
    card.appendChild(gl);

    const row = document.createElement("div"); row.className = "row1";
    const code = document.createElement("span"); code.className = "code"; code.textContent = r.code;
    row.appendChild(code);
    const t = document.createElement("span");
    if (r.status === "موقوف") { t.className = "tag hold"; t.textContent = "موقوف"; }
    else if (r.confirmed === false) { t.className = "tag ask"; t.textContent = "بلا سعر"; }
    else { t.className = "tag"; t.textContent = r.cat; }
    row.appendChild(t);
    b.appendChild(row);

    if ((r.photos || []).length) {
      const th = document.createElement("div"); th.className = "thumb";
      const im = document.createElement("img");
      im.src = photoSrc(r.photos[0]); im.alt = r.title || r.code; im.loading = "lazy";
      th.appendChild(im); b.appendChild(th);
    }
    const h = document.createElement("h3"); h.textContent = r.title || "بلا عنوان"; b.appendChild(h);
    const m = document.createElement("div"); m.className = "meta";
    const s = sizeOf(r); m.textContent = r.area + " · " + s[0] + " " + s[1]; b.appendChild(m);
    const p = document.createElement("div"); p.className = "price";
    p.textContent = r.confirmed === false ? "السعر عند التواصل"
      : money(totalOf(r)) + (r.mode === "للدنم" ? "  (" + money(r.price) + " للدنم)" : "");
    b.appendChild(p);
    g.appendChild(card);
  }
  const held = ROWS.filter(r => r.status === "موقوف").length;
  $("count").textContent = list.length + " من " + ROWS.length + " عقار"
    + (held ? " · " + held + " موقوف ما بينشر" : "");
  updateBar();
  saveDraft();
}
/* صورة لم تُرفع بعد تُعرض من الذاكرة */
function photoSrc(path) {
  if (newBlobs[path]) return "data:image/jpeg;base64," + newBlobs[path];
  return BASE + "/" + path;
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
    img.src = photoSrc(path); img.alt = "صورة " + (i + 1); img.loading = "lazy";
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
  const code = (quickRow ? quickRow.code : $("f_code").value.trim().toUpperCase());
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
  stat.textContent = done + " صورة جاهزة — اضغط «نشر» لتظهر على الموقع.";
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
  const v = parseFloat($("f_land").value);
  if (!isFinite(v) || v <= 0) return null;
  return Math.round(unit === "dunam" ? v * 1000 : v);
}
function updateTotal() {
  const m2 = inputToM2() || 0, price = parseFloat($("f_price").value) || 0;
  const t = mode === "للدنم" ? price * m2 / 1000 : price;
  $("totalVal").textContent = t > 0 ? money(t) : "—";
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
  $("f_area").value = r ? (r.area || "يعفور") : "يعفور";
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
  $("f_papers").value = r ? (r.papers || "") : "";
  $("f_status").value = r ? (r.status || "متاح") : "متاح";
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
function fail(msg, focus) {
  const e = $("err"); e.textContent = msg; e.hidden = false;
  if (focus) $(focus).focus();
}
function save() {
  const code = $("f_code").value.trim().toUpperCase();
  if (!/^MK-\d{3}$/.test(code)) return fail("الكود لازم يكون بصيغة MK-022.", "f_code");
  if (!editing && ROWS.some(r => r.code === code)) return fail("الكود " + code + " مستعمل من قبل.", "f_code");
  const title = $("f_title").value.trim();
  if (!title) return fail("اكتب عنوان العقار.", "f_title");
  const m2 = inputToM2(), bua = parseFloat($("f_bua").value);
  if (!m2 && !(isFinite(bua) && bua > 0)) return fail("لازم مساحة أرض أو مساحة بناء.", "f_land");
  const price = parseFloat($("f_price").value);
  if (!isFinite(price) || price <= 0) return fail("اكتب السعر.", "f_price");
  if (mode === "للدنم" && !m2) return fail("سعر الدنم بدّو مساحة أرض.", "f_land");

  const body = {
    code, status: $("f_status").value, cat: $("f_cat").value, title,
    area: $("f_area").value, area_m2: m2, bua: isFinite(bua) && bua > 0 ? Math.round(bua) : null,
    mode, price: Math.round(price), nego: $("f_nego").checked, confirmed: $("f_conf").checked,
    papers: $("f_papers").value, feats: feats.slice(), photos: photos.slice(),
    note: $("f_note").value.trim(),
    src_place: $("p_place").value.trim(), src_by: $("p_by").value.trim(),
    commission: $("p_comm").value.trim(), src_notes: $("p_notes").value.trim(),
    updatedAt: new Date().toISOString()
  };
  if (editing) Object.assign(editing, body);
  else { body._new = true; ROWS.push(body); }
  $("dlg").close();
  render();
}
function removeIt() {
  if (!editing) return;
  if (!confirm("متأكد بدك تحذف " + editing.code + " نهائياً؟\n\nلو بدك بس توقفه عن النشر، بدّل الحالة لـ«موقوف».")) return;
  ROWS = ROWS.filter(r => r !== editing);
  $("dlg").close();
  render();
}

/* ===== النشر ===== */
async function publish() {
  if (!isDirty()) return;
  $("pubBtn").disabled = true;
  try {
    const live = liveRows();

    /* بياناتك أولاً: هي الأصل. لو انقطع النت بعدها، ما بتضيع ولا معلومة. */
    say("جارٍ حفظ بياناتك…", "warn", true);
    const clean = ROWS.map(r => { const c = Object.assign({}, r); delete c._new; return c; });
    await commit(CFG.priv, [{ path: "private.json", content: JSON.stringify(clean, null, 1) }],
      "تحديث بيانات المخزون");

    say("جارٍ تجهيز صفحات الموقع…", "warn", true);
    const cols = collectionsAll(live);
    const files = [
      { path: "data.json", content: JSON.stringify(publicData(live), null, 1) },
      { path: "index.html", content: indexPage(live) },
      { path: "sitemap.xml", content: sitemapXml(live) }
    ];
    for (const c of cols) files.push({ path: c.slug, content: collectionPage(c, cols) });
    for (const x of live) files.push({ path: `listing/${x.code}.html`, content: listingPage(x, live) });
    for (const p in newBlobs) files.push({ path: p, b64: newBlobs[p] });
    /* صفحات الصور الخاصة: لكل عقار له مفتاح وصور */
    const galKeep = new Set();
    for (const r of ROWS) {
      if (r.galKey && (r.photos || []).length) {
        files.push({ path: galPath(r.galKey), content: galleryPage(r) });
        galKeep.add(galPath(r.galKey));
      }
    }

    /* صفحات عقارات ما عادت متاحة (انحذفت أو صارت موقوفة) تُشال من الموقع
       حتى ما يوصلها زبون من جوجل ويتصل على عقار مباع */
    const keep = new Set(live.map(x => `listing/${x.code}.html`));
    const usedPhotos = new Set(ROWS.flatMap(r => r.photos || []));
    /* كل أسماء صفحات التصفّح الممكنة — نحذف ما لم يعد منها مستحقّاً */
    const colNames = new Set();
    for (const a of AREA_ORDER) {
      colNames.add(AREA_SLUG[a] + ".html");
      for (const c of ["land", "villa", "farm", "apt"]) colNames.add(`${CAT_SLUG[c]}-${AREA_SLUG[a]}.html`);
    }
    const colKeep = new Set(cols.map(c => c.slug));
    const existing = await repoPaths(CFG.pub);
    const deletes = existing.filter(p =>
      (p.startsWith("listing/") && p.endsWith(".html") && !keep.has(p)) ||
      (colNames.has(p) && !colKeep.has(p)) ||
      /* رابط خاص أُبطل أو عقار ما عاد له صور */
      (p.startsWith(GAL_DIR + "/") && p.endsWith(".html") && !galKeep.has(p)) ||
      /* صورة ما عاد يشير إليها أي عقار */
      (p.startsWith("img/") && p !== "img/mohammad-khaled.jpg" && !usedPhotos.has(p)));

    say("جارٍ الرفع (" + files.length + " ملف"
      + (deletes.length ? " · حذف " + deletes.length : "") + ")…", "warn", true);
    await commit(CFG.pub, files, "تحديث المخزون من لوحة الإدارة", deletes);

    newBlobs = {};
    ROWS.forEach(r => { delete r._new; });
    BASE_ROWS = snapshot();
    try { localStorage.removeItem(LS_DRAFT); } catch (e) { }
    say("اننشر ✓ الموقع بيتحدّث خلال دقيقة", "ok");
    setTimeout(() => { say("", ""); updateBar(); }, 6000);
    render();
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
$("galNew").addEventListener("click", () => {
  if (!galRow) return;
  if (galRow.galKey && !confirm("الرابط القديم رح يبطل فوراً وما حدا يقدر يفتحه. متأكد؟")) return;
  galRow.galKey = newKey();
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
    s2.textContent = "انطبق التمويه — اضغط «نشر» ليوصل للموقع.";
    setTimeout(() => { s2.hidden = true; }, 4500);
  }, "image/jpeg", 0.82);
});
$("blurDlg").addEventListener("close", () => { blurState = null; });

$("qClose").addEventListener("click", () => $("photoDlg").close());
$("qDone").addEventListener("click", () => $("photoDlg").close());
$("photoDlg").addEventListener("close", () => { quickRow = null; });
$("pubBtn").addEventListener("click", publish);
$("dropBtn").addEventListener("click", () => {
  if (!confirm("بدك تتراجع عن كل التعديلات اللي ما اننشرت؟")) return;
  try { localStorage.removeItem(LS_DRAFT); } catch (e) { }
  location.reload();
});
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
    let rows = await readJson(CFG.priv, "private.json");
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

    /* مسودّة محفوظة من جلسة سابقة */
    try {
      const d = JSON.parse(localStorage.getItem(LS_DRAFT) || "null");
      if (d && d.rows && JSON.stringify(d.rows) !== BASE_ROWS) {
        if (confirm("عندك تعديلات ما اننشرت من آخر مرة. بدك ترجّعها؟")) {
          ROWS = d.rows; newBlobs = d.blobs || {};
        } else localStorage.removeItem(LS_DRAFT);
      }
    } catch (e) { }

    $("loading").hidden = true;
    $("app").hidden = false;
    render();
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
