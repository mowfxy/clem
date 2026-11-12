// Home ⇄ main thread (docs/MAIN-THREAD.md "Home to thread"): home's message box grows into the thread's while the
// thread rises in and home's widgets recede; back to home reverses it. The View Transitions API carries the composer
// (view-transition-name while it runs, src/main-thread/main-thread.css), and its group pseudo-element has the glass's
// own backdrop-filter, so the glass is never a flat snapshot. Without the API the composer itself is FLIPped: the glass
// element moves, no parent of it fades. Reduced motion or a quieter workspace: the swap is instant.
import { flushSync } from "react-dom";
import { flipFrom, MORPH_MS, morphMode } from "../../core/main-thread/home";

type VT = { finished: Promise<void>; ready: Promise<void>; skipTransition(): void };
let running: VT | null = null;
const EASE = "cubic-bezier(.2,.8,.2,1)";

export function currentMorph() {
  const doc = document as Document & { startViewTransition?: (update: () => void) => VT };
  return morphMode({ reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, quiet: document.documentElement.dataset.quiet === "true", viewTransitions: typeof doc.startViewTransition === "function" });
}

/** Runs `update` (a React state change) as the morph `to` the thread ("in") or home ("out"). */
export function morph(to: "in" | "out", update: () => void) {
  const mode = currentMorph(), root = document.documentElement;
  running?.skipTransition();
  if (mode === "instant") { update(); return; }
  if (mode === "view-transition") {
    root.dataset.morph = to;
    const vt = (document as Document & { startViewTransition: (u: () => void) => VT }).startViewTransition(() => flushSync(update));
    running = vt;
    void vt.finished.catch(() => {}).finally(() => { if (running === vt) { running = null; delete root.dataset.morph; } });
    return;
  }
  // FLIP: the new composer starts where the old one was and slides home; the content only moves (opacity would turn
  // its glass flat while it runs).
  const before = document.querySelector(".composer")?.getBoundingClientRect();
  flushSync(update);
  const box = document.querySelector<HTMLElement>(".composer"), after = box?.getBoundingClientRect();
  const opts = { duration: MORPH_MS, easing: EASE };
  if (box && before && after) box.animate([{ transform: flipFrom(before, after), transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], opts);
  document.querySelector<HTMLElement>(to === "in" ? ".main-thread-list,.main-thread-empty" : ".new-chat-content > :not(.composer)")
    ?.animate([{ transform: `translateY(${to === "in" ? 16 : 12}px)` }, { transform: "none" }], opts);
}
