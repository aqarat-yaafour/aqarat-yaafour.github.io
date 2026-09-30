import { chromium } from './pw.mjs';
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path';
const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const JPG = fs.readFileSync(REPO + '/img/mohammad-khaled.jpg');
const pub = JSON.parse(fs.readFileSync(REPO + '/tests/fixtures/data.json', 'utf8'));
const CAT_AR = { land: 'أرض', villa: 'فيلا', farm: 'مزرعة', apt: 'شقة', invest: 'استثماري' };
const priv = pub.map(p => ({ code: p.code, status: 'متاح', cat: CAT_AR[p.cat], title: p.title, area: p.area, area_m2: p.area_m2, bua: p.bua, mode: p.mode === 'dunam' ? 'للدنم' : 'مقطوع', price: p.price, nego: !!p.nego, confirmed: !p.unconfirmed, papers: p.papers || '', feats: p.feats || [], photos: [], note: p.note || '', src_place: 'سري', src_by: '', commission: '', src_notes: '' }));
priv.find(r => r.code === 'MK-003').photos = ['img/MK-003-1.jpg'];
const r12 = priv.find(r => r.code === 'MK-012'); r12.photos = ['img/MK-012-1.jpg']; r12.galKey = 'oldkeyoldkeyoldkey';
const pubExisting = ['data.json', 'index.html', 'img/mohammad-khaled.jpg', 'img/MK-003-1.jpg', 'img/MK-012-1.jpg', 'p/oldkeyoldkeyoldkey.html', 'assets/mk.css'];
const privExisting = ['private.json'];
const gsha = buf => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])).digest('hex');
let privLive = null;
const state = { pub: new Map(pubExisting.map(x => [x, null])), priv: new Map(privExisting.map(x => [x, null])) };
const store = { blobs: {}, trees: [], commits: [] }; let blobN = 0;
const b64 = t => Buffer.from(t, 'utf8').toString('base64');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, ignoreHTTPSErrors: true });
await ctx.route('https://aqarat-yaafour.github.io/**', r => { const u = new URL(r.request().url()); if (/\/img\/MK-0\d\d-\d\.jpg$/.test(u.pathname)) return r.fulfill({ status: 200, body: JPG, contentType: 'image/jpeg' }); return r.fulfill({ status: 404, body: '' }); });
await ctx.route('https://api.github.com/**', async r => {
  const u = new URL(r.request().url()), m = r.request().method(), p = u.pathname, json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  let mm; const repo = (p.match(/^\/repos\/[^/]+\/([^/]+)/) || [])[1];
  if (/^\/repos\/[^/]+\/[^/]+$/.test(p)) return json({ permissions: { push: true } });
  if ((mm = p.match(/\/contents\/(.+)$/))) { const f = decodeURIComponent(mm[1]); if (repo === 'mk-inventory' && f === 'private.json') { const t = privLive || JSON.stringify(priv); return json({ content: b64(t), sha: gsha(Buffer.from(t, 'utf8')) }); } if (repo === 'mk-inventory' && store.privPhotos && store.privPhotos[f]) return r.fulfill({ status: 200, body: store.privPhotos[f] }); return json({ message: 'nf' }, 404); }
  if (/\/git\/ref\/heads\/main$/.test(p)) return json({ object: { sha: 'HEAD0' } });
  if (/\/git\/commits\/HEAD0$/.test(p)) return json({ tree: { sha: 'TREE0' } });
  if (/\/git\/trees\/(HEAD0|TREE0)$/.test(p)) return json({ tree: [...(repo === 'mk-inventory' ? state.priv : state.pub).entries()].map(([x, sha]) => ({ type: 'blob', path: x, sha })) });
  if (/\/git\/blobs$/.test(p)) { const body = JSON.parse(r.request().postData()); const id = 'B' + (++blobN); store.blobs[id] = body; return json({ sha: id }); }
  if (/\/git\/trees$/.test(p) && m === 'POST') { const body = JSON.parse(r.request().postData()); store.trees.push({ repo, tree: body.tree }); if (repo === 'mk-inventory') { const pj = body.tree.find(e => e.path === 'private.json'); if (pj && pj.content !== undefined) privLive = pj.content; } const st = repo === 'mk-inventory' ? state.priv : state.pub; for (const e of body.tree) { if (e.sha === null) st.delete(e.path); else st.set(e.path, e.content !== undefined ? gsha(Buffer.from(e.content, 'utf8')) : gsha(Buffer.from(store.blobs[e.sha].content, store.blobs[e.sha].encoding === 'base64' ? 'base64' : 'utf8'))); } return json({ sha: 'T' + store.trees.length }); }
  if (/\/git\/commits$/.test(p) && m === 'POST') { store.commits.push(1); return json({ sha: 'C' + store.commits.length }); }
  if (/\/git\/refs\/heads\/main$/.test(p) && m === 'PATCH') return json({});
  return json({ message: 'unmocked ' + p }, 500);
});
await ctx.route('http://localhost:8769/**', async r => { const f = decodeURIComponent(new URL(r.request().url()).pathname); const fp = path.join(REPO, f); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, body: fs.readFileSync(fp), contentType: fp.endsWith('.html') ? 'text/html' : fp.endsWith('.js') ? 'text/javascript' : fp.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); return r.fulfill({ status: 404, body: '' }); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
await p.goto('http://localhost:8769/admin.html', { waitUntil: 'domcontentloaded' });
await p.fill('#s_token', 'fake'); await p.click('#s_go'); await p.waitForSelector('#app:not([hidden])');
const txt = e => e && (e.encoding === 'base64' ? Buffer.from(e.content, 'base64') : Buffer.from(e.content, 'utf8'));
const waitCommits = async n => { const t0 = Date.now(); while (store.commits.length < n && Date.now() - t0 < 60000) await new Promise(r => setTimeout(r, 200)); await p.waitForTimeout(300); };
const files = t => Object.fromEntries(t.tree.map(e => [e.path, e.sha === null ? null : (e.content !== undefined ? { content: e.content, encoding: 'utf-8' } : store.blobs[e.sha])]));
/* --- publish 1: migration --- */
await p.evaluate(() => { ROWS.find(r => r.code === 'MK-001').note = 'تعديل لتفعيل النشر'; render(); });
await p.click('#pubBtn'); await waitCommits(2);
console.log('bar:', await p.evaluate(() => document.querySelector('.publish .msg').textContent), '| commits', store.commits.length);
const privT = files(store.trees.find(t => t.repo === 'mk-inventory')), pubT = files(store.trees.find(t => t.repo === 'aqarat-yaafour.github.io'));
console.log('publish 1 wrote', Object.keys(pubT).length, 'public paths, blobs uploaded:', Object.keys(store.blobs).length);
console.log('PRIVATE repo gets photos:', ['img/MK-003-1.jpg', 'img/MK-012-1.jpg'].every(k => privT[k] && txt(privT[k]).equals(JPG)));
console.log('PUBLIC deletes photos + old plain gallery:', ['img/MK-003-1.jpg', 'img/MK-012-1.jpg', 'p/oldkeyoldkeyoldkey.html'].every(k => k in pubT && pubT[k] === null));
console.log('PUBLIC writes no img/*:', !Object.keys(pubT).some(k => k.startsWith('img/') && pubT[k]), '| keeps avatar:', !('img/mohammad-khaled.jpg' in pubT));
const pj = JSON.parse(txt(privT['private.json']).toString()); console.log('old insecure link retired (MK-012 galKey removed):', !pj.find(r => r.code === 'MK-012').galKey, '| secret fields kept private:', pj[0].src_place === 'سري');
console.log('public data.json has no secrets:', !/سري|galSecret|galKey/.test(txt(pubT['data.json']).toString()));
/* --- create encrypted link for MK-003, publish 2 --- */
store.privPhotos = { 'img/MK-003-1.jpg': JPG };
await p.evaluate(() => { const r = ROWS.find(x => x.code === 'MK-003'); openGallery(r); });
await p.click('#galNew'); const link = await p.inputValue('#galLink'); console.log('link:', link.replace(/#.*/, '#<secret>'), '| has fragment:', /#[\w-]{22}$/.test(link));
await p.click('#galClose'); await p.click('#pubBtn'); await waitCommits(4);
const pubT2 = files(store.trees.filter(t => t.repo === 'aqarat-yaafour.github.io')[1]);
const key = link.match(/p\/(\w+)\.html/)[1], secret = link.split('#')[1];
const page = txt(pubT2[`p/${key}.html`]).toString(), bin = txt(pubT2[`p/${key}.bin`]);
console.log('publish 2 wrote only', Object.keys(pubT2).length, 'files:', Object.keys(pubT2).join(', '));
console.log('gallery page + bin written:', !!page && bin.length > 4000, '| page has no image data/paths:', !/img\/MK-003|data:image|base64/.test(page), '| bin is not a JPEG:', !bin.includes(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0])) && !bin.includes(JPG.subarray(200, 260)));
/* --- open the published page like a visitor --- */
const v = await ctx.newPage(); await v.route(`https://aqarat-yaafour.github.io/p/**`, r => { const u = new URL(r.request().url()); if (u.pathname.endsWith('.html')) return r.fulfill({ status: 200, body: page, contentType: 'text/html' }); if (u.pathname.endsWith('.bin')) return r.fulfill({ status: 200, body: bin, contentType: 'application/octet-stream' }); return r.fulfill({ status: 404, body: '' }); });
await v.route('https://aqarat-yaafour.github.io/assets/**', r => { const f = path.join(REPO, new URL(r.request().url()).pathname); return r.fulfill({ status: 200, body: fs.readFileSync(f), contentType: f.endsWith('css') ? 'text/css' : 'font/woff2' }); });
const shot = ((process.env.TMPDIR || '/tmp') + '/');
await v.goto(link, { waitUntil: 'load' }); await v.waitForTimeout(1500);
console.log('visitor WITH key sees photos:', await v.evaluate(() => [...document.querySelectorAll('.gshot img')].filter(i => i.complete && i.naturalWidth > 0).length));
await v.screenshot({ path: shot + 'galv.png' });
await v.goto(link.replace(/#.*/, ''), { waitUntil: 'load' }); await v.waitForTimeout(800);
console.log('visitor WITHOUT key:', await v.evaluate(() => document.querySelectorAll('.gshot img').length), 'photos |', (await v.textContent('#gst')).slice(0, 40));
await v.goto(link.replace(/#.*/, '') + '#AAAAAAAAAAAAAAAAAAAAAA', { waitUntil: 'load' }); await v.waitForTimeout(800);
console.log('visitor WRONG key:', await v.evaluate(() => document.querySelectorAll('.gshot img').length), 'photos |', (await v.textContent('#gst')).slice(0, 40));
/* --- admin preview before publish --- */
console.log('errors', errs);
await b.close();
