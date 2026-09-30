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
console.log('=== نص التعريف ورقم الهاتف في كل مكان ===');
setRemote(mkRows()); answer = true; PUB.files.clear();
let p = await open();
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
await p.selectOption('#f_cat', 'استثماري'); await p.selectOption('#f_area', '__new__'); await p.fill('#f_area_new', 'صحنايا'); await p.fill('#f_title', 'أصل في صحنايا'); await p.fill('#f_land', '8.5'); await p.fill('#f_price', '4000000'); await p.uncheck('#f_conf'); await p.click('#saveBtn'); await p.waitForTimeout(250);
const m = await publishNow(p); ok('publish ok', /اننشر/.test(m), m);
const F = PUB.files, html = [...F.keys()].filter(k => /\.html$/.test(k) && k !== 'admin.html');
const metas = f => { const t = F.get(f); return [...t.matchAll(/(?:name="description"|property="og:description") content="([^"]*)"/g)].map(x => x[1]); };
const badCover = [], spaced = [], noLrm = [];
for (const f of html) for (const d of metas(f)) { if (/(في|مع) يعفور وقرى الشام\.|مستشار عقاري في يعفور وقرى الشام/.test(d)) badCover.push(f); if (/0996 606 813/.test(d)) spaced.push(f); if (/واتساب/.test(d) && !d.includes('‎0996606813‎')) noLrm.push(f); }
ok('no description (meta / og:description) still calls him an adviser only "in يعفور وقرى الشام"', badCover.length === 0, JSON.stringify(badCover.slice(0, 4)));
ok('the phone inside every description is written without spaces (never split / reversed in previews)', spaced.length === 0, JSON.stringify(spaced.slice(0, 4)));
ok('…and wrapped in left-to-right marks wherever WhatsApp is mentioned', noLrm.length === 0, JSON.stringify(noLrm.slice(0, 4)));
const lp = metas('listing/MK-022.html')[0]; ok('the listing preview text now reads: «… مع محمد خالد، مستشار عقاري في دمشق وريفها. واتساب ‎0996606813‎»', /مستشار عقاري في دمشق وريفها\. واتساب ‎0996606813‎$/.test(lp), lp);
ok('no description ends with a dot right after the number', html.every(f => metas(f).every(d => !/0996606813‎\./.test(d))));
ok('homepage title/description use دمشق وريفها; deeper experience still listed', /<title>عقارات دمشق وريفها/.test(F.get('index.html')) && /في دمشق وريفها، وخبرتي الأوسع في يعفور وقرى الشام والصبورة/.test(metas('index.html')[0]));
ok('footer everywhere says دمشق وريفها', html.every(f => !/<footer/.test(F.get(f)) || /<div><b>محمد خالد<\/b> · مستشار عقاري · دمشق وريفها<\/div>/.test(F.get(f))));
ok('the listing page contact line uses it too', /تواصل مع محمد خالد، مستشار عقاري في دمشق وريفها/.test(F.get('listing/MK-001.html')));
ok('the owners page says دمشق وريفها in its intro and FAQ', /أعمل في دمشق وريفها/.test(F.get('sell.html')) && /أعمل في دمشق وريفها، وخبرتي الأوسع في يعفور وقرى الشام والصبورة، وأنظر في كل عرض على حدة/.test(F.get('sell.html')));
ok('llms.txt headline + summary follow the new positioning', /^# محمد خالد — مستشار عقاري في دمشق وريفها/.test(F.get('llms.txt')) && /وسيط عقاري في دمشق وريفها \(سوريا\)، خبرته الأوسع في يعفور وقرى الشام والصبورة\./.test(F.get('llms.txt')) && /مستشار عقاري في دمشق وريفها/.test(F.get('llms-full.txt')));
const ld = h => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(x => JSON.parse(x[1]));
ok('structured data serves دمشق + ريف دمشق + the three areas', (() => { const a = ld(F.get('index.html')).find(x => x['@type'] === 'RealEstateAgent').areaServed.map(x => x.name); return ['دمشق', 'ريف دمشق', 'يعفور', 'قرى الشام', 'الصبورة'].every(n => a.includes(n)); })());
ok('the FAQ no longer claims listings exist only in يعفور وقرى الشام', !/الملاصقتين لها/.test(F.get('index.html')));
const cap = await p.evaluate(() => postCaption(ROWS[ROWS.length - 1]));
ok('the post caption uses the unspaced phone', cap.includes('‎0996606813‎') && !/0996 606 813/.test(cap), cap.split('\n').find(l => /واتساب/.test(l)));
ok('the on-page phone buttons still show the readable spaced number', /<a class="btn btn-ghost" href="tel:\+963996606813" dir="ltr">0996 606 813<\/a>/.test(F.get('listing/MK-001.html')));
console.log('page errors:', errs);
await b.close();
