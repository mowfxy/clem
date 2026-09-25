import {desktop} from "./bridge";

/** Keeps Windows' minimise/maximise/close buttons in step with the page: dimmed while a pop-up blurs the app,
 *  matched to the viewer header while a file is full screen. */
export function followWindowTone() {
  if (!desktop?.setWindowTone) return;
  let last = "", queued = false;
  const tone = () =>
    document.querySelector(".file-panel.full") ? "full"
    : document.querySelector("dialog:modal, .fp-backdrop") ? "dim"
    : "normal";
  const update = () => {
    queued = false;
    const next = tone();
    if (next !== last) { last = next; desktop!.setWindowTone!(next); }
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(update); } })
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "class"] });
  update();
}
