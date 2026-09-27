import { useEffect, useRef, useState } from "react";
import type { Chapter } from "../../core/chat-title";
import "./chapters.css";

const quiet = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.quiet === "true";
const anchor = (id: string) => document.querySelector<HTMLElement>(`.messages [data-message-id="${CSS.escape(id)}"]`);

/** The nearest scrolling ancestor, or null when the page itself scrolls. */
function scroller(from: HTMLElement | null) {
  for (let el = from?.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

/** A long chat's topics, pinned to its top-left corner: one bar per chapter with the one in view lit. Hovering or
 *  clicking lists them by name, and choosing one scrolls to the question that started it. Hidden until a chat has
 *  moved on to a second topic. */
export function Chapters({ chapters }: { chapters: Chapter[] }) {
  const [current, setCurrent] = useState(0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const closing = useRef<number | undefined>(undefined);
  const key = chapters.map((c) => c.id).join(" ");

  useEffect(() => {
    if (chapters.length < 2) return;
    const box = scroller(root.current);
    const update = () => {
      const line = (box ? box.getBoundingClientRect().top : 0) + 140;
      let at = 0;
      chapters.forEach((c, i) => { const el = anchor(c.id); if (el && el.getBoundingClientRect().top <= line) at = i; });
      // At the very bottom the last chapter is the one being read, even when its question sits above the line.
      const end = box ? box.scrollTop + box.clientHeight >= box.scrollHeight - 4 : innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
      setCurrent(end && anchor(chapters.at(-1)!.id) ? chapters.length - 1 : at);
    };
    update();
    const target: HTMLElement | Window = box ?? window;
    target.addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => { target.removeEventListener("scroll", update); removeEventListener("resize", update); };
  }, [key]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("keydown", onKey);
    addEventListener("pointerdown", onDown);
    return () => { removeEventListener("keydown", onKey); removeEventListener("pointerdown", onDown); };
  }, [open]);

  useEffect(() => () => clearTimeout(closing.current), []);

  if (chapters.length < 2) return null;
  const at = Math.min(current, chapters.length - 1);
  const go = (c: Chapter) => {
    anchor(c.id)?.scrollIntoView({ behavior: quiet() ? "auto" : "smooth", block: "start" });
    setOpen(false);
  };
  const show = () => { clearTimeout(closing.current); setOpen(true); };
  const hide = () => { clearTimeout(closing.current); closing.current = window.setTimeout(() => setOpen(false), 180); };

  return (
    <div className="chapters-pin">
      <nav ref={root} className={`chapters ${open ? "open" : ""}`} aria-label="Chapters" onMouseEnter={show} onMouseLeave={hide}>
        <button type="button" className="chapters-rail" aria-expanded={open} aria-label={`Chapters. Now reading: ${chapters[at].title}`} onClick={() => setOpen((o) => !o)}>
          {chapters.map((c, i) => <span key={c.id} className={i === at ? "on" : ""} />)}
        </button>
        {open && (
          <ol className="chapters-list">
            {chapters.map((c, i) => (
              <li key={c.id}>
                <button type="button" className={i === at ? "on" : ""} aria-current={i === at ? "true" : undefined} onClick={() => go(c)}>
                  <span className="chapters-dash" aria-hidden="true" />
                  <span className="chapters-name">{c.title}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </nav>
    </div>
  );
}
