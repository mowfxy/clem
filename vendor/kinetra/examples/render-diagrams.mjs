import fs from 'node:fs';
import { defaultElectrostaticRods, renderElectrostaticRods } from '../packages/core/src/diagram/electrostatics.ts';
import { renderOptics } from '../packages/core/src/diagram/optics.ts';
import { renderProjectile } from '../packages/core/src/diagram/projectile.ts';
import { renderFBD } from '../packages/core/src/diagram/freebody.ts';
import { renderPulley, atwoodDynamics } from '../packages/core/src/diagram/pulley.ts';
import { renderScalarField, renderVectorField } from '../packages/core/src/diagram/fields.ts';
import { renderSchematic } from '../packages/core/src/diagram/circuit_schematic.ts';
const out = new URL('../out/diagrams/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
const model = JSON.parse(fs.readFileSync(new URL('./charged-rods.json', import.meta.url), 'utf8'));
fs.writeFileSync(new URL('charged-rods.model.json', out), JSON.stringify(model, null, 2) + '\n');
const examples = [['charged-rods', renderElectrostaticRods(model)]];
examples.push(['charged-rods-repulsion', renderElectrostaticRods({ ...model, nearby: { ...model.nearby, charge: -1, material: 'rubber', label: 'Rubber' } })]);
const optics = { width: 800, height: 460, world: { xMin: -6, xMax: 6, yMin: -3.5, yMax: 3.5 }, objectBase: { x: -3, y: 0 }, objectHeight: 1 };
for (const [name, element] of [
  ['plane-mirror', { kind: 'plane-mirror', x: 0, yMin: -2, yMax: 2 }],
  ['concave-mirror', { kind: 'concave-mirror', x: 0, y: 0, focal: 1, radius: 2 }],
  ['convex-mirror', { kind: 'convex-mirror', x: 0, y: 0, focal: -1, radius: 2 }],
  ['converging-lens', { kind: 'thin-lens-converging', x: 0, y: 0, focal: 1 }],
  ['diverging-lens', { kind: 'thin-lens-diverging', x: 0, y: 0, focal: -1 }],
]) examples.push([name, renderOptics({ ...optics, element, title: name.replaceAll('-', ' ') })]);
examples.push(['lens-at-focus', renderOptics({ ...optics, objectBase: { x: -1, y: 0 }, element: { kind: 'thin-lens-converging', x: 0, y: 0, focal: 1 }, title: 'Object at focus' })]);
examples.push(['virtual-lens-image', renderOptics({ ...optics, objectBase: { x: -0.6, y: 0 }, element: { kind: 'thin-lens-converging', x: 0, y: 0, focal: 1 }, title: 'Virtual image' })]);
examples.push(['projectile', renderProjectile({ width: 800, height: 460, initialPosition: { x: 0, y: 20 }, initialSpeed: 15, launchAngleDeg: 30, gravity: 9.81 })]);
const mass = 5, g = 9.81, a = Math.PI / 6;
examples.push(['incline-freebody', renderFBD({ width: 800, height: 520, world: { xMin: -6, xMax: 6, yMin: -4, yMax: 4 }, bodyPosition: { x: 0, y: 0 }, bodySize: { w: 1.6, h: 0.9 }, bodyAngleDeg: 30, bodyLabel: '5 kg', frameAngleDeg: 30, showComponents: true, forces: [
  { point: { x: 0, y: 0 }, components: { x: 0, y: -mass*g }, magnitude: mass*g, unit: 'N', label: 'W' },
  { point: { x: 0, y: 0 }, components: { x: -mass*g*Math.cos(a)*Math.sin(a), y: mass*g*Math.cos(a)**2 }, magnitude: mass*g*Math.cos(a), unit: 'N', label: 'N', color: '#377f5c' },
  { point: { x: 0, y: 0 }, components: { x: mass*g*Math.sin(a)*Math.cos(a), y: mass*g*Math.sin(a)**2 }, magnitude: mass*g*Math.sin(a), unit: 'N', label: 'static friction', color: '#357aa6' },
] })]);
examples.push(['atwood', renderPulley({ width: 600, height: 520, world: { xMin: -3, xMax: 3, yMin: -2, yMax: 5 }, pulleys: [{ center: { x: 0, y: 3 }, radius: 0.8, fixed: true }], masses: [{ mass: 2, position: { x: -0.8, y: 0.2 }, size: { w: 0.65, h: 0.8 }, label: '2 kg' }, { mass: 3, position: { x: 0.8, y: -0.6 }, size: { w: 0.65, h: 0.8 }, label: '3 kg' }], tension: atwoodDynamics(2,3).tension })]);
examples.push(['movable-pulley', renderPulley({ width: 600, height: 520, world: { xMin: -3, xMax: 3, yMin: -2, yMax: 5 }, configuration: 'movable', pulleys: [{ center: { x: 0, y: 1.5 }, radius: 0.8, fixed: false }], masses: [{ mass: 2, position: { x: 0, y: -0.6 }, size: { w: 0.65, h: 0.8 }, label: '2 kg' }], tension: 9.81 })]);
examples.push(['contours', renderScalarField({ type: 'scalar', width: 600, height: 500, world: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }, cols: 40, rows: 40, field: p => p.x*p.x+p.y*p.y, contours: [1,4,6.25], title: 'Scalar potential and level curves' })]);
examples.push(['radial-field', renderVectorField({ type: 'vector', width: 600, height: 500, world: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 }, cols: 12, rows: 12, field: p => ({x:p.x,y:p.y}), title:'Outward radial field' })]);
examples.push(['rc-circuit', renderSchematic({ width: 800, height: 460, world: {xMin:-2,xMax:6,yMin:-3,yMax:2}, title:'RC low-pass circuit', components:[
  {id:'V',kind:'voltage-source',position:{x:0,y:0},rotationDeg:90,label:'Vᵢₙ'},
  {id:'R',kind:'resistor',position:{x:2,y:1},label:'R'},
  {id:'C',kind:'capacitor',position:{x:4,y:0},rotationDeg:90,label:'C'},
  {id:'G',kind:'ground',position:{x:2,y:-1.5}},
],wires:[
  {from:{componentId:'V',pin:1},to:{componentId:'R',pin:0},via:[{x:0,y:1}]},
  {from:{componentId:'R',pin:1},to:{componentId:'C',pin:1},via:[{x:4,y:1}]},
  {from:{componentId:'C',pin:0},to:{componentId:'G',pin:0},via:[{x:4,y:-1.5}]},
  {from:{componentId:'V',pin:0},to:{componentId:'G',pin:0},via:[{x:0,y:-1.5}]},
] })]);
for (const [name, svg] of examples) fs.writeFileSync(new URL(name + '.svg', out), svg);
fs.writeFileSync(new URL('index.html', out), '<!doctype html><meta charset="utf-8"><title>Kinetra textbook diagrams</title><style>body{font:16px system-ui;background:#f3f4f3;margin:30px}section{background:white;padding:24px;margin:24px auto;max-width:940px}img{max-width:100%;height:auto}h1{max-width:940px;margin:auto}</style><h1>Kinetra · verified diagram examples</h1>' + examples.map(([name]) => '<section><h2>'+name.replaceAll('-', ' ')+'</h2><img src="'+name+'.svg" alt="'+name+'"></section>').join(''));
console.log('Wrote '+examples.length+' SVG examples to '+out.pathname);
