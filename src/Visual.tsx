import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icons';
import { downloadMade } from './store';
import { CanvasPen, C, H, W } from './visuals/pen';
import { defaults, projectileLatex, sceneById, scenes, sceneSvg, type Handle, type Values } from './visuals/scenes';
import './visuals/visuals.css';

const Projectile3D = lazy(() => import('./visuals/Projectile3D'));
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.quiet === 'true';

/** An interactive, deterministic visual. `scene` accepts a scene id; legacy chats stored `true` for projectile motion. */
export default function Visual({ scene: sceneId = 'projectile', params: initial, compact = false, onParams }: { scene?: string | boolean; params?: Values; compact?: boolean; onParams?: (p: Values) => void }) {
  const scene = sceneById(sceneId) || scenes[0];
  const [params, setParams] = useState<Values>(() => ({ ...defaults(scene), ...initial }));
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [rate, setRate] = useState(1);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [readouts, setReadouts] = useState<[string, string][]>(() => scene.readouts(params, scene.still(params)));
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [hover, setHover] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const time = useRef(reducedMotion() ? scene.still(params) : 0);
  const dirty = useRef(true), paramsRef = useRef(params), dragging = useRef<string | null>(null);
  paramsRef.current = params;
  const period = scene.period(params), looped = Number.isFinite(period);
  const local = () => { const loop = scene.period(paramsRef.current); return Number.isFinite(loop) ? time.current % loop : time.current; };

  useEffect(() => { dirty.current = true; onParams?.(params); }, [params]);
  useEffect(() => {
    const el = canvas.current;
    if (!el || view !== '2d') return;
    const ctx = el.getContext('2d');
    if (!ctx) { setError('This device cannot draw the visual. Save the SVG instead.'); return; }
    const pen = new CanvasPen(ctx);
    let raf = 0, last = 0, visible = true, lastReadout = 0;
    const resize = () => { const dpr = Math.min(devicePixelRatio || 1, 2), w = el.clientWidth; el.width = Math.round(w * dpr); el.height = Math.round(w * H / W * dpr); dirty.current = true; };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) { last = 0; return; }
      if (playing && !dragging.current) { if (last) time.current += Math.min(now - last, 80) / 1000 * rate; dirty.current = true; }
      last = now;
      if (!dirty.current) return;
      dirty.current = false;
      const p = paramsRef.current, t = local(), s = el.width / W;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, el.width, el.height);
      ctx.setTransform(s, 0, 0, s, 0, 0);
      scene.draw(pen, p, t);
      if (now - lastReadout > 110) { lastReadout = now; setReadouts(scene.readouts(p, t)); if (looped) setProgress(t / scene.period(p)); }
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; dirty.current = true; }); io.observe(el);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); io.disconnect(); };
  }, [scene, playing, rate, view, looped]);

  const toLogical = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H] as const; };
  const hit = (x: number, y: number): Handle | undefined => scene.handles?.(paramsRef.current).find(h => Math.hypot(h.x - x, h.y - y) < 30);
  const handles = scene.handles?.(params) || [];
  const visible = scene.params.filter(p => !p.hidden);
  const svg = () => sceneSvg(scene, params, local());
  const name = scene.id;

  return <section className={`visual-engine v2 ${compact ? 'compact' : ''}`} aria-label={`Interactive visual: ${scene.title}`}>
    <header className="visual-heading">
      <div className="visual-title"><span className="visual-subject">{scene.subject}</span><strong>{scene.title}</strong></div>
      <div className="visual-transport">
        {scene.id === 'projectile' && !compact && <div className="segmented" role="group" aria-label="View"><button aria-pressed={view === '2d'} onClick={() => setView('2d')}>Diagram</button><button aria-pressed={view === '3d'} onClick={() => setView('3d')}>3D</button></div>}
        {view === '2d' && <>
          <button className="visual-icon" aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>{playing ? <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="3.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/><rect x="9.5" y="2.5" width="3" height="11" rx="1" fill="currentColor"/></svg> : <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M4.5 2.8v10.4a.8.8 0 0 0 1.2.7l8.4-5.2a.8.8 0 0 0 0-1.4L5.7 2.1a.8.8 0 0 0-1.2.7Z" fill="currentColor"/></svg>}</button>
          <button className="visual-icon" aria-label="Restart" title="Restart" onClick={() => { time.current = 0; dirty.current = true; setPlaying(true); }}><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.8h2.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
          <button className="visual-rate" aria-label={`Playback speed ${rate}×`} title="Playback speed" onClick={() => setRate(rate === 1 ? 2 : rate === 2 ? 0.5 : 1)}>{rate}×</button>
        </>}
      </div>
    </header>
    {error && <p className="inline-error" role="status">{error}</p>}
    <div className="visual-stage">
      {view === '3d' ? <Suspense fallback={<div className="visual-canvas-fallback">Opening 3D…</div>}><Projectile3D params={params} onError={setError} /></Suspense> :
        <canvas ref={canvas} className="visual-canvas" role="img" aria-label={scene.describe(params)}
          style={{ cursor: dragging.current ? 'grabbing' : hover ? 'grab' : undefined }}
          onPointerDown={e => { const [x, y] = toLogical(e), h = hit(x, y); if (!h) return; dragging.current = h.id; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e => { const [x, y] = toLogical(e); if (dragging.current && scene.drag) { const next = scene.drag(dragging.current, x, y, paramsRef.current); if (Object.keys(next).length) setParams(p => ({ ...p, ...next })); } else if (handles.length) setHover(!!hit(x, y)); }}
          onPointerUp={() => { dragging.current = null; dirty.current = true; }} onPointerCancel={() => { dragging.current = null; }} />}
      {view === '2d' && handles.length > 0 && <span className="visual-hint">Drag {scene.id === 'lens' ? 'the object' : 'a charge'}</span>}
    </div>
    {view === '2d' && looped && <input className="visual-scrub" type="range" min="0" max="1000" value={Math.round(progress * 1000)} aria-label="Timeline" onChange={e => { setPlaying(false); time.current = +e.target.value / 1000 * period; dirty.current = true; setProgress(+e.target.value / 1000); }} />}
    <div className="visual-body">
      <div className="visual-controls">{visible.map(p => <label key={p.key}><span className="visual-control-label">{p.label}<output>{params[p.key]}{p.unit && ` ${p.unit}`}</output></span><input type="range" min={p.min} max={p.max} step={p.step} value={params[p.key]} onChange={e => setParams(v => ({ ...v, [p.key]: +e.target.value }))} /></label>)}</div>
      <dl className="visual-readouts">{readouts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </div>
    <footer className="visual-caption"><span className="visual-equation">{scene.equation}</span><span>{scene.assumption}</span></footer>
    {!compact && <div className="visual-exports">
      <button onClick={() => { const off = document.createElement('canvas'); off.width = W * 2; off.height = H * 2; const ctx = off.getContext('2d')!; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, off.width, off.height); ctx.scale(2, 2); scene.draw(new CanvasPen(ctx), params, local()); off.toBlob(b => b && void downloadMade(b, `${name}.png`), 'image/png'); }}><Icon name="download" size={16} /> Image</button>
      <button onClick={() => void downloadMade(new Blob([svg()], { type: 'image/svg+xml' }), `${name}.svg`)}>SVG</button>
      <button onClick={() => void import('./visual-pdf').then(m => m.exportDiagramPdf(svg(), `${name}.pdf`)).catch(() => setError('Could not export the PDF. Please try again.'))}>PDF</button>
      {scene.id === 'projectile' && <button onClick={() => void downloadMade(new Blob([projectileLatex(params)], { type: 'text/plain' }), 'projectile.tex')}>LaTeX</button>}
      <button className="visual-reset" onClick={() => setParams(defaults(scene))}>Reset values</button>
    </div>}
  </section>;
}

/** Every available scene as a card. `picker` is the compact in-chat variant. */
export function VisualGallery({ onPick, picker = false }: { onPick: (scene: string) => void; picker?: boolean }) {
  return <div className={picker ? 'visual-picker' : 'visual-gallery'}>{scenes.map(s => <button key={s.id} onClick={() => onPick(s.id)}>
    <VisualThumb scene={s.id} />
    {!picker && <span className="visual-subject">{s.subject}</span>}
    <strong>{s.title}</strong>
    {!picker && <small>{s.summary}</small>}
  </button>)}</div>;
}

/** Static miniature of any scene, used by the gallery and saved-visual cards. */
export function VisualThumb({ scene, params }: { scene: string | boolean | undefined; params?: Values }) {
  const def = sceneById(scene) || scenes[0];
  const html = useMemo(() => sceneSvg(def, { ...defaults(def), ...params }), [def, params]);
  return <div className="visual-thumb" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}
