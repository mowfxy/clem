import { lazy, memo, Suspense, useContext, useMemo, useState, type ReactNode } from 'react';
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
import { EditProposal, type EditBlock } from './EditProposal';
import { AutomationProposal } from './AutomationProposal';
import { readAutomationBlock, type AutomationBlock } from '../LocalAutomations';
import type { EditOutcome } from '../../core/types';

const SpecVisual = lazy(() => import('../visuals/SpecVisual'));

/** Every maths dialect becomes remark-math's $$…$$ (see core/math-markdown), then citations become links. */
export function prepareMarkdown(text: string) {
  return linkCitations(normalizeMath(text));
}

export type BodyHandlers = {
  onCite?: (c: Citation) => void;
  canCite?: (c: Citation) => boolean;
  edits?: Record<string, EditOutcome>;
  onEdit?: (key: string, block: EditBlock, approve: boolean) => Promise<void>;
  onUndo?: (key: string, outcome: EditOutcome) => Promise<void>;
  /** A routine proposed with an ```automation block; outcomes share `edits`. */
  onSchedule?: (key: string, block: AutomationBlock, approve: boolean) => Promise<void>;
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

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="code-block">
    <div className="code-head"><span>{lang || 'text'}</span><button type="button" aria-label="Copy code" onClick={() => { void copyText(code).then(ok => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 1400); }); }}>{copied ? <><Icon name="check" size={14} />Copied</> : <><Icon name="copy" size={14} />Copy</>}</button></div>
    <pre><code>{code}</code></pre>
  </div>;
}

function VisualBlock({ body, streaming }: { body: string; streaming: boolean }) {
  const result = useMemo(() => { try { return { visual: parseVisual(body), spec: JSON.parse(body) as unknown }; } catch (e) { return { error: (e as Error).message }; } }, [body]);
  const saves = useContext(VisualSaveContext);
  if (result.visual) {
    const saved = !!saves?.saved(result.spec);
    return <div className="visual-frame">
      <Suspense fallback={<div className="visual-drafting">Drawing…</div>}><SpecVisual visual={result.visual} headerAction={saves && !streaming && <button type="button" className={`visual-save ${saved ? "saved" : ""}`} aria-pressed={saved} title={saved ? "Saved to Visuals · click to remove" : "Save to Visuals"} onClick={() => saves.toggle(result.spec)}>
        <Icon name={saved ? "check" : "pin"} size={16} /><span>{saved ? "Saved" : "Save"}</span>
      </button>} /></Suspense>
    </div>;
  }
  if (streaming) return <div className="visual-drafting" role="status"><span className="drafting-dot" />Drawing the visual…</div>;
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
      <code title={r.expr}>{r.expr}</code>
      <span className="check-value">{r.status === 'differs' ? <>stated {showNumber(r.claimed)} · <strong>recomputed {showNumber(r.computed)}</strong></> : r.status === 'ok' ? <>{showNumber(r.computed)}</> : r.error}{r.unit && r.status !== 'error' ? ' ' + r.unit : ''}</span>
    </li>)}<li className="checks-note">Mowr recomputes each stated formula with its inputs. It confirms the arithmetic, not the choice of formula.</li></ul>}
  </div>;
}

function MessageBodyImpl({ content, streaming = false, handlers = {} }: { content: string; streaming?: boolean; handlers?: BodyHandlers }) {
  const prepared = useMemo(() => prepareMarkdown(content), [content]);
  let editIndex = 0, automationIndex = 0;
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
            return <button type="button" className={`cite ${usable ? '' : 'unavailable'}`} title={usable ? `Open ${cite.name}${cite.page ? ', page ' + cite.page : ''}` : `${cite.name} is not in your files`} onClick={() => usable && handlers.onCite?.(cite)}><Icon name="files" size={12} /><span>{children}</span></button>;
          }
          return href ? <LinkChip href={href}>{children}</LinkChip> : <>{children}</>;
        },
        // A paragraph that mentions a YouTube video is followed by the video, ready to play.
        p: ({ node, children }) => { const videos = streaming ? [] : videosIn(node); return <>{<p>{children}</p>}{videos.map((v) => <YouTubeEmbed key={v} href={v} />)}{!streaming && drivePlayers(node)}</>; },
        li: ({ node, children }) => { const videos = streaming ? [] : videosIn(node); return <li>{children}{videos.map((v) => <YouTubeEmbed key={v} href={v} />)}{!streaming && drivePlayers(node)}</li>; },
        table: ({ children }) => <div className="table-wrap"><table>{children}</table></div>,
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
            if (!block || typeof block.path !== 'string') return streaming ? <div className="visual-drafting" role="status"><span className="drafting-dot" />Preparing a file change…</div> : <details className="block-error"><summary>A proposed file change could not be read.</summary><pre>{code.slice(0, 4000)}</pre></details>;
            return <EditProposal block={block} streaming={streaming} scope={handlers.scope} outcome={handlers.edits?.[key]} onDecide={approve => handlers.onEdit?.(key, block!, approve) ?? Promise.resolve()} onUndo={outcome => handlers.onUndo?.(key, outcome) ?? Promise.resolve()} />;
          }
          if (lang === 'automation') {
            const key = 'automation-' + automationIndex++, block = readAutomationBlock(code);
            if (!block) return streaming ? <div className="visual-drafting" role="status"><span className="drafting-dot" />Preparing a routine…</div> : <details className="block-error"><summary>A proposed routine could not be read.</summary><pre>{code.slice(0, 4000)}</pre></details>;
            return <AutomationProposal block={block} streaming={streaming} outcome={handlers.edits?.[key]} onDecide={approve => handlers.onSchedule?.(key, block, approve) ?? Promise.resolve()} />;
          }
          return <CodeBlock lang={lang} code={code} />;
        },
      }}
    >{prepared}</ReactMarkdown>
  </div>;
}
// Handlers read live state through refs in the workspace, so only content changes need a re-render.
export const MessageBody = memo(MessageBodyImpl, (a, b) => a.content === b.content && a.streaming === b.streaming && a.handlers?.edits === b.handlers?.edits && a.handlers?.scope === b.handlers?.scope);
