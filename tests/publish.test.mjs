/* End-to-end check of the REAL admin panel: mock GitHub API, add a listing through the form, publish, inspect output. */
import { chromium } from './pw.mjs';
import fs from 'node:fs'; import path from 'node:path';
const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const store = { blobs: {}, commits: [], trees: [] };            // captured writes
const pub = JSON.parse(fs.readFileSync(REPO + '/data.json', 'utf8'));
const CAT_AR = { land: 'أرض', villa: 'فيلا', farm: 'مزرعة', apt: 'شقة' };
const priv = pub.map(p => ({ code: p.code, status: 'متاح', cat: CAT_AR[p.cat], title: p.title, area: p.area, area_m2: p.area_m2, bua: p.bua, mode: p.mode === 'dunam' ? 'للدنم' : 'مقطوع', price: p.price, nego: !!p.nego, confirmed: !p.unconfirmed, papers: p.papers || '', feats: p.feats || [], photos: [], note: p.note || '', src_place: '', src_by: '', commission: '', src_notes: '' }));
const existing = ['data.json', 'index.html', 'sitemap.xml', 'style.css', 'yaafour.html', 'villas-yaafour.html', 'land-yaafour.html', 'qura-alsham.html', 'villas-qura-alsham.html', ...pub.map(p => `listing/${p.code}.html`), 'img/mohammad-khaled.jpg', 'img/MK-012-1.jpg', 'p/aenk2cjiss3gw5q6ujfg.html', 'assets/mk.css', 'assets/mk.js'];
const b64 = t => Buffer.from(t, 'utf8').toString('base64');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, ignoreHTTPSErrors: true });
let blobN = 0; const commitsBy = {}; let deletes = [];
await ctx.route('https://api.github.com/**', async r => {
  const u = new URL(r.request().url()), m = r.request().method(), p = u.pathname;
  const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  let mm;
  if ((mm = p.match(/^\/repos\/[^/]+\/([^/]+)$/))) return json({ permissions: { push: true } });
  if ((mm = p.match(/^\/repos\/[^/]+\/([^/]+)\/contents\/(.+)$/))) { if (mm[1] === 'mk-inventory' && mm[2] === 'private.json') return json({ content: b64(JSON.stringify(priv)) }); return json({ message: 'nf' }, 404); }
  if (/\/git\/ref\/heads\/main$/.test(p)) return json({ object: { sha: 'HEAD0' } });
  if (/\/git\/commits\/HEAD0$/.test(p)) return json({ tree: { sha: 'TREE0' } });
  if (/\/git\/trees\/HEAD0$/.test(p) || /\/git\/trees\/TREE0$/.test(p)) return json({ tree: existing.map(x => ({ type: 'blob', path: x })) });
  if (/\/git\/blobs$/.test(p) && m === 'POST') { const body = JSON.parse(r.request().postData()); const id = 'B' + (++blobN); store.blobs[id] = body; return json({ sha: id }); }
  if (/\/git\/trees$/.test(p) && m === 'POST') { const body = JSON.parse(r.request().postData()); const repo = p.split('/')[3]; store.trees.push({ repo, tree: body.tree }); return json({ sha: 'T' + store.trees.length }); }
  if (/\/git\/commits$/.test(p) && m === 'POST') { const body = JSON.parse(r.request().postData()); store.commits.push(body); return json({ sha: 'C' + store.commits.length }); }
  if (/\/git\/refs\/heads\/main$/.test(p) && m === 'PATCH') return json({});
  return json({ message: 'unmocked ' + m + ' ' + p }, 500);
});
await ctx.route('http://localhost:8769/**', async r => { const f = decodeURIComponent(new URL(r.request().url()).pathname); const fp = path.join(REPO, f); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, body: fs.readFileSync(fp), contentType: fp.endsWith('.html') ? 'text/html' : fp.endsWith('.js') ? 'text/javascript' : fp.endsWith('.css') ? 'text/css' : 'application/octet-stream' }); return r.fulfill({ status: 404, body: '' }); });
const p = await ctx.newPage(); const errs = [];
p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
await p.goto('http://localhost:8769/admin.html', { waitUntil: 'domcontentloaded' });
await p.fill('#s_token', 'fake_token_for_test'); await p.click('#s_go');
await p.waitForSelector('#app:not([hidden])', { timeout: 15000 });
console.log('admin loaded, rows shown:', await p.evaluate(() => document.querySelectorAll('#grid .card').length));
// add a new listing through the real form
await p.click('#addBtn'); await p.waitForSelector('#dlg[open]');
await p.selectOption('#f_cat', 'فيلا'); await p.selectOption('#f_area', 'يعفور');
await p.fill('#f_title', 'فيلا اختبار 3 طوابق مع مسبح وبئر'); await p.fill('#f_land', '3'); await p.fill('#f_bua', '420'); await p.fill('#f_price', '2200000');
await p.fill('#f_featIn', 'مسبح'); await p.press('#f_featIn', 'Enter'); await p.fill('#f_featIn', 'بئر'); await p.press('#f_featIn', 'Enter');
await p.check('#f_feat');
console.log('new code proposed:', await p.inputValue('#f_code'));
await p.click('#saveBtn'); await p.waitForTimeout(300);
console.log('err:', await p.evaluate(() => document.getElementById('err').textContent || 'none'), '| pub bar text:', (await p.evaluate(() => document.getElementById('pubBtn').disabled)) ? 'disabled' : 'enabled');
await p.click('#pubBtn');
const t0 = Date.now(); while (!(store.commits.length >= 2) && Date.now() - t0 < 240000) await new Promise(r => setTimeout(r, 500));
await p.waitForTimeout(800);
console.log('publish finished in', Math.round((Date.now() - t0) / 1000), 's; commits:', store.commits.length, '| blobs:', Object.keys(store.blobs).length);
// what was written
const pubTree = store.trees.find(t => t.repo === 'aqarat-yaafour.github.io');
const files = {}; for (const e of pubTree.tree) files[e.path] = e.sha === null ? null : (e.content !== undefined ? { content: e.content, encoding: 'utf-8' } : store.blobs[e.sha]);
const text = e => e && (e.encoding === 'base64' ? Buffer.from(e.content, 'base64').toString('utf8') : e.content);
console.log('public commit writes', Object.keys(files).length, 'paths; deletions:', Object.entries(files).filter(([, v]) => v === null).map(([k]) => k));
const newPage = text(files['listing/MK-022.html']);
console.log('new listing page:', !!newPage, '| new design:', /assets\/mk\.css/.test(newPage), '| has 3D viewer:', /id="tile3d"/.test(newPage), '| title:', (newPage.match(/<title>([^<]*)/) || [])[1]);
const ogFiles = Object.keys(files).filter(k => k.startsWith('og/'));
const refd = (newPage.match(/og:image" content="https:\/\/aqarat-yaafour\.github\.io\/([^"]+)"/) || [])[1];
console.log('og cards written:', ogFiles.length, '(expect 20 listings + site = 21) | listing page points to an uploaded card:', ogFiles.includes(refd), refd);
const idx = text(files['index.html']);
console.log('index points to site card:', /og\/site-1\.jpg/.test(idx), '| card is real JPEG:', Buffer.from(files[ogFiles[0]].content, 'base64').subarray(0, 3).toString('hex') === 'ffd8ff');
console.log('index: new design', /assets\/mk\.js/.test(idx), '| newest first (MK-022 before MK-021):', idx.indexOf('MK-022.html') < idx.indexOf('MK-021.html'), '| featured flag in data:', /"featured":true/.test(idx));
const data = JSON.parse(text(files['data.json'])); console.log('data.json entries', data.length, 'last:', data[data.length - 1].code, data[data.length - 1].title);
console.log('sitemap has new page:', /MK-022/.test(text(files['sitemap.xml'])));
console.log('private commit:', store.trees.filter(t => t.repo === 'mk-inventory').length, 'tree(s), keeps commission fields:', /commission/.test(text((e0 => e0.content !== undefined ? e0 : store.blobs[e0.sha])(store.trees.find(t => t.repo === 'mk-inventory').tree[0]))));
fs.mkdirSync('/tmp/pub_out/listing', { recursive: true });
for (const [k, v] of Object.entries(files)) if (v && /\.(html|xml|json)$/.test(k)) { fs.mkdirSync(path.dirname('/tmp/pub_out/' + k), { recursive: true }); fs.writeFileSync('/tmp/pub_out/' + k, text(v)); }
console.log('errors', errs);
await b.close();
