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





async function publishNow(p) {
  await p.evaluate(() => { VERIFY.every = 100; VERIFY.max = 400; });
  await p.click('#pubBtn');
  const t0 = Date.now(); while (!/اننشر|ما زبط/.test(await p.textContent('#pubMsg')) && Date.now() - t0 < 20000) await p.waitForTimeout(100);
  return p.textContent('#pubMsg');
}
const DAY = 864e5, day = d => new Date(Date.now() + d * DAY).toISOString().slice(0, 10), TODAY = day(0);
const vb = (p, code) => p.evaluate(code => { const c = [...document.querySelectorAll('#grid .card')].find(x => x.querySelector('.code').textContent === code); const v = c && c.querySelector('.vb'); return v ? { t: v.textContent, cls: v.className.replace('vb ', '') } : null; }, code);
const chip = async (p, f) => { await p.click(`#filters button[data-f="${f}"]`); await p.waitForTimeout(120); };
const codes = p => p.evaluate(() => [...document.querySelectorAll('#grid .card .code')].map(e => e.textContent));
const ALL5 = { owner: '2026-09-01', deed: '2026-09-01', auth: '2026-09-01', cur: '2026-09-01', photos: '2026-09-01' };

console.log('=== 1) حالة القوائم على البطاقات ===');
const rows0 = mkRows(); const R = c => rows0.find(r => r.code === c);
R('MK-002').checks = { owner: '2026-09-01' };                               // متتبَّع وناقص
R('MK-003').checks = { ...ALL5 };                                          // مكتمل
R('MK-005').checks = { ...ALL5 }; R('MK-005').authUntil = '2026-01-01';    // تفويض منتهٍ
R('MK-008').checks = { ...ALL5 }; R('MK-008').authUntil = day(10);         // ينتهي قريباً
R('MK-009').checks = { ...ALL5 }; R('MK-009').authUntil = day(200);        // بعيد
R('MK-012').checks = { ...ALL5 }; R('MK-012').authUntil = TODAY;           // ينتهي اليوم (ما زال ساري)
R('MK-010').status = 'موقوف'; R('MK-010').checks = {};                     // موقوف ناقص: لا يُزعَج
R('MK-011').status = 'مباع'; R('MK-011').soldAt = '2026-08-01'; R('MK-011').checks = {};
setRemote(rows0); answer = true; PUB.files.clear();
let p = await open(); dialogs = [];
const b1 = await vb(p, 'MK-001'), b2 = await vb(p, 'MK-002'), b3 = await vb(p, 'MK-003'), b5 = await vb(p, 'MK-005'), b8 = await vb(p, 'MK-008'), b9 = await vb(p, 'MK-009'), b10 = await vb(p, 'MK-010');
ok('an old listing without a checklist shows nothing (no nagging)', b1 === null);
ok('partial: “تحقق 1/5” in amber', b2 && b2.t === 'تحقق 1/5' && b2.cls === 'warn', JSON.stringify(b2));
ok('complete: “تحقق 5/5” in green', b3 && b3.t === 'تحقق 5/5' && b3.cls === 'ok', JSON.stringify(b3));
ok('expired authorization is flagged in red', b5 && /انتهى التفويض/.test(b5.t) && b5.cls === 'bad', JSON.stringify(b5));
ok('authorization ending within 14 days warns with the days left', b8 && /ينتهي خلال 10 يوماً/.test(b8.t) && b8.cls === 'warn', JSON.stringify(b8));
const b12 = await vb(p, 'MK-012');
ok('authorization ending TODAY is still valid (warning, not expired)', b12 && /ينتهي اليوم/.test(b12.t) && b12.cls === 'warn', JSON.stringify(b12));
ok('a distant authorization just shows its date', b9 && b9.t.includes('التفويض حتى ' + day(200)) && b9.cls === 'ok', JSON.stringify(b9));
ok('suspended listings are not tracked on cards', b10 === null);
ok('header counts what needs verification (MK-002 + expired MK-005)', /2 تحتاج تحقق/.test(await p.textContent('#count')), await p.textContent('#count'));
await chip(p, 'verify'); ok('the “يحتاج تحقق” chip lists exactly those two', JSON.stringify(await codes(p)) === JSON.stringify(['MK-002', 'MK-005']), JSON.stringify(await codes(p))); await chip(p, 'all');

