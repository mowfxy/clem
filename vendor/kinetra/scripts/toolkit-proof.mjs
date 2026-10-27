// Compose the toolkit proof set (examples/toolkit/proof/*.json): each SVG goes
// to docs/toolkit/contact-sheet/proof/ and each report to out/toolkit/proof/.
// With a headless Chrome or Edge (dev-time only; KINETRA_CHROME overrides the
// path) it also writes PNGs: one per diagram when a name filter is given or
// PROOF_PNG=1 is set, and the contact sheet proof.png (from proof.html).
// Run: npm run proof:toolkit [-- <name-substring>]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compose } from '../packages/core/src/toolkit/index.ts';

const root = new URL('../', import.meta.url);
const dir = new URL('examples/toolkit/proof/', root);
const outDir = resolve(new URL('docs/toolkit/contact-sheet/proof/', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const reportDir = resolve(new URL('out/toolkit/proof/', root).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });
const only = process.argv[2];

function findChrome() {
  const c = [process.env.KINETRA_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return c.find(p => p && fs.existsSync(p));
}
const chrome = findChrome();
const shot = (file, w, h, png) => chrome && spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w},${h}`, `--screenshot=${png}`, pathToFileURL(file).href]);

let failed = 0;
const done = [];
for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  if (only && !name.includes(only)) continue;
  const m = JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'));
  const r = compose(m);
  const base = name.replace(/\.json$/, '');
  if (!r.ok) {
    failed++;
    console.log(`FAIL ${base} [${r.report.stage}]`);
    for (const e of r.errors) console.log(`  ${e.code} ${e.elements.join(',')}: ${e.message}${e.suggestion ? `\n    -> ${e.suggestion}` : ''}`);
    continue;
  }
  const svgPath = resolve(outDir, `${base}.svg`);
  fs.writeFileSync(svgPath, r.svg);
  fs.writeFileSync(resolve(reportDir, `${base}.report.json`), JSON.stringify(r.report, null, 2) + '\n');
  if (only || process.env.PROOF_PNG) shot(svgPath, m.canvas.width, m.canvas.height, resolve(outDir, `${base}.png`));
  done.push({ base, w: m.canvas.width, h: m.canvas.height });
  console.log(`ok   ${base}: ${r.report.checks.length} checks (${r.report.checks.map(c => c.id ?? c.type).join(', ')}), ${r.report.labels.length} labels, ${r.report.gate.pairsTested} pairs, ${r.report.gate.collisions} collisions`);
}
if (!only && done.length) {
  // Contact sheet: every proof diagram at half size in a 3-column grid.
  const cells = done.map(d => `<figure><img src="proof/${d.base}.svg" width="${d.w / 2}" height="${d.h / 2}"><figcaption>${d.base}</figcaption></figure>`).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><title>Toolkit proof set</title><style>body{margin:12px;font:12px Arial,sans-serif;background:#fff;display:grid;grid-template-columns:repeat(3,440px);gap:10px}figure{margin:0;border:1px solid #ddd;padding:4px}img{display:block;max-width:430px;height:auto}figcaption{color:#555;margin-top:2px}</style>\n${cells}\n`;
  const page = resolve(outDir, '..', 'proof.html');
  fs.writeFileSync(page, html);
  const rows = Math.ceil(done.length / 3);
  shot(page, 1380, rows * 330 + 40, resolve(outDir, '..', 'proof.png'));
  console.log(`contact sheet: ${done.length} diagrams -> docs/toolkit/contact-sheet/proof.html${chrome ? ' + proof.png' : ''}`);
}
process.exitCode = failed ? 1 : 0;
