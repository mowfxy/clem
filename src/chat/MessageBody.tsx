import { Illustration } from '../Illustrations';
import { lazy, memo, Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { VisualSaveContext } from './visual-save';
import { LinkChip, YouTubeEmbed, videosIn } from './Links';
import { DriveAudio, DriveCard, DriveChip, DriveVideo } from './DriveCards';
import { driveKind, type DriveRef } from '../../core/drive-search';
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';
import 'katex/contrib/copy-tex';
import { mathMacros, normalizeMath } from '../../core/math-markdown';
import { linkCitations, readCitation, type Citation } from '../../core/citations';
import { parseVisual } from '../../core/visual-spec';
import { parseModelJson } from '../../core/model-json';
import { parseChecks, showNumber, type CheckResult } from '../../core/checks';
import { Icon } from '../Icons';
import { copyText } from '../clipboard';
import { tokenize, languageName } from './highlight';
import { runCode, runnable, type RunHandle } from './code-run';
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

/** A fence the answer marked as a complete program to try (```python run): only those get Run, so a fragment
 *  quoted in an explanation is shown, not executed. */
export function fenceRuns(lang: string, meta: unknown) {
  const tagged = /-run$/i.test(lang);
  return { lang: tagged ? lang.replace(/-run$/i, '') : lang, runs: tagged || /(?:^|[s{,])run(?:nable)?(?:$|[s},=])/i.test(String(meta ?? '')) };
}

function CodeBlock({ lang, code, streaming, runs }: { lang: string; code: string; streaming: boolean; runs: boolean }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  type Chunk = { kind: 'out' | 'err' | 'in'; text: string };
  const [run, setRun] = useState<{ output: Chunk[]; status: string; state: 'running' | 'ok' | 'failed' | 'stopped'; ms: number; waiting: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const stop = useRef<RunHandle | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const tokens = useMemo(() => tokenize(code, lang), [code, lang]);
  const runAs = runs ? runnable(lang) : null;
  useEffect(() => () => stop.current?.(), []);
  // Lines of the same stream join into one chunk, and a run is capped so a runaway loop cannot flood the chat.
  const append = (output: Chunk[], kind: Chunk['kind'], text: string) => {
    if (output.reduce((n, o) => n + o.text.length, 0) > 200_000) return output;
    const last = output[output.length - 1];
    return last && last.kind === kind ? [...output.slice(0, -1), { kind, text: last.text + text }] : [...output, { kind, text }];
  };
  const start = () => {
    if (!runAs) return;
    const began = performance.now();
    setTyped('');
    setRun({ output: [], status: '', state: 'running', ms: 0, waiting: false });
    stop.current = runCode(runAs, code, (e) => setRun((r) => {
      if (!r) return r;
      if (e.type === 'status') return { ...r, status: e.text };
      if (e.type === 'waiting') { requestAnimationFrame(() => field.current?.focus({ preventScroll: true })); return { ...r, waiting: true }; }
      if (e.type === 'done') { stop.current = null; return { ...r, status: '', waiting: false, state: e.stopped ? 'stopped' : e.ok ? 'ok' : 'failed', ms: performance.now() - began }; }
      return { ...r, output: append(r.output, e.type, e.text) };
    }));
  };
  /** The typed line goes to the program's standard input and shows in the output where it was entered. */
  const send = (line: string | null) => {
    if (!stop.current) return;
    stop.current.send(line);
    setRun((r) => (r ? { ...r, waiting: false, output: line === null ? r.output : append(r.output, 'in', line + '\n') } : r));
    setTyped('');
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
        <span>{running ? (run.waiting ? 'Waiting for input' : run.status || 'Running…') : run.state === 'ok' ? 'Output' : run.state === 'stopped' ? 'Stopped' : 'Error'}</span>
        {!running && <span className="code-output-meta">{run.ms < 1000 ? Math.max(1, Math.round(run.ms)) + ' ms' : (run.ms / 1000).toFixed(1) + ' s'}</span>}
        {!running && <button type="button" className="code-icon" aria-label="Clear output" title="Clear" onClick={() => setRun(null)}><Icon name="close" size={13} /></button>}
      </div>
      <pre>{run.output.length ? run.output.map((o, i) => <span key={i} className={o.kind === 'err' ? 'code-err' : o.kind === 'in' ? 'code-in' : undefined}>{o.text}</span>) : !running && <span className="code-none">No output</span>}{running && !run.waiting && <span className="code-caret" aria-hidden="true" />}</pre>
      {running && <form className={`code-stdin ${run.waiting ? 'waiting' : ''}`} onSubmit={(e) => { e.preventDefault(); send(typed); }}>
        <span className="code-stdin-mark" aria-hidden="true">›</span>
        <input ref={field} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Input for the program" placeholder={run.waiting ? 'The program is waiting for input. Type it and press Enter' : 'Type input for the program and press Enter'} spellCheck={false} autoComplete="off"
          onKeyDown={(e) => { if (e.key === 'd' && (e.ctrlKey || e.metaKey) && !typed) { e.preventDefault(); send(null); } }} />
        <button type="submit" className="code-stdin-send" aria-label="Send input" title="Send (Enter)"><Icon name="send" size={13} /></button>
      </form>}
    </div>}
  </div>;
}

function VisualBlock({ body, streaming }: { body: string; streaming: boolean }) {
  const result = useMemo(() => { try { return { visual: parseVisual(body), spec: parseModelJson(body) as unknown }; } catch (e) { return { error: (e as Error).message }; } }, [body]);
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
    </li>)}<li className="checks-note">Clem recomputes each stated formula with its inputs. It confirms the arithmetic, not the choice of formula.</li></ul>}
  </div>;
}

