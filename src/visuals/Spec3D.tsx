import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { cameraPosition, tickLabel, worldFrame, type Bounds, type Compiled3D, type Prim, type Vec } from '../../core/visual-3d';
import type { Vars } from '../../core/expr';

/** What the surrounding visual tells the 3D view each frame. `dirty` is set whenever values, time or step change. */
export type Clock = { values: Vars; t: number; step?: number; dirty: boolean };
export type Scene3DHandle = { capture(): Promise<Blob | null>; resetView(): void };

const BG = '#161615';
const ramp = ['#3d4f9a', '#8197e2', '#b49ddb', '#d87968', '#d9b36c'].map(c => new THREE.Color(c));
function heat(f: number, out: THREE.Color) { const x = Math.max(0, Math.min(0.9999, f)) * (ramp.length - 1), i = Math.floor(x); return out.copy(ramp[i]).lerp(ramp[i + 1], x - i); }

const unitSphere = new THREE.SphereGeometry(1, 36, 24), unitBox = new THREE.BoxGeometry(1, 1, 1), unitCyl = new THREE.CylinderGeometry(1, 1, 1, 36), unitCone = new THREE.ConeGeometry(1, 1, 36);
const boxEdges = new THREE.EdgesGeometry(unitBox), Y = new THREE.Vector3(0, 1, 0);
const shared = new Set<THREE.BufferGeometry>([unitSphere, unitBox, unitCyl, unitCone, boxEdges]);

type Slot = { sig: string; obj: THREE.Object3D; update(p: Prim): void };
/** Primitives with the same signature can be updated in place instead of rebuilt. */
const sigOf = (p: Prim) => p.k === 'mesh' ? `mesh${p.rows}x${p.cols}${p.wire}${p.colormap}` : p.k === 'line' ? `line${p.pts.length}${p.dash}` : p.k === 'poly' ? `poly${p.pts.length}` : p.k === 'cyl' ? (p.cone ? 'cone' : 'cyl') : p.k;

