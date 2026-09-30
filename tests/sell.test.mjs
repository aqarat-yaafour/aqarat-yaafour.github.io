import { chromium } from './pw.mjs';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const pub = JSON.parse(fs.readFileSync(REPO + '/data.json', 'utf8'));
const CAT_AR = { land: 'أرض', villa: 'فيلا', farm: 'مزرعة', apt: 'شقة' };
const mkRows = () => pub.map(p => ({ code: p.code, status: 'متاح', cat: CAT_AR[p.cat], title: p.title, area: p.area, area_m2: p.area_m2, bua: p.bua, mode: p.mode === 'dunam' ? 'للدنم' : 'مقطوع', price: p.price, nego: !!p.nego, confirmed: !p.unconfirmed, papers: p.papers || '', feats: p.feats || [], photos: [], note: p.note || '', src_place: '', src_by: '', commission: '', src_notes: '' }));
const gsha = buf => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex');
const remote = { text: '', sha: '' };
const setRemote = rows => { remote.text = JSON.stringify(rows, null, 1); remote.sha = gsha(Buffer.from(remote.text, 'utf8')); };
const rem = () => JSON.parse(remote.text);
const PUB = { files: new Map(), deleted: [] };
const S = { commits: [], patches: 0, failFirstPatch: false, patchFailed: false, privWrites: 0 };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, ignoreHTTPSErrors: true });
const blobs = {};
let bn = 0;
await ctx.route('https://api.github.com/**', async r => {
  const u = new URL(r.request().url()), m = r.request().method(), p = u.pathname, json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  const repo = (p.match(/^\/repos\/[^/]+\/([^/]+)/) || [])[1];
  if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) return json({ permissions: { push: true } });
  if (repo !== 'mk-inventory' && /\/contents\/sitemap\.xml$/.test(p)) return PUB.files.has('sitemap.xml') ? r.fulfill({ status: 200, body: PUB.files.get('sitemap.xml') }) : json({ message: 'nf' }, 404);
  if (/\/contents\//.test(p)) { if (repo === 'mk-inventory' && /private\.json$/.test(p)) return json({ content: Buffer.from(remote.text).toString('base64'), sha: remote.sha }); return json({ message: 'nf' }, 404); }
  if (/\/git\/ref\/heads\/main$/.test(p)) return json({ object: { sha: 'HEAD0' } });
  if (/\/git\/commits\/HEAD0$/.test(p)) return json({ tree: { sha: 'TREE0' } });
  if (/\/git\/trees\/(HEAD0|TREE0)$/.test(p)) return json({ tree: repo === 'mk-inventory' ? [{ type: 'blob', path: 'private.json', sha: remote.sha }] : [...PUB.files.keys()].map(path => ({ type: 'blob', path, sha: 'x' })) });
  if (/\/git\/blobs$/.test(p)) { const id = 'B' + (++bn); blobs[id] = JSON.parse(r.request().postData()); return json({ sha: id }); }
  if (/\/git\/trees$/.test(p) && m === 'POST') { const body = JSON.parse(r.request().postData()); if (repo === 'mk-inventory') { const e = body.tree.find(x => x.path === 'private.json'); if (e) { setRemote(JSON.parse(e.content)); S.privWrites++; } } if (repo !== 'mk-inventory') for (const e of body.tree) { if (e.sha === null) { PUB.deleted.push(e.path); PUB.files.delete(e.path); } else PUB.files.set(e.path, e.content !== undefined ? e.content : (blobs[e.sha] && blobs[e.sha].encoding !== 'base64' ? blobs[e.sha].content : '(binary)')); } S.commits.push(repo); return json({ sha: 'T' + S.commits.length }); }
  if (/\/git\/commits$/.test(p) && m === 'POST') return json({ sha: 'C' + (S.commits.length) });
  if (/\/git\/refs\/heads\/main$/.test(p) && m === 'PATCH') { S.patches++; if (S.failFirstPatch && !S.patchFailed) { S.patchFailed = true; return json({ message: 'Update is not a fast forward' }, 422); } return json({}); }
  return json({ message: 'unmocked ' + p }, 500);
});
await ctx.route('http://localhost:8769/**', async r => { const f = decodeURIComponent(new URL(r.request().url()).pathname); const fp = path.join(REPO, f); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, body: fs.readFileSync(fp), contentType: fp.endsWith('.html') ? 'text/html' : fp.endsWith('.js') ? 'text/javascript' : fp.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); return r.fulfill({ status: 404, body: '' }); });
const ok = (n, c, extra = '') => console.log(c ? 'PASS' : 'FAIL', n, extra);
const errs = [];
let dialogs = [], answer = true;
async function open() {
  const p = await ctx.newPage(); await p.addInitScript(() => { try { localStorage.removeItem('mk_admin_draft'); } catch (e) { } }); p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await p.goto('http://localhost:8769/admin.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(400);
  if (await p.isVisible('#s_token')) { await p.fill('#s_token', 'fake'); await p.click('#s_go'); }
  await p.waitForSelector('#app:not([hidden])');
  return p;
}
const bar = p => p.textContent('#pubMsg');
const waitIdle = async (p, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const t = await bar(p); if (/اننشر|ما زبط/.test(t)) return t; await p.waitForTimeout(150); } return await bar(p); };
let vn = 0;   /* عناوين ومساحات فريدة حتى لا يعتبرها كشف التكرار نسخاً من بعضها */
async function addVilla(p, price, land = '', mode = null) {
  vn++; await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
  await p.selectOption('#f_cat', 'فيلا'); await p.fill('#f_title', 'فيلا اختبار رقم ' + vn + ' مميزة');
  await p.fill('#f_bua', String(200 + vn * 111)); await p.fill('#f_price', price); if (land) await p.fill('#f_land', land);
  if (mode) await p.click(`#modeSeg button[data-m="${mode}"]`);
  await p.click('#saveBtn'); await p.waitForTimeout(250);
}




