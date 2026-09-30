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

console.log('=== 1) الأرقام العربية ===');
setRemote(mkRows());
let p = await open();
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
await p.fill('#f_title', 'أرقام عربية');
await p.click('#f_land'); await p.keyboard.type('٥');
await p.click('#f_bua'); await p.keyboard.type('٣٠٠');
await p.click('#f_price'); await p.keyboard.type('٢٥٠٬٠٠٠');
ok('Arabic digits become Latin in the fields', (await p.inputValue('#f_land')) === '5' && (await p.inputValue('#f_bua')) === '300' && (await p.inputValue('#f_price')) === '250,000', `(land=${await p.inputValue('#f_land')} bua=${await p.inputValue('#f_bua')} price=${await p.inputValue('#f_price')})`);
ok('total updates live (5 dunam? mode=total → 250 ألف)', /250/.test(await p.textContent('#totalVal')), await p.textContent('#totalVal'));
await p.click('#saveBtn'); await p.waitForTimeout(250);
let row = await p.evaluate(() => ROWS[ROWS.length - 1]);
ok('saved with price 250000 / area 5000 m2 / bua 300', row.price === 250000 && row.area_m2 === 5000 && row.bua === 300, JSON.stringify([row.price, row.area_m2, row.bua]));
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
await p.fill('#f_title', 'فاصلة عشرية'); await p.fill('#f_land', '1,5'); await p.fill('#f_price', '200000');
await p.click('#saveBtn'); await p.waitForTimeout(250);
row = await p.evaluate(() => ROWS[ROWS.length - 1]); ok('"1,5" dunam = 1500 m2', row.area_m2 === 1500, row.area_m2);
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
await p.fill('#f_title', 'سعر خاطئ'); await p.fill('#f_land', '2'); await p.fill('#f_price', 'abc'); await p.click('#saveBtn'); await p.waitForTimeout(150);
ok('garbage price is rejected with a clear message', /اكتب السعر/.test(await p.textContent('#err')) && await p.evaluate(() => document.getElementById('dlg').open));
await p.click('#closeBtn');
ok('code field accepts Arabic digits (MK-٠٣٠ → MK-030)', await (async () => { await p.click('#addBtn'); await p.waitForSelector('#dlg[open]'); await p.fill('#f_code', ''); await p.click('#f_code'); await p.keyboard.type('mk-٠٣٠'); const v = await p.inputValue('#f_code'); await p.click('#closeBtn'); return v.toUpperCase() === 'MK-030'; })());

console.log('=== 2) فحص الأسعار الشاذة ===');
p = await open(); dialogs = []; answer = false;
const n0 = await p.evaluate(() => ROWS.length);
await addVilla(p, '25000000');
ok('villa at 25,000,000 triggers a warning', dialogs.length === 1 && /دقّق السعر/.test(dialogs[0]), (dialogs[0] || '').replace(/\n/g, ' | '));
ok('cancel keeps the form open and saves nothing', (await p.evaluate(() => document.getElementById('dlg').open)) && (await p.evaluate(() => ROWS.length)) === n0);
answer = true; dialogs = []; await p.click('#saveBtn'); await p.waitForTimeout(250);
ok('accepting the warning saves the row', dialogs.length === 1 && (await p.evaluate(() => ROWS.length)) === n0 + 1);
dialogs = []; await addVilla(p, '650000');
ok('a normal villa price shows no warning', dialogs.length === 0 && (await p.evaluate(() => ROWS.length)) === n0 + 2);
dialogs = []; answer = false; await addVilla(p, '250000', '5', 'للدنم'.replace('للدنم', 'للدنم'));
ok('normal land per-dunam price (250k) shows no warning', dialogs.length === 0, dialogs[0] || '');
dialogs = []; await p.evaluate(() => {}); await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
await p.selectOption('#f_cat', 'أرض'); await p.fill('#f_title', 'أرض خطأ'); await p.fill('#f_land', '5'); await p.click('#modeSeg button[data-m="للدنم"]'); await p.fill('#f_price', '25000000'); await p.click('#saveBtn'); await p.waitForTimeout(250);
ok('land at 25,000,000 per dunam triggers a per-dunam warning', dialogs.length === 1 && /سعر الدنم/.test(dialogs[0]), (dialogs[0] || '').replace(/\n/g, ' | ')); await p.click('#closeBtn');
dialogs = []; answer = false;
await p.evaluate(() => openForm(ROWS.find(r => r.code === 'MK-003')));
await p.fill('#f_title', 'عنوان جديد فقط'); await p.click('#saveBtn'); await p.waitForTimeout(250);
ok('editing a listing without changing its price never nags', dialogs.length === 0 && !(await p.evaluate(() => document.getElementById('dlg').open)));

