// Home ⇄ main thread (docs/MAIN-THREAD.md "Home to thread"): the two views crossfade, nothing flies. The swap runs
// inside a view transition with only the root snapshotted (src/main-thread/main-thread.css), so every glass surface is
// captured with its blur in it and the browser's own crossfade blends old into new without a dip. Reduced motion, a
// quieter workspace or no View Transitions API: the swap is instant.
import { flushSync } from "react-dom";
import { MORPH_EASE, MORPH_MS, morphMode } from "../../core/main-thread/home";

type VT = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void>; skipTransition(): void };
let running: VT | null = null;

export function currentMorph() {
  const doc = document as Document & { startViewTransition?: (update: () => void) => VT };
  return morphMode({ reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, quiet: document.documentElement.dataset.quiet === "true", viewTransitions: typeof doc.startViewTransition === "function" });
}

/** Right after the new view is in the DOM: the crossfade is its entrance, so the entrances its parts would play on their
 *  own (home's widgets, a message's mark) are finished at once instead of replaying under and after it; the window's
 *  frost follows the fade's length and curve; and a caret that was in the box stays in the box (the box is a new element
 *  there, and keys typed before a later focus would be lost). */
function arrived(keepCaret: boolean) {
  for (const a of document.getAnimations()) {
    const target = (a.effect as KeyframeEffect | null)?.target as Element | null | undefined;
    if (!target) continue;
    if ("animationName" in a && target.closest(".workspace") && (a.currentTime === null || Number(a.currentTime) < 34) && Number.isFinite(a.effect?.getTiming().iterations ?? 1)) a.finish();
    else if ("transitionProperty" in a && target.classList.contains("glass-pane")) a.effect?.updateTiming({ duration: MORPH_MS, easing: MORPH_EASE });
  }
  if (!keepCaret) return;
  const box = document.querySelector<HTMLTextAreaElement>(".composer textarea");
  if (box && document.activeElement !== box) { box.focus({ preventScroll: true }); box.setSelectionRange(box.value.length, box.value.length); }
}

/** Runs `update` (a React state change) as the move `to` the thread ("in") or home ("out"). */
export function morph(to: "in" | "out", update: () => void) {
  const root = document.documentElement;
  running?.skipTransition();
  // Going in from a box that has the caret keeps it there; Home never takes it (focusing home's box opens the thread).
  const keepCaret = to === "in" && !!document.activeElement?.closest(".composer");
  if (currentMorph() === "instant") { update(); return; }
  root.dataset.morph = to;
  const vt = (document as Document & { startViewTransition: (u: () => void) => VT }).startViewTransition(() => { flushSync(update); arrived(keepCaret); });
  running = vt;
  void vt.finished.catch(() => {}).finally(() => { if (running === vt) { running = null; delete root.dataset.morph; } });
}
