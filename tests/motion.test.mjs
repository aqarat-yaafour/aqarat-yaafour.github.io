/* الحركة على اللابتوب: إعداد «تقليل الحركة» في النظام لا يجمّد المشهد ثلاثي الأبعاد، وفيه مفتاح لتشغيل الحركة الكاملة */
import { chromium } from './pw.mjs';
import fs from 'node:fs'; import path from 'node:path';
const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const MT = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', json: 'application/json', jpg: 'image/jpeg', svg: 'image/svg+xml', png: 'image/png', xml: 'text/xml', txt: 'text/plain', ico: 'image/x-icon' };
const ok = (n, c, extra = '') => console.log(c ? 'PASS' : 'FAIL', n, extra);
const b = await chromium.launch();
async function open(opts, url = 'https://aqarat-yaafour.github.io/') {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, ...opts });
  await ctx.route('https://aqarat-yaafour.github.io/**', r => { let p = decodeURIComponent(new URL(r.request().url()).pathname); if (p.endsWith('/')) p += 'index.html'; const fp = path.join(REPO, p); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, body: fs.readFileSync(fp), contentType: MT[fp.split('.').pop()] || 'application/octet-stream' }); return r.fulfill({ status: 404, body: '' }); });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto(url, { waitUntil: 'load' }); await pg.waitForTimeout(1400);
  return { ctx, pg, errs };
}
const sig = pg => pg.evaluate(() => { const c = document.getElementById('hero3d'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4 * 211) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3]) >>> 0; return h; });
async function drag(pg) { const box = await pg.locator('#hero3d').boundingBox(); await pg.mouse.move(box.x + box.width * .4, box.y + box.height * .45); await pg.mouse.down(); await pg.mouse.move(box.x + box.width * .18, box.y + box.height * .45, { steps: 14 }); await pg.mouse.up(); }

console.log('=== لابتوب بإعدادات عادية ===');
let A = await open({ reducedMotion: 'no-preference' });
let s1 = await sig(A.pg); await A.pg.waitForTimeout(1200); let s2 = await sig(A.pg);
ok('the scene animates by itself', s1 !== s2);
let before = await sig(A.pg); await drag(A.pg); await A.pg.waitForTimeout(500);
ok('mouse drag turns it', before !== await sig(A.pg));
ok('no motion switch is shown (nothing to switch)', (await A.pg.locator('.motion-pill, .motion-link').count()) === 0 && !(await A.pg.evaluate(() => document.documentElement.classList.contains('no-anim'))));
ok('no errors', A.errs.length === 0, JSON.stringify(A.errs)); await A.ctx.close();

console.log('=== لابتوب نظامه يطلب «تقليل الحركة» (سبب شكوى التجمّد) ===');
let R = await open({ reducedMotion: 'reduce' });
ok('it does NOT animate on its own (respects the setting)', await (async () => { const a = await sig(R.pg); await R.pg.waitForTimeout(1500); return a === await sig(R.pg); })());
before = await sig(R.pg); await drag(R.pg); await R.pg.waitForTimeout(400);
ok('but mouse dragging DOES turn the 3D scene (was frozen before the fix)', before !== await sig(R.pg));
await R.pg.waitForTimeout(3600); const idle1 = await sig(R.pg); await R.pg.waitForTimeout(1200);
ok('and it comes to rest afterwards (no endless motion)', idle1 === await sig(R.pg));
const nextBtn = R.pg.locator('#pcNext'); const t0 = await R.pg.textContent('#pcTitle'); await nextBtn.click(); await R.pg.waitForTimeout(1500);
ok('the ‹ › buttons still move to the next property', (await R.pg.textContent('#pcTitle')) !== t0, t0 + ' → ' + await R.pg.textContent('#pcTitle'));
ok('a clear switch tells the visitor why, and offers full motion', /الحركة موقوفة بإعداد جهازك/.test(await R.pg.locator('.motion-pill').textContent()));
ok('a footer link offers it too', /تشغيل الحركة/.test(await R.pg.locator('.motion-link').textContent()));
await R.pg.locator('.motion-pill').click(); await R.pg.waitForLoadState('load'); await R.pg.waitForTimeout(1500);
ok('after pressing it: full motion (animates by itself), and the choice is remembered', await (async () => { const a = await sig(R.pg); await R.pg.waitForTimeout(1200); return a !== await sig(R.pg); })() && (await R.pg.evaluate(() => localStorage.getItem('mk_motion'))) === '1');
ok('…the hint pill is gone and the footer link now offers to stop it', (await R.pg.locator('.motion-pill').count()) === 0 && /إيقاف الحركة/.test(await R.pg.locator('.motion-link').textContent()) && !(await R.pg.evaluate(() => document.documentElement.classList.contains('no-anim'))));
await R.pg.goto('https://aqarat-yaafour.github.io/yaafour.html', { waitUntil: 'load' }); await R.pg.waitForTimeout(600);
ok('the choice carries over to other pages (reveal animations run again)', !(await R.pg.evaluate(() => document.documentElement.classList.contains('no-anim'))));
await R.pg.goto('https://aqarat-yaafour.github.io/', { waitUntil: 'load' }); await R.pg.waitForTimeout(800);
await R.pg.locator('.motion-link').click(); await R.pg.waitForLoadState('load'); await R.pg.waitForTimeout(900);
ok('pressing “إيقاف الحركة” returns to the calm mode', (await R.pg.evaluate(() => localStorage.getItem('mk_motion'))) === '0' && (await R.pg.evaluate(() => document.documentElement.classList.contains('no-anim'))));
ok('no errors', R.errs.length === 0, JSON.stringify(R.errs)); await R.ctx.close();

console.log('=== ?motion=1 ===');
let Q = await open({ reducedMotion: 'reduce' }, 'https://aqarat-yaafour.github.io/?motion=1');
ok('the link parameter turns full motion on without pressing anything', await (async () => { const a = await sig(Q.pg); await Q.pg.waitForTimeout(1200); return a !== await sig(Q.pg); })());
await Q.ctx.close();

console.log('=== صفحة عقار واحد (المجسّم) مع تقليل الحركة ===');
let T = await open({ reducedMotion: 'reduce' }, 'https://aqarat-yaafour.github.io/listing/MK-001.html');
const tsig = () => T.pg.evaluate(() => { const c = document.getElementById('tile3d'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4 * 131) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2]) >>> 0; return h; });
const tb = await tsig(); const bx = await T.pg.locator('#tile3d').boundingBox();
await T.pg.mouse.move(bx.x + bx.width * .6, bx.y + bx.height * .5); await T.pg.mouse.down(); await T.pg.mouse.move(bx.x + bx.width * .3, bx.y + bx.height * .5, { steps: 12 }); await T.pg.mouse.up(); await T.pg.waitForTimeout(500);
ok('the single-listing 3D viewer can also be turned by dragging', tb !== await tsig());
ok('no errors', T.errs.length === 0, JSON.stringify(T.errs)); await T.ctx.close();
await b.close();
