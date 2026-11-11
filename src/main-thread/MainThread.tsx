import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Chat, Message } from "../../core/types";

/** Messages per page: the newest page shows at once, older pages join as the person scrolls up. */
export const PAGE = 30;
const ESTIMATE = 180;

/** The element the conversation scrolls in (the workspace on the desktop), as useChatScroll finds it. */
function scrollerOf(node: Element | null): HTMLElement | null {
  for (let el = node?.parentElement; el; el = el.parentElement) if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/**
 * The main thread: one conversation that never ends, so only the rows near the view are in the page. It renders from
 * the saved workspace on the first frame (no loading step, no blank flash) starting at the newest page; `render` is the
 * same message rendering every chat uses. Digests (core/main-thread/fold.ts) are context, never shown.
 */
export function MainThread({ chat, render, listRef }: { chat: Chat; render: (m: Message, index: number) => ReactNode; listRef: RefObject<HTMLDivElement | null> }) {
  const visible = useMemo(() => chat.messages.flatMap((m, i) => (m.digest ? [] : [{ m, i }])), [chat.messages]);
  const [shown, setShown] = useState(PAGE);
  const rows = visible.slice(Math.max(0, visible.length - shown));
  const scroller = useRef<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const list = listRef.current, el = (scroller.current = scrollerOf(list));
    if (list && el) setMargin(Math.round(list.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop));
  }, [chat.id]);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ESTIMATE,
    getItemKey: (index) => rows[index].m.id,
    overscan: 6,
    scrollMargin: margin,
    // The first frame already lays out the newest rows, before the scroller is measured.
    initialRect: { width: 800, height: typeof window === "undefined" ? 900 : window.innerHeight },
    initialOffset: () => margin + Math.max(0, rows.length * ESTIMATE - (typeof window === "undefined" ? 900 : window.innerHeight)),
  });
  // Near the top, the next older page joins above, and the view stays on the message the person was reading.
  const anchor = useRef<{ total: number; top: number } | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target: HTMLElement | Window = el === document.scrollingElement ? window : el;
    const onScroll = () => {
      if (anchor.current || el.scrollTop - margin > 600 || shown >= visible.length) return;
      anchor.current = { total: virtual.getTotalSize(), top: el.scrollTop };
      setShown((n) => n + PAGE);
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [margin, shown, visible.length, virtual]);
  useLayoutEffect(() => {
    const was = anchor.current, el = scroller.current;
    if (!was || !el) return;
    anchor.current = null;
    el.scrollTop = was.top + (virtual.getTotalSize() - was.total);
  }, [shown]);
  return (
    <div className="messages main-thread-list" ref={listRef} style={{ height: virtual.getTotalSize(), position: "relative" }} aria-label="Main thread" data-older={visible.length - rows.length}>
      {virtual.getVirtualItems().map((item) => {
        const { m, i } = rows[item.index];
        return <div key={item.key} data-index={item.index} ref={virtual.measureElement} className="mt-row" style={{ transform: `translateY(${item.start - margin}px)` }}>{render(m, i)}</div>;
      })}
    </div>
  );
}