console.log('=== 2) النموذج ===');
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
ok('the form shows the six checks with a progress line (أرض: 0 من 5 مطلوب)', (await p.locator('#vchkItems input').count()) === 6 && /0 من 5/.test(await p.textContent('#vchkProg')), await p.textContent('#vchkProg'));
await p.selectOption('#f_cat', 'استثماري');
ok('for استثماري the license becomes required (0 من 6) and loses its “optional” tag', /0 من 6/.test(await p.textContent('#vchkProg')) && !/اختياري/.test(await p.locator('#vchkItems label').nth(5).textContent()));
await p.selectOption('#f_cat', 'فيلا'); ok('for other types the license is marked optional', /اختياري/.test(await p.locator('#vchkItems label').nth(5).textContent()));
await p.click('#closeBtn');
/* حفظ قديم بلا لمس القائمة لا يبدأ التتبع */
await p.evaluate(() => openForm(ROWS.find(r => r.code === 'MK-004'))); await p.fill('#f_note', 'ملاحظة فقط'); await p.click('#saveBtn'); await p.waitForTimeout(200);
ok('editing an old listing without touching the checklist does not start tracking it', (await p.evaluate(() => ROWS.find(r => r.code === 'MK-004').checks)) === undefined);
await p.evaluate(() => openForm(ROWS.find(r => r.code === 'MK-004'))); await p.locator('#vchkItems input').nth(0).check(); await p.locator('#vchkItems input').nth(1).check(); await p.click('#saveBtn'); await p.waitForTimeout(200);
const c4 = await p.evaluate(() => ROWS.find(r => r.code === 'MK-004').checks);
ok('ticking stores each item with today\'s date', c4 && c4.owner === TODAY && c4.deed === TODAY && !c4.auth, JSON.stringify(c4));
await p.evaluate(() => openForm(ROWS.find(r => r.code === 'MK-002'))); await p.click('#saveBtn'); await p.waitForTimeout(200);
ok('re-saving keeps the original verification date (not reset to today)', (await p.evaluate(() => ROWS.find(r => r.code === 'MK-002').checks.owner)) === '2026-09-01');
await p.evaluate(() => openForm(ROWS.find(r => r.code === 'MK-002'))); await p.locator('#vchkItems input').nth(0).uncheck(); await p.click('#saveBtn'); await p.waitForTimeout(200);
ok('unticking removes the item', (await p.evaluate(() => ROWS.find(r => r.code === 'MK-002').checks.owner)) === undefined);
await p.evaluate(() => openForm(ROWS.find(r => r.code === 'MK-003'))); await p.fill('#p_auth_until', day(60)); await p.click('#saveBtn'); await p.waitForTimeout(200);
ok('the authorization date is saved; clearing it removes it', (await p.evaluate(() => ROWS.find(r => r.code === 'MK-003').authUntil)) === day(60));
await p.evaluate(() => openForm(ROWS.find(r => r.code === 'MK-003'))); await p.fill('#p_auth_until', ''); await p.click('#saveBtn'); await p.waitForTimeout(200);
ok('…cleared', (await p.evaluate(() => ROWS.find(r => r.code === 'MK-003').authUntil)) === undefined);

console.log('=== 3) التنبيه قبل النشر ===');
setRemote(rows0); PUB.files.clear(); p = await open(); dialogs = [];
async function addNew(title, tickN) { await p.click('#addBtn'); await p.waitForSelector('#dlg[open]'); await p.selectOption('#f_cat', 'فيلا'); await p.fill('#f_title', title); await p.fill('#f_land', '0.5'); await p.fill('#f_bua', String(200 + Math.floor(Math.random() * 900))); await p.fill('#f_price', String(300000 + Math.floor(Math.random() * 5e5))); for (let i = 0; i < tickN; i++) await p.locator('#vchkItems input').nth(i).check(); await p.click('#saveBtn'); await p.waitForTimeout(250); return p.evaluate(() => ROWS[ROWS.length - 1].code); }
const newCode = await addNew('فيلا جديدة بدون تحقق', 0);
answer = false; dialogs = []; S.commits = []; let m = await publishNow(p);
ok('a NEW listing with nothing verified → asked before publishing, listing the missing items', dialogs.length === 1 && dialogs[0].includes(newCode) && /بيان قيد عقاري حديث/.test(dialogs[0]) && /تفويض مكتوب/.test(dialogs[0]), dialogs[0] && dialogs[0].replace(/\n/g, ' | '));
ok('cancel stops the publish: nothing written to the public repo', /توقّف النشر/.test(m) && !S.commits.includes('aqarat-yaafour.github.io'), m);
answer = true; dialogs = []; m = await publishNow(p);
ok('confirming publishes anyway', dialogs.length === 1 && /اننشر/.test(m), m);
const code2 = await addNew('فيلا جديدة مكتملة التحقق', 5);
dialogs = []; m = await publishNow(p); ok('a fully verified new listing publishes with no question', dialogs.length === 0 && /اننشر/.test(m), m);
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-002').src_notes = 'ملاحظة خاصة فقط'; render(); });
dialogs = []; m = await publishNow(p); ok('a private-only edit on an incomplete, already-published listing does NOT ask', dialogs.length === 0 && /اننشر|ما في تغيير/.test(m), m);
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-005').title = 'عنوان جديد لعقار تفويضه منتهٍ'; render(); });
dialogs = []; m = await publishNow(p); ok('changing a listing whose authorization expired → asked, naming the expiry', dialogs.length === 1 && /MK-005/.test(dialogs[0]) && /انتهى التفويض بتاريخ 2026-01-01/.test(dialogs[0]), dialogs[0] && dialogs[0].replace(/\n/g, ' | '));
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-010').title = 'موقوف بتغيير'; render(); });
dialogs = []; answer = false; m = await publishNow(p); ok('suspended / sold listings are never questioned', !dialogs.some(d => /MK-010|MK-011/.test(d)), dialogs.join(' | ').slice(0, 120));

console.log('=== 4) خصوصية ===');
const leak = []; for (const [k, v] of PUB.files) if (typeof v === 'string' && /\.(html|json|xml)$/.test(k)) for (const r of [/authUntil/, /"checks"/, /بيان قيد عقاري حديث/, /هوية المالك/, /تفويض مكتوب/]) if (r.test(v)) leak.push(k + ' ← ' + r);
ok('checklist data never appears in any public file', leak.length === 0, JSON.stringify(leak));
console.log('page errors:', errs);
await b.close();