async function publishNow(p) {
  await p.evaluate(() => { VERIFY.every = 100; VERIFY.max = 400; });
  await p.click('#pubBtn');
  const t0 = Date.now(); while (!/اننشر|ما زبط/.test(await p.textContent('#pubMsg')) && Date.now() - t0 < 20000) await p.waitForTimeout(100);
  return p.textContent('#pubMsg');
}
const OUT = (process.env.TMPDIR || '/tmp') + '/';
console.log('=== قناة المالكين: صفحة «لديك عقار للبيع؟» ===');
setRemote(mkRows()); answer = true; PUB.files.clear();
let p = await open();
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
await p.selectOption('#f_cat', 'استثماري'); await p.selectOption('#f_area', '__new__'); await p.fill('#f_area_new', 'صحنايا'); await p.fill('#f_title', 'أصل في صحنايا'); await p.fill('#f_land', '8.5'); await p.fill('#f_price', '4000000'); await p.click('#saveBtn'); await p.waitForTimeout(250);
const m = await publishNow(p); ok('publish succeeds with the new page (quality check passes)', /اننشر/.test(m), m);
const F = PUB.files, SP = F.get('sell.html') || '';
ok('sell.html is generated', SP.length > 3000);
ok('it is in the sitemap', F.get('sitemap.xml').includes('/sell.html'));
ok('SEO basics: title, description, canonical, indexable', /<title>لديك عقار للبيع؟/.test(SP) && /name="description" content="[^"]{60,}"/.test(SP) && /rel="canonical" href="https:\/\/aqarat-yaafour.github.io\/sell.html"/.test(SP) && /index,follow/.test(SP));
const lds = [...SP.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(x => JSON.parse(x[1]));
ok('structured data parses (WebPage + Breadcrumb + 4-question FAQ)', lds.length === 3 && lds.some(x => x['@type'] === 'FAQPage' && x.mainEntity.length === 4));
ok('every page links to it from the footer (home, listing, area pages)', ['index.html', 'yaafour.html'].every(f => F.get(f).includes('sell.html')) && [...F.keys()].filter(k => k.startsWith('listing/')).every(k => F.get(k).includes('/sell.html')));
ok('the homepage has the small “اعرضه معي” link under the request form', /<p class="sell-link">[^<]*<a href="sell.html">/.test(F.get('index.html')));
ok('area list offers the core areas + the live extra area (صحنايا)', ['يعفور', 'قرى الشام', 'الصبورة', 'صحنايا'].every(a => SP.includes(`<option value="${a}"></option>`)));
const visible = SP.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ');
ok('it says nothing is stored, and states no commission figure or percentage', /لا يُحفظ شيء على الموقع/.test(visible) && !/\d\s*%|عمولة\s*\d|نسبة\s*\d/.test(visible), (visible.match(/.{20}%.{10}/) || [''])[0]);
ok('the brand positioning is unchanged on the homepage', /أعمل في يعفور وقرى الشام والصبورة بريف دمشق/.test(F.get('index.html')));

console.log('=== النموذج في المتصفح ===');
const v = await ctx.newPage(); const verrs = []; v.on('pageerror', e => verrs.push(e.message)); await v.setViewportSize({ width: 390, height: 844 });
await v.addInitScript(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
await v.route('https://aqarat-yaafour.github.io/**', r => { const u = new URL(r.request().url()); let pth = decodeURIComponent(u.pathname).replace(/^\//, ''); if (pth === '') pth = 'index.html'; if (PUB.files.has(pth) && /\.html$/.test(pth)) return r.fulfill({ status: 200, body: PUB.files.get(pth), contentType: 'text/html' }); const fp = path.join(REPO, pth); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { const ext = fp.split('.').pop(); return r.fulfill({ status: 200, body: fs.readFileSync(fp), contentType: { css: 'text/css', js: 'text/javascript', woff2: 'font/woff2', jpg: 'image/jpeg', svg: 'image/svg+xml', png: 'image/png', json: 'application/json' }[ext] || 'application/octet-stream' }); } return r.fulfill({ status: 404, body: '' }); });
await v.goto('https://aqarat-yaafour.github.io/sell.html', { waitUntil: 'load' }); await v.waitForTimeout(900);
await v.screenshot({ path: OUT + 'sell1.png' });
const opened = () => v.evaluate(() => window.__opened.slice());
await v.click('#sellGo');
ok('empty form: shows what is missing and opens nothing', /أكمل: نوع العقار والمنطقة/.test(await v.textContent('#sellErr')) && (await opened()).length === 0, await v.textContent('#sellErr'));
await v.selectOption('#sellCat', 'أرض'); await v.click('#sellGo');
ok('only the area is missing → says so', /أكمل: المنطقة$/.test((await v.textContent('#sellErr')).trim()) && (await opened()).length === 0, await v.textContent('#sellErr'));
await v.fill('#sellArea', 'صحنايا'); await v.fill('#sellSize', '٨٫٥'); await v.selectOption('#sellPapers', 'طابو أخضر'); await v.selectOption('#sellRole', 'وكيل عن المالك'); await v.fill('#sellPrice', '٥ مليون $'); await v.fill('#sellNote', 'على الأوتستراد <script>alert(1)</script> "اختبار" & أكثر');
await v.click('#sellGo');
const o = await opened(); ok('a single WhatsApp link to the owner\'s number is opened', o.length === 1 && o[0].startsWith('https://wa.me/963996606813?text='), o[0] && o[0].slice(0, 50));
const msg = decodeURIComponent((o[0] || '').split('?text=')[1] || '');
ok('the message is tidy and complete (Arabic digits converted to Latin)', msg.startsWith('مرحباً أستاذ محمد، عندي عقار للبيع:') && msg.includes('▪️ النوع: أرض') && msg.includes('▪️ المنطقة: صحنايا') && msg.includes('▪️ المساحة: 8.5 دنم') && msg.includes('▪️ الأوراق: طابو أخضر') && msg.includes('▪️ صفتي: وكيل عن المالك') && msg.includes('▪️ السعر المتوقع: 5 مليون $'), msg.replace(/\n/g, ' ⏎ '));
ok('special characters travel as plain text (nothing is injected into the page)', msg.includes('<script>alert(1)</script> "اختبار" & أكثر') && !(await v.evaluate(() => document.body.innerHTML.includes('alert(1)'))));
ok('the error message is hidden after a good submit', await v.evaluate(() => document.getElementById('sellErr').hidden));
await v.fill('#sellSize', ''); await v.fill('#sellPrice', ''); await v.fill('#sellNote', ''); await v.selectOption('#sellPapers', ''); await v.click('#sellGo');
const msg2 = decodeURIComponent(((await opened())[1] || '').split('?text=')[1] || '');
ok('optional fields left empty are simply omitted', !/المساحة|السعر المتوقع|ملاحظة|الأوراق/.test(msg2) && /▪️ صفتي: وكيل عن المالك/.test(msg2), msg2.replace(/\n/g, ' ⏎ '));
await v.evaluate(() => document.getElementById('sell').scrollIntoView()); await v.waitForTimeout(500);
await v.screenshot({ path: OUT + 'sell2.png' });
await v.goto('https://aqarat-yaafour.github.io/', { waitUntil: 'load' }); await v.waitForTimeout(700);
await v.evaluate(() => document.querySelector('.sell-link a').scrollIntoView({ block: 'center' })); await v.click('.sell-link a'); await v.waitForURL('**/sell.html');
ok('the link on the homepage reaches the page', /sell\.html$/.test(v.url()));
ok('no page errors', verrs.length === 0 && errs.length === 0, JSON.stringify(verrs.concat(errs)));
console.log('page errors:', errs.concat(verrs));
await b.close();
