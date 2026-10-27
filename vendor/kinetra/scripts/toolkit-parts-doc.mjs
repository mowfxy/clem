// Generate docs/toolkit/parts.md from the part registry: every part with its
// category, aliases, positioning, options, anchors and a sample composition
// fragment. Run: npm run docs:toolkit-parts (the parts tests check it is current).
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { TOOLKIT_PART_CATALOG, TOOLKIT_PART_SAMPLES } from '../packages/core/src/toolkit/index.ts';

const ORDER = ['general', 'mechanics', 'fields', 'fluids', 'circuits', 'logic', 'plots'];
const TITLES = { general: 'General', mechanics: 'Mechanics and structures', fields: 'Fields and electromagnetism', fluids: 'Fluids and thermodynamics', circuits: 'Circuits', logic: 'Logic and controls', plots: 'Plots' };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const compact = v => JSON.stringify(v).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/\{"/g, '{ "').replace(/"\}/g, '" }').replace(/(\d)\}/g, '$1 }');

export function partsMarkdown() {
  const L = [];
  const counts = Object.fromEntries(ORDER.map(c => [c, TOOLKIT_PART_CATALOG.filter(p => p.category === c).length]));
  L.push('# Toolkit parts catalogue', '');
  L.push('Generated from the part registry by `npm run docs:toolkit-parts`; do not edit by hand.', '');
  L.push(`The library adds ${TOOLKIT_PART_CATALOG.length} part types to the ${11} basic shapes described in [engine.md](engine.md#basic-parts-agent-1) (point, rect/box, block, circle, segment, polyline, polygon, arc, arrow/force, curve, text).`, '');
  L.push('| Category | Parts |', '| --- | --- |');
  for (const c of ORDER) L.push(`| ${TITLES[c]} | ${counts[c]} |`);
  L.push('', 'Contact sheets of every part: [contact-sheet/](contact-sheet/) (SVG and PNG per category).', '');
  L.push('## Conventions', '');
  L.push('- **World units.** Sizes are world units unless an option says px. Circuit and logic symbols keep the template schematic\'s proportions; use `scale` (circuits) or `w` (gates) to size them for the canvas zoom.');
  L.push('- **Placed parts** take `at` or `place` relations for their origin (named in the description). **Point parts** take point references (`"id.anchor"`, `{"x":..,"y":..}`, `{"ref":..,"dx":..}`).');
  L.push('- **Anchors** are named points other elements can refer to as `"id.anchor"`; `name(arg)` anchors take a number, a length or an angle, e.g. `"beam.top(0.5)"`, `"pulley.rim(30 deg)"`, `"gate.in(1)"`.');
  L.push('- **Contacts.** Parts that sit on or connect to other parts may touch them without `mayTouch`: connectors, leaders, ropes, springs, dampers, loads, wires and pipes touch the elements their end points name; supports, pivots, hinges, moments, junctions and take-off points touch what they are attached to; series and plot annotations touch their axes; transitions and self-loops touch their states. Any other contact still needs `mayTouch`, and **text is never excused**: a line through a part\'s own text (tick labels, symbol letters, table cells) is an E_COLLISION even between parts allowed to touch.');
  L.push('- **Text inside symbols** (meter letters, gate marks, state names, box text) must fit inside its frame at the current zoom; otherwise E_INVALID_VALUE asks for a larger `scale`/size.');
  L.push('- **Style.** Every part draws only Scene2D shapes in palette colours and contract stroke widths, so output matches the template renderers ([style-contract.md](style-contract.md)).');
  L.push('- **Checks.** Parts expose values to declared checks as `<id>.<name>` (listed under *Refs* where a part has them), e.g. `shade.area`, `slopeTriangle.slope`, `incline.angle`, `rope.length`, `truss.members`.', '');
  for (const c of ORDER) {
    L.push(`## ${TITLES[c]}`, '');
    for (const p of TOOLKIT_PART_CATALOG.filter(q => q.category === c)) {
      L.push(`### \`${p.type}\``, '');
      L.push(p.description, '');
      const meta = [`**Positioning:** ${p.positioning === 'placed' ? 'placed (origin by `at` / `place`)' : 'by point references'}`];
      if (p.aliases.length) meta.push(`**Aliases:** ${p.aliases.map(a => `\`${a}\``).join(', ')}`);
      L.push(meta.join(' · '), '');
      const opts = Object.entries(p.options);
      if (opts.length) { L.push('| Option | Meaning |', '| --- | --- |'); for (const [k, v] of opts) L.push(`| \`${k}\` | ${String(v).replace(/\|/g, '\\|')} |`); L.push(''); }
      L.push(`**Anchors:** ${p.anchors.map(a => `\`${a}\``).join(', ')}`, '');
      const sample = TOOLKIT_PART_SAMPLES.get(p.type)?.(p.type.replace(/[^A-Za-z0-9_]/g, '_'), { x: 2, y: 1.5 }, rng(7));
      if (sample) { L.push('```json', ...sample.map(e => compact(e)), '```', ''); }
    }
  }
  return L.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync('docs/toolkit/parts.md', partsMarkdown());
  console.log(`docs/toolkit/parts.md: ${TOOLKIT_PART_CATALOG.length} parts`);
}
