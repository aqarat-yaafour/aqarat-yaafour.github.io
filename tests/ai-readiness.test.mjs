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
console.log('=== تهيئة المساعدات الذكية ===');
const rows0 = mkRows();
rows0.find(r => r.code === 'MK-002').confirmed = false; rows0.find(r => r.code === 'MK-002').price = 4937000;   // سعر مخفي مميّز
rows0.find(r => r.code === 'MK-002').src_notes = 'سر خاص جداً ZZZSECRET'; rows0.find(r => r.code === 'MK-002').commission = '7% خاص';
rows0.find(r => r.code === 'MK-004').status = 'موقوف'; rows0.find(r => r.code === 'MK-005').status = 'مباع';
rows0.find(r => r.code === 'MK-003').checks = { owner: '2026-09-01' }; rows0.find(r => r.code === 'MK-003').authUntil = '2027-01-01';
setRemote(rows0); answer = true; PUB.files.clear();
let p = await open();
await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-001'); r.note = 'أرض\nبمساحة   كبيرة\tوقريبة من الطريق'; r.nego = true; render(); });
const m = await publishNow(p); ok('publish succeeds (quality check passes with the new files)', /اننشر/.test(m), m);
const F = PUB.files, L = F.get('llms.txt') || '', LF = F.get('llms-full.txt') || '';
const live = JSON.parse(F.get('data.json')); 
ok('llms.txt and llms-full.txt are generated', L.length > 500 && LF.length > 500);
ok('llms.txt follows the format: H1, blockquote summary, H2 sections, Optional last', /^# /.test(L) && /\n> /.test(L) && /\n## الصفحات الرئيسية/.test(L) && /\n## العقارات المتاحة/.test(L) && L.trim().split('\n').filter(l => l.startsWith('## ')).pop() === '## Optional');
ok('it states the currency and what "on contact" means', /الدولار الأمريكي \(USD\)/.test(L) && /«السعر عند التواصل» تعني/.test(L));
ok('it carries the public phone and the specialisation', L.includes('+963996606813') && /يعفور وقرى الشام والصبورة/.test(L.split('\n')[0]));
const bullets = L.split('## العقارات المتاحة')[1].split('## Optional')[0].split('\n').filter(l => l.startsWith('- ['));
ok('one bullet per AVAILABLE listing (sold and suspended excluded)', bullets.length === live.length && !/MK-004|MK-005/.test(L) && !/MK-004|MK-005/.test(LF), bullets.length + ' vs ' + live.length);
const links = [...L.matchAll(/\]\((https:\/\/aqarat-yaafour\.github\.io\/([^)]*))\)/g)].map(x => x[2]);
const missing = links.filter(l => l !== '' && !F.has(l));
ok('every link in llms.txt points to a file that is published', links.length > 10 && missing.length === 0, JSON.stringify(missing));
ok('the hidden price stays hidden (shows السعر عند التواصل, no number anywhere)', /MK-002[^\n]*السعر عند التواصل/.test(L) && /### MK-002[\s\S]*?- السعر: السعر عند التواصل/.test(LF) && !/4937000|4,937,000|4\.94 مليون|4\.9 مليون/.test(L + LF));
ok('no private field ever appears (source notes, commission, checklist, authorization date)', !/ZZZSECRET|7% خاص|commission|src_|authUntil|checks|2027-01-01/.test(L + LF));
ok('notes are flattened to single lines (no broken markdown)', /- وصف: أرض بمساحة كبيرة وقريبة من الطريق/.test(LF));
ok('negotiable is mentioned only for public prices', /MK-001[^\n]*قابل للتفاوض/.test(L) && !/MK-002[^\n]*قابل للتفاوض/.test(L));
ok('full file has a block per listing with its page URL', (LF.match(/^### MK-/gm) || []).length === live.length && (LF.match(/^- الصفحة: https:\/\/aqarat-yaafour\.github\.io\/listing\/MK-\d+\.html/gm) || []).length === live.length);
ok('no "undefined" / "NaN" / "[object" in either file', !/undefined|NaN|\[object/.test(L + LF));

console.log('=== بيانات منظمة وrobots ===');
const home = F.get('index.html'), lp = F.get('listing/MK-001.html');
const ld = h => [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(x => JSON.parse(x[1]));
ok('the broker has one stable @id on the homepage, and listing/area/sell pages point to the same @id', ld(home).some(x => x['@id'] === 'https://aqarat-yaafour.github.io/#agent') && ld(lp).some(x => x.broker && x.broker['@id'] === 'https://aqarat-yaafour.github.io/#agent') && ld(F.get('yaafour.html')).some(x => x.provider && x.provider['@id'] === 'https://aqarat-yaafour.github.io/#agent') && ld(F.get('sell.html')).some(x => x.provider && x.provider['@id'] === 'https://aqarat-yaafour.github.io/#agent'));
const li = ld(lp).find(x => x['@type'] === 'RealEstateListing');
ok('listing data has datePosted + dateModified + language', /^\d{4}-\d\d-\d\d$/.test(li.dateModified) && /^\d{4}-\d\d-\d\d$/.test(li.datePosted) && li.inLanguage === 'ar');
ok('hidden-price listing has no offer price in its structured data', !/"price"/.test(JSON.stringify(ld(F.get('listing/MK-002.html')).find(x => x['@type'] === 'RealEstateListing').offers || {})));
const rb = fs.readFileSync(REPO + '/robots.txt', 'utf8');
ok('robots.txt: open to all (AI assistants included), private/test paths excluded, sitemap listed', /User-agent: \*\s+Allow: \//.test(rb) && /Disallow: \/p\//.test(rb) && /Disallow: \/tests\//.test(rb) && /Sitemap: https:\/\/aqarat-yaafour\.github\.io\/sitemap\.xml/.test(rb) && !/Disallow: \/\s*$/m.test(rb));
console.log('--- llms.txt (first 28 lines) ---\n' + L.split('\n').slice(0, 28).join('\n'));
console.log('--- llms-full.txt (first 12 lines) ---\n' + LF.split('\n').slice(0, 12).join('\n'));
console.log('page errors:', errs);
await b.close();
