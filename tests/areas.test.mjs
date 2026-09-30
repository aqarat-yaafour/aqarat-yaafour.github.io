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
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await p.goto('http://localhost:8769/admin.html', { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => localStorage.removeItem('mk_admin_draft'));
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


const ALLOWED_NOTE = 'ℹ️';
async function publishNow(p) {
  await p.evaluate(() => { VERIFY.every = 100; VERIFY.max = 400; });
  await p.click('#pubBtn');
  const t0 = Date.now(); while (!/اننشر|ما زبط/.test(await p.textContent('#pubMsg')) && Date.now() - t0 < 20000) await p.waitForTimeout(100);
  return p.textContent('#pubMsg');
}
/* يضيف عقاراً. o.area = اسم منطقة موجودة، أو o.newArea = {name, slug, region} */
async function addListing(p, o) {
  await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
  await p.selectOption('#f_cat', o.cat || 'فيلا'); await p.fill('#f_title', o.title);
  if (o.newArea) {
    await p.selectOption('#f_area', '__new__');
    await p.fill('#f_area_new', o.newArea.name);
    if (o.newArea.slug !== undefined) await p.fill('#f_area_slug', o.newArea.slug);
    if (o.newArea.region) await p.fill('#f_area_region', o.newArea.region);
  } else await p.selectOption('#f_area', o.area);
  await p.fill('#f_land', String(o.land || 1)); await p.fill('#f_bua', String(o.bua || 210)); await p.fill('#f_price', String(o.price || 500000));
  await p.click('#saveBtn'); await p.waitForTimeout(250);
}
const dlgOpen = p => p.evaluate(() => document.getElementById('dlg').open);
const areaOpts = p => p.evaluate(() => [...document.querySelectorAll('#f_area option')].map(o => o.textContent));

console.log('=== 1) قائمة المناطق ===');
setRemote(mkRows()); answer = true;
let p = await open();
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
let opts = await areaOpts(p);
ok('form lists the 3 core areas and a “new area” door (nothing else yet)', JSON.stringify(opts) === JSON.stringify(['يعفور', 'قرى الشام', 'الصبورة', '＋ منطقة جديدة…']), opts.join('|'));
ok('the new-area fields are hidden until chosen', await p.evaluate(() => document.getElementById('newAreaBox').hidden));
await p.selectOption('#f_area', '__new__'); ok('choosing it reveals name / slug / region', !(await p.evaluate(() => document.getElementById('newAreaBox').hidden)));
await p.fill('#f_area_new', 'صحنايا');
ok('a known area suggests its existing slug (sahnaya)', (await p.inputValue('#f_area_slug')) === 'sahnaya', await p.inputValue('#f_area_slug'));
await p.fill('#f_area_new', 'جرمانا');
const sug = await p.inputValue('#f_area_slug'); ok('a new name gets a valid suggested slug', /^[a-z][a-z0-9-]{1,30}$/.test(sug), sug);
ok('region defaults to ريف دمشق', (await p.inputValue('#f_area_region')) === 'ريف دمشق'); await p.click('#closeBtn');

console.log('=== 2) منطقة جديدة كاملة ===');
await addListing(p, { title: 'أرض في جرمانا', cat: 'أرض', newArea: { name: 'جرمانا', slug: 'jaramana' }, land: 2, price: 300000 });
let row = await p.evaluate(() => ROWS[ROWS.length - 1]);
ok('saved with its area, slug (no region stored when default)', row.area === 'جرمانا' && row.area_slug === 'jaramana' && row.area_region === undefined, JSON.stringify([row.area, row.area_slug, row.area_region]));
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]'); opts = await areaOpts(p); await p.click('#closeBtn');
ok('the new area now appears in the list (after the core ones)', JSON.stringify(opts) === JSON.stringify(['يعفور', 'قرى الشام', 'الصبورة', 'جرمانا', '＋ منطقة جديدة…']), opts.join('|'));
await addListing(p, { title: 'فيلا في جرمانا', area: 'جرمانا', price: 650000 });
ok('a second listing in it just picks the area (no slug needed)', (await p.evaluate(() => ROWS[ROWS.length - 1])).area_slug === 'jaramana');
await addListing(p, { title: 'شقة في المزة', cat: 'شقة', newArea: { name: 'المزة', slug: 'mazzeh', region: 'دمشق' }, land: 1, bua: 120, price: 240000 });
ok('a region outside ريف دمشق is kept on the listing', (await p.evaluate(() => ROWS[ROWS.length - 1])).area_region === 'دمشق');
let m = await publishNow(p); ok('publish succeeds with the new areas (quality check passes)', /اننشر/.test(m), m);
const F = PUB.files, codeJ = (await p.evaluate(() => ROWS.find(r => r.title === 'أرض في جرمانا').code)), codeM = await p.evaluate(() => ROWS.find(r => r.title === 'شقة في المزة').code);
ok('jaramana.html exists with both listings and the right heading', F.has('jaramana.html') && /عقارات جرمانا/.test(F.get('jaramana.html')) && F.get('jaramana.html').includes(codeJ), '');
ok('the listing page links to its own area page', F.get(`listing/${codeJ}.html`).includes('jaramana.html'));
ok('sitemap lists every new area page', ['jaramana.html', 'mazzeh.html'].every(x => F.get('sitemap.xml').includes('/' + x)));
ok('homepage filter and request form offer the new areas', ['جرمانا', 'المزة'].every(a => F.get('index.html').includes(`<option value="${a}">`)) && (F.get('index.html').match(/<option value="جرمانا">/g) || []).length >= 2);
ok('region is per area: Mazzeh says دمشق (not ريف دمشق), Jaramana says ريف دمشق', /المزة · دمشق/.test(F.get(`listing/${codeM}.html`)) && !/المزة · ريف دمشق/.test(F.get(`listing/${codeM}.html`)) && /"addressRegion":"دمشق"/.test(F.get(`listing/${codeM}.html`)) && /جرمانا · ريف دمشق/.test(F.get(`listing/${codeJ}.html`)));
ok('public data.json never carries the internal slug/region fields', !/area_slug|area_region/.test(F.get('data.json')));
ok('the owner\'s brand copy is untouched (specialised in his 3 areas)', /أعمل في يعفور وقرى الشام والصبورة بريف دمشق/.test(F.get('index.html')) && !/جرمانا|المزة/.test((F.get('index.html').match(/<title>[^<]*<\/title>/) || [''])[0]) && /<h2 class="h2 rv">من أنا<\/h2>\s*<p class="rv">[^<]*يعفور وقرى الشام والصبورة[^<]*<\/p>/.test(F.get('index.html')));
ok('core area pages keep their exact URLs', F.has('yaafour.html') && F.has('qura-alsham.html'));

