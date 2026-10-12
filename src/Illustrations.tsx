import { useEffect, useId, useRef } from "react";
import { animated, filmFrame, type Scene } from "./vectorFilm";
export function Illustration({
  scene,
  className = "",
  viewBox = "0 0 480 390",
}: {
  scene: Scene;
  className?: string;
  /** Crops the 480×390 stage, e.g. to show one prop at a small size. */
  viewBox?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = "film-" + useId().replace(/[^a-z0-9]/gi, "");
  useEffect(() => {
    const el = ref.current!,
      svg = el.querySelector("svg")!,
      media = matchMedia("(prefers-reduced-motion: reduce)");
    const paint = (seconds: number) => {
      svg.innerHTML = filmFrame(scene, seconds, id);
    };
    paint(0);
    // The first frame is the finished pose; a scene without a loop stays on it.
    if (!animated.has(scene)) return;
    let timer = 0,
      last = 0,
      elapsed = 0,
      lastCel = 0,
      visible = false;
    const quiet = () =>
      media.matches || document.documentElement.dataset.quiet === "true";
    const stop = () => {
      clearTimeout(timer);
      timer = 0;
      last = 0;
    };
    // Drawn on twos: twelve drawings a second, like hand animation. Each drawing is scheduled for when it is due
    // rather than checked for on every display frame (120 a second on a fast screen), and lands on the same frame.
    const tick = () => {
      const now = performance.now();
      if (last) elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      const cel = Math.floor(elapsed * 12);
      if (cel !== lastCel) {
        paint(cel / 12);
        lastCel = cel;
      }
      timer = window.setTimeout(tick, Math.max(1, ((cel + 1) / 12 - elapsed) * 1000));
    };
    const sync = () => {
      stop();
      if (quiet()) {
        paint(0);
        return;
      }
      if (visible && !document.hidden) timer = window.setTimeout(tick, 0);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0].isIntersecting;
        sync();
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    const mutation = new MutationObserver(sync);
    mutation.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-quiet"],
    });
    document.addEventListener("visibilitychange", sync);
    media.addEventListener("change", sync);
    return () => {
      stop();
      observer.disconnect();
      mutation.disconnect();
      document.removeEventListener("visibilitychange", sync);
      media.removeEventListener("change", sync);
    };
  }, [scene, id]);
  return (
    <div ref={ref} className={`ink-scene ink-${scene} ${className}`}>
      <svg viewBox={viewBox} aria-hidden="true" />
    </div>
  );
}