/** Orbitable Three.js view of a model-authored 3D scene. Drag to orbit, scroll or pinch to zoom, right-drag to pan. */
export default function Spec3D({ scene, clock, handle, onError, label }: { scene: Compiled3D; clock: MutableRefObject<Clock>; handle: MutableRefObject<Scene3DHandle | null>; onError: (message: string) => void; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { onError('3D is unavailable on this device, so a still drawing of the scene is shown.'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer(); labels.domElement.className = 'scene-labels'; element.appendChild(labels.domElement);

    const three = new THREE.Scene(); three.background = new THREE.Color(BG);
    three.add(new THREE.HemisphereLight(0xf4f2ec, 0x2a2a27, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(9, 16, 11); three.add(key);
    const rim = new THREE.DirectionalLight(0x9fb0ff, 0.55); rim.position.set(-12, 6, -10); three.add(rim);
    // Data is laid out z-up (as in maths); the group turns it into Three's y-up world.
    const world = new THREE.Group(); world.rotation.x = -Math.PI / 2; three.add(world);
    const axes = new THREE.Group(); world.add(axes);
    const content = new THREE.Group(); world.add(content);
    const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.09; controls.autoRotate = scene.autoRotate; controls.autoRotateSpeed = 1.2;
    const resolution = new THREE.Vector2(1, 1), lineMaterials = new Set<LineMaterial>();

    let frame = worldFrame(scene.bounds(clock.current.values, clock.current.t), scene.equal), boundsKey = '';
    const W3 = (p: Vec) => new THREE.Vector3(...frame.toWorld(p));
    const radius = (r: number) => r * (scene.equal ? frame.scale[0] : (frame.scale[0] + frame.scale[1] + frame.scale[2]) / 3);
    const resetView = () => {
      const ext = Math.hypot(...frame.half) || 5, d = ext * 2.9 / scene.camera.zoom, p = cameraPosition(scene.camera, d);
      camera.position.set(p[0], p[2], -p[1]); controls.target.set(0, 0, 0); camera.near = d / 200; camera.far = d * 20; camera.updateProjectionMatrix(); controls.update();
    };

    const material = (p: Prim, extra: THREE.MeshStandardMaterialParameters = {}) => { const o = p.opacity * p.dim; return new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5, metalness: 0.05, transparent: o < 1, opacity: o, depthWrite: o >= 0.95, ...extra }); };
    const fatLine = (pts: THREE.Vector3[], color: string, width: number, opacity: number, dash: boolean) => {
      const g = new LineGeometry(); g.setPositions(pts.flatMap(v => [v.x, v.y, v.z]));
      const m = new LineMaterial({ color, linewidth: width, transparent: opacity < 1, opacity, dashed: dash, dashSize: 0.25, gapSize: 0.18, worldUnits: false }); m.resolution.copy(resolution); lineMaterials.add(m);
      const l = new Line2(g, m); if (dash) l.computeLineDistances();
      if (opacity > 0.5) { const gm = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0.3 * opacity, depthTest: false, depthWrite: false, worldUnits: false }); gm.resolution.copy(resolution); lineMaterials.add(gm); const x = new Line2(g, gm); x.renderOrder = 10; l.add(x); }
      return l;
    };
    // X-ray: a faint copy drawn over everything, so points, slopes and paths hidden behind a surface still read.
    const ghost = (parent: THREE.Mesh, color: string, dim: number) => { const g = new THREE.Mesh(parent.geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32 * dim, depthTest: false, depthWrite: false })); g.renderOrder = 10; parent.add(g); return g; };
    const tag = (text: string, color: string, size = 12, cls = 'scene-label') => { const el = document.createElement('span'); el.className = cls; el.textContent = text; el.style.color = color; el.style.fontSize = size + 'px'; return new CSS2DObject(el); };
    const orient = (obj: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number) => { const d = b.clone().sub(a), len = d.length() || 1e-6; obj.position.copy(a).addScaledVector(d, 0.5); obj.quaternion.setFromUnitVectors(Y, d.divideScalar(len)); obj.scale.set(r, len, r); };

    function build(p: Prim): Slot {
      switch (p.k) {
        case 'mesh': {
          const n = p.rows * p.cols, g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), idx: number[] = [];
          for (let i = 0; i < p.rows - 1; i++) for (let j = 0; j < p.cols - 1; j++) { const a = i * p.cols + j, b = a + 1, c = a + p.cols, d = c + 1; idx.push(a, b, d, a, d, c); }
          g.setIndex(idx); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          if (p.colormap) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
          const group = new THREE.Group();
          const surface = new THREE.Mesh(g, material(p, { side: THREE.DoubleSide, vertexColors: p.colormap, color: p.colormap ? '#ffffff' : p.color, depthWrite: true }));
          // A light grid drawn on the surface shows its shape the way a hand-drawn mesh would.
          const every = Math.max(1, Math.round(p.rows / 14)), lines: number[] = [];
          for (let i = 0; i < p.rows; i += every) for (let j = 0; j < p.cols - 1; j++) lines.push(i * p.cols + j, i * p.cols + j + 1);
          for (let j = 0; j < p.cols; j += every) for (let i = 0; i < p.rows - 1; i++) lines.push(i * p.cols + j, (i + 1) * p.cols + j);
          const lg = new THREE.BufferGeometry(); lg.setAttribute('position', g.getAttribute('position')); lg.setIndex(lines);
          const wire = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: p.wire ? p.color : '#0f0f0e', transparent: true, opacity: (p.wire ? 0.95 : 0.28) * p.dim }));
          // See-through surfaces first lay down depth alone, so only their nearest layer blends and no triangles pop.
          const prepass = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: THREE.DoubleSide, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
          prepass.renderOrder = -1; surface.renderOrder = 0;
          if (!p.wire) group.add(prepass, surface);
          group.add(wire);
          const color = new THREE.Color();
          return { sig: `mesh${p.rows}x${p.cols}${p.wire}${p.colormap}`, obj: group, update(q) {
            const m = q as Extract<Prim, { k: 'mesh' }>, attr = g.getAttribute('position') as THREE.BufferAttribute, arr = attr.array as Float32Array;
            let lo = Infinity, hi = -Infinity;
            for (let i = 0; i < n; i++) { const w = frame.toWorld([m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]]); arr[i * 3] = w[0]; arr[i * 3 + 1] = w[1]; arr[i * 3 + 2] = w[2]; lo = Math.min(lo, w[2]); hi = Math.max(hi, w[2]); }
            attr.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
            if (m.colormap) { const ca = g.getAttribute('color') as THREE.BufferAttribute, span = hi - lo || 1; for (let i = 0; i < n; i++) { heat((arr[i * 3 + 2] - lo) / span, color); ca.setXYZ(i, color.r, color.g, color.b); } ca.needsUpdate = true; }
            const o = m.opacity * m.dim; (surface.material as THREE.MeshStandardMaterial).opacity = o; (surface.material as THREE.MeshStandardMaterial).transparent = o < 1; (wire.material as THREE.LineBasicMaterial).opacity = (m.wire ? 0.95 : 0.28) * m.dim;
          } };
        }
        case 'line': {
          const group = new THREE.Group();
          return { sig: `line${p.pts.length}${p.dash}`, obj: group, update(q) {
            const l = q as Extract<Prim, { k: 'line' }>;
            for (const c of [...group.children]) { group.remove(c); c.traverse(o => { const m = (o as Line2).material as LineMaterial; lineMaterials.delete(m); m.dispose(); }); (c as Line2).geometry.dispose(); }
            if (l.pts.length > 1) group.add(fatLine(l.pts.map(W3), l.color, l.width, l.opacity * l.dim, l.dash));
          } };
        }
        case 'point': {
          const m = new THREE.Mesh(unitSphere, material(p, { emissive: p.color, emissiveIntensity: 0.35 })); ghost(m, p.color, p.dim);
          return { sig: 'point', obj: m, update(q) { const pt = q as Extract<Prim, { k: 'point' }>; m.position.copy(W3(pt.p)); m.scale.setScalar(0.045 * pt.size); (m.material as THREE.MeshStandardMaterial).opacity = pt.dim; (m.material as THREE.MeshStandardMaterial).transparent = pt.dim < 1; } };
        }
        case 'arrow': {
          const g = new THREE.Group(), mat = material(p), shaft = new THREE.Mesh(unitCyl, mat), head = new THREE.Mesh(unitCone, mat); g.add(shaft, head); if (p.dim === 1) { ghost(shaft, p.color, p.opacity); ghost(head, p.color, p.opacity); }
          return { sig: 'arrow', obj: g, update(q) {
            const ar = q as Extract<Prim, { k: 'arrow' }>, a = W3(ar.from), b = W3(ar.to), len = a.distanceTo(b);
            g.visible = len > 1e-4; if (!g.visible) return;
            const hl = Math.min(0.6, len * 0.3), dir = b.clone().sub(a).normalize(), neck = b.clone().addScaledVector(dir, -hl);
            orient(shaft, a, neck, Math.min(0.075, len * 0.06)); orient(head, neck, b, Math.min(0.2, hl * 0.45));
            mat.opacity = ar.opacity * ar.dim; mat.transparent = mat.opacity < 1;
          } };
        }
        case 'sphere': {
          const m = new THREE.Mesh(unitSphere, material(p, { roughness: 0.38 }));
          return { sig: 'sphere', obj: m, update(q) { const s = q as Extract<Prim, { k: 'sphere' }>; m.position.copy(W3(s.c)); m.scale.set(s.r * frame.scale[0], s.r * frame.scale[1], s.r * frame.scale[2]); const mt = m.material as THREE.MeshStandardMaterial; mt.color.set(s.color); mt.opacity = s.opacity * s.dim; mt.transparent = mt.opacity < 1; } };
        }
        case 'box': {
          const g = new THREE.Group(), mat = material(p), m = new THREE.Mesh(unitBox, mat), e = new THREE.LineSegments(boxEdges, new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.9 * p.dim })); g.add(m, e);
          return { sig: 'box', obj: g, update(q) { const b = q as Extract<Prim, { k: 'box' }>; g.position.copy(W3(b.c)); g.scale.set(b.s[0] * frame.scale[0] || 1e-4, b.s[1] * frame.scale[1] || 1e-4, b.s[2] * frame.scale[2] || 1e-4); mat.opacity = b.opacity * b.dim; } };
        }
        case 'cyl': {
          const m = new THREE.Mesh(p.cone ? unitCone : unitCyl, material(p, { roughness: 0.42 }));
          return { sig: p.cone ? 'cone' : 'cyl', obj: m, update(q) { const c = q as Extract<Prim, { k: 'cyl' }>; orient(m, W3(c.a), W3(c.b), radius(c.r)); const mt = m.material as THREE.MeshStandardMaterial; mt.color.set(c.color); mt.opacity = c.opacity * c.dim; mt.transparent = mt.opacity < 1; } };
        }
        case 'poly': {
          const g = new THREE.Group();
          return { sig: `poly${p.pts.length}`, obj: g, update(q) {
            const pl = q as Extract<Prim, { k: 'poly' }>;
            for (const c of [...g.children]) { g.remove(c); const o = c as THREE.Mesh; if (!shared.has(o.geometry)) o.geometry?.dispose(); (o.material as THREE.Material)?.dispose(); }
            const pts = pl.pts.map(W3), geo = new THREE.BufferGeometry().setFromPoints(pts), idx: number[] = [];
            for (let i = 1; i < pts.length - 1; i++) idx.push(0, i, i + 1);
            geo.setIndex(idx); geo.computeVertexNormals();
            g.add(new THREE.Mesh(geo, material(pl, { side: THREE.DoubleSide })), new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: pl.color, transparent: true, opacity: pl.dim })));
          } };
        }
        case 'text': {
          const o = tag(p.text, p.color, p.size);
          return { sig: 'text', obj: o, update(q) { const t = q as Extract<Prim, { k: 'text' }>; o.position.copy(W3(t.p)); o.element.textContent = t.text; o.element.style.opacity = String(t.dim); } };
        }
      }
    }

    let slots: Slot[] = [];
    const clear = (group: THREE.Group) => {
      group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) { lineMaterials.delete(x as LineMaterial); x.dispose(); }
        if (o instanceof CSS2DObject) o.element.remove();
      });
      group.clear();
    };
    const drawAxes = (b: Bounds) => {
      clear(axes);
      if (!scene.axes) return;
      const [hx, hy, hz] = frame.half, faint = new THREE.LineBasicMaterial({ color: '#2c2c2a' }), strong = new THREE.LineBasicMaterial({ color: '#4a4a45' }), seg: number[] = [];
      for (let i = 0; i <= 8; i++) { const fx = -hx + 2 * hx * i / 8, fy = -hy + 2 * hy * i / 8; seg.push(fx, -hy, -hz, fx, hy, -hz, -hx, fy, -hz, hx, fy, -hz); }
      const grid = new THREE.BufferGeometry(); grid.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3)); axes.add(new THREE.LineSegments(grid, faint));
      const edges = new THREE.BufferGeometry(); edges.setAttribute('position', new THREE.Float32BufferAttribute([-hx, -hy, -hz, hx, -hy, -hz, -hx, -hy, -hz, -hx, hy, -hz, -hx, -hy, -hz, -hx, -hy, hz, -hx, hy, -hz, -hx, hy, hz, -hx, hy, hz, hx, hy, hz, hx, hy, -hz, hx, hy, hz], 3)); axes.add(new THREE.LineSegments(edges, strong));
      const add = (text: string, x: number, y: number, z: number, cls = 'scene-tick') => { const o = tag(text, '', 11, cls); o.position.set(x, y, z); axes.add(o); };
      for (const f of [0, 0.5, 1]) {
        add(tickLabel(b.x[0] + (b.x[1] - b.x[0]) * f), -hx + 2 * hx * f, -hy - 0.75, -hz);
        add(tickLabel(b.y[0] + (b.y[1] - b.y[0]) * f), hx + 0.75, -hy + 2 * hy * f, -hz);
        add(tickLabel(b.z[0] + (b.z[1] - b.z[0]) * f), -hx - 0.8, -hy, -hz + 2 * hz * f);
      }
      add(scene.labels.x || 'x', 0, -hy - 1.35, -hz, 'scene-axis'); add(scene.labels.y || 'y', hx + 1.35, 0, -hz, 'scene-axis'); add(scene.labels.z || 'z', -hx - 0.9, -hy - 0.9, 0, 'scene-axis');
    };

    const sync = () => {
      const c = clock.current, b = scene.bounds(c.values, c.t), bk = JSON.stringify(b);
      if (bk !== boundsKey) { const first = !boundsKey; boundsKey = bk; frame = worldFrame(b, scene.equal); drawAxes(b); if (first) resetView(); }
      const prims = scene.primitives(c.values, c.t, c.step);
      if (prims.length !== slots.length || prims.some((p, i) => slots[i].sig !== sigOf(p))) {
        clear(content); slots = prims.map(build); for (const s of slots) content.add(s.obj);
      }
      prims.forEach((p, i) => slots[i].update(p));
    };

    const resize = () => { const w = element.clientWidth, h = element.clientHeight || w * 0.55; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); resolution.set(w, h); lineMaterials.forEach(m => m.resolution.copy(resolution)); needs = true; };
    let raf = 0, needs = true, visible = true;
    controls.addEventListener('change', () => { needs = true; });
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; needs = true; }); io.observe(element);
    const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (quiet) controls.autoRotate = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      if (clock.current.dirty) { clock.current.dirty = false; try { sync(); } catch { /* a failing formula leaves the last good frame */ } needs = true; }
      if (controls.update()) needs = true;
      if (controls.autoRotate) needs = true;
      if (!needs) return;
      needs = false;
      renderer.render(three, camera); labels.render(three, camera);
    };
    clock.current.dirty = true;
    raf = requestAnimationFrame(tick);

    handle.current = {
      resetView: () => { resetView(); needs = true; },
      // The PNG is the WebGL frame with every label painted on, so exports read like the live view.
      capture: () => new Promise(resolve => {
        renderer.render(three, camera);
        const src = renderer.domElement, out = document.createElement('canvas'); out.width = src.width; out.height = src.height;
        const ctx = out.getContext('2d')!; ctx.drawImage(src, 0, 0);
        const scale = src.width / element.clientWidth, v = new THREE.Vector3();
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        three.traverse(o => {
          if (!(o instanceof CSS2DObject) || !o.element.textContent) return;
          v.setFromMatrixPosition(o.matrixWorld).project(camera);
          if (v.z > 1) return;
          const x = (v.x + 1) / 2 * src.width, y = (1 - v.y) / 2 * src.height, text = o.element.textContent, size = parseFloat(o.element.style.fontSize || '12') * scale;
          ctx.font = `${size}px 'Mowafy Sans Text',system-ui,sans-serif`;
          if (o.element.className === 'scene-label') { const w = ctx.measureText(text).width + 12 * scale; ctx.fillStyle = '#161615dd'; ctx.fillRect(x - w / 2, y - size * 0.85, w, size * 1.7); }
          ctx.fillStyle = o.element.style.color || (o.element.className === 'scene-label' ? '#f0efeb' : '#8f8e89'); ctx.fillText(text, x, y);
        });
        out.toBlob(resolve, 'image/png');
      }),
    };
    return () => {
      cancelAnimationFrame(raf); observer.disconnect(); io.disconnect(); controls.dispose();
      clear(content); clear(axes); renderer.dispose(); handle.current = null; element.replaceChildren();
    };
  }, [scene]);
  return <div className="visual-3d" ref={host} role="img" aria-label={`${label}. Three-dimensional view: drag to orbit, scroll to zoom, right-drag to pan.`} />;
}
