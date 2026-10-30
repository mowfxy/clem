import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icons';
import { desktop } from '../desktop/bridge';
import { downloadMade } from '../store';
import { standardFonts } from '../../core/print-fonts';
import { parseModelJson } from '../../core/model-json';
import { paintSvg } from '../visuals/record';
import '../visuals/visuals.css';

/**
 * A ```kinetra block in an answer: a textbook figure drawn by Kinetra (circuit schematics, logic circuits, ray diagrams,
 * free-body diagrams, apparatus, graphs) from {"title","caption","module","fn","args"}, the same figure spec a PDF
 * section takes. The desktop app draws it in the Kinetra worker (desktop/main.ts "kinetraFigure"); the chat shows it on
 * paper like the ```visual textbook figures, with the same downloads.
 */
export type KinetraBlock = { title: string; caption?: string; module: string; fn: string; args: unknown[] };

export function readKinetraBlock(body: string): KinetraBlock | null {
  let value: any;
  try { value = parseModelJson(body); } catch { return null; }
  const figure = value?.figure && typeof value.figure === 'object' ? { ...value.figure, ...value, figure: undefined } : value;
  if (typeof figure?.module !== 'string' || typeof figure?.fn !== 'string' || !Array.isArray(figure?.args)) return null;
  return { title: typeof figure.title === 'string' && figure.title.trim() ? figure.title.trim() : '', caption: typeof figure.caption === 'string' ? figure.caption : undefined, module: figure.module, fn: figure.fn, args: figure.args };
}

/** What the card's eyebrow calls the figure, from the Kinetra function that draws it. */
function kindOf(block: KinetraBlock) {
  const id = (block.module + '/' + block.fn).toLowerCase();
  if (id === 'clem/compose') return 'Technical figure';
  if (id.includes('logic')) return 'Logic circuit';
  if (id.includes('circuit')) return 'Circuit';
  if (id.includes('optics')) return 'Ray diagram';
  if (id.includes('freebody') || id.includes('fbd')) return 'Free-body diagram';
  if (/plot|field/.test(id)) return 'Graph';
  return 'Textbook figure';
}

/** Each figure is drawn once per session, however often the message renders. */
const drawn = new Map<string, Promise<string>>();
function draw(block: KinetraBlock) {
  const figure = JSON.stringify({ module: block.module, fn: block.fn, args: block.args });
  if (!drawn.has(figure)) {
    const job = desktop ? desktop.invoke({ action: 'kinetraFigure', figure }).then((r: { svg: string }) => r.svg) : Promise.reject(Error('Kinetra figures are drawn by the Clem desktop app.'));
    job.catch(() => drawn.delete(figure));
    drawn.set(figure, job);
  }
  return drawn.get(figure)!;
}

const fileName = (title: string) => title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 60) || 'figure';
const clean = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function KinetraFigure({ body, streaming }: { body: string; streaming: boolean }) {
  // While it streams the JSON is incomplete, so nothing is drawn until the whole block has arrived.
  const parsed = useMemo(() => readKinetraBlock(body), [body]);
  const [svg, setSvg] = useState(''), [error, setError] = useState(''), [note, setNote] = useState('');
  // Downloads live behind one icon in the heading, like the interactive visuals; the menu closes on a click elsewhere or Escape.
  const [menu, setMenu] = useState(false), menuHost = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!menuHost.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [menu]);
  const key = parsed ? JSON.stringify([parsed.module, parsed.fn, parsed.args]) : '';
  useEffect(() => {
    if (!parsed) return;
    let live = true;
    setError('');
    draw(parsed).then((out) => { if (live) setSvg(out); }, (e) => { if (live) setError(clean(e)); });
    return () => { live = false; };
  }, [key]);
  if (streaming && !parsed) return <div className="visual-drafting line" role="status"><span className="drafting-text">Drawing the figure…</span></div>;
  if (!parsed) return <details className="block-error"><summary><Icon name="visuals" size={15} />This figure could not be read.</summary><pre>{body.slice(0, 4000)}</pre></details>;
  if (error) return <details className="block-error"><summary><Icon name="visuals" size={15} />This figure could not be drawn. {error}</summary><pre>{body.slice(0, 4000)}</pre></details>;
  const title = parsed.title || kindOf(parsed);
  const failed = (e: unknown) => setNote(clean(e) || 'That could not be saved.');
  const png = () => {
    setNote('');
    const out = standardFonts(svg), box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(out), c = document.createElement('canvas');
    c.width = Math.round((box ? +box[1] : 760) * 2); c.height = Math.round((box ? +box[2] : 460) * 2);
    void paintSvg(c, out).then(() => c.toBlob((b) => b && void downloadMade(b, `${fileName(title)}.png`).catch(failed), 'image/png')).catch(failed);
  };
  return <div className="visual-frame">
    <section className="visual-engine v2 spec-visual no-side kinetra-figure" aria-label={`${kindOf(parsed)}: ${title}`}>
      <header className="visual-heading">
        <div className="visual-title"><span className="visual-subject">{kindOf(parsed)}</span><strong>{title}</strong></div>
        {svg && <div className="visual-transport"><div className="visual-menu-host" ref={menuHost}>
          <button className="visual-icon" aria-label="Download" aria-description="Download" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="download" size={16} /></button>
          {menu && <div className="visual-menu" role="menu" onClick={() => setMenu(false)}>
            <button role="menuitem" onClick={png}>Image <span>PNG</span></button>
            <button role="menuitem" onClick={() => { setNote(''); void downloadMade(new Blob([standardFonts(svg)], { type: 'image/svg+xml' }), `${fileName(title)}.svg`).catch(failed); }}>Vector <span>SVG</span></button>
            <button role="menuitem" onClick={() => { setNote(''); void import('../visual-pdf').then((m) => m.exportDiagramPdf(standardFonts(svg), `${fileName(title)}.pdf`)).catch(failed); }}>Document <span>PDF</span></button>
          </div>}
        </div></div>}
      </header>
      <div className="visual-stage">
        {svg ? <div className="visual-figure" role="img" aria-label={parsed.caption || title} dangerouslySetInnerHTML={{ __html: svg }} />
          : <div className="visual-figure kinetra-pending" role="status"><span>Drawing the figure…</span></div>}
      </div>
      {parsed.caption && <footer className="visual-caption"><span>{parsed.caption}</span></footer>}
      {note && <div className="visual-exports visual-status"><span className="visual-note" role="status">{note}</span></div>}
    </section>
  </div>;
}

/** A ```memory block: what the AI saved because the person asked it to remember something (desktop/main.ts rememberAsked). */
export function MemoryNote({ body }: { body: string }) {
  let items: string[] = [];
  try { const value = parseModelJson(body) as any; items = [value?.remember ?? value].flat().map((m: any) => typeof m?.text === 'string' ? m.text : '').filter(Boolean); } catch { /* still arriving */ }
  if (!items.length) return null;
  return <div className="memory-note" role="note"><Icon name="check" size={14} /><span><strong>Memory</strong>{items.map((t, i) => <span key={i}>{t}</span>)}</span></div>;
}
