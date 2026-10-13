import { Illustration } from '../Illustrations';
import { lazy, memo, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { VisualSaveContext } from './visual-save';
import { LinkChip, YouTubeEmbed, videosIn } from './Links';
import { DriveAudio, DriveCard, DriveChip, DriveVideo } from './DriveCards';
import { driveKind, type DriveRef } from '../../core/drive-search';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';
import 'katex/contrib/copy-tex';
import { mathMacros, normalizeMath } from '../../core/math-markdown';
import { linkCitations, readCitation, type Citation } from '../../core/citations';
import { parseVisual } from '../../core/visual-spec';
import { parseChecks, showNumber, type CheckResult } from '../../core/checks';
import { Icon } from '../Icons';
import { copyText } from '../clipboard';
import { tokenize, languageName } from './highlight';
import { runCode, runnable } from './code-run';
import { EditProposal, type EditBlock } from './EditProposal';
import { AutomationProposal } from './AutomationProposal';
import { readAutomationBlock, type AutomationBlock } from '../LocalAutomations';
import { PlanProposal, type PlanCardInfo } from './PlanProposal';
import { readPlanBlock, type PlanBlock } from '../../core/plans';
import type { EditOutcome } from '../../core/types';

const SpecVisual = lazy(() => import('../visuals/SpecVisual'));
/** While a block is still arriving: the pencil at work for a visual, a quiet line for the rest. */
function Drafting({ art = false, children }: { art?: boolean; children: ReactNode }) {
  return <div className={`visual-drafting ${art ? 'with-art' : 'line'}`} role="status">{art && <Illustration scene="pencil" viewBox="60 30 360 300" className="drafting-art" />}<span className="drafting-text">{children}</span></div>;
}

/** Every maths dialect becomes remark-math's $$…$$ (see core/math-markdown), then citations become links. */
export function prepareMarkdown(text: string) {
  return linkCitations(normalizeMath(text));
}

export type BodyHandlers = {
  onCite?: (c: Citation) => void;
  canCite?: (c: Citation) => boolean;
  edits?: Record<string, EditOutcome>;
  /** `base`: the SHA-256 of the file the change was shown against (null for a new file), checked again when it is applied. */
  onEdit?: (key: string, block: EditBlock, approve: boolean, base?: string | null) => Promise<void>;
  onUndo?: (key: string, outcome: EditOutcome) => Promise<void>;
  /** A routine proposed with an ```automation block; outcomes share `edits`. */
  onSchedule?: (key: string, block: AutomationBlock, approve: boolean) => Promise<void>;
  /** ```plan blocks: what the chat knows about each one's subject or project, and the person's decisions. Outcomes share `edits`. */
  planInfo?: (key: string, block: PlanBlock) => PlanCardInfo;
  onPlan?: (key: string, block: PlanBlock, approve: boolean) => Promise<void>;
  onPlanUndo?: (key: string, block: PlanBlock, outcome: EditOutcome) => Promise<void>;
  onOpenPlan?: (block: PlanBlock) => void;
  /** Changes whenever any plan changes, so the cards re-render (undo availability, saved state). */
  planStamp?: string;
  scope?: string;
  /** Drive files found for this reply, looked up by id for [name](drive:ID) links. */
  driveFile?: (id: string) => DriveRef | undefined;
  onOpenDrive?: (file: DriveRef) => void;
  onOpenDriveWeb?: (file: DriveRef) => void;
};

/** Drive ids linked inside a block of rendered markdown, in order and without repeats. */
function driveIdsIn(node: unknown): string[] {
  const found: string[] = [];
  const walk = (n: { tagName?: string; properties?: { href?: unknown }; children?: unknown[] }) => {
    if (n?.tagName === 'a' && typeof n.properties?.href === 'string' && n.properties.href.startsWith('drive:')) { const id = n.properties.href.slice(6); if (!found.includes(id)) found.push(id); }
    for (const child of n?.children || []) walk(child as typeof n);
  };
  walk(node as never);
  return found;
}

function CodeBlock({ lang, code, streaming }: { lang: string; code: string; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [run, setRun] = useState<{ output: { err: boolean; text: string }[]; status: string; state: 'running' | 'ok' | 'failed' | 'stopped'; ms: number } | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const tokens = useMemo(() => tokenize(code, lang), [code, lang]);
  const runAs = runnable(lang);
  useEffect(() => () => stop.current?.(), []);
  const start = () => {
    if (!runAs) return;
    const began = performance.now();
    setRun({ output: [], status: '', state: 'running', ms: 0 });
    stop.current = runCode(runAs, code, (e) => setRun((r) => {
      if (!r) return r;
      if (e.type === 'status') return { ...r, status: e.text };
      if (e.type === 'done') { stop.current = null; return { ...r, status: '', state: e.stopped ? 'stopped' : e.ok ? 'ok' : 'failed', ms: performance.now() - began }; }
      const last = r.output[r.output.length - 1], err = e.type === 'err';
      // Lines of the same stream join into one chunk, and a run is capped so a runaway loop cannot flood the chat.
      if (r.output.reduce((n, o) => n + o.text.length, 0) > 200_000) return r;
      return { ...r, output: last && last.err === err ? [...r.output.slice(0, -1), { err, text: last.text + e.text }] : [...r.output, { err, text: e.text }] };
    }));
  };
  const running = run?.state === 'running';
  return <div className={`code-block ${wrap ? 'wrapped' : ''}`}>
    <div className="code-head">
      <span className="code-lang"><span className="code-glyph" aria-hidden="true">&lt;/&gt;</span>{languageName(lang)}</span>
      <div className="code-tools">
        <button type="button" className="code-icon" aria-pressed={wrap} aria-label={wrap ? 'Stop wrapping lines' : 'Wrap long lines'} title={wrap ? 'Unwrap' : 'Wrap lines'} onClick={() => setWrap(!wrap)}><Icon name="wrap" size={15} /></button>
        <button type="button" className="code-icon" aria-label={copied ? 'Copied' : 'Copy code'} title={copied ? 'Copied' : 'Copy'} onClick={() => { void copyText(code).then(ok => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}><Icon name={copied ? 'check' : 'copy'} size={15} /></button>
        {runAs && <button type="button" className={`code-run ${running ? 'running' : ''}`} disabled={streaming} aria-label={running ? 'Stop running' : `Run ${languageName(lang)} code`} onClick={() => running ? stop.current?.() : start()}>
          <Icon name={running ? 'stop' : 'playhead'} size={13} />{running ? 'Stop' : 'Run'}
        </button>}
      </div>
    </div>
    <pre><code>{tokens.map((t, i) => t.kind === 'plain' ? t.text : <span key={i} className={'tk-' + t.kind}>{t.text}</span>)}</code></pre>
    {run && <div className={`code-output ${run.state}`} role="log" aria-live="polite" aria-label="Output">
      <div className="code-output-head">
        <span>{running ? (run.status || 'Running…') : run.state === 'ok' ? 'Output' : run.state === 'stopped' ? 'Stopped' : 'Error'}</span>
        {!running && <span className="code-output-meta">{run.ms < 1000 ? Math.max(1, Math.round(run.ms)) + ' ms' : (run.ms / 1000).toFixed(1) + ' s'}</span>}
        {!running && <button type="button" className="code-icon" aria-label="Clear output" title="Clear" onClick={() => setRun(null)}><Icon name="close" size={13} /></button>}
      </div>
      <pre>{run.output.length ? run.output.map((o, i) => <span key={i} className={o.err ? 'code-err' : undefined}>{o.text}</span>) : !running && <span className="code-none">No output</span>}{running && <span className="code-caret" aria-hidden="true" />}</pre>
    </div>}
  </div>;
}

function VisualBlock({ body, streaming }: { body: string; streaming: boolean }) {
  const result = useMemo(() => { try { return { visual: parseVisual(body), spec: JSON.parse(body) as unknown }; } catch (e) { return { error: (e as Error).message }; } }, [body]);
  const saves = useContext(VisualSaveContext);
  if (result.visual) {
    const saved = !!saves?.saved(result.spec);
    return <div className="visual-frame">
      <Suspense fallback={<Drafting art>Drawing…</Drafting>}><SpecVisual visual={result.visual} headerAction={saves && !streaming && <button type="button" className={`visual-save ${saved ? "saved" : ""}`} aria-pressed={saved} aria-description={saved ? "Saved to Visuals · click to remove" : "Save to Visuals"} onClick={() => saves.toggle(result.spec)}>
        <Icon name={saved ? "check" : "pin"} size={16} /><span>{saved ? "Saved" : "Save"}</span>
      </button>} /></Suspense>
    </div>;
  }
  if (streaming) return <Drafting art>Drawing the visual…</Drafting>;
  return <details className="block-error"><summary><Icon name="visuals" size={15} />This visual could not be drawn. {result.error}</summary><pre>{body.slice(0, 4000)}</pre></details>;
}

function CheckBlock({ body, streaming }: { body: string; streaming: boolean }) {
  const parsed = useMemo(() => { try { return { results: parseChecks(body) }; } catch (e) { return { error: (e as Error).message }; } }, [body]);
  const [open, setOpen] = useState(false);
  if (!parsed.results) return streaming ? <div className="checks pending" role="status"><Icon name="verify" size={15} />Rechecking the numbers…</div> : null;
  const results: CheckResult[] = parsed.results, differs = results.filter(r => r.status === 'differs'), errors = results.filter(r => r.status === 'error');
  const tone = differs.length ? 'warn' : errors.length === results.length ? 'muted' : 'ok';
  const summary = differs.length ? `${differs.length} of ${results.length} ${results.length === 1 ? 'number differs' : 'numbers differ'} when recomputed` : `${results.length - errors.length} of ${results.length} ${results.length === 1 ? 'number' : 'numbers'} recomputed and confirmed`;
  return <div className={`checks ${tone}`}>
    <button type="button" className="checks-summary" aria-expanded={open || !!differs.length} onClick={() => setOpen(!open)}>
      <Icon name={differs.length ? 'research' : 'verify'} size={16} /><span>{summary}</span><Icon name="down" size={13} />
    </button>
    {(open || differs.length > 0) && <ul>{results.map((r, i) => <li key={i} className={r.status}>
      <span className="check-mark" aria-label={r.status === 'ok' ? 'Confirmed' : r.status === 'differs' ? 'Differs' : 'Not checked'}>{r.status === 'ok' ? '✓' : r.status === 'differs' ? '!' : '–'}</span>
      <span className="check-label">{r.label}</span>
      <code aria-description={r.expr}>{r.expr}</code>
      <span className="check-value">{r.status === 'differs' ? <>stated {showNumber(r.claimed)} · <strong>recomputed {showNumber(r.computed)}</strong></> : r.status === 'ok' ? <>{showNumber(r.computed)}</> : r.error}{r.unit && r.status !== 'error' ? ' ' + r.unit : ''}</span>
    </li>)}<li className="checks-note">Mowr recomputes each stated formula with its inputs. It confirms the arithmetic, not the choice of formula.</li></ul>}
  </div>;
}

function MessageBodyImpl({ content, streaming = false, handlers = {} }: { content: string; streaming?: boolean; handlers?: BodyHandlers }) {
  const prepared = useMemo(() => prepareMarkdown(content), [content]);
  let editIndex = 0, automationIndex = 0, planIndex = 0;
  // Drive files linked in a paragraph follow it, like YouTube links: videos and audio play, documents open as cards.
  const drivePlayers = (node: unknown) => driveIdsIn(node).map((id) => handlers.driveFile?.(id)).filter((f): f is DriveRef => !!f)
    .map((f) => driveKind(f.mimeType) === 'video' ? <DriveVideo key={f.id} file={f} onOpenWeb={handlers.onOpenDriveWeb} /> : driveKind(f.mimeType) === 'audio' ? <DriveAudio key={f.id} file={f} /> : <DriveCard key={f.id} file={f} onOpen={(x) => handlers.onOpenDrive?.(x)} />);
  return <div className="md">
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: 'ignore', output: 'html', macros: mathMacros }]]}
      urlTransform={url => (url.startsWith('source:') || /^drive:[\w-]{10,150}$/.test(url) ? url : defaultUrlTransform(url))}
      components={{
        a: ({ href, children }) => {
          if (href?.startsWith('drive:')) {
            const file = handlers.driveFile?.(href.slice(6));
            if (!file) return <>{children}</>;
            // In the sentence a Drive link is a chip; its player or card follows the paragraph.
            const media = driveKind(file.mimeType) === 'video' || driveKind(file.mimeType) === 'audio';
            return <DriveChip onClick={media ? undefined : () => handlers.onOpenDrive?.(file)}>{children}</DriveChip>;
          }
          const cite = href ? readCitation(href) : null;
          if (cite) {
            const usable = handlers.canCite?.(cite) ?? false;
            return <button type="button" className={`cite ${usable ? '' : 'unavailable'}`} aria-description={usable ? `Open ${cite.name}${cite.page ? ', page ' + cite.page : ''}` : `${cite.name} is not in your files`} onClick={() => usable && handlers.onCite?.(cite)}><Icon name="files" size={12} /><span>{children}</span></button>;
          }
          return href ? <LinkChip href={href}>{children}</LinkChip> : <>{children}</>;
        },
        // A paragraph that mentions a YouTube video is followed by the video, ready to play.
        p: ({ node, children }) => { const videos = streaming ? [] : videosIn(node); return <>{<p>{children}</p>}{videos.map((v) => <YouTubeEmbed key={v} href={v} />)}{!streaming && drivePlayers(node)}</>; },
        li: ({ node, children }) => { const videos = streaming ? [] : videosIn(node); return <li>{children}{videos.map((v) => <YouTubeEmbed key={v} href={v} />)}{!streaming && drivePlayers(node)}</li>; },
        table: ({ children }) => <TableWrap>{children}</TableWrap>,
        pre: ({ children }) => {
          const child = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string; children?: ReactNode } } | undefined;
          const lang = /language-([\w-]+)/.exec(child?.props?.className || '')?.[1] || '';
          const code = String(child?.props?.children ?? '').replace(/\n$/, '');
          if (lang === 'visual') return <VisualBlock body={code} streaming={streaming} />;
          if (lang === 'check') return <CheckBlock body={code} streaming={streaming} />;
          if (lang === 'edit') {
            const key = 'edit-' + editIndex++;
            let block: EditBlock | null = null;
            try { block = JSON.parse(code); } catch { /* still streaming or malformed */ }
            if (!block || typeof block.path !== 'string') return streaming ? <Drafting>Preparing a file change…</Drafting> : <details className="block-error"><summary>A proposed file change could not be read.</summary><pre>{code.slice(0, 4000)}</pre></details>;
            return <EditProposal block={block} streaming={streaming} scope={handlers.scope} outcome={handlers.edits?.[key]} onDecide={(approve, base) => handlers.onEdit?.(key, block!, approve, base) ?? Promise.resolve()} onUndo={outcome => handlers.onUndo?.(key, outcome) ?? Promise.resolve()} />;
          }
          if (lang === 'automation') {
            const key = 'automation-' + automationIndex++, block = readAutomationBlock(code);
            if (!block) return streaming ? <Drafting>Preparing a routine…</Drafting> : <details className="block-error"><summary>A proposed routine could not be read.</summary><pre>{code.slice(0, 4000)}</pre></details>;
            return <AutomationProposal block={block} streaming={streaming} outcome={handlers.edits?.[key]} onDecide={approve => handlers.onSchedule?.(key, block, approve) ?? Promise.resolve()} />;
          }
          if (lang === 'plan') {
            const key = 'plan-' + planIndex++, block = readPlanBlock(code);
            if (!block) return streaming ? <Drafting>Drawing up the plan…</Drafting> : <details className="block-error"><summary>A plan could not be read.</summary><pre>{code.slice(0, 4000)}</pre></details>;
            const outcome = handlers.edits?.[key];
            return <PlanProposal block={block} streaming={streaming} outcome={outcome} info={handlers.planInfo?.(key, block) ?? {}} onDecide={approve => handlers.onPlan?.(key, block, approve) ?? Promise.resolve()} onUndo={() => outcome ? handlers.onPlanUndo?.(key, block, outcome) ?? Promise.resolve() : Promise.resolve()} onOpen={() => handlers.onOpenPlan?.(block)} />;
          }
          return <CodeBlock lang={lang} code={code} streaming={streaming} />;
        },
      }}
    >{prepared}</ReactMarkdown>
  </div>;
}
// Handlers read live state through refs in the workspace, so only content changes need a re-render.
export const MessageBody = memo(MessageBodyImpl, (a, b) => a.content === b.content && a.streaming === b.streaming && a.handlers?.edits === b.handlers?.edits && a.handlers?.scope === b.handlers?.scope && a.handlers?.planStamp === b.handlers?.planStamp);

/** A table in an answer: as wide as the text column, or wider when its columns need it and the window has room (up
 *  to the workspace's width less its margins); wider still, it scrolls sideways inside its frame (chat.css). */
function TableWrap({ children }: { children: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = wrap.current, area = el?.closest<HTMLElement>('.workspace');
    if (!el) return;
    const room = () => el.style.setProperty('--room', Math.max(0, (area || document.documentElement).clientWidth - 72) + 'px');
    room();
    if (!area) return;
    const watch = new ResizeObserver(room);
    watch.observe(area);
    return () => watch.disconnect();
  }, []);
  return <div ref={wrap} className="table-wrap"><table>{children}</table></div>;
}
