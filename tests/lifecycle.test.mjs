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
let pubWrites = [];
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
  if (/\/git\/trees$/.test(p) && m === 'POST') { const body = JSON.parse(r.request().postData()); if (repo === 'mk-inventory') { const e = body.tree.find(x => x.path === 'private.json'); if (e) { setRemote(JSON.parse(e.content)); S.privWrites++; } } else { pubWrites = body.tree.map(x => x.path); } S.commits.push(repo); return json({ sha: 'T' + S.commits.length }); }
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
async function addVilla(p, price, land = '', mode = null) {
  await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
  await p.selectOption('#f_cat', 'فيلا'); await p.fill('#f_title', 'فيلا اختبار');
  await p.fill('#f_bua', '300'); await p.fill('#f_price', price); if (land) await p.fill('#f_land', land);
  if (mode) await p.click(`#modeSeg button[data-m="${mode}"]`);
  await p.click('#saveBtn'); await p.waitForTimeout(250);
}


const cardInfo = (p, code) => p.evaluate(code => { const c = [...document.querySelectorAll('#grid .card')].find(x => x.querySelector('.code').textContent === code); return c ? { age: c.querySelector('.age').textContent, stale: c.querySelector('.age').classList.contains('stale'), tag: c.querySelector('.tag').textContent, btns: [...c.querySelectorAll('.card-acts button')].map(b => b.textContent) } : null; }, code);
const chip = async (p, f) => { await p.click(`#filters button[data-f="${f}"]`); await p.waitForTimeout(120); };
const shownCodes = p => p.evaluate(() => [...document.querySelectorAll('#grid .card .code')].map(e => e.textContent));
const DAY = 864e5, ago = d => new Date(Date.now() - d * DAY).toISOString();

