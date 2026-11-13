// Home ⇄ main thread (docs/MAIN-THREAD.md "Home to thread"): home's message box glides into the thread's while the
// thread rises in and home's widgets recede; back to home reverses it. The View Transitions API carries the composer
// (view-transition-name while it runs, src/main-thread/main-thread.css). The group pseudo-element *is* the glass while
// the box is in flight: it paints the composer's surface and live backdrop blur at every size, and the snapshots hold
// only the contents, so nothing is stretched or doubled. Without the API the composer itself is FLIPped: the glass
// element moves, no parent of it fades. Reduced motion or a quieter workspace: the swap is instant.
import { flushSync } from "react-dom";
import { flipFrom, MORPH_EASE, MORPH_MS, morphMode } from "../../core/main-thread/home";

type VT = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void>; skipTransition(): void };
let running: VT | null = null;

export function currentMorph() {
  const doc = document as Document & { startViewTransition?: (update: () => void) => VT };
  return morphMode({ reduced: matchMedia("(prefers-reduced-motion: reduce)").matches, quiet: document.documentElement.dataset.quiet === "true", viewTransitions: typeof doc.startViewTransition === "function" });
}

/** Right after the new view is in the DOM: the morph is its entrance, so the entrances its parts would play on their
 *  own (home's widgets, a message's mark) are finished at once instead of starting under the morph and running on after
 *  it; the window's frost follows the glide's own length and curve; and a caret that was in the box stays in the box
 *  (the box is a new element there, and keys typed before a later focus would be lost). */
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

function done(vt: VT) {
  if (running !== vt) return;
  running = null;
  const root = document.documentElement;
  delete root.dataset.morph; delete root.dataset.morphSurface; delete root.dataset.morphFocus;
}

/** Runs `update` (a React state change) as the morph `to` the thread ("in") or home ("out"). */
export function morph(to: "in" | "out", update: () => void) {
  const mode = currentMorph(), root = document.documentElement;
  running?.skipTransition();
  // Going in from a box that has the caret keeps it there; Home never takes it (focusing home's box opens the thread).
  const keepCaret = to === "in" && !!document.activeElement?.closest(".composer");
  if (mode === "instant") { update(); return; }
  if (mode === "view-transition") {
    root.dataset.morph = to; root.dataset.morphSurface = "group";
    if (keepCaret) root.dataset.morphFocus = ""; else delete root.dataset.morphFocus;
    const vt = (document as Document & { startViewTransition: (u: () => void) => VT }).startViewTransition(() => { flushSync(update); arrived(keepCaret); });
    running = vt;
    // When the glide lands, the real composer takes its surface back while the transition is still showing: its live
    // snapshot and the group then look exactly like the box will once the transition lets go. (An animation's finished
    // promise settles before that frame is drawn; the transition's own does not.)
    void vt.ready.then(() => {
      const glide = document.getAnimations().find((a) => (a.effect as KeyframeEffect | null)?.pseudoElement === "::view-transition-group(clem-composer)");
      const live = () => { if (running === vt) root.dataset.morphSurface = "live"; };
      if (glide) void glide.finished.then(live, live); else live();
    }, () => done(vt));
    void vt.finished.catch(() => {}).finally(() => done(vt));
    return;
  }
  // FLIP: the new composer starts where the old one was and slides home; the content only moves (opacity would turn
  // its glass flat while it runs).
  const before = document.querySelector(".composer")?.getBoundingClientRect();
  flushSync(update);
  arrived(keepCaret);
  const box = document.querySelector<HTMLElement>(".composer"), after = box?.getBoundingClientRect();
  const opts = { duration: MORPH_MS, easing: MORPH_EASE };
  if (box && before && after) box.animate([{ transform: flipFrom(before, after), transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], opts);
  document.querySelector<HTMLElement>(to === "in" ? ".main-thread-list,.main-thread-empty" : ".new-chat-content > :not(.composer)")
    ?.animate([{ transform: `translateY(${to === "in" ? 16 : 12}px)` }, { transform: "none" }], opts);
}
