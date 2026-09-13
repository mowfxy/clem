/**
 * Demo: smoke test every core engine.
 */
import { buildKMap } from '../../../core/src/dld/kmap.js';
import { buildTruthTable, minterms } from '../../../core/src/dld/truth_table.js';
import { xor, variable, parseBoolExpr, collectVariables } from '../../../core/src/dld/expression.js';
import { simplifyExpression } from '../../../core/src/dld/simplify.js';
import { renderPlotSvg } from '../../../core/src/graph/render_svg.js';
import { samplePlot } from '../../../core/src/graph/sample.js';
import { renderFBD } from '../../../core/src/diagram/freebody.js';
import { PdfBuilder } from '../../../core/src/pdf/pdf.js';

export function runDemo(): void {
  // 1) Build a 2-variable K-map for a XOR b.
  const xorExpr = xor(variable('a'), variable('b'));
  const vars = ['a', 'b'];
  const tt = buildTruthTable(vars, xorExpr);
  const kmap = buildKMap({ variables: vars, minterms: minterms(tt) });
  console.log('[demo] K-map cells:', kmap.cells.length, 'groups:', kmap.groups.length);

  // 2) Parse a boolean expression and simplify.
  const parsed = parseBoolExpr('!a + b*c');
  console.log('[demo] Parsed expression uses vars:', collectVariables(parsed).join(','));
  console.log('[demo] Simplify:', JSON.stringify(simplifyExpression(parsed).expr));

  // 3) Sample y = sin(x) and render.
  const samples = samplePlot({ fn: 'sin', domain: [0, 6.283], samples: 64 });
  const svg = renderPlotSvg(samples);
  console.log('[demo] Graph svg bytes:', svg.length);

  // 4) Build an FBD scene and render.
  const fbd = {
    title: 'Block on incline',
    objects: [{ id: 'b1', shape: 'box', center: { x: 0, y: 0 }, width: 2, height: 1, label: 'm' }],
    forces: [
      { object: 'b1', vector: { x: 0, y: -9.81 }, label: 'W' },
      { object: 'b1', vector: { x: 4, y: 6.928 }, label: 'T', angle: 60 },
    ],
    constraints: [],
    axes: { x: 12, y: 8 },
    origin: { x: 6, y: 4 },
  } as any;
  console.log('[demo] FBD svg bytes:', renderFBD(fbd).length);

  // 5) Generate a PDF.
  const pdf = new PdfBuilder({ pageSize: 'letter' });
  const p = pdf.addPage();
  p.text('Kinetra demo', { x: 60, y: 700, fontSize: 22, font: 'Helvetica-Bold' });
  p.text('K-map + graph + FBD + PDF in one run.', { x: 60, y: 660, fontSize: 12 });
  const bytes = pdf.build();
  console.log('[demo] pdf bytes:', bytes.byteLength, 'magic:', new TextDecoder('latin1').decode(bytes.subarray(0, 5)));
}