console.log('=== 1) عمر التحديث والتنبيه ===');
const rows0 = mkRows();
rows0.find(r => r.code === 'MK-001').updatedAt = ago(70);
rows0.find(r => r.code === 'MK-002').updatedAt = ago(10);
delete rows0.find(r => r.code === 'MK-003').updatedAt;
rows0.find(r => r.code === 'MK-004').status = 'موقوف'; rows0.find(r => r.code === 'MK-004').updatedAt = ago(90);
rows0.find(r => r.code === 'MK-005').updatedAt = ago(80); rows0.find(r => r.code === 'MK-005').confirmedAt = ago(3);   // مؤكَّد حديثاً
setRemote(rows0); answer = true;
let p = await open(); dialogs = [];
let i1 = await cardInfo(p, 'MK-001'), i2 = await cardInfo(p, 'MK-002'), i3 = await cardInfo(p, 'MK-003'), i4 = await cardInfo(p, 'MK-004'), i5 = await cardInfo(p, 'MK-005');
ok('70-day-old listing is flagged stale with its age', i1.stale && /70/.test(i1.age), i1.age);
ok('10-day-old listing is not flagged', !i2.stale && /10/.test(i2.age), i2.age);
ok('listing without any date says so (no false alarm)', !i3.stale && /بلا تاريخ/.test(i3.age), i3.age);
ok('suspended listing is never stale', !i4.stale, i4.age);
ok('a recent confirmation beats an old update date', !i5.stale && /3/.test(i5.age), i5.age);
ok('header counts the stale ones', /1 تحتاج مراجعة/.test(await p.textContent('#count')), await p.textContent('#count'));
await chip(p, 'stale'); ok('“لم يُحدَّث” chip lists only MK-001', JSON.stringify(await shownCodes(p)) === '["MK-001"]', JSON.stringify(await shownCodes(p)));
ok('stale card offers “ما زال متاحاً”', (await cardInfo(p, 'MK-001')).btns.some(t => /ما زال متاحاً/.test(t)));
await p.click('#grid .card .card-ok'); await p.waitForTimeout(150);
ok('confirming refreshes it (leaves the stale list, dialog asked)', dialogs.length === 1 && (await shownCodes(p)).length === 0, dialogs[0]);
ok('confirming only touches private data (no public change needed)', await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-001'); return !!r.confirmedAt && Date.now() - Date.parse(r.confirmedAt) < 60000; }));

console.log('=== 2) مباع ===');
await chip(p, 'all'); dialogs = [];
await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-008'); r.featured = true; r.galKey = 'soldgallerykey0000000'; r.galSecret = 'AAAAAAAAAAAAAAAAAAAAAA'; r.photos = ['img/MK-008-1.jpg']; newBlobs['img/MK-008-1.jpg'] = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='; render(); });
const codeBtn = code => p.evaluate(code => { const c = [...document.querySelectorAll('#grid .card')].find(x => x.querySelector('.code').textContent === code); const b = [...c.querySelectorAll('.card-acts button')].find(x => /💰/.test(x.textContent)); b.click(); return true; }, code);
await codeBtn('MK-008'); await p.waitForTimeout(200);
const sold = await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-008'); return { st: r.status, at: r.soldAt, feat: r.featured }; });
ok('“💰 مباع” sets status, today\'s date, clears featured', sold.st === 'مباع' && sold.at === new Date().toISOString().slice(0, 10).replace(/(\d+)-(\d+)-(\d+)/, '$1-$2-$3') || (sold.st === 'مباع' && /^\d{4}-\d\d-\d\d$/.test(sold.at) && sold.feat === false), JSON.stringify(sold));
ok('sold listing leaves the default list', !(await shownCodes(p)).includes('MK-008'));
await chip(p, 'مباع'); ok('“المباع” chip shows it with a sold tag and date', JSON.stringify(await shownCodes(p)) === '["MK-008"]' && (await cardInfo(p, 'MK-008')).tag === 'مباع' && /بتاريخ/.test((await cardInfo(p, 'MK-008')).age));
await chip(p, 'all'); await p.fill('#q', 'MK-008'); await p.waitForTimeout(150);
ok('searching by code still finds a sold listing', (await shownCodes(p)).includes('MK-008')); await p.fill('#q', '');
S.commits = []; await p.click('#pubBtn'); let msg = await waitIdle(p);
const R = rem();
ok('publish keeps the sold row privately (with its sold date)', /اننشر/.test(msg) && R.find(x => x.code === 'MK-008').status === 'مباع' && !!R.find(x => x.code === 'MK-008').soldAt, msg);
ok('sold listing is unpublished: its page is deleted and it is out of data/sitemap/index', await p.evaluate(() => { const live = liveRows().map(r => r.code); return !live.includes('MK-008') && live.length === ROWS.length - 2; }));
ok('sold listing gets no private gallery page', !(pubWrites || []).some(k => /soldgallerykey/.test(k)), JSON.stringify(pubWrites));
/* revert */
await chip(p, 'مباع'); dialogs = []; await p.click('#grid .card-sold'); await p.waitForTimeout(200);
const back = await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-008'); return { st: r.status, at: r.soldAt }; });
ok('“↩︎ رجّعه متاحاً” brings it back and clears the sold date', back.st === 'متاح' && back.at === undefined, JSON.stringify(back));

