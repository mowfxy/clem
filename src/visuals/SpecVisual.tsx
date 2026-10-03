import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';
import { mathMacros } from '../../core/math-markdown';
import type { Clock, Scene3DHandle } from './Spec3D';
import { Icon } from '../Icons';
import { downloadMade } from '../store';
import { CanvasPen, SvgPen, C, H, W } from './pen';
import { defaultValues, type CompiledVisual } from '../../core/visual-spec';
import { paintSvg, recordCanvas, videoFormat } from './record';
import './visuals.css';

const Spec3D = lazy(() => import('./Spec3D'));
/** A visual's equation line: LaTeX when it looks like LaTeX, otherwise plain text. */
function Equation({ source }: { source: string }) {
  const tex = source.trim().replace(/^\$+|\$+$/g, '');
  const html = useMemo(() => (/[\\^_{}]/.test(tex) ? katex.renderToString(tex, { throwOnError: false, strict: 'ignore', macros: { ...mathMacros } }) : null), [tex]);
  return html ? <span className="visual-equation" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="visual-equation">{tex}</span>;
}
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.quiet === 'true';
const fileName = (title: string) => title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'visual';

/** Renders a model-authored visual with the same engine, controls and exports as the built-in models. */
export default function SpecVisual({ visual, compact = false, initial, headerAction }: { visual: CompiledVisual; compact?: boolean; initial?: Record<string, number>; headerAction?: ReactNode }) {
  const { spec, params, moving, steps } = visual;
  const [values, setValues] = useState(() => ({ ...defaultValues(visual), ...initial }));
  const [playing, setPlaying] = useState(() => moving && !reducedMotion());
  const [rate, setRate] = useState(1);
  const [step, setStep] = useState<number | undefined>(undefined);
  const [readouts, setReadouts] = useState<[string, string][]>(() => visual.readouts(values, 0));
  const [progress, setProgress] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null), stage = useRef<HTMLDivElement>(null);
  const [flat, setFlat] = useState(false);
  const use3d = !!visual.scene3d && !flat, figure = visual.figure;
  const figHost = useRef<HTMLDivElement>(null), film = useRef<HTMLCanvasElement | null>(null), filming = useRef(false);
  const [recording, setRecording] = useState(false), [note, setNote] = useState('');
  // Gradient ids are per card, so two figures on one page never share them.
  const prefix = useMemo(() => 'f' + Math.random().toString(36).slice(2, 8), [visual]);
  const focusOf = (s?: number) => (s !== undefined && spec.steps?.[s]?.focus ? new Set(spec.steps[s].focus) : null);
  const figureSvg = (v: Record<string, number>, t: number, s?: number) => figure!.render(v, t, { focus: focusOf(s), idPrefix: prefix });
  const clock = useRef<Clock>({ values, t: 0, step, dirty: true }), view3d = useRef<Scene3DHandle | null>(null);
  const time = useRef(moving ? 0 : reducedMotion() ? 1 : 0), dirty = useRef(true), valuesRef = useRef(values), stepRef = useRef(step);
  valuesRef.current = values; stepRef.current = step;
  const looped = Number.isFinite(visual.period);
  const local = () => (looped ? time.current % visual.period : time.current);

  useEffect(() => { dirty.current = true; }, [values, step]);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d') ?? null, watched = el || stage.current;
    if (!watched || (!use3d && !figure && !ctx)) return;
    const pen = ctx ? new CanvasPen(ctx) : null;
    let raf = 0, last = 0, visible = true, lastReadout = 0;
    const resize = () => { if (!el) return; const dpr = Math.min(devicePixelRatio || 1, 2), w = el.clientWidth; el.width = Math.round(w * dpr); el.height = Math.round(w * H / W * dpr); dirty.current = true; };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      // While filming, frames keep coming even if the card is scrolled out of view.
      if ((!visible || document.hidden) && !filming.current) { last = 0; return; }
      // Still pictures get a short entrance (charts grow in) and then stop redrawing.
      const intro = !moving && !figure && time.current < 1;
      if ((playing && moving) || intro) { if (last) time.current += Math.min(now - last, 80) / 1000 * (intro ? 1 : rate); dirty.current = true; }
      last = now;
      if (!dirty.current) return;
      dirty.current = false;
      const t = local();
      clock.current = { values: valuesRef.current, t, step: stepRef.current, dirty: true };
      if (figure && figHost.current) {
        try { const out = figureSvg(valuesRef.current, t, stepRef.current); figHost.current.innerHTML = out; if (film.current) void paintSvg(film.current, out); } catch { /* a failing formula keeps the last good frame */ }
      }
      if (el && ctx && pen) {
        const s = el.width / W;
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = C.bg; ctx.fillRect(0, 0, el.width, el.height);
        ctx.setTransform(s, 0, 0, s, 0, 0);
        try { visual.draw(pen, valuesRef.current, t, stepRef.current); } catch { /* A formula failing mid-draw leaves the rest of the picture. */ }
      }
      if (now - lastReadout > 110) { lastReadout = now; if (visual.spec.readouts?.length) setReadouts(visual.readouts(valuesRef.current, t)); if (looped) setProgress(t / visual.period); }
    };
    const observer = new ResizeObserver(resize); observer.observe(watched); resize();
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; dirty.current = true; }); io.observe(watched);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); io.disconnect(); };
  }, [visual, playing, rate, moving, looped, use3d]);
  useEffect(() => { if (!moving || !playing) setReadouts(visual.readouts(values, local())); }, [values]);

  const svg = () => { if (figure) return figureSvg(values, local(), step); const pen = new SvgPen(); visual.draw(pen, values, local(), step); return pen.toString(spec.title); };
  const png = () => {
    if (figure) { const out = svg(), m = /viewBox="0 0 (\d+) (\d+)"/.exec(out), c = document.createElement('canvas'); c.width = (m ? +m[1] : 760) * 2; c.height = (m ? +m[2] : 460) * 2; void paintSvg(c, out).then(() => c.toBlob(b => b && void downloadMade(b, `${fileName(spec.title)}.png`), 'image/png')); return; }
    if (use3d && view3d.current) { void view3d.current.capture().then(b => b && void downloadMade(b, `${fileName(spec.title)}.png`)); return; } const off = document.createElement('canvas'); off.width = W * 2; off.height = H * 2; const ctx = off.getContext('2d')!; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, off.width, off.height); ctx.scale(2, 2); visual.draw(new CanvasPen(ctx), values, local(), step); off.toBlob(b => b && void downloadMade(b, `${fileName(spec.title)}.png`), 'image/png'); };
  // Films the visual as it plays: animations from the start for one loop, still 3D models as a turntable.
  const canFilm = (moving || use3d) && !!videoFormat();
  const video = async () => {
    if (recording) return;
    setRecording(true); setNote(''); filming.current = true;
    try {
      const seconds = Math.min(20, Math.max(3, looped ? visual.period : use3d && !moving ? 9 : 6));
      time.current = 0; dirty.current = true; if (moving) setPlaying(true);
      let result: { blob: Blob; ext: string } | undefined;
      if (use3d && view3d.current) result = await view3d.current.record(seconds, !moving);
      else if (figure) { const c = document.createElement('canvas'); c.width = 1280; c.height = Math.round(1280 * figure.aspect / 2) * 2; film.current = c; dirty.current = true; try { result = await recordCanvas(c, seconds); } finally { film.current = null; } }
      else if (canvas.current) result = await recordCanvas(canvas.current, seconds);
      if (result) await downloadMade(result.blob, `${fileName(spec.title)}.${result.ext}`);
    } catch (e) { setNote((e as Error).message); } finally { filming.current = false; setRecording(false); }
  };
  const current = step !== undefined ? steps[step] : undefined;
  const hasSide = params.length > 0 || readouts.length > 0;
  const kindLabel = useMemo(() => spec.subject || (spec.kind === 'chart' ? 'Chart' : spec.kind === 'diagram' ? 'Diagram' : spec.kind === '3d' ? '3D model' : spec.kind === 'figure' ? 'Figure' : 'Model'), [spec]);

  return <section className={`visual-engine v2 spec-visual ${compact ? 'compact' : ''} ${hasSide ? '' : 'no-side'}`} aria-label={`Interactive visual: ${spec.title}`}>
    <header className="visual-heading">
      <div className="visual-title"><span className="visual-subject">{kindLabel}</span><strong>{spec.title}</strong></div>
      <div className="visual-transport">
        {use3d && <button className="visual-icon" aria-label="Reset view" aria-description="Reset view" onClick={() => view3d.current?.resetView()}><Icon name="cube" size={16} /></button>}
        {moving && <>
          <button className="visual-icon" aria-label={playing ? 'Pause' : 'Play'} aria-description={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>{playing ? <Icon name="pause" size={16} /> : <Icon name="playhead" size={16} />}</button>
          <button className="visual-icon" aria-label="Restart" aria-description="Restart" onClick={() => { time.current = 0; dirty.current = true; setPlaying(true); }}><Icon name="restart" size={16} /></button>
          <button className="visual-rate" aria-label={`Playback speed ${rate}×`} aria-description="Playback speed" onClick={() => setRate(rate === 1 ? 2 : rate === 2 ? 0.5 : 1)}>{rate}×</button>
        </>}
        {headerAction}
      </div>
    </header>
    <div className="visual-stage" ref={stage}>
      {use3d && visual.scene3d ? <Suspense fallback={<div className="visual-canvas-fallback">Building the 3D scene…</div>}><Spec3D scene={visual.scene3d} clock={clock} handle={view3d} label={visual.describe()} onError={() => setFlat(true)} /><span className="visual-hint-3d">Drag to orbit · scroll to zoom</span></Suspense>
        : figure ? <div ref={figHost} className="visual-figure" role="img" aria-label={visual.describe()} />
        : <canvas ref={canvas} className="visual-canvas" role="img" aria-label={visual.describe()} />}
    </div>
    {moving && looped && <input className="visual-scrub" type="range" min="0" max="1000" value={Math.round(progress * 1000)} aria-label="Timeline" onChange={e => { setPlaying(false); time.current = +e.target.value / 1000 * visual.period; dirty.current = true; setProgress(+e.target.value / 1000); }} />}
    {steps.length > 0 && <div className="spec-steps">
      <div className="spec-step-nav" role="group" aria-label="Walk through">
        <button className="visual-icon" aria-label="Previous step" disabled={step === undefined} onClick={() => setStep(s => (s === undefined || s === 0 ? undefined : s - 1))}><Icon name="arrow" size={15} /></button>
        <div className="spec-step-dots">{steps.map((s, i) => <button key={i} aria-label={s.title} aria-current={step === i} className={step === i ? 'on' : step !== undefined && i < step ? 'done' : ''} onClick={() => setStep(i)} />)}</div>
        <button className="visual-icon" aria-label="Next step" disabled={step === steps.length - 1} onClick={() => setStep(s => (s === undefined ? 0 : Math.min(steps.length - 1, s + 1)))}><Icon name="arrow" size={15} /></button>
      </div>
      <div className="spec-step-text" aria-live="polite">{current ? <><strong>{current.title}</strong>{current.text && <p>{current.text}</p>}</> : <p className="spec-step-hint">Step through it — {steps.length} stages.</p>}</div>
    </div>}
    {hasSide && <div className="visual-body">
      {params.length > 0 && <div className="visual-controls">{params.map(p => <label key={p.key}><span className="visual-control-label">{p.label}<output>{Number(values[p.key].toFixed(6))}{p.unit && ` ${p.unit}`}</output></span><input type="range" min={p.min} max={p.max} step={p.step} value={values[p.key]} onChange={e => setValues(v => ({ ...v, [p.key]: +e.target.value }))} /></label>)}</div>}
      {readouts.length > 0 && <dl className="visual-readouts">{readouts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    </div>}
    {(spec.equation || spec.caption) && <footer className="visual-caption">{spec.equation && <Equation source={spec.equation} />}{spec.caption && <span>{spec.caption}</span>}</footer>}
    {!compact && <div className="visual-exports">
      <button onClick={png}><Icon name="download" size={16} /> Image</button>
      <button onClick={() => void downloadMade(new Blob([svg()], { type: 'image/svg+xml' }), `${fileName(spec.title)}.svg`)}>SVG</button>
      {canFilm && <button onClick={() => void video()} disabled={recording} aria-busy={recording}><Icon name="playhead" size={16} /> {recording ? 'Recording…' : 'Video'}</button>}
      <button onClick={() => void import('../visual-pdf').then(m => m.exportDiagramPdf(svg(), `${fileName(spec.title)}.pdf`))}>PDF</button>
      {note && <span className="visual-note" role="status">{note}</span>}
      {params.length > 0 && <button className="visual-reset" onClick={() => setValues(defaultValues(visual))}>Reset values</button>}
    </div>}
  </section>;
}

/** Static SVG of a spec, for thumbnails. */
export function specSvg(visual: CompiledVisual, values = defaultValues(visual)) { if (visual.figure) return visual.figure.render(values, 0, { idPrefix: 't' + Math.random().toString(36).slice(2, 7) }); const pen = new SvgPen(); visual.draw(pen, values, 1, undefined); return pen.toString(visual.spec.title); }