/** Numbers each ```edit, ```automation and ```plan block in document order (edit-0, plan-0…), the keys their saved outcomes use. */
type HastNode = { type?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };
function rehypeBlockKeys() {
  return (tree: HastNode) => {
    const seen: Record<string, number> = {};
    const walk = (n: HastNode) => {
      if (n.tagName === 'pre') {
        const code = n.children?.find((c) => c.tagName === 'code'), cls = code?.properties?.className;
        const lang = (Array.isArray(cls) ? cls : [cls]).map(String).map((c) => /^language-([\w-]+)$/.exec(c)?.[1]).find(Boolean);
        if (lang === 'edit' || lang === 'automation' || lang === 'plan') { seen[lang] = seen[lang] ?? 0; n.properties = { ...n.properties, dataBlockKey: lang + '-' + seen[lang]++ }; }
      }
      for (const c of n.children || []) walk(c);
    };
    walk(tree);
  };
}
const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: false }]] as const;
const rehypePlugins = [[rehypeKatex, { throwOnError: false, strict: 'ignore', output: 'html', macros: mathMacros }], rehypeBlockKeys] as const;
const urlTransform = (url: string) => (url.startsWith('source:') || /^drive:[\w-]{10,150}$/.test(url) ? url : defaultUrlTransform(url));

