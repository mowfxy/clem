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
      // Ambient scenes open on the finished drawing and run its idle loop forward from there.
      // A still scene stays on that drawing, and only its line boil advances.
      const time = still ? 6 : ambient ? 6 + seconds : seconds;
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
      // Drawn on twos: 12 cels a second gives the stepped, hand-animated feel.
      const cel = Math.floor(elapsed * 12);
      if (cel !== lastCel) {
        paint(cel / 12);
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
    paint(6);
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
