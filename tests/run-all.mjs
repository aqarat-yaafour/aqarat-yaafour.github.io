/* يشغّل كل الاختبارات ويلخّص: node tests/run-all.mjs
   الفشل = خروج بخطأ، أو سطر فيه FAIL أو false، أو مصفوفة أخطاء غير فارغة. */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = new URL('.', import.meta.url).pathname;
const files = readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync('node', [dir + f], { encoding: 'utf8', timeout: 600000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const bad = out.split('\n').filter(l => !/^PASS/.test(l) && /\bFAIL\b|\bfalse\b|errors?: \[\s*['"]/.test(l));
  const pass = (out.match(/^PASS/gm) || []).length;
  const ok = r.status === 0 && !bad.length;
  if (!ok) { failed++; console.log('✗', f, '\n   ' + (bad.concat(r.status ? ['exit code ' + r.status, out.slice(-400)] : [])).join('\n   ')); }
  else console.log('✓', f, pass ? `(${pass} فحصاً)` : '');
}
console.log(failed ? `\n${failed} من ${files.length} فشل` : `\nنجحت كل الاختبارات (${files.length})`);
process.exit(failed ? 1 : 0);
