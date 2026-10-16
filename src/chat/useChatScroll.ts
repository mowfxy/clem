import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** How close to the end counts as "at the latest message", in pixels. */
const NEAR_END = 96;

/** The element the conversation scrolls in: the workspace on the desktop, the page in a browser. */
function scrollerOf(node: Element | null): HTMLElement | null {
  if (!node) return null;
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (/(auto|scroll)/.test(overflow)) return el;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

const quiet = () =>
  document.documentElement.dataset.quiet === "true" || matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Keeps a conversation where the person expects it: a chat opens at its latest message, a sent message brings the
 * view to the end, and a streaming answer is followed while the person stays at the end. Scrolling up to read stops
 * the following until they come back down or press "Jump to latest" (`away` says when to offer it).
 */
export function useChatScroll(chatId: string | null, messageCount: number, lastQuestion: string | undefined) {
  const messages = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  // Until this time a smooth scroll to the end is under way: its in-between positions are not the person scrolling up.
  const settling = useRef(0);
  const [away, setAway] = useState(false);

  const toEnd = useCallback((smooth = false) => {
    const el = scrollerOf(messages.current);
    if (!el) return;
    follow.current = true;
    setAway(false);
    const glide = smooth && !quiet();
    settling.current = glide ? performance.now() + 1500 : 0;
    el.scrollTo({ top: el.scrollHeight, behavior: glide ? "smooth" : "auto" });
    if (!glide) return;
    // The glide aims at the end as it was when it started; content that grew meanwhile (a streaming answer) is caught
    // up with when it comes to rest (or after a moment, where scrollend is not supported).
    const target: HTMLElement | Window = el === document.scrollingElement ? window : el;
    let done = false;
    const land = () => {
      if (done) return;
      done = true;
      target.removeEventListener("scrollend", land);
      settling.current = 0;
      follow.current = true;
      setAway(false);
      el.scrollTop = el.scrollHeight;
    };
    target.addEventListener("scrollend", land, { once: true });
    setTimeout(land, 1500);
  }, []);

  // Watching the scroller: whether the person is at the end decides whether the answer is followed.
  useEffect(() => {
    const el = scrollerOf(messages.current);
    if (!el) return;
    const target: HTMLElement | Window = el === document.scrollingElement ? window : el;
    const onScroll = () => {
      if (performance.now() < settling.current) return;
      const end = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END;
      follow.current = end;
      setAway((was) => (was === !end ? was : !end));
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [chatId, messageCount > 0]);

  // Growing content (a streamed answer, a picture that loads, a visual that draws) stays in view while followed.
  useEffect(() => {
    const list = messages.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!follow.current) return;
      const el = scrollerOf(list);
      if (!el) return;
      // During a glide to the end the glide carries on; the end it aims for is caught up with when it finishes.
      if (performance.now() >= settling.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [chatId, messageCount > 0]);

  // A chat opens at its latest message.
  useLayoutEffect(() => {
    follow.current = true;
    setAway(false);
    const el = scrollerOf(messages.current);
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatId]);

  // The person's own message (a new one, a retry or an edit) always brings the view down to it.
  const seen = useRef({ chatId, lastQuestion });
  useEffect(() => {
    const before = seen.current;
    seen.current = { chatId, lastQuestion };
    if (before.chatId === chatId && lastQuestion && lastQuestion !== before.lastQuestion) toEnd(true);
  }, [chatId, lastQuestion, toEnd]);

  return { messages, away, toEnd };
}
