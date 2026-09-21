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
  const ph = (x && x.photos) || [];
  return ph.length ? BASE + "/" + ph[0] : BASE + "/img/mohammad-khaled.jpg";
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
function mediaHtml(x, up, big) {
  const [n, u] = sizeOf(x), ph = x.photos || [];
  const cls = big ? "media photo big" : "media photo";
  if (ph.length) {
    const first = `<img src="${up}${esc(ph[0])}" alt="${esc(x.title)} في ${esc(x.area)} - ${x.code}" loading="lazy">`;
    let rest = "";
    if (big && ph.length > 1) {
      rest = '<div class="thumbs">' + ph.slice(1).map((p, i) =>
        `<img src="${up}${esc(p)}" alt="${esc(x.title)} - صورة ${i + 2}" loading="lazy">`).join("") + "</div>";
    }
    return `<div class="${cls}">${first}</div>${rest}`;
  }
  const soon = big ? '<span class="soon">الصور قريباً</span>' : "";
  return `<div class="media${big ? " big" : ""}"><span class="num">${n}</span><span class="unit">${u}</span>${soon}</div>`;
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
  if ((x.photos || []).length) jsonld.image = x.photos.map(p => BASE + "/" + p);
  jsonld.broker = { "@type": "RealEstateAgent", name: NAME, telephone: "+" + PHONE_INTL, areaServed: ["يعفور", "قرى الشام", "ريف دمشق"], url: BASE + "/" };
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "العقارات", item: BASE + "/" },
      { "@type": "ListItem", position: 2, name: x.title, item: canonical }]
  };
  const extra = `<script type="application/ld+json">${JSON.stringify(crumbs)}<\/script>`;
  const rel = live.filter(y => y.cat === x.cat && y.code !== x.code).slice(0, 3);
  const body = `${NAV("../")}
<main class="wrap">
  <nav class="crumbs"><a href="../index.html">العقارات</a> <span>›</span> ${esc(x.title)}</nav>
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
    </div>
  </article>
  ${rel.length ? `<section class="related"><h2>عقارات مشابهة</h2><div class="grid">${rel.map(y => cardHtml(y, "../")).join("")}</div></section>` : ""}
</main>
${FOOT()}`;
  return headHtml(title, desc, canonical, jsonld, extra, ogImage(x)) + body;
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
  const f = featured(live), ph = (f && f.photos) || [];
  return ph.length ? ` style="background-image:url(&quot;${esc(ph[0])}&quot;)"` : "";
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
function searchHtml() {
  const optsArea = ["يعفور", "قرى الشام"].map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join("");
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
  let stats = "";
  for (const en of ["land", "villa", "farm", "apt"]) {
    const v = live.filter(x => CAT_EN[x.cat] === en).length;
    if (v) stats += `<span><b>${v}</b>${CAT_AR[en]}</span>`;
  }
  const body = `${NAV("")}
<section class="hero">
  <div class="hero-bg"${heroStyle(live)}></div>
  <div class="hero-inner">
    <div class="hero-txt">
      <p class="eyebrow">عقارات مختارة · ريف دمشق</p>
      <h1>عقارات يعفور<br><span class="g">وقرى الشام</span></h1>
      <p class="lead">أراضٍ وفلل ومزارع وشقق للبيع، معاينة على الأرض.<br>مرافقة من المعاينة حتى التسجيل.</p>
      <div class="actions">
        <a class="btn btn-primary" target="_blank" rel="noopener" href="${wa("مرحباً أستاذ محمد، أرغب بالاستفسار عن العقارات المتوفرة لديك.")}">تواصل على واتساب <span class="ar">←</span></a>
        <a class="btn btn-ghost" href="#listings">تصفّح العقارات</a>
      </div>
      <div class="who">
        <img class="avatar" src="img/mohammad-khaled.jpg" width="128" height="128" alt="${NAME} مستشار عقاري في يعفور وقرى الشام">
        <div><b>${NAME}</b><small>${ROLE} · يعفور وقرى الشام والصبورة</small></div>
      </div>
    </div>
    ${featureHtml(live)}
  </div>
</section>
<div class="wrap">${searchHtml()}</div>
<main class="wrap">
  <div class="sechead">
    <div>
      <p class="eyebrow">العقارات المتاحة</p>
      <h2 id="listings">أراضٍ وفلل ومزارع<br><span class="g">للبيع في يعفور وقرى الشام</span></h2>
    </div>
    <p class="rcount" id="rcount">${live.length} عقار متاح</p>
  </div>
  <div class="grid" id="listings-grid">${live.map(x => cardHtml(x, "")).join("")}</div>
  <p class="rnone" id="rnone" hidden>ما في عقار مطابق لهالبحث. جرّب توسّع الميزانية أو غيّر النوع.</p>
  <section class="why">
    <div class="why-grid">${whyHtml()}</div>
  </section>
  <section id="about" class="about glass">
    <h2>من أنا</h2>
    <p>أنا ${NAME}، ${ROLE} أعمل في يعفور وقرى الشام والصبورة وريف دمشق. أساعد المشترين، ومنهم المغتربون الذين لا يستطيعون الحضور، على اختيار الأرض أو الفيلا المناسبة، والتحقق من الأوراق، ومتابعة الإجراءات حتى التسجيل. وإلى جانب الوساطة العقارية أتابع أعمال البناء والإكساء، فأستطيع تقدير كلفة البناء أو الإكساء قبل الشراء.</p>
    <h2>أسئلة متكررة</h2>
    <dl class="faq">
      <dt>في أي مناطق تعمل؟</dt><dd>يعفور وقرى الشام والصبورة وما حولها في ريف دمشق.</dd>
      <dt>شو المتوفر عندك؟</dt><dd>أراضٍ زراعية وسكنية ومرخّصة، وفلل ومزارع وشقق، بمساحات من دنم حتى 100 دنم.</dd>
      <dt>هل أستطيع الشراء وأنا خارج سوريا؟</dt><dd>نعم. أرسل لك صور العقار وأوراقه، وأرافق الإجراءات حتى التسجيل حسب ما يسمح به القانون ووكالتك.</dd>
      <dt>كيف أستفسر عن عقار؟</dt><dd>افتح صفحة العقار وأرسل رسالة واتساب فيها كود العقار، مثل MK-012.</dd>
    </dl>
  </section>
</main>
${FOOT()}
<script>${SEARCH_JS}<\/script>`;
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [
      { "@type": "Question", name: "في أي مناطق يعمل محمد خالد؟", acceptedAnswer: { "@type": "Answer", text: "يعفور وقرى الشام والصبورة وما حولها في ريف دمشق." } },
      { "@type": "Question", name: "ما العقارات المتوفرة في يعفور وقرى الشام؟", acceptedAnswer: { "@type": "Answer", text: "أراضٍ زراعية وسكنية ومرخّصة، وفلل ومزارع وشقق، بمساحات من دنم حتى 100 دنم." } },
      { "@type": "Question", name: "هل يمكن الشراء من خارج سوريا؟", acceptedAnswer: { "@type": "Answer", text: "نعم، مع إرسال صور العقار وأوراقه ومرافقة الإجراءات حتى التسجيل حسب القانون والوكالة." } }]
  };
  return headHtml(title, desc, BASE + "/", jsonld,
    `<script type="application/ld+json">${JSON.stringify(faq)}<\/script>`) + body;
}
function sitemapXml(live) {
  const urls = [[BASE + "/", "1.0"]].concat(live.map(x => [`${BASE}/listing/${x.code}.html`, "0.8"]));
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
      papers: x.papers || "", photos: x.photos || []
    };
  });
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
    const files = [
      { path: "data.json", content: JSON.stringify(publicData(live), null, 1) },
      { path: "index.html", content: indexPage(live) },
      { path: "sitemap.xml", content: sitemapXml(live) }
    ];
    for (const x of live) files.push({ path: `listing/${x.code}.html`, content: listingPage(x, live) });
    for (const p in newBlobs) files.push({ path: p, b64: newBlobs[p] });

    /* صفحات عقارات ما عادت متاحة (انحذفت أو صارت موقوفة) تُشال من الموقع
       حتى ما يوصلها زبون من جوجل ويتصل على عقار مباع */
    const keep = new Set(live.map(x => `listing/${x.code}.html`));
    const existing = await repoPaths(CFG.pub);
    const deletes = existing.filter(p => p.startsWith("listing/") && p.endsWith(".html") && !keep.has(p));

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
