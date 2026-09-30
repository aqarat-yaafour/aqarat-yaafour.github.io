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
const PUB = { files: new Map() };
const S = { commits: [], patches: 0, failFirstPatch: false, patchFailed: false, privWrites: 0 };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, ignoreHTTPSErrors: true });
const blobs = {};
let bn = 0;
await ctx.route('https://api.github.com/**', async r => {
  const u = new URL(r.request().url()), m = r.request().method(), p = u.pathname, json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  const repo = (p.match(/^\/repos\/[^/]+\/([^/]+)/) || [])[1];
  if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) return json({ permissions: { push: true } });
  if (/\/contents\//.test(p)) { if (repo === 'mk-inventory' && /private\.json$/.test(p)) return json({ content: Buffer.from(remote.text).toString('base64'), sha: remote.sha }); return json({ message: 'nf' }, 404); }
  if (/\/git\/ref\/heads\/main$/.test(p)) return json({ object: { sha: 'HEAD0' } });
  if (/\/git\/commits\/HEAD0$/.test(p)) return json({ tree: { sha: 'TREE0' } });
  if (/\/git\/trees\/(HEAD0|TREE0)$/.test(p)) return json({ tree: repo === 'mk-inventory' ? [{ type: 'blob', path: 'private.json', sha: remote.sha }] : [] });
  if (/\/git\/blobs$/.test(p)) { const id = 'B' + (++bn); blobs[id] = JSON.parse(r.request().postData()); return json({ sha: id }); }
  if (/\/git\/trees$/.test(p) && m === 'POST') { const body = JSON.parse(r.request().postData()); if (repo === 'mk-inventory') { const e = body.tree.find(x => x.path === 'private.json'); if (e) { setRemote(JSON.parse(e.content)); S.privWrites++; } } if (repo !== 'mk-inventory') for (const e of body.tree) if (e.sha !== null) PUB.files.set(e.path, e.content !== undefined ? e.content : (blobs[e.sha] && blobs[e.sha].encoding !== 'base64' ? blobs[e.sha].content : '(binary)')); S.commits.push(repo); return json({ sha: 'T' + S.commits.length }); }
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


console.log('=== منطقة جديدة: صحنايا ===');
setRemote(mkRows()); answer = true;
let p = await open();
const opts = await p.evaluate(() => [...document.querySelectorAll('#f_area option')].map(o => o.textContent));
ok('the form offers صحنايا besides the three existing areas', JSON.stringify(opts) === JSON.stringify(['يعفور', 'قرى الشام', 'الصبورة', 'صحنايا']), opts.join('|'));
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
await p.selectOption('#f_cat', 'فيلا'); await p.selectOption('#f_area', 'صحنايا');
await p.fill('#f_title', 'فيلا في صحنايا بإطلالة'); await p.fill('#f_land', '0.5'); await p.fill('#f_bua', '240'); await p.fill('#f_price', '420000');
await p.fill('#p_place', 'مالك مباشر — تواصل بتاريخ اليوم'); await p.fill('#p_comm', '2%');
await p.click('#saveBtn'); await p.waitForTimeout(250);
const row = await p.evaluate(() => ROWS[ROWS.length - 1]);
ok('saved with area صحنايا and the private source fields', row.area === 'صحنايا' && row.src_place.startsWith('مالك') && row.commission === '2%', JSON.stringify([row.area, row.src_place, row.commission]));
await p.evaluate(() => { VERIFY.every = 100; VERIFY.max = 600; });
await p.click('#pubBtn');
const t0 = Date.now(); while (!/اننشر|ما زبط/.test(await p.textContent('#pubMsg')) && Date.now() - t0 < 15000) await p.waitForTimeout(100);
const msg = await p.textContent('#pubMsg'); ok('publish succeeds (quality check passes with the new area)', /اننشر/.test(msg), msg);
const F = PUB.files, code = row.code;
ok('an area page sahnaya.html is created with the listing', F.has('sahnaya.html') && F.get('sahnaya.html').includes(code) && /عقارات صحنايا/.test(F.get('sahnaya.html')));
ok('the listing page links back to its area page', F.has(`listing/${code}.html`) && F.get(`listing/${code}.html`).includes('sahnaya.html'));
ok('sitemap lists the new area page and the listing', F.get('sitemap.xml').includes('/sahnaya.html') && F.get('sitemap.xml').includes(`/listing/${code}.html`));
ok('homepage filter offers صحنايا', /<option value="صحنايا">/.test(F.get('index.html')));
ok('share card was drawn for it', [...F.keys()].some(k => k.startsWith(`og/${code}-`)));
ok('brand copy was NOT touched (still the owner\'s three areas)', /أعمل في يعفور وقرى الشام والصبورة بريف دمشق/.test(F.get('index.html')));
ok('existing areas still produce their pages', F.has('yaafour.html') && F.has('qura-alsham.html'));
ok('private source fields never reach the public files', ![...F.values()].some(v => typeof v === 'string' && /مالك مباشر|"commission"/.test(v)));
console.log('page errors:', errs);
await b.close();