console.log('=== 3) أخطاء الرابط ===');
async function tryNew(name, slug, region) { await p.click('#addBtn'); await p.waitForSelector('#dlg[open]'); await p.selectOption('#f_area', '__new__'); await p.fill('#f_title', 'اختبار ' + name); await p.fill('#f_area_new', name); await p.fill('#f_area_slug', slug); if (region) await p.fill('#f_area_region', region); await p.fill('#f_land', '1'); await p.fill('#f_price', '400000'); await p.click('#saveBtn'); await p.waitForTimeout(200); const err = await p.textContent('#err'); const still = await dlgOpen(p); await p.click('#closeBtn').catch(() => {}); return { err, still }; }
const n0 = await p.evaluate(() => ROWS.length);
let r1 = await tryNew('منطقة أ', 'jaramana'); ok('duplicate slug is refused (names the other area)', r1.still && /جرمانا/.test(r1.err), r1.err);
r1 = await tryNew('منطقة ب', 'Bad Slug'); ok('spaces / capitals are refused', r1.still && /حروف إنكليزية صغيرة/.test(r1.err), r1.err);
r1 = await tryNew('منطقة ج', 'admin'); ok('reserved names are refused', r1.still && /محجوز/.test(r1.err), r1.err);
r1 = await tryNew('منطقة د', 'land-yaafour'); ok('a slug that would collide with an existing page name is refused', r1.still && /يتعارض|مستعمل/.test(r1.err), r1.err);
r1 = await tryNew('منطقة هـ', 'x'); ok('too short is refused', r1.still && /حروف إنكليزية/.test(r1.err), r1.err);
ok('none of the five refused attempts saved anything', (await p.evaluate(() => ROWS.length)) === n0);
r1 = await tryNew('منطقة و', 'ok-slug'); ok('a clean new slug is accepted and saved', !r1.still && (await p.evaluate(() => ROWS.length)) === n0 + 1 && (await p.evaluate(() => ROWS[ROWS.length - 1].area_slug)) === 'ok-slug');
await p.evaluate(() => { ROWS = ROWS.filter(r => !/^اختبار /.test(r.title)); render(); });
const nx = await p.evaluate(() => ROWS.length);
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]'); await p.selectOption('#f_area', '__new__'); await p.fill('#f_title', 'مكرر'); await p.fill('#f_area_new', ' جرمانا '); await p.fill('#f_land', '1'); await p.fill('#f_price', '380000'); await p.click('#saveBtn'); await p.waitForTimeout(250);
ok('typing an existing area name reuses it (no slug asked, no duplicate area)', (await p.evaluate(() => ROWS.length)) === nx + 1 && (await p.evaluate(() => { const a = new Set(ROWS.map(r => r.area)); return a.has('جرمانا') && ![...a].some(x => x !== x.trim() || /^\s|\s$/.test(x)); })));

