import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Values } from './scenes';

/** Orbitable 3D view of the same projectile model the diagram draws. */
export default function Projectile3D({ params, onError }: { params: Values; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const th = params.angle * Math.PI / 180, vx = params.speed * Math.cos(th), vy = params.speed * Math.sin(th), T = 2 * vy / params.g, range = vx * T, maxHeight = vy * vy / (2 * params.g);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#161615');
    const scale = Math.max(range, maxHeight * 2, 10), camera = new THREE.PerspectiveCamera(36, 1, 0.1, 2000);
    camera.position.set(range * 0.56, scale * 0.7, scale * 1.1);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); } catch { onError('3D rendering is unavailable on this device. The diagram view shows the same model.'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); element.appendChild(renderer.domElement);
    const labels = new CSS2DRenderer(); labels.domElement.className = 'scene-labels'; element.appendChild(labels.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(range * 0.48, maxHeight * 0.35, 0); controls.enableDamping = true;
    const grid = new THREE.GridHelper(Math.ceil(scale * 1.5), 12, '#4a4a45', '#262624'); grid.position.x = range * 0.45; scene.add(grid);
    const points = Array.from({ length: 121 }, (_, i) => { const t = T * i / 120; return new THREE.Vector3(vx * t, vy * t - 0.5 * params.g * t * t, 0); });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: '#f0efeb' })); scene.add(line);
    const dotGeometry = new THREE.SphereGeometry(scale * 0.009, 16, 12), dotMaterial = new THREE.MeshBasicMaterial({ color: '#f0efeb' });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.018, 24, 16), new THREE.MeshBasicMaterial({ color: '#d87968' })); scene.add(ball);
    const label = (text: string, x: number, y: number) => { const dot = new THREE.Mesh(dotGeometry, dotMaterial); dot.position.set(x, y, 0); scene.add(dot); const el = document.createElement('span'); el.className = 'scene-label'; el.textContent = text; const obj = new CSS2DObject(el); obj.position.set(x, y + scale * 0.04, 0); scene.add(obj); };
    label('Launch', 0, 0); label(`Apex · ${maxHeight.toFixed(2)} m`, range / 2, maxHeight); label(`${range.toFixed(2)} m`, range, 0);
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(Math.cos(th), Math.sin(th), 0), new THREE.Vector3(), scale * 0.2, 0x8197e2, scale * 0.04, scale * 0.02));
    const observer = new ResizeObserver(() => { const w = element.clientWidth, h = element.clientHeight; renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); });
    observer.observe(element);
    let raf = 0; const start = performance.now(), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = (now: number) => { raf = requestAnimationFrame(tick); const t = still ? T * 0.36 : ((now - start) / 1000) % (T + 1.2); const u = Math.min(t, T); ball.position.set(vx * u, vy * u - 0.5 * params.g * u * u, 0); controls.update(); renderer.render(scene, camera); labels.render(scene, camera); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); renderer.dispose(); scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); const mat = m.material; if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else (mat as THREE.Material | undefined)?.dispose(); }); element.replaceChildren(); };
  }, [params.angle, params.speed, params.g]);
  return <div className="visual-3d" ref={host} aria-label="Three-dimensional trajectory. Drag to orbit, scroll to zoom." />;
}
