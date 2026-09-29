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
const VERS = { list: [], rows: {}, photos: {} };
const S = { commits: [], patches: 0, failFirstPatch: false, patchFailed: false, privWrites: 0 };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, ignoreHTTPSErrors: true });
const blobs = {};
let bn = 0;
await ctx.route('https://api.github.com/**', async r => {
  const u = new URL(r.request().url()), m = r.request().method(), p = u.pathname, json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  const repo = (p.match(/^\/repos\/[^/]+\/([^/]+)/) || [])[1];
  if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) return json({ permissions: { push: true } });
  if (repo === 'mk-inventory' && /\/commits$/.test(p) && m === 'GET') return json(VERS.list.map(v => ({ sha: v.sha, commit: { message: 'تحديث', committer: { date: v.date } } })));
  if (/\/contents\//.test(p)) { const ref = u.searchParams.get('ref'); if (ref && repo === 'mk-inventory') { if (/private\.json$/.test(p)) { const t = JSON.stringify(VERS.rows[ref]); return json({ content: Buffer.from(t).toString('base64'), sha: 'x' + ref }); } const ph = VERS.photos[ref + ':' + decodeURIComponent(p.split('/contents/')[1])]; return ph ? r.fulfill({ status: 200, body: ph }) : json({ message: 'nf' }, 404); } if (repo === 'mk-inventory' && /private\.json$/.test(p)) return json({ content: Buffer.from(remote.text).toString('base64'), sha: remote.sha }); return json({ message: 'nf' }, 404); }
  if (/\/git\/ref\/heads\/main$/.test(p)) return json({ object: { sha: 'HEAD0' } });
  if (/\/git\/commits\/HEAD0$/.test(p)) return json({ tree: { sha: 'TREE0' } });
  if (/\/git\/trees\/(HEAD0|TREE0)$/.test(p)) return json({ tree: repo === 'mk-inventory' ? [{ type: 'blob', path: 'private.json', sha: remote.sha }] : [] });
  if (/\/git\/blobs$/.test(p)) { const id = 'B' + (++bn); blobs[id] = JSON.parse(r.request().postData()); return json({ sha: id }); }
  if (/\/git\/trees$/.test(p) && m === 'POST') { const body = JSON.parse(r.request().postData()); if (repo === 'mk-inventory') { const e = body.tree.find(x => x.path === 'private.json'); if (e) { setRemote(JSON.parse(e.content)); S.privWrites++; } } S.commits.push(repo); return json({ sha: 'T' + S.commits.length }); }
  if (/\/git\/commits$/.test(p) && m === 'POST') return json({ sha: 'C' + (S.commits.length) });
  if (/\/git\/refs\/heads\/main$/.test(p) && m === 'PATCH') { S.patches++; if (S.failFirstPatch && !S.patchFailed) { S.patchFailed = true; return json({ message: 'Update is not a fast forward' }, 422); } return json({}); }
  return json({ message: 'unmocked ' + p }, 500);
});
await ctx.route('http://localhost:8769/**', async r => { const f = decodeURIComponent(new URL(r.request().url()).pathname); const fp = path.join(REPO, f); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, body: fs.readFileSync(fp), contentType: fp.endsWith('.html') ? 'text/html' : fp.endsWith('.js') ? 'text/javascript' : fp.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); return r.fulfill({ status: 404, body: '' }); });
const ok = (n, c, extra = '') => console.log(c ? 'PASS' : 'FAIL', n, extra);
const errs = [];
let dialogs = [], answer = true;
async function open() {
  const p = await ctx.newPage(); await p.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined }); }); p.on('pageerror', e => errs.push(e.message));
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
async function addVilla(p, price, land = '', mode = null) {
  await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
  await p.selectOption('#f_cat', 'فيلا'); await p.fill('#f_title', 'فيلا اختبار');
  await p.fill('#f_bua', '300'); await p.fill('#f_price', price); if (land) await p.fill('#f_land', land);
  if (mode) await p.click(`#modeSeg button[data-m="${mode}"]`);
  await p.click('#saveBtn'); await p.waitForTimeout(250);
}



console.log('=== IndexedDB غير متاح (تصفح خاص) ===');
setRemote(mkRows()); answer = true;
let p = await open(); dialogs = [];
await p.evaluate(() => { for (let i = 0; i < 2; i++) newBlobs['img/MK-060-' + i + '.jpg'] = 'A'.repeat(40 * 1024); ROWS.find(x => x.code === 'MK-001').photos = Object.keys(newBlobs); render(); });
await p.waitForTimeout(500);
ok('small draft still saved (localStorage fallback, with photos)', await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('mk_admin_draft')); return d && d.blobs && Object.keys(d.blobs).length === 2; }), await bar(p));
ok('no warning while it fits', !/⚠️/.test(await bar(p)));
await p.evaluate(() => { for (let i = 0; i < 12; i++) newBlobs['img/MK-070-' + i + '.jpg'] = 'A'.repeat(450 * 1024 * 4 / 3 | 0); ROWS.find(x => x.code === 'MK-001').photos = Object.keys(newBlobs); render(); });
await p.waitForTimeout(500);
ok('when it cannot be saved the bar warns explicitly (no silent loss)', /⚠️.*انشر الآن/.test(await bar(p)), await bar(p));
await p.evaluate(() => { newBlobs = {}; ROWS.find(x => x.code === 'MK-001').photos = []; render(); }); await p.waitForTimeout(300);
ok('warning clears once the draft fits again', !/⚠️/.test(await bar(p)), await bar(p));
console.log('page errors:', errs);
await b.close();
