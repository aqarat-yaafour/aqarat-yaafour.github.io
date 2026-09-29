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
const O=((process.env.TMPDIR || '/tmp') + '/');
const PX='/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
await p.evaluate(px => { ROWS[0].photos = ['img/MK-001-1.jpg']; newBlobs['img/MK-001-1.jpg'] = px; openGallery(ROWS[0]); }, PX);
p.on('dialog', d => d.accept());
await p.click('#galNew');
const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#galOpen')]);
await pop.waitForLoadState('domcontentloaded'); await pop.waitForTimeout(1500);
console.log('popup url', pop.url().slice(0,30), '| title', await pop.title(), '| data-img', await pop.evaluate(() => document.querySelector('.gshot img').src.slice(0,26)));
await pop.screenshot({ path: O + 'gal.png' });
console.log('msg:', await p.textContent('#galMsg'), '| errors', errs);
await b.close();