function MessageBodyImpl({ content, streaming = false, handlers = {} }: { content: string; streaming?: boolean; handlers?: BodyHandlers }) {
  const prepared = useMemo(() => prepareMarkdown(content), [content]);
  // The renderers stay the same functions for the message's life, so blocks keep their state (a run's output, a playing
  // video, a visual's sliders) across re-renders; what changes is read through these refs.
  const live = useRef({ handlers, streaming });
  live.current = { handlers, streaming };
  const components = useMemo<Components>(() => {
    // Drive files linked in a paragraph follow it, like YouTube links: videos and audio play, documents open as cards.
    const drivePlayers = (node: unknown) => { const handlers = live.current.handlers; return driveIdsIn(node).map((id) => handlers.driveFile?.(id)).filter((f): f is DriveRef => !!f)
      .map((f) => driveKind(f.mimeType) === 'video' ? <DriveVideo key={f.id} file={f} onOpenWeb={handlers.onOpenDriveWeb} /> : driveKind(f.mimeType) === 'audio' ? <DriveAudio key={f.id} file={f} /> : <DriveCard key={f.id} file={f} onOpen={(x) => live.current.handlers.onOpenDrive?.(x)} />); };
    return {
        a: ({ href, children }) => {
          const handlers = live.current.handlers;
          if (href?.startsWith('drive:')) {
            const file = handlers.driveFile?.(href.slice(6));
            if (!file) return <>{children}</>;
            // In the sentence a Drive link is a chip; its player or card follows the paragraph.
            const media = driveKind(file.mimeType) === 'video' || driveKind(file.mimeType) === 'audio';
            return <DriveChip onClick={media ? undefined : () => live.current.handlers.onOpenDrive?.(file)}>{children}</DriveChip>;
          }
          const cite = href ? readCitation(href) : null;
          if (cite) {
            const usable = handlers.canCite?.(cite) ?? false;
            return <button type="button" className={`cite ${usable ? '' : 'unavailable'}`} aria-description={usable ? `Open ${cite.name}${cite.page ? ', page ' + cite.page : ''}` : `${cite.name} is not in your files`} onClick={() => usable && live.current.handlers.onCite?.(cite)}><Icon name="files" size={12} /><span>{children}</span></button>;
          }
          return href ? <LinkChip href={href}>{children}</LinkChip> : <>{children}</>;
        },
        // A paragraph that mentions a YouTube video is followed by the video, ready to play.
        p: ({ node, children }) => { const streaming = live.current.streaming, videos = streaming ? [] : videosIn(node); return <>{<p>{children}</p>}{videos.map((v) => <YouTubeEmbed key={v} href={v} />)}{!streaming && drivePlayers(node)}</>; },
        li: ({ node, children }) => { const streaming = live.current.streaming, videos = streaming ? [] : videosIn(node); return <li>{children}{videos.map((v) => <YouTubeEmbed key={v} href={v} />)}{!streaming && drivePlayers(node)}</li>; },
        table: ({ children }) => <TableWrap>{children}</TableWrap>,
        pre: ({ node, children }) => {
          const { handlers, streaming } = live.current;
          const child = (Array.isArray(children) ? children[0] : children) as { props?: { className?: string; children?: ReactNode } } | undefined;
          const lang = /language-([\w-]+)/.exec(child?.props?.className || '')?.[1] || '';
          const code = String(child?.props?.children ?? '').replace(/\n$/, '');
          const key = String(node?.properties?.dataBlockKey ?? lang + '-0');
          if (lang === 'visual') return <VisualBlock body={code} streaming={streaming} />;
          if (lang === 'check') return <CheckBlock body={code} streaming={streaming} />;
          if (lang === 'edit') {
            let block: EditBlock | null = null;
            try { block = parseModelJson(code); } catch { /* still streaming or malformed */ }
            if (!block || typeof block.path !== 'string') return streaming ? <Drafting>Preparing a file change…</Drafting> : <details className="block-error"><summary>A proposed file change could not be read.</summary><pre>{code.slice(0, 4000)}</pre></details>;
            return <EditProposal block={block} streaming={streaming} scope={handlers.scope} outcome={handlers.edits?.[key]} onDecide={(approve, base) => live.current.handlers.onEdit?.(key, block!, approve, base) ?? Promise.resolve()} onUndo={outcome => live.current.handlers.onUndo?.(key, outcome) ?? Promise.resolve()} />;
          }
          if (lang === 'automation') {
            const block = readAutomationBlock(code);
            if (!block) return streaming ? <Drafting>Preparing a routine…</Drafting> : <details className="block-error"><summary>A proposed routine could not be read.</summary><pre>{code.slice(0, 4000)}</pre></details>;
            return <AutomationProposal block={block} streaming={streaming} outcome={handlers.edits?.[key]} onDecide={approve => live.current.handlers.onSchedule?.(key, block, approve) ?? Promise.resolve()} />;
          }
          if (lang === 'plan') {
            const block = readPlanBlock(code);
            if (!block) return streaming ? <Drafting>Drawing up the plan…</Drafting> : <details className="block-error"><summary>A plan could not be read.</summary><pre>{code.slice(0, 4000)}</pre></details>;
            const outcome = handlers.edits?.[key];
            return <PlanProposal block={block} streaming={streaming} outcome={outcome} info={handlers.planInfo?.(key, block) ?? {}} onDecide={approve => live.current.handlers.onPlan?.(key, block, approve) ?? Promise.resolve()} onUndo={() => outcome ? live.current.handlers.onPlanUndo?.(key, block, outcome) ?? Promise.resolve() : Promise.resolve()} onOpen={() => live.current.handlers.onOpenPlan?.(block)} />;
          }
          const fence = fenceRuns(lang, (node?.children?.[0] as { data?: { meta?: unknown } } | undefined)?.data?.meta);
          return <CodeBlock lang={fence.lang} code={code} streaming={streaming} runs={fence.runs} />;
        },
    };
  }, []);
  return <div className="md">
    <ReactMarkdown
      remarkPlugins={remarkPlugins as never}
      rehypePlugins={rehypePlugins as never}
      urlTransform={urlTransform}
      components={components}
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
