import {desktop} from "./bridge";

/** Keeps Windows' minimise/maximise/close buttons in step with the page: its theme, and dimmed while a pop-up blurs the app. */
export function followWindowTone() {
  if (!desktop?.setWindowTone) return;
  let last = "", queued = false;
  const tone = () => {
    const dim = !!document.querySelector("dialog:modal, .fp-backdrop");
    return document.documentElement.dataset.theme === "light" ? (dim ? "light-dim" : "light") : dim ? "dim" : "normal";
  };
  const update = () => {
    queued = false;
    const next = tone();
    if (next !== last) { last = next; desktop!.setWindowTone!(next); }
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(update); } })
    .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open", "class"] });
  addEventListener("clem-theme", update);
  update();
}
