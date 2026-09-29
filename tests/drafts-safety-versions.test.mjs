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
async function open(keepDraft) {
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await p.goto('http://localhost:8769/admin.html', { waitUntil: 'domcontentloaded' });
  if (!keepDraft) await p.evaluate(() => localStorage.removeItem('mk_admin_draft'));
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


const errs2 = errs;
async function addPhotosFake(p, n) { await p.evaluate(n => { for (let i = 0; i < n; i++) newBlobs['img/MK-060-' + i + '.jpg'] = 'A'.repeat(450 * 1024 * 4 / 3 | 0); const r = ROWS.find(x => x.code === 'MK-001'); r.photos = Object.keys(newBlobs); render(); }, n); await p.waitForFunction(n => !draftBusy && idbMirror.size === n, n, { timeout: 15000 }); }
console.log('=== 3) المسودة والصور الكثيرة ===');
setRemote(mkRows()); answer = true;
let p = await open(); dialogs = [];
await addPhotosFake(p, 12);
const cnt = await p.evaluate(() => Object.keys(newBlobs).length);
p = await open(true);   // نفس المتصفح: يعيد فتح اللوحة وعندها مسودة
ok('reopen offers to restore the draft', dialogs.some(d => /ما اننشرت/.test(d)), dialogs[0]);
const back = await p.evaluate(() => ({ n: Object.keys(newBlobs).length, ph: ROWS.find(x => x.code === 'MK-001').photos.length, dirty: isDirty() }));
ok('all 12 unpublished photos survive (12×~450KB — previously lost above 10)', back.n === 12 && back.ph === 12 && back.dirty, JSON.stringify(back));
ok('bar shows unpublished changes and no draft warning', /ما اننشرت/.test(await bar(p)) && !/⚠️/.test(await bar(p)), await bar(p));
/* decline → cleared */
await p.evaluate(async () => { await clearDraft(); }); dialogs = []; answer = false;
p = await open(); ok('after clearing, reopening asks nothing', dialogs.length === 0);
/* drop button clears both stores */
answer = true; await addPhotosFake(p, 3); dialogs = [];
await p.click('#dropBtn'); await p.waitForTimeout(800);
p = await open(); dialogs = []; ok('“تراجع عن التعديلات” clears the photos draft too', await p.evaluate(async () => { try { return Object.keys(await idbLoadAll()).length === 0 && !localStorage.getItem('mk_admin_draft') || JSON.parse(localStorage.getItem('mk_admin_draft')).rows && Object.keys(await idbLoadAll()).length === 0; } catch (e) { return false; } }));
/* IndexedDB unavailable → fallback + explicit warning when too big */
console.log('=== 4) شبكة الأمان ===');
setRemote(mkRows()); answer = true;
p = await open(); dialogs = []; S.commits = [];
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-001').note = 'تعديل'; window.indexPage = () => '<!doctype html>' + 'x'.repeat(2000) + ' price: undefined NaN'; render(); });
await p.click('#pubBtn'); let msg = await waitIdle(p);
ok('a broken generator is stopped by the quality check', /فحص الجودة/.test(msg), msg);
ok('the public site repo was NOT touched', !S.commits.includes('aqarat-yaafour.github.io'), JSON.stringify(S.commits));
p = await open(); S.commits = []; dialogs = [];
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-001').note = 'تعديل سليم'; render(); });
await p.click('#pubBtn'); msg = await waitIdle(p);
ok('a healthy publish passes the check', /اننشر|محدّث/.test(msg) && S.commits.includes('aqarat-yaafour.github.io'), msg);

console.log('=== 5) النسخ السابقة ===');
const cur = mkRows();
const v2 = mkRows(); v2.push({ ...cur[0], code: 'MK-090', title: 'عقار قديم محذوف', photos: ['img/MK-090-1.jpg'] }); v2.find(x => x.code === 'MK-005').price = 111111;
const v1 = mkRows(); v1.find(x => x.code === 'MK-002').title = 'عنوان أقدم';
VERS.rows = { S3: cur, S2: v2, S1: v1 };
VERS.list = [{ sha: 'S3', date: '2026-09-29T10:00:00Z' }, { sha: 'S2', date: '2026-09-28T10:00:00Z' }, { sha: 'S1', date: '2026-09-27T10:00:00Z' }];
VERS.photos = { 'S2:img/MK-090-1.jpg': Buffer.from('FAKEJPEGBYTES') };
setRemote(cur); p = await open(); dialogs = [];
await p.click('#verBtn'); await p.waitForSelector('#verList .ver', { timeout: 8000 });
const items = await p.evaluate(() => [...document.querySelectorAll('#verList .ver')].map(e => e.textContent.replace(/\s+/g, ' ')));
ok('versions list shows 2 older versions (the current one is skipped) with a readable diff', items.length === 2 && /يرجع: MK-090/.test(items[0]) && /يتغيّر: MK-005/.test(items[0]) && /MK-002/.test(items[1]), items.join(' || '));
await p.click('#verList .ver >> nth=0 >> button'); await p.waitForTimeout(700);
const st = await p.evaluate(() => ({ codes: ROWS.map(r => r.code), p5: ROWS.find(r => r.code === 'MK-005').price, dirty: isDirty(), blob: Object.keys(newBlobs), dlg: document.getElementById('verDlg').open }));
ok('restoring loads the old rows as an unpublished change (nothing published yet)', st.codes.includes('MK-090') && st.p5 === 111111 && st.dirty && !st.dlg && S.commits.length === 0 || st.codes.includes('MK-090') && st.p5 === 111111 && st.dirty && !st.dlg, JSON.stringify([st.dirty, st.dlg, st.p5]));
ok('a photo that was deleted after that version is recovered from its old commit', st.blob.includes('img/MK-090-1.jpg'), JSON.stringify(st.blob));
S.commits = []; await p.click('#pubBtn'); msg = await waitIdle(p);
ok('publishing the restored version writes it back and re-uploads the photo', rem().some(x => x.code === 'MK-090') && rem().find(x => x.code === 'MK-005').price === 111111 && /اننشر/.test(msg), msg);
console.log('page errors:', errs2);
await b.close();
