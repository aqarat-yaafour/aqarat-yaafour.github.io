/* قياس أداء (ليس اختباراً): node tests/perf.mjs 4 index.html   ← إبطاء المعالج 4 مرات */
import { chromium } from './pw.mjs';
import fs from 'node:fs'; import path from 'node:path';
const REPO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const RATE = +(process.argv[2] || 4), PAGE = process.argv[3] || 'index.html', MODE = process.argv[4] || 'all';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
const MT = { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', json: 'application/json', jpg: 'image/jpeg', xml: 'text/xml', svg: 'image/svg+xml', png: 'image/png' };
let bytes = 0, reqs = 0;
await ctx.route('https://aqarat-yaafour.github.io/**', r => {
  let p = decodeURIComponent(new URL(r.request().url()).pathname); if (p.endsWith('/')) p += 'index.html'; const fp = path.join(REPO, p.split('?')[0]);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { const buf = fs.readFileSync(fp); bytes += buf.length; reqs++; return r.fulfill({ status: 200, body: buf, contentType: MT[fp.split('.').pop()] || 'application/octet-stream' }); }
  return r.fulfill({ status: 404, body: '' });
});
const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
await p.addInitScript(() => {
  window.__lt = []; window.__lcp = 0; window.__fcp = 0;
  new PerformanceObserver(l => l.getEntries().forEach(e => __lt.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver(l => l.getEntries().forEach(e => { __lcp = e.startTime; })).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(l => l.getEntries().forEach(e => { if (e.name === 'first-contentful-paint') __fcp = e.startTime; })).observe({ type: 'paint', buffered: true });
});
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
const t0 = Date.now();
await p.goto('https://aqarat-yaafour.github.io/' + PAGE, { waitUntil: 'load' });
const loadMs = Date.now() - t0;
await p.waitForTimeout(1500);
{ const { profile } = await cdp.send('Profiler.stop'); const self = {}; const idx = {}; profile.nodes.forEach(n => idx[n.id] = n);
  profile.samples.forEach((id, i) => { const n = idx[id], k = (n.callFrame.functionName || '(anon)') + ' ' + (n.callFrame.url.split('/').pop() || '') + ':' + n.callFrame.lineNumber; self[k] = (self[k] || 0) + (profile.timeDeltas[i] || 0) / 1000; });
  console.log('LOAD top CPU:', Object.entries(self).filter(([k]) => !/^\(idle|^\(program|^\(root/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 9).map(([k, v]) => k + ' ' + v.toFixed(0) + 'ms').join('\n   ')); }
const L = await p.evaluate(() => ({ fcp: Math.round(__fcp), lcp: Math.round(__lcp), lt: __lt.length, tbt: Math.round(__lt.reduce((a, [s, d]) => a + Math.max(0, d - 50), 0)), canvases: [...document.querySelectorAll('canvas')].map(c => c.width + 'x' + c.height) }));
console.log(`\n== ${PAGE} @ CPU ${RATE}x, 360x740 dpr3 ==`);
console.log(`transfer (uncompressed) ${(bytes / 1024).toFixed(0)}KB in ${reqs} requests | load ${loadMs}ms | FCP ${L.fcp}ms LCP ${L.lcp}ms | long tasks ${L.lt}, TBT ${L.tbt}ms | canvas ${L.canvases.join(', ')}`);
const sampler = `(ms) => new Promise(res => { const t = []; let last = performance.now(), end = last + ms; (function f(now) { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else res(t); })(last); requestAnimationFrame(() => {}); })`;
const stats = t => { t = t.slice(2); const s = [...t].sort((a, b) => a - b); const avg = t.reduce((a, c) => a + c, 0) / t.length; return `fps ${(1000 / avg).toFixed(0)} | avg ${avg.toFixed(1)}ms p95 ${s[Math.floor(s.length * .95)].toFixed(0)}ms max ${s[s.length - 1].toFixed(0)}ms | frames >33ms: ${t.filter(x => x > 33.4).length}/${t.length}`; };
async function phase(name, action) {
  await cdp.send('Profiler.start');
  const sp = p.evaluate(`(${sampler})(4000)`); if (action) await action(); const t = await sp;
  const { profile } = await cdp.send('Profiler.stop');
  const self = {}; const dt = profile.timeDeltas; const idx = {}; profile.nodes.forEach(n => idx[n.id] = n);
  profile.samples.forEach((id, i) => { const n = idx[id], k = (n.callFrame.functionName || '(anon)') + ':' + n.callFrame.lineNumber; self[k] = (self[k] || 0) + (dt[i] || 0) / 1000; });
  const top = Object.entries(self).filter(([k]) => !k.startsWith('(idle') && !k.startsWith('(program') && !k.startsWith('(root')).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v.toFixed(0)}ms`).join(' · ');
  console.log(`${name}: ${stats(t)}\n   top CPU: ${top}`);
}
await phase('idle at top (hero animating)', null);
if (MODE === 'all') {
  await phase('finger drag on hero', async () => { const cx = 180; for (let i = 0; i < 30; i++) { await p.touchscreen.tap(1, 1).catch(() => {}); } });
  await phase('scrolling the page', async () => { for (let i = 0; i < 40; i++) { await p.mouse.wheel(0, 60); await p.waitForTimeout(90); } });
  await phase('idle far down (hero off-screen)', null);
}
console.log('page errors:', await p.evaluate(() => 0));
await b.close();
