import { chromium } from './pw.mjs';
import fs from 'node:fs'; import path from 'node:path';
const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
const MT = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', json: 'application/json', jpg: 'image/jpeg', svg: 'image/svg+xml', png: 'image/png', xml: 'text/xml', ico: 'image/x-icon' };
await ctx.route('https://aqarat-yaafour.github.io/**', r => { let p = decodeURIComponent(new URL(r.request().url()).pathname); if (p.endsWith('/')) p += 'index.html'; const fp = path.join(REPO, p); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, body: fs.readFileSync(fp), contentType: MT[fp.split('.').pop()] || 'application/octet-stream' }); return r.fulfill({ status: 404, body: '' }); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/404/.test(m.text()) && errs.push(m.text()));
await p.goto('https://aqarat-yaafour.github.io/', { waitUntil: 'load' }); await p.waitForTimeout(800);
const ok = (n, c) => console.log(c ? 'PASS' : 'FAIL', n);
ok('hero canvas drawing (has painted pixels)', await p.evaluate(() => { const c = document.getElementById('hero3d'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) n++; return n > 200; }));
const H = await p.evaluate(() => document.documentElement.scrollHeight);
/* walk the whole page; every reveal element must end fully visible when scrolled into the middle */
const n = await p.evaluate(() => document.querySelectorAll('.rv').length);
let bad = 0;
for (let i = 0; i < n; i++) {
  await p.evaluate(i => document.querySelectorAll('.rv')[i].scrollIntoView({ block: 'center' }), i); await p.waitForTimeout(90);
  const o = await p.evaluate(i => +getComputedStyle(document.querySelectorAll('.rv')[i]).opacity, i); if (o < .95) bad++;
}
ok(`reveal: ${n} elements all visible when scrolled to (${bad} not)`, bad === 0);
await p.evaluate(() => document.querySelector('[data-count]').scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
ok('count-up reaches its target', await p.evaluate(() => [...document.querySelectorAll('[data-count]')].every(e => +e.textContent === +e.dataset.count)));
await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(200);
ok('nav bg is transparent at top / solid after scroll', await p.evaluate(() => +getComputedStyle(document.documentElement).getPropertyValue('--navbg') === 0) && (await p.evaluate(() => { scrollTo(0, 900); return new Promise(r => setTimeout(() => r(+getComputedStyle(document.documentElement).getPropertyValue('--navbg') === 1), 250)); })));
/* circle CTA */
await p.evaluate(() => { const r = document.getElementById('reveal'); scrollTo(0, r.offsetTop + r.offsetHeight - innerHeight * 1.1); }); await p.waitForTimeout(300);
const cr0 = await p.evaluate(() => parseFloat(getComputedStyle(document.getElementById('circle')).getPropertyValue('--cr')));
ok('circle CTA expands near the end of its section (--cr=' + cr0 + ')', cr0 > 60);
/* filters re-measure: filter to one area, scroll to a row, it must show its line */
await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(200);
await p.selectOption('#fCat', 'villa'); await p.waitForTimeout(300);
const shown = await p.evaluate(() => [...document.querySelectorAll('#listings-grid .row')].filter(r => !r.hidden).length);
await p.evaluate(() => document.querySelector('#listings-grid .row:not([hidden])').scrollIntoView({ block: 'center' })); await p.waitForTimeout(250);
const lx = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('#listings-grid .row:not([hidden])')).getPropertyValue('--lx')));
ok(`filter villas: ${shown} rows shown, first visible row line drawn (--lx=${lx})`, shown > 0 && lx > .9);
/* other page types */
for (const pg of ['listing/MK-003.html', 'yaafour.html']) {
  const q = await ctx.newPage(); const e2 = []; q.on('pageerror', e => e2.push(e.message));
  await q.goto('https://aqarat-yaafour.github.io/' + pg, { waitUntil: 'load' }); await q.waitForTimeout(600);
  await q.evaluate(() => scrollTo(0, 600)); await q.waitForTimeout(200);
  ok(pg + ' loads, scrolls, no errors' + (pg.startsWith('listing') ? ' (3D viewer painted: ' + await q.evaluate(() => { const c = document.getElementById('tile3d'); if (!c) return 'no canvas'; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) n++; return n > 100; }) + ')' : ''), e2.length === 0);
}
console.log('page errors:', errs);
await b.close();
