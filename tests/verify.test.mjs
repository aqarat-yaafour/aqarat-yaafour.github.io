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
const pubState = new Map();                   // ما يعرفه المستودع العام من ملفات (path -> git sha) ليعمل تخطي غير المتغيّر
const SITE = new Map();                       // ما هو منشور فعلاً على الموقع الحي (يحاكي GitHub Pages)
const DEPLOY = { enabled: true, delay: 500 }, NET = { mode: 'ok' }, RUNS = { mode: 'forbidden' }, REPOI = { privPrivate: true }, TREE = { truncated: false }, RATE = { remaining: 4900 }, SEEN = { publicTrees: 0 };
const asText = e => e.content !== undefined ? e.content : (blobs[e.sha] && (blobs[e.sha].encoding === 'base64' ? Buffer.from(blobs[e.sha].content, 'base64').toString('utf8') : blobs[e.sha].content));
const bytesOf = e => e.content !== undefined ? Buffer.from(e.content, 'utf8') : (blobs[e.sha].encoding === 'base64' ? Buffer.from(blobs[e.sha].content, 'base64') : Buffer.from(blobs[e.sha].content, 'utf8'));
function queueDeploy(tree) {
  SEEN.publicTrees++;
  for (const e of tree) { if (e.sha === null) pubState.delete(e.path); else pubState.set(e.path, gsha(bytesOf(e))); }
  if (!DEPLOY.enabled) return;
  const snap = tree.map(e => [e.path, e.sha === null ? null : asText(e)]);
  setTimeout(() => { for (const [p, t] of snap) { if (t === null) SITE.delete(p); else SITE.set(p, t); } }, DEPLOY.delay);
}
const S = { commits: [], patches: 0, failFirstPatch: false, patchFailed: false, privWrites: 0 };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, ignoreHTTPSErrors: true });
const blobs = {};
let bn = 0;
await ctx.route('https://api.github.com/**', async r => {
  const u = new URL(r.request().url()), m = r.request().method(), p = u.pathname, json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  const repo = (p.match(/^\/repos\/[^/]+\/([^/]+)/) || [])[1];
  if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) return json({ permissions: { push: true }, private: repo === 'mk-inventory' ? REPOI.privPrivate : false });
  if (p === '/rate_limit') return r.fulfill({ status: 200, headers: { date: new Date().toUTCString(), 'content-type': 'application/json' }, body: JSON.stringify({ resources: { core: { limit: 5000, remaining: RATE.remaining } } }) });
  if (/\/actions\/runs$/.test(p)) { if (RUNS.mode === 'forbidden') return json({ message: 'Resource not accessible by personal access token' }, 403); if (RUNS.mode === 'fail') return json({ workflow_runs: [{ name: 'pages build and deployment', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/x/y/actions/runs/1' }] }); return json({ workflow_runs: [{ name: 'pages build and deployment', status: 'completed', conclusion: 'success', html_url: 'https://github.com/x/y/actions/runs/2' }] }); }
  if (repo === 'mk-inventory' && /\/commits$/.test(p) && r.request().method() === 'GET') return json([{ sha: 'C9', commit: { message: 'x', committer: { date: '2026-09-29T10:00:00Z' } } }]);
  if (/\/contents\/img\//.test(p)) return r.fulfill({ status: 200, body: 'JPEGBYTES' });
  if (/\/contents\//.test(p)) { if (repo === 'mk-inventory' && /private\.json$/.test(p)) return json({ content: Buffer.from(remote.text).toString('base64'), sha: remote.sha }); return json({ message: 'nf' }, 404); }
  if (/\/git\/ref\/heads\/main$/.test(p)) return json({ object: { sha: 'HEAD0' } });
  if (/\/git\/commits\/HEAD0$/.test(p)) return json({ tree: { sha: 'TREE0' } });
  if (/\/git\/trees\/(HEAD0|TREE0)$/.test(p)) return json({ truncated: TREE.truncated, tree: repo === 'mk-inventory' ? [{ type: 'blob', path: 'private.json', sha: remote.sha }, { type: 'blob', path: 'img/MK-001-1.jpg', sha: 'ph' }] : [...pubState].map(([path, sha]) => ({ type: 'blob', path, sha })) });
  if (/\/git\/blobs$/.test(p)) { const id = 'B' + (++bn); blobs[id] = JSON.parse(r.request().postData()); return json({ sha: id }); }
  if (/\/git\/trees$/.test(p) && m === 'POST') { const body = JSON.parse(r.request().postData()); if (repo === 'mk-inventory') { const e = body.tree.find(x => x.path === 'private.json'); if (e) { setRemote(JSON.parse(e.content)); S.privWrites++; } } if (repo !== 'mk-inventory') queueDeploy(body.tree); S.commits.push(repo); return json({ sha: 'T' + S.commits.length }); }
  if (/\/git\/commits$/.test(p) && m === 'POST') return json({ sha: 'C' + (S.commits.length) });
  if (/\/git\/refs\/heads\/main$/.test(p) && m === 'PATCH') { S.patches++; if (S.failFirstPatch && !S.patchFailed) { S.patchFailed = true; return json({ message: 'Update is not a fast forward' }, 422); } return json({}); }
  return json({ message: 'unmocked ' + p }, 500);
});
await ctx.route('https://aqarat-yaafour.github.io/**', async r => {
  if (NET.mode === 'abort') return r.abort();
  const pth = decodeURIComponent(new URL(r.request().url()).pathname).replace(/^\//, '');
  if (SITE.has(pth)) return r.fulfill({ status: 200, body: SITE.get(pth), contentType: 'text/plain; charset=utf-8', headers: { 'access-control-allow-origin': '*' } });
  return r.fulfill({ status: 404, body: '', headers: { 'access-control-allow-origin': '*' } });
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


const fast = p => p.evaluate(() => { VERIFY.every = 120; VERIFY.max = 6000; });
const lastMsg = p => p.textContent('#pubMsg');
async function until(p, re, ms = 9000) { const t0 = Date.now(); let t = ''; while (Date.now() - t0 < ms) { t = await lastMsg(p); if (re.test(t)) return t; await p.waitForTimeout(80); } return t; }
async function edit(p, code = 'MK-001', note = 'تعديل ' + Math.random()) { await p.evaluate(([c, n]) => { ROWS.find(r => r.code === c).note = n; render(); }, [code, note]); }

console.log('=== 1) التحقق بعد النشر ===');
setRemote(mkRows()); answer = true; SITE.clear(); DEPLOY.enabled = true; DEPLOY.delay = 700; NET.mode = 'ok'; RUNS.mode = 'forbidden';
let p = await open(); await fast(p); await edit(p);
await p.click('#pubBtn');
let m = await until(p, /جارٍ التأكد من تحديث الموقع/); ok('after publish it says it is checking the live site', /اننشر ✓/.test(m) && /جارٍ التأكد من تحديث الموقع/.test(m), m);
m = await until(p, /تحدّث فعلاً/); ok('and confirms once the live site really serves the new files', /تحدّث فعلاً ✓/.test(m) && /ث\)/.test(m), m);
ok('no build-log link when everything is fine', await p.evaluate(() => document.getElementById('pubActions').hidden));

console.log('=== 2) الموقع لا يتحدّث أبداً ===');
setRemote(mkRows()); SITE.clear(); DEPLOY.enabled = false;
p = await open(); await p.evaluate(() => { VERIFY.every = 120; VERIFY.max = 1500; }); await edit(p); await p.click('#pubBtn');
m = await until(p, /ما تحدّث/, 9000);
ok('it warns loudly instead of pretending success', /اننشر ✓/.test(m) && /ما تحدّث خلال/.test(m), m);
ok('and offers the build log link', !(await p.evaluate(() => document.getElementById('pubActions').hidden)) && /actions$/.test(await p.evaluate(() => document.getElementById('pubActions').href)), await p.evaluate(() => document.getElementById('pubActions').href));

console.log('=== 3) فشل بناء GitHub Pages (يُكتشف عبر Actions) ===');
setRemote(mkRows()); SITE.clear(); DEPLOY.enabled = false; RUNS.mode = 'fail';
p = await open(); await p.evaluate(() => { VERIFY.every = 120; VERIFY.max = 8000; }); await edit(p); await p.click('#pubBtn');
m = await until(p, /فشل/, 6000);
ok('a failed Pages build is reported quickly with its reason', /بناء الموقع على GitHub فشل \(failure\)/.test(m), m);
ok('and the link points to that exact run', (await p.evaluate(() => document.getElementById('pubActions').href)) === 'https://github.com/x/y/actions/runs/1');

console.log('=== 4) المتصفح لا يقدر يقرأ الموقع ===');
setRemote(mkRows()); SITE.clear(); DEPLOY.enabled = true; RUNS.mode = 'forbidden'; NET.mode = 'abort';
p = await open(); await fast(p); await edit(p); await p.click('#pubBtn');
m = await until(p, /تعذّر التحقق/, 6000);
ok('network trouble gives a neutral message (still says published)', /اننشر ✓/.test(m) && /تعذّر التحقق الآلي/.test(m), m); NET.mode = 'ok';

console.log('=== 5) تعديل خاص لا يمسّ الموقع ===');
setRemote(mkRows()); SITE.clear(); pubState.clear(); DEPLOY.enabled = true; DEPLOY.delay = 200;
p = await open(); await fast(p);
await edit(p, 'MK-001', 'نشر عادي أول'); await p.click('#pubBtn'); await until(p, /تحدّث فعلاً/, 9000);   // ينشر كل الملفات مرة
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-002').src_notes = 'ملاحظة سرية جديدة'; render(); });
const before = SEEN.publicTrees; await p.click('#pubBtn');
m = await until(p, /ما في تغيير على الموقع/, 6000);
ok('private-only edit: says the site itself did not change, and nothing is uploaded to the public repo', /ما في تغيير على الموقع/.test(m) && SEEN.publicTrees === before, m + ' | public trees ' + before + '→' + SEEN.publicTrees);

console.log('=== 6) نشران متتاليان ===');
setRemote(mkRows()); SITE.clear(); DEPLOY.enabled = false;
p = await open(); await p.evaluate(() => { VERIFY.every = 150; VERIFY.max = 20000; }); await edit(p, 'MK-001', 'أول'); await p.click('#pubBtn');
await until(p, /جارٍ التأكد من تحديث الموقع/); DEPLOY.enabled = true; DEPLOY.delay = 300;
await edit(p, 'MK-002', 'ثاني'); await p.click('#pubBtn');
m = await until(p, /تحدّث فعلاً/, 12000);
ok('the newer publish takes over the status (no stale message from the first)', /تحدّث فعلاً/.test(m), m);

console.log('=== 7) فحص الاتصال ===');
setRemote(mkRows()); SITE.clear(); SITE.set('data.json', JSON.stringify(mkRows().map(r => ({ code: r.code })))); DEPLOY.enabled = true; RUNS.mode = 'forbidden'; NET.mode = 'ok'; REPOI.privPrivate = true; TREE.truncated = false; RATE.remaining = 4900;
p = await open();
const runChk = async () => { await p.click('#chkBtn'); await p.waitForFunction(() => document.querySelectorAll('#chkList .chk').length >= 9 && !document.querySelector('#chkList .chk.wait'), null, { timeout: 15000 }); return p.evaluate(() => [...document.querySelectorAll('#chkList .chk')].map(e => e.className.replace('chk ', '') + '|' + e.textContent)); };
let L = await runChk();
ok('healthy setup: summary says it is fine to publish (Actions read is only a warning)', /ok\|✓ كل شي سليم|warn\|⚠️ الاتصال شغّال/.test(L[L.length - 1]) && !L.some(x => x.startsWith('bad|')), L.map(x => x.slice(0, 60)).join('\n     '));
ok('it reports the number of listings, photos read and versions', L.some(x => /عقار/.test(x) && x.startsWith('ok|')) && L.some(x => /قرأت img\/MK-001-1.jpg/.test(x)) && L.some(x => /نسخة محفوظة/.test(x)));
ok('missing Actions permission is a warning, not an error', L.some(x => x.startsWith('warn|') && /Actions/.test(x)));
await p.click('#chkDone'); REPOI.privPrivate = false;
L = await runChk(); ok('a PUBLIC “private” repo is flagged as a serious problem', L.some(x => x.startsWith('bad|') && /مكشوفة/.test(x)), L.find(x => /مكشوفة/.test(x)));
await p.click('#chkDone'); REPOI.privPrivate = true; TREE.truncated = true;
L = await runChk(); ok('a truncated file tree is an error (publish could miss files)', L.some(x => x.startsWith('bad|') && /تقطّعت/.test(x)));
await p.click('#chkDone'); TREE.truncated = false; RATE.remaining = 50; RUNS.mode = 'ok';
L = await runChk(); ok('a nearly exhausted API quota is warned about', L.some(x => x.startsWith('warn|') && /متبقّي 50/.test(x)));
ok('with Actions readable, the last build result is shown', L.some(x => /آخر بناء: success/.test(x)));
await p.click('#chkDone'); RATE.remaining = 4900; NET.mode = 'abort';
L = await runChk(); ok('an unreachable live site is reported', L.some(x => x.startsWith('bad|') && /الموقع الحي/.test(x)));
console.log('page errors:', errs);
await b.close();