console.log('=== 3) حماية النشر من الكتابة فوق جهاز آخر ===');
answer = true;
/* C1: الجهاز الآخر عدّل عقاراً غير الذي عدّلته أنت */
setRemote(mkRows()); p = await open(); dialogs = []; S.commits = []; S.privWrites = 0;
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-001').note = 'تعديل من هذا الجهاز'; render(); });
{ const r = rem(); r.find(x => x.code === 'MK-005').note = 'تعديل من الجهاز الآخر'; r.push({ ...r[0], code: 'MK-090', title: 'عقار أضافه الجهاز الآخر' }); setRemote(r); }
await p.click('#pubBtn'); let msg = await waitIdle(p);
let R = rem();
ok('C1 both devices\' edits survive (no prompt)', dialogs.length === 0 && R.find(x => x.code === 'MK-001').note === 'تعديل من هذا الجهاز' && R.find(x => x.code === 'MK-005').note === 'تعديل من الجهاز الآخر' && R.some(x => x.code === 'MK-090'), msg);
ok('C1 message names what was merged', /MK-005/.test(msg) || /MK-090/.test(msg), msg);
/* نفس الجلسة: تعديل ثانٍ ونشر — لا تعارض كاذب */
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-002').note = 'تعديل ثانٍ'; render(); }); dialogs = [];
await p.click('#pubBtn'); msg = await waitIdle(p); ok('C1b a second publish in the same session has no false conflict', dialogs.length === 0 && rem().find(x => x.code === 'MK-002').note === 'تعديل ثانٍ' && /اننشر/.test(msg), msg);
/* C2: تعارض على نفس العقار */
setRemote(mkRows()); p = await open(); dialogs = []; S.privWrites = 0; answer = false;
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-001').note = 'نسختي'; render(); });
{ const r = rem(); r.find(x => x.code === 'MK-001').note = 'نسخة الجهاز الآخر'; setRemote(r); }
await p.click('#pubBtn'); msg = await waitIdle(p);
ok('C2 conflict asks, and cancel stops publish with nothing written', dialogs.length === 1 && /MK-001/.test(dialogs[0]) && S.privWrites === 0 && rem().find(x => x.code === 'MK-001').note === 'نسخة الجهاز الآخر' && /توقّف|ما زبط/.test(msg), msg);
answer = true; dialogs = []; await p.click('#pubBtn'); msg = await waitIdle(p);
ok('C2b accepting keeps my version for the conflicting row', rem().find(x => x.code === 'MK-001').note === 'نسختي' && /اننشر/.test(msg), msg);
/* C3: لا تغيير بعيد → لا أسئلة */
setRemote(mkRows()); p = await open(); dialogs = [];
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-004').note = 'عادي'; render(); }); await p.click('#pubBtn'); msg = await waitIdle(p);
ok('C3 unchanged remote: publishes with no prompt', dialogs.length === 0 && rem().find(x => x.code === 'MK-004').note === 'عادي', msg);
/* C4: الجهاز الآخر حذف عقاراً لم أعدّله */
setRemote(mkRows()); p = await open(); dialogs = [];
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-001').note = 'س'; render(); });
{ const r = rem().filter(x => x.code !== 'MK-010'); setRemote(r); }
await p.click('#pubBtn'); msg = await waitIdle(p);
ok('C4 a listing deleted on the other device stays deleted', !rem().some(x => x.code === 'MK-010') && rem().find(x => x.code === 'MK-001').note === 'س', msg);

console.log('=== 4) الفرع تحرّك أثناء النشر ===');
setRemote(mkRows()); p = await open(); S.failFirstPatch = true; S.patchFailed = false; S.patches = 0;
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-001').note = 'بعد الفشل'; render(); });
await p.click('#pubBtn'); msg = await waitIdle(p);
ok('non-fast-forward is retried automatically and publish completes', S.patchFailed && /اننشر/.test(msg) && rem().find(x => x.code === 'MK-001').note === 'بعد الفشل', `patch attempts=${S.patches} | ${msg}`);
console.log('page errors:', errs);
await b.close();
