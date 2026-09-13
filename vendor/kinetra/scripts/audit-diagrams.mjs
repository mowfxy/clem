// Independent acceptance probes. Failures are real blockers, not expected passes.
// Run: npm run audit:diagrams
import fs from 'node:fs';
import { lensImage, renderOptics } from '../packages/core/src/diagram/optics.ts';
import { buildSceneFromProjectile, renderProjectile } from '../packages/core/src/diagram/projectile.ts';
import { renderScene2D, worldToView } from '../packages/core/src/diagram/scene2d.ts';
import { renderScalarField } from '../packages/core/src/diagram/fields.ts';
import { renderSchematic } from '../packages/core/src/diagram/circuit_schematic.ts';

const base = { world: { xMin: -5, xMax: 5, yMin: -3, yMax: 3 }, width: 600, height: 360 };
const optic = { ...base, element: { kind: 'thin-lens-converging', x: 0, y: 0, focal: 1 }, objectBase: { x: -2, y: 0 }, objectHeight: 1 };
const projectile = { width: 600, height: 360, initialPosition: { x: 0, y: 20 }, initialSpeed: 15, launchAngleDeg: 30, gravity: 9.81 };
const results = [];
function check(name, pass, observed) { results.push({ name, pass, observed }); }
const plane = lensImage({ ...optic, element: { kind: 'plane-mirror', x: 0, yMin: -2, yMax: 2 } });
check('Plane mirror preserves upright height and magnification +1', plane.imageHeight === 1 && plane.magnification === 1, plane);
const mirror = lensImage({ ...optic, element: { kind: 'concave-mirror', x: 0, y: 0, focal: 1, radius: 2 } });
check('Concave mirror at u=2f forms real image on object side x=-2', mirror.imageBase.x === -2, mirror.imageBase);
const vector = renderScene2D({ ...base, shapes: [{ kind: 'vector', at: { x: 0, y: 0 }, v: { x: 1, y: 1 }, label: 'F' }] });
const ids = [...vector.matchAll(/marker-end="url\(#([^)]*)\)"/g)].map(m => m[1]);
check('Every vector arrowhead reference resolves', ids.length > 0 && ids.every(id => vector.includes(`id="${id}"`)), ids);
const scene = buildSceneFromProjectile(projectile);
const svg = renderScene2D(scene);
const path = svg.match(/<path d="M ([^ ]+) ([^ ]+)[^"]*"([^>]*)/);
const transform = path?.[3].match(/transform="matrix\(([^)]+)\)"/);
const matrix = transform ? transform[1].split(/[ ,]+/).map(Number) : [1, 0, 0, 1, 0, 0];
const pathStart = path ? { x: matrix[0]*Number(path[1])+matrix[2]*Number(path[2])+matrix[4], y: matrix[1]*Number(path[1])+matrix[3]*Number(path[2])+matrix[5] } : undefined;
const launch = worldToView(scene, projectile.initialPosition);
check('Rendered trajectory begins at rendered launch point', !!pathStart && Math.hypot(pathStart.x - launch.x, pathStart.y - launch.y) < 1e-6, { pathStart, launch });
const trajectory = scene.shapes.find(s => s.kind === 'path').d.trim().split(/\s+/);
check('Default projectile trajectory stops at ground', Math.abs(Number(trajectory.at(-1))) < 1e-6, { finalWorldY: Number(trajectory.at(-1)) });
let dragRejected = false, dragSvg;
try { dragSvg = renderProjectile({ ...projectile, drag: 1 }); } catch { dragRejected = true; }
check('Nonzero drag is implemented or explicitly rejected', dragRejected || dragSvg !== svg, { dragRejected, identicalToVacuum: dragSvg === svg });
const focalSvg = renderOptics({ ...optic, objectBase: { x: -1, y: 0 } });
check('Object at focus does not emit nonfinite SVG coordinates', !/NaN|Infinity/.test(focalSvg), { nonfinite: /NaN|Infinity/.test(focalSvg) });
const contour = renderScalarField({ ...base, type: 'scalar', field: p => p.x + p.y, cols: 4, rows: 4, contours: [0.123] });
const contourLines = [...contour.matchAll(/<line ([^>]+)>?/g)].map(m => Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]))).filter(a => a['stroke-width'] === '0.6');
check('Linear scalar field produces nonzero contour segments', contourLines.length > 0 && contourLines.every(a => a.x1 !== a.x2 || a.y1 !== a.y2), { segments: contourLines.length, nonzero: contourLines.filter(a => a.x1 !== a.x2 || a.y1 !== a.y2).length });
const circuit = renderSchematic({ ...base, components: [{ id: 'R', kind: 'resistor', position: { x: 0, y: 0 }, label: 'R' }], wires: [{ from: { componentId: 'R', pin: 0 }, to: { point: { x: -2, y: 0 } } }] });
const componentMatrix=circuit.match(/data-component="R" transform="matrix\(([^)]+)\)"/)?.[1].split(/[ ,]+/).map(Number);
const actualSymbolWidth=componentMatrix ? 0.6*Math.hypot(componentMatrix[0],componentMatrix[1]):0.6;
check('Schematic symbol applies world scale consistently with wires', Math.abs(actualSymbolWidth-36)<1e-9, { expectedSymbolWidthPx:36, actualSymbolWidthPx:actualSymbolWidth });
const dir = new URL('../out/diagram-audit/', import.meta.url);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(new URL('results.json', dir), JSON.stringify(results, null, 2) + '\n');
const examples = [['Projectile', svg], ['Plane mirror', renderOptics({ ...optic, element: { kind: 'plane-mirror', x: 0, yMin: -2, yMax: 2 } })], ['Converging lens', renderOptics(optic)], ['Circuit scale', circuit], ['Scalar contours', contour]];
for (const [i, [, content]] of examples.entries()) fs.writeFileSync(new URL(`example-${i + 1}.svg`, dir), content);
fs.writeFileSync(new URL('gallery.html', dir), '<!doctype html><meta charset="utf-8"><title>Current renderer audit evidence</title><style>body{font:16px system-ui;margin:32px;background:#eee}section{background:white;padding:20px;margin:20px 0;max-width:650px}svg{border:1px solid #ccc}</style><h1>Current renderer audit evidence</h1><p>Unmodified output, not corrected reference figures.</p>' + examples.map(([title, content]) => `<section><h2>${title}</h2>${content.replace(/<\?xml[^>]*>/, '')}</section>`).join(''));
for(const result of results)console.log((result.pass ? 'PASS ' : 'FAIL ') + result.name);
console.log(`${results.filter(r => r.pass).length}/${results.length} acceptance probes passed`);
process.exitCode = results.every(r => r.pass) ? 0 : 1;