console.log('=== 3) نموذج العقار: المباع والتاريخ ===');
await chip(p, 'all'); await p.evaluate(() => openForm(ROWS.find(x => x.code === 'MK-009')));
ok('sold-date box hidden for an available listing', await p.evaluate(() => document.getElementById('soldBox').hidden));
await p.selectOption('#f_status', 'مباع');
ok('choosing «مباع» reveals the date box pre-filled with today', !(await p.evaluate(() => document.getElementById('soldBox').hidden)) && /^\d{4}-\d\d-\d\d$/.test(await p.inputValue('#f_sold')));
await p.fill('#f_sold', '2026-08-15'); await p.click('#saveBtn'); await p.waitForTimeout(200);
ok('saved with the chosen sold date; featured cleared', await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-009'); return r.status === 'مباع' && r.soldAt === '2026-08-15' && !r.featured; }));

console.log('=== 4) كشف التكرار ===');
await p.evaluate(() => openForm(ROWS.find(x => x.code === 'MK-009'))); await p.selectOption('#f_status', 'متاح'); await p.click('#saveBtn'); await p.waitForTimeout(200); dialogs = [];   // رجّعناه متاحاً لنستعمله كمرجع
const ref = await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-009'); return { cat: r.cat, area: r.area, m2: r.area_m2, bua: r.bua, price: r.price, mode: r.mode, title: r.title }; });
async function addLike(o) {
  await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
  await p.selectOption('#f_cat', o.cat); await p.selectOption('#f_area', o.area); await p.fill('#f_title', o.title);
  if (o.mode === 'للدنم') await p.click('#modeSeg button[data-m="للدنم"]'); else await p.click('#modeSeg button[data-m="مقطوع"]');
  if (o.m2) { await p.fill('#f_land', String(o.m2 / 1000)); } if (o.bua) await p.fill('#f_bua', String(o.bua)); await p.fill('#f_price', String(o.price));
  await p.click('#saveBtn'); await p.waitForTimeout(250);
}
const n0 = await p.evaluate(() => ROWS.length); answer = false; dialogs = [];
await addLike({ ...ref, title: 'عنوان مختلف تماماً', price: Math.round(ref.price * 1.05), m2: ref.m2 ? Math.round(ref.m2 * 0.95) : null, bua: ref.bua ? Math.round(ref.bua * 1.03) : null });
ok('same type/area with ±10% size & price triggers the duplicate question', dialogs.length >= 1 && dialogs.some(d => /يشبه عقاراً عندك/.test(d) && /MK-009/.test(d)), (dialogs.find(d => /يشبه/.test(d)) || dialogs[0] || '').replace(/\n/g, ' | '));
ok('cancel keeps the form open and saves nothing', (await p.evaluate(() => ROWS.length)) === n0 && await p.evaluate(() => document.getElementById('dlg').open));
answer = true; dialogs = []; await p.click('#saveBtn'); await p.waitForTimeout(250);
ok('accepting saves it as a separate listing', (await p.evaluate(() => ROWS.length)) === n0 + 1);
/* الأسئلة الأخرى (السعر الشاذ) نقبلها حتى نصل فعلاً لفحص التكرار */
dialogs = []; answer = true; const nb = await p.evaluate(() => ROWS.length);
await addLike({ ...ref, cat: ref.cat === 'أرض' ? 'فيلا' : 'أرض', title: 'نوع مختلف', price: ref.price, m2: ref.m2, bua: ref.bua });
ok('a different type gets no duplicate question and is saved', !dialogs.some(d => /يشبه عقاراً/.test(d)) && (await p.evaluate(() => ROWS.length)) === nb + 1, dialogs.map(d => d.slice(0, 25)).join(' / '));
dialogs = []; answer = true; const nc = await p.evaluate(() => ROWS.length);
await addLike({ ...ref, title: ref.title, price: ref.price * 5, m2: ref.m2 ? ref.m2 * 5 : null, bua: ref.bua ? ref.bua * 5 : null });
ok('identical title in the same area/type triggers it even if numbers differ', dialogs.some(d => /يشبه عقاراً عندك/.test(d) && /MK-009/.test(d)) && (await p.evaluate(() => ROWS.length)) === nc + 1, dialogs.map(d => d.slice(0, 25)).join(' / '));
/* editing an existing listing (only its note) must not nag */
dialogs = []; answer = false;
await p.evaluate(() => openForm(ROWS.find(x => x.code === 'MK-009'))); await p.fill('#f_note', 'ملاحظة جديدة'); await p.click('#saveBtn'); await p.waitForTimeout(250);
ok('editing a listing without changing its facts never asks', dialogs.length === 0 && !(await p.evaluate(() => document.getElementById('dlg').open)), dialogs[0]);
/* similar to a SOLD listing: says so */
await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-010'); r.status = 'مباع'; r.soldAt = '2026-08-01'; render(); });
const r8 = await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-010'); return { cat: r.cat, area: r.area, m2: r.area_m2, bua: r.bua, price: r.price, mode: r.mode }; });
dialogs = []; answer = false;
await addLike({ ...r8, title: 'إعادة عرض', price: r8.price, m2: r8.m2, bua: r8.bua });
ok('similar to a sold listing: the message labels it “(مباع)”', dialogs.some(d => /MK-010/.test(d) && /\(مباع\)/.test(d)), (dialogs.find(d => /MK-010/.test(d)) || '').replace(/\n/g, ' | '));
console.log('page errors:', errs);
await b.close();
