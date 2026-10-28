import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../Icons";

/** Matches are painted with the CSS Custom Highlight API, so the page's own elements are never rewritten. */
const ALL = "clem-find", CURRENT = "clem-find-current";
const MAX = 1000;
type Highlights = { set(name: string, value: unknown): void; delete(name: string): void };
const registry = (): Highlights | undefined => (globalThis.CSS as unknown as { highlights?: Highlights } | undefined)?.highlights;
const HighlightClass = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

/** Every place `query` appears in the visible text under `root`, case-insensitively, in reading order. */
function findRanges(root: Element, query: string): Range[] {
  const q = query.toLowerCase();
  if (!q) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const el = node.parentElement;
      if (!el || el.closest(".find-bar,script,style,textarea,[aria-hidden=true]")) return NodeFilter.FILTER_REJECT;
      return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const ranges: Range[] = [];
  for (let node = walker.nextNode(); node && ranges.length < MAX; node = walker.nextNode()) {
    const text = node.nodeValue!.toLowerCase();
    for (let at = text.indexOf(q); at >= 0 && ranges.length < MAX; at = text.indexOf(q, at + q.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + q.length);
      ranges.push(range);
    }
  }
  return ranges;
}

/** Ctrl+F in Clem: finds words in the page on screen (a conversation, a subject, Files), steps through them with
 *  Enter and Shift+Enter, and keeps counting while an answer streams in. */
export function FindBar({ scope, focusKey = 0, onClose }: { scope: string; focusKey?: number; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [ranges, setRanges] = useState<Range[]>([]);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const supported = !!registry() && !!HighlightClass;

  // Opening it, or pressing Ctrl+F again while it is open, puts the caret in the box with the words selected.
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, [focusKey]);

  // Search again as the query changes and as the page changes (a streaming answer, a new message).
  useEffect(() => {
    const area = document.querySelector(scope);
    if (!area || !query.trim()) { setRanges([]); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => { timer = undefined; setRanges(findRanges(area, query.trim())); };
    run();
    // Recounted at most a few times a second while the page changes (an answer streaming in).
    const observer = new MutationObserver(() => { timer ??= setTimeout(run, 400); });
    observer.observe(area, { subtree: true, childList: true, characterData: true });
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [query, scope]);

  useEffect(() => { setAt(0); }, [query]);
  const current = ranges.length ? Math.min(at, ranges.length - 1) : -1;

  // Paint the matches, and the current one more strongly.
  useEffect(() => {
    const css = registry();
    if (!css || !HighlightClass) return;
    css.set(ALL, new HighlightClass(...ranges));
    if (current >= 0) css.set(CURRENT, new HighlightClass(ranges[current]));
    else css.delete(CURRENT);
  }, [ranges, current]);
  // The highlight colours apply only while this is open (src/enhance.css).
  useEffect(() => {
    document.documentElement.classList.add("clem-finding");
    return () => { document.documentElement.classList.remove("clem-finding"); registry()?.delete(ALL); registry()?.delete(CURRENT); };
  }, []);

  // Bring the current match into view when it changes (not on every recount while an answer streams).
  const shown = useRef<Range | null>(null);
  useEffect(() => {
    const range = current >= 0 ? ranges[current] : null;
    if (!range || (shown.current && shown.current.startContainer === range.startContainer && shown.current.startOffset === range.startOffset)) return;
    shown.current = range;
    range.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [ranges, current]);

  const step = (by: number) => { if (ranges.length) setAt((current + by + ranges.length) % ranges.length); };
  return <div className="find-bar" role="search" aria-label="Find on this page">
    <Icon name="research" size={16} />
    <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in this page" aria-label="Find in this page"
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        else if (e.key === "Escape") { e.preventDefault(); onClose(); }
      }} />
    <span className="find-count" role="status">{!supported ? "" : query.trim() ? (ranges.length ? `${current + 1} of ${ranges.length}${ranges.length >= MAX ? "+" : ""}` : "No matches") : ""}</span>
    <button type="button" className="icon-button" aria-label="Previous match" disabled={!ranges.length} onClick={() => step(-1)}><Icon name="up" size={15} /></button>
    <button type="button" className="icon-button" aria-label="Next match" disabled={!ranges.length} onClick={() => step(1)}><Icon name="down" size={15} /></button>
    <button type="button" className="icon-button" aria-label="Close find" onClick={onClose}><Icon name="close" size={15} /></button>
  </div>;
}
