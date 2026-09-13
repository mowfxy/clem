/**
 * Workflow B: physics + 2D diagram.
 *
 * Builds a structured free-body diagram for an inclined-plane problem,
 * renders it, then embeds the SVG and the equations of motion in a PDF.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { renderFBD } from '../../../core/src/diagram/freebody.js';
import { createDocument, validateDocument } from '../../../core/src/pdf/document.js';
import { renderPlotSvg } from '../../../core/src/graph/render_svg.js';
import { samplePlot } from '../../../core/src/graph/sample.js';
import type { FBDModel } from '../../../core/src/diagram/freebody.js';

export function runWorkflowB(): void {
  const m = 5;
  const theta = (30 * Math.PI) / 180;
  const g = 9.81;
  const mu = 0.2;
  const N = m * g * Math.cos(theta);
  const fg = m * g * Math.sin(theta);
  const fric = mu * N;
  const a = (fg - fric) / m;

  const fbd: FBDModel = {
    title: 'Block on 30 deg incline',
    objects: [{ id: 'block', shape: 'box', center: { x: 0, y: 0 }, width: 2, height: 1, label: 'm' }],
    forces: [
      { object: 'block', vector: { x: 0, y: -m * g }, label: 'W = mg', at: { x: 0, y: 0 } },
      { object: 'block', vector: { x: 0, y: N }, label: 'N', at: { x: 0, y: 0 } },
      { object: 'block', vector: { x: -fric, y: 0 }, label: 'f_k', at: { x: 0, y: 0 } },
    ],
    constraints: [],
    axes: { x: 12, y: 12 },
    origin: { x: 6, y: 6 },
  };
  const svg = renderFBD(fbd);
  console.log('[workflow-b] free-body svg bytes:', svg.length);

  const samples = samplePlot(
    {
      id: 'vt',
      title: 'v(t)',
      type: 'function2d',
      xRange: [0, 5],
      xAxis: { label: 't (s)' },
      yAxis: { label: 'v (m/s)' },
      functions: [{ expression: { kind: 'literal', value: a } as any, label: 'v = a*t' }],
    } as any,
    40,
  );
  const plot = renderPlotSvg(samples);
  console.log('[workflow-b] plot svg bytes:', plot.length);

  const doc = createDocument({ title: 'Workflow B — Inclined Plane' });
  doc.addHeading('Workflow B: Block on a 30 deg Incline', 1);
  doc.addParagraph('Mass m = ' + m + ' kg, angle = 30 deg, mu_k = ' + mu + '.');
  doc.addParagraph('Normal force N = m*g*cos(theta) = ' + N.toFixed(2) + ' N.');
  doc.addParagraph('Friction f_k = mu*N = ' + fric.toFixed(2) + ' N.');
  doc.addParagraph('Acceleration a = (m*g*sin(theta) - mu*m*g*cos(theta)) / m = ' + a.toFixed(3) + ' m/s^2.');
  doc.addFigure({ svg, caption: 'Free-body diagram', widthPt: 320, aspectRatio: 1 });
  doc.addFigure({ svg: plot, caption: 'Velocity vs time', widthPt: 320, aspectRatio: 1.4 });
  doc.addEquation('a = g * (sin(theta) - mu_k * cos(theta))');
  const bytes = doc.build();
  validateDocument(bytes);
  mkdirSync('output', { recursive: true });
  writeFileSync('output/workflow-b.pdf', bytes);
  console.log('[workflow-b] wrote output/workflow-b.pdf (' + bytes.byteLength + ' bytes)');
}
