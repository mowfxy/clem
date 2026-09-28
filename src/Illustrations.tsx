import { useEffect, useId, useRef } from "react";
import { filmFrame, type Scene } from "./vectorFilm";
export function Illustration({
  scene,
  className = "",
  ambient = false,
  still = false,
  viewBox = "0 0 480 390",
}: {
  scene: Scene;
  className?: string;
  /** Kept for callers; every scene now plays its entrance on first view and then loops. */
  ambient?: boolean;
  /** Holds the finished drawing in place; only its lines keep boiling. */
  still?: boolean;
  /** Crops the 480×390 stage, e.g. to show one prop at a small size. */
  viewBox?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = "film-" + useId().replace(/[^a-z0-9]/gi, "");
  useEffect(() => {
    const el = ref.current!,
      svg = el.querySelector("svg")!,
      media = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0,
      last = 0,
      elapsed = 0,
      lastCel = -1,
      visible = false;
    const quiet = () =>
      media.matches || document.documentElement.dataset.quiet === "true";
    const paint = (seconds: number) => {
      // Each scene is a short film: its entrance plays the first time it is seen, then its loop runs.
      // A still scene stays on the finished drawing; only its line boil advances.
      const time = still ? 6 : seconds;
      svg.innerHTML = filmFrame(scene, time, id, still ? seconds : null);
      svg.dataset.frame = seconds.toFixed(2);
      svg.dataset.phase = seconds < 6 ? "action" : "idle";
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    };
    const tick = (now: number) => {
      if (last) elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      // 24 frames a second, like film.
      const cel = Math.floor(elapsed * 24);
      if (cel !== lastCel) {
        paint(cel / 24);
        lastCel = cel;
      }
      raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      stop();
      if (quiet()) {
        paint(6);
        return;
      }
      if (visible && !document.hidden) raf = requestAnimationFrame(tick);
    };
    // Motion allowed: start on the film's first frame, so its entrance plays from the beginning when seen.
    paint(quiet() || still ? 6 : 0);
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
  }, [scene, id, ambient, still]);
  return (
    <div ref={ref} className={`ink-scene ink-${scene} ${className}`}>
      <svg viewBox={viewBox} aria-hidden="true" />
    </div>
  );
}
