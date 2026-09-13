/**
 * Workflow C: circuit analysis + schematic.
 *
 * Builds a structured electrical circuit (RC low-pass), runs DC + transient
 * simulation, plots the transient output, embeds schematic + plot in a PDF.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { newCircuit, addVoltageSource, addResistor, addCapacitor, addGround, validateCircuit } from '../../../core/src/circuit/circuit.js';
import { solveDC, solveTransient } from '../../../core/src/circuit/spice.js';
import { renderSchematic } from '../../../core/src/diagram/circuit_schematic.js';
import { samplePlot } from '../../../core/src/graph/sample.js';
import { renderPlotSvg } from '../../../core/src/graph/render_svg.js';
import { createDocument, validateDocument } from '../../../core/src/pdf/document.js';

export function runWorkflowC(): void {
  // RC low-pass: V1 -> R1 -> out -> C1 -> GND
  const c = newCircuit('rc-lowpass');
  const inNode = c.nodes.length;
  c.nodes.push();
  const outNode = c.nodes.length;
  c.nodes.push();
  addVoltageSource(c, inNode, 0, 1, 'V1');
  addResistor(c, inNode, outNode, 1000, 'R1');
  addCapacitor(c, outNode, 0, 1e-6, 'C1');
  addGround(c, 0);
  validateCircuit(c);

  const dc = solveDC(c);
  console.log('[workflow-c] dc voltages:', JSON.stringify(dc.voltages));

  const transient = solveTransient(c, { duration: 0.005, dt: 1e-5, probeNode: outNode });
  console.log('[workflow-c] transient samples:', transient.samples.length);

  const sch = renderSchematic({
    components: c.components.map((cmp: any, i: number) => ({
      id: cmp.id,
      kind: cmp.kind === 'resistor' ? 'R' : cmp.kind === 'capacitor' ? 'C' : cmp.kind === 'voltage-source' ? 'V' : cmp.kind === 'inductor' ? 'L' : cmp.kind === 'diode' ? 'D' : cmp.kind === 'current-source' ? 'I' : 'GND',
      x: 60 + (i % 3) * 120,
      y: 60 + Math.floor(i / 3) * 80,
      label: cmp.label ?? cmp.id,
    })),
    wires: [],
    width: 600,
    height: 240,
    title: 'RC low-pass filter',
  });
  console.log('[workflow-c] schematic svg bytes:', sch.length);

  const samples = transient.samples.map((s: any) => ({ x: s.t, y: s.v }));
  const plot = renderPlotSvg(samples);
  console.log('[workflow-c] plot svg bytes:', plot.length);

  const doc = createDocument({ title: 'Workflow C — RC Low-pass' });
  doc.addHeading('Workflow C: RC Low-pass Filter', 1);
  doc.addParagraph('Series RC driven by a 1 V DC source.');
  doc.addParagraph('R = 1 kOhm, C = 1 uF, tau = R*C = 1 ms.');
  doc.addFigure({ svg: sch, caption: 'Schematic', widthPt: 360, aspectRatio: 2.5 });
  doc.addFigure({ svg: plot, caption: 'Capacitor voltage vs time', widthPt: 360, aspectRatio: 1.6 });
  doc.addEquation('v_out(t) = V_in * (1 - exp(-t/(R*C)))');
  const bytes = doc.build();
  validateDocument(bytes);
  mkdirSync('output', { recursive: true });
  writeFileSync('output/workflow-c.pdf', bytes);
  console.log('[workflow-c] wrote output/workflow-c.pdf (' + bytes.byteLength + ' bytes)');
}
