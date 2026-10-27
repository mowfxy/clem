// Render every toolkit example composition to out/toolkit/ (SVG + report).
// Run: npm run examples:toolkit
import fs from 'node:fs';
import { compose } from '../../packages/core/src/toolkit/index.ts';

const here = new URL('./', import.meta.url);
const out = new URL('../../out/toolkit/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
let failed = 0;
for (const name of fs.readdirSync(here).filter(f => f.endsWith('.json')).sort()) {
  const result = compose(JSON.parse(fs.readFileSync(new URL(name, here), 'utf8')));
  const base = name.replace(/\.json$/, '');
  if (!result.ok) { failed++; console.log(`FAIL ${base}\n${JSON.stringify(result.errors, null, 2)}`); continue; }
  fs.writeFileSync(new URL(base + '.svg', out), result.svg);
  fs.writeFileSync(new URL(base + '.report.json', out), JSON.stringify(result.report, null, 2) + '\n');
  console.log(`ok   ${base} (${result.report.checks.length} checks, ${result.report.labels.length} labels)`);
}
process.exitCode = failed ? 1 : 0;