console.log('=== 4) اختفاء المنطقة عند انتهاء عقاراتها ===');
await p.evaluate(() => { for (const r of ROWS) if (r.area === 'جرمانا') { r.status = 'مباع'; r.soldAt = '2026-09-30'; } render(); });
PUB.deleted = []; m = await publishNow(p);
ok('publish ok', /اننشر/.test(m), m);
ok('the emptied area page is deleted', PUB.deleted.includes('jaramana.html') && !PUB.files.has('jaramana.html'), PUB.deleted.filter(x => !/^listing\//.test(x)).join(','));
ok('its sitemap entry and homepage option are gone', !PUB.files.get('sitemap.xml').includes('jaramana') && !PUB.files.get('index.html').includes('value="جرمانا"'));
ok('other areas and the protected root files are never touched', PUB.files.has('mazzeh.html') && PUB.files.has('yaafour.html') && !PUB.deleted.some(x => ['index.html', '404.html', 'admin.html'].includes(x) || /^google/.test(x)), PUB.deleted.filter(x => !/^listing\/|^og\//.test(x)).join(','));
ok('the sold listings stay in the private inventory (and the area stays selectable for them)', await p.evaluate(() => { syncAreas(ROWS); return AREA_ORDER.includes('جرمانا'); }));

console.log('=== 5) نقل عقار لمنطقة أساسية ===');
await p.evaluate(() => openForm(ROWS.find(r => r.title === 'شقة في المزة')));
await p.selectOption('#f_area', 'يعفور'); await p.click('#saveBtn'); await p.waitForTimeout(250);
row = await p.evaluate(() => ROWS.find(r => r.title === 'شقة في المزة'));
ok('moving a listing to a core area drops its old slug/region fields', row.area === 'يعفور' && row.area_slug === undefined && row.area_region === undefined, JSON.stringify([row.area, row.area_slug, row.area_region]));
m = await publishNow(p); ok('the now-empty Mazzeh page is deleted on the next publish', PUB.deleted.includes('mazzeh.html') && !PUB.files.has('mazzeh.html'), m);
console.log('page errors:', errs);
await b.close();
