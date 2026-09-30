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
async function addInvest(p, title, price, feats) {
  await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
  await p.selectOption('#f_cat', 'استثماري'); await p.fill('#f_title', title);
  if ((await p.evaluate(() => [...document.querySelectorAll('#f_area option')].map(o => o.value))).includes('صحنايا')) await p.selectOption('#f_area', 'صحنايا');
  else { await p.selectOption('#f_area', '__new__'); await p.fill('#f_area_new', 'صحنايا'); }
  await p.fill('#f_land', '8.5'); await p.fill('#f_bua', '7980'); await p.fill('#f_price', String(price)); await p.selectOption('#f_papers', 'طابو أخضر');
  for (const f of feats) { await p.fill('#f_featIn', f); await p.press('#f_featIn', 'Enter'); }
  await p.click('#saveBtn'); await p.waitForTimeout(250);
  return p.evaluate(() => ROWS[ROWS.length - 1]);
}

console.log('=== التصنيف الجديد «استثماري» ===');
setRemote(mkRows()); answer = true;
let p = await open();
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
const cats = await p.evaluate(() => [...document.querySelectorAll('#f_cat option')].map(o => o.textContent));
ok('the form offers the new category after the four old ones', JSON.stringify(cats) === JSON.stringify(['أرض', 'فيلا', 'مزرعة', 'شقة', 'استثماري']), cats.join('|')); await p.click('#closeBtn');
ok('the admin has a filter chip for it', await p.evaluate(() => !!document.querySelector('#filters button[data-f="استثماري"]')));
dialogs = [];
const r1 = await addInvest(p, 'أرض وأبنية استثمارية على أوتستراد دمشق – صحنايا', 5000000, ['ترخيص استثماري حتى 14 طابقاً', 'واجهة 70 م على الأوتستراد', 'مركز تحويل كهرباء خاص']);
ok('saved as category استثماري with NO price or duplicate warning (5M / 8.5 dunam is in range)', r1.cat === 'استثماري' && r1.price === 5000000 && r1.area === 'صحنايا' && dialogs.length === 0, dialogs.join(' | '));
const r2 = await addInvest(p, 'مجمع تجاري قائم في صحنايا', 2200000, ['واجهة على الطريق الرئيسي']);
await p.click('#filters button[data-f="استثماري"]'); await p.waitForTimeout(150);
ok('the chip shows only the investment listings', JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('#grid .card .code')].map(e => e.textContent))) === JSON.stringify([r1.code, r2.code]));
ok('the post caption uses its own hashtag', await p.evaluate(r => /#عقارات_استثمارية/.test(postCaption(r)) && !/undefined/.test(postCaption(r)), r1));
await p.evaluate(() => { VERIFY.every = 100; VERIFY.max = 400; });
await p.click('#filters button[data-f="all"]');
const msg = await publishNow(p); ok('publish succeeds (quality check passes with the new category)', /اننشر/.test(msg), msg);
const F = PUB.files;
ok('public data carries the category key "invest"', JSON.parse(F.get('data.json')).filter(x => x.cat === 'invest').length === 2);
ok('listing page says للبيع · استثماري', /للبيع · استثماري/.test(F.get(`listing/${r1.code}.html`)));
ok('homepage filter offers استثماري, and so does the request form', /<option value="invest">استثماري<\/option>/.test(F.get('index.html')) && /<option value="استثماري">استثماري<\/option>/.test(F.get('index.html')));
ok('two listings in one area → a category page exists with its own heading', F.has('investment-sahnaya.html') && /عقارات استثمارية للبيع في صحنايا/.test(F.get('investment-sahnaya.html')));
ok('sitemap lists it', F.get('sitemap.xml').includes('/investment-sahnaya.html'));
ok('a share card was drawn for each', [r1.code, r2.code].every(c => [...F.keys()].some(k => k.startsWith(`og/${c}-`))));
ok('the four old categories are untouched in the filter', ['land', 'villa', 'farm', 'apt'].every(k => F.get('index.html').includes(`<option value="${k}">`)));

console.log('=== رسمه في المتصفح ===');
const v = await ctx.newPage(); const verrs = []; v.on('pageerror', e => verrs.push(e.message)); await v.setViewportSize({ width: 390, height: 844 });
await v.route('https://aqarat-yaafour.github.io/**', r => {
  const u = new URL(r.request().url()); let pth = decodeURIComponent(u.pathname).replace(/^\//, ''); if (pth === '') pth = 'index.html';
  if (PUB.files.has(pth) && /\.(html)$/.test(pth)) return r.fulfill({ status: 200, body: PUB.files.get(pth), contentType: 'text/html' });
  const fp = path.join(REPO, pth); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { const ext = fp.split('.').pop(); return r.fulfill({ status: 200, body: fs.readFileSync(fp), contentType: { css: 'text/css', js: 'text/javascript', woff2: 'font/woff2', jpg: 'image/jpeg', svg: 'image/svg+xml', png: 'image/png', json: 'application/json' }[ext] || 'application/octet-stream' }); }
  return r.fulfill({ status: 404, body: '' });
});
const painted = (sel) => v.evaluate(sel => { const c = document.querySelector(sel); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 61) if (d[i]) n++; return n; }, sel);
await v.goto(`https://aqarat-yaafour.github.io/listing/${r1.code}.html`, { waitUntil: 'load' }); await v.waitForTimeout(1500);
ok('the listing page draws its 3D tile', (await painted('#tile3d')) > 300, String(await painted('#tile3d')));
await v.goto('https://aqarat-yaafour.github.io/', { waitUntil: 'load' }); await v.waitForTimeout(1500);
ok('the homepage hero draws with the new type among the parcels', (await painted('#hero3d')) > 300);
ok('its row has a drawn thumbnail and the filter works', await v.evaluate(() => !!document.querySelector('.row .cover[data-cat="invest"] svg')));
await v.selectOption('#fCat', 'invest'); await v.waitForTimeout(250);
ok('filtering by it shows exactly the two', (await v.evaluate(() => [...document.querySelectorAll('#listings-grid .row')].filter(r => !r.hidden).length)) === 2);
await v.goto('https://aqarat-yaafour.github.io/investment-sahnaya.html', { waitUntil: 'load' }); await v.waitForTimeout(800);
ok('the category page renders its listings', (await v.evaluate(() => document.querySelectorAll('.row').length)) === 2);
ok('no page errors anywhere', verrs.length === 0 && errs.length === 0, JSON.stringify(verrs.concat(errs)));
console.log('page errors:', errs.concat(verrs));
await b.close();
