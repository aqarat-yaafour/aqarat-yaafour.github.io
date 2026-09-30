import { chromium } from './pw.mjs';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const pub = JSON.parse(fs.readFileSync(REPO + '/tests/fixtures/data.json', 'utf8'));
const CAT_AR = { land: 'أرض', villa: 'فيلا', farm: 'مزرعة', apt: 'شقة', invest: 'استثماري' };
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
async function add(p, o) {
  await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
  await p.selectOption('#f_cat', o.cat); await p.fill('#f_title', o.title);
  const has = (await p.evaluate(() => [...document.querySelectorAll('#f_area option')].map(x => x.value))).includes(o.area);
  if (has) await p.selectOption('#f_area', o.area); else { await p.selectOption('#f_area', '__new__'); await p.fill('#f_area_new', o.area); await p.fill('#f_area_slug', o.slug); }
  await p.fill('#f_land', String(o.land || 8.5)); await p.fill('#f_bua', String(o.bua || 7980)); await p.fill('#f_price', String(o.price)); await p.check('#f_nego');
  if (o.hide) await p.uncheck('#f_conf');
  await p.click('#saveBtn'); await p.waitForTimeout(250);
  return p.evaluate(() => ROWS[ROWS.length - 1]);
}
const SECRET = [/4937000/, /4,937,000/, /(?<![\d.])4\.94 مليون/, /(?<![\d.])4\.9 مليون/, /(?<![\d,])4937(?!\d)/];
const leakScan = () => { const out = []; for (const [k, v] of PUB.files) if (typeof v === 'string' && /\.(html|json|xml)$/.test(k)) for (const r of SECRET) { const m = v.match(r); if (m) out.push(k + ' ← ' + m[0]); } for (const k of PUB.files.keys()) if (/4937/.test(k)) out.push('filename ' + k); return out; };

console.log('=== السعر «عند التواصل» لا يتسرّب في أي ملف علني ===');
setRemote(mkRows()); answer = true; PUB.files.clear();
let p = await open(); dialogs = [];
const hidden = await add(p, { cat: 'استثماري', title: 'أصل استثماري مخفي السعر', area: 'صحنايا', slug: 'sahnaya', price: 4937000, hide: true });
const shown = await add(p, { cat: 'فيلا', title: 'فيلا معلنة السعر في صحنايا', area: 'صحنايا', land: 0.5, bua: 240, price: 650000 });
const hidden2 = await add(p, { cat: 'استثماري', title: 'أصل استثماري ثانٍ مخفي السعر في صحنايا', area: 'صحنايا', slug: 'sahnaya', price: 4937000, hide: true });
const lone = await add(p, { cat: 'استثماري', title: 'أصل ثانٍ مخفي السعر في جرمانا', area: 'جرمانا', slug: 'jaramana', price: 4937000, hide: true });
ok('the hidden price is kept privately in the inventory', hidden.price === 4937000 && hidden.confirmed === false);
let m = await publishNow(p); ok('publish ok', /اننشر/.test(m), m);
let leaks = leakScan(); ok('NO public file (html/json/xml) or filename contains the hidden price', leaks.length === 0, JSON.stringify(leaks));
const D = JSON.parse(PUB.files.get('data.json')); const dh = D.find(x => x.code === hidden.code);
ok('public data: price/total null, mode "ask", negotiable flag not exposed', dh.price === null && dh.total === null && dh.mode === 'ask' && dh.nego === false, JSON.stringify(dh));
const desc = f => (PUB.files.get(f).match(/name="description" content="([^"]*)"/) || [])[1] || '';
ok('area page with one hidden + one public price shows only the public one', /السعر 650 ألف/.test(desc('sahnaya.html')) && !/مليون/.test(desc('sahnaya.html')), desc('sahnaya.html'));
ok('area page whose listings are ALL hidden shows no price at all', !/السعر|الأسعار|مليون|ألف/.test(desc('jaramana.html')), desc('jaramana.html'));
ok('the investment category page (two hidden listings in صحنايا) exists and shows no price text', PUB.files.has('investment-sahnaya.html') && !/السعر|الأسعار|مليون|ألف/.test(desc('investment-sahnaya.html')), desc('investment-sahnaya.html'));
const hp = PUB.files.get(`listing/${hidden.code}.html`);
ok('listing page says السعر عند التواصل, has no price in JSON-LD offers', /السعر عند التواصل/.test(hp) && !/"price"/.test((hp.match(/"@type":"Offer"[^}]*/) || [''])[0]));
const ex = await p.evaluate(async h => { const g = galleryPage(Object.assign({}, h, { galKey: 'k', galSecret: 's' }), ['x']); return { cap: postCaption(h), g }; }, hidden);
ok('caption and private gallery page do not reveal it either', !SECRET.some(r => r.test(ex.cap)) && !SECRET.some(r => r.test(ex.g)) && /عند التواصل/.test(ex.cap), ex.cap.split('\n').find(l => /السعر/.test(l)));
ok('homepage embedded data has the listing as price-less', (() => { const i = PUB.files.get('index.html'); const seg = i.slice(i.indexOf(hidden.code)); return !/"price":\s*4/.test(i) && /السعر عند/.test(i); })());

console.log('=== بطاقة المشاركة: اسم الملف لا يحمل بصمة السعر المخفي ===');
const p1 = await p.evaluate(h => ogPath(h), hidden);
await p.evaluate(h => { const r = ROWS.find(x => x.code === h.code); r.price = 5900000; render(); }, hidden);
const p2 = await p.evaluate(h => ogPath(ROWS.find(x => x.code === h.code)), hidden);
ok('changing the hidden price does NOT change its public card filename', p1 === p2, p1 + ' vs ' + p2);
const c1 = await p.evaluate(s => ogPath(s), shown); await p.evaluate(s => { ROWS.find(x => x.code === s.code).price = 700000; render(); }, shown);
const c2 = await p.evaluate(s => ogPath(ROWS.find(x => x.code === s.code)), shown);
ok('changing a PUBLIC price does change the filename (so WhatsApp refreshes the preview)', c1 !== c2);

console.log('=== إظهار السعر لاحقاً يعمل ===');
await p.evaluate(h => { const r = ROWS.find(x => x.code === h.code); r.price = 4937000; r.confirmed = true; render(); }, hidden);
m = await publishNow(p);
ok('after confirming the price, the listing and area range show it', /4\.94 مليون/.test(PUB.files.get(`listing/${hidden.code}.html`)) && /4\.94 مليون|الأسعار من/.test(desc('sahnaya.html')), desc('sahnaya.html'));
console.log('page errors:', errs);
await b.close();
