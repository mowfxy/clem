import { useEffect, useRef } from "react";

// Four tapered ink ribbons continuously pass a bend along the selected fill.
const path = (p: number[]) =>
  `M${p.slice(0, 2).join(" ")} ${Array.from(
    { length: 6 },
    (_, i) =>
      `C${p
        .slice(2 + i * 6, 8 + i * 6)
        .map((n) => n.toFixed(2))
        .join(" ")}`,
  ).join(" ")}Z`;
function ribbon(a: number, b: number, y: number, bend: number, weight: number) {
  const l = b - a;
  return [
    a,
    y,
    a + l * 0.15,
    y - bend * 0.3,
    a + l * 0.28,
    y - bend,
    a + l * 0.4,
    y - bend,
    a + l * 0.58,
    y - bend,
    a + l * 0.63,
    y + bend * 0.7,
    a + l * 0.76,
    y + bend * 0.65,
    a + l * 0.87,
    y + bend * 0.6,
    b - weight,
    y,
    b,
    y,
    b - weight,
    y + weight,
    a + l * 0.86,
    y + bend * 0.65 + weight,
    a + l * 0.76,
    y + bend * 0.65 + weight,
    a + l * 0.56,
    y + bend * 0.7 + weight,
    a + l * 0.6,
    y - bend + weight,
    a + l * 0.4,
    y - bend + weight,
    a + l * 0.2,
    y - bend + weight,
    a + l * 0.07,
    y + weight,
    a,
    y,
  ];
}
function poses(width: number, i: number) {
  return {
    loose: ribbon(
      3,
      Math.max(24, width - 14) - 3,
      7 + i * 3,
      (i % 2 ? -1 : 1) * 2.5,
      0.85 + i * 0.12,
    ),
  };
}
export function ReasoningInk() {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current!,
      paths = Array.from(svg.querySelectorAll("path"));
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0,
      frame = 0,
      elapsed = 0,
      last = 0,
      drawn = -1,
      inView = true;
    let artwork = paths.map((_, i) => poses(100, i));
    const still = () => {
      paths.forEach((p, i) => p.setAttribute("d", path(artwork[i].loose)));
      svg.dataset.phase = "flow";
    };
    const paint = (ms: number) => {
      svg.dataset.phase = "flow";
      paths.forEach((p, i) => {
        const usable = Math.max(24, width - 14);
        const phase = (ms / 6200) * Math.PI * 2 - i * 0.65;
        // The shared swell travels left to right; staggered counter-curves
        // keep each strand distinct without collapsing the flowing silhouette.
        const contour = ribbon(
          3,
          usable - 3,
          7 + i * 3,
          Math.sin(phase) * 2.8 + Math.sin(phase * 0.5 + i * 0.4) * 0.5,
          0.8 + i * 0.1,
        );
        for (let j = 0; j < contour.length; j += 2) {
          const u = contour[j] / usable;
          if (u > 0.08 && u < 0.92)
            contour[j + 1] +=
              Math.sin(u * Math.PI * 2 - phase) * 1.4 * Math.sin(u * Math.PI);
        }
        p.setAttribute("d", path(contour));
      });
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    };
    const tick = (now: number) => {
      elapsed += last ? Math.min(now - last, 80) : 0;
      last = now;
      const cel = Math.floor(elapsed / 33.33);
      if (cel !== drawn) {
        paint(elapsed);
        drawn = cel;
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      stop();
      const quiet =
        reduced.matches || document.documentElement.dataset.quiet === "true";
      svg.dataset.motion =
        quiet || document.hidden || !inView || width < 36 ? "still" : "running";
      if (quiet) {
        still();
        return;
      }
      if (document.hidden || !inView || width < 36) return;
      frame = requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(() => {
      width = svg.getBoundingClientRect().width;
      svg.setAttribute("viewBox", `0 0 ${Math.max(width, 1)} 24`);
      artwork = paths.map((_, i) => poses(width, i));
      paint(elapsed);
      sync();
    });
    const intersection = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    const quietObserver = new MutationObserver(sync);
    resize.observe(svg);
    intersection.observe(svg);
    quietObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-quiet"],
    });
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", sync);
    return () => {
      stop();
      resize.disconnect();
      intersection.disconnect();
      quietObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", sync);
    };
  }, []);
  return (
    <svg
      ref={ref}
      className="reasoning-ink"
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 24"
    >
      {[0, 1, 2, 3].map((i) => (
        <path key={i} d={path(poses(100, i).loose)} />
      ))}
    </svg>
  );
}
