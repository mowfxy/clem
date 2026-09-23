import { useEffect, useRef } from "react";

// Four authored ribbons share the six-Bezier contour of a Mowr petal.
// They cross, collect into the mark, hold, then open back into loose ink.
const petal = [
  64, 11, 87, 4, 104, 20, 103, 42, 103, 57, 94, 70, 84, 72, 78, 73, 79, 65, 81,
  61, 85, 48, 75, 43, 65, 48, 55, 52, 49, 43, 49, 31, 49, 22, 54, 15, 64, 11,
];
const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
const mix = (a: number[], b: number[], t: number) =>
  a.map((n, i) => n + (b[i] - n) * smooth(t));
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
  const usable = Math.max(24, width - 14),
    center = usable / 2;
  const direction = i % 2 ? -1 : 1;
  const loose = ribbon(
    3,
    usable - 3,
    7 + i * 3,
    (i % 2 ? -1 : 1) * 2.5,
    0.85 + i * 0.12,
  );
  const weave = ribbon(
    center - usable * 0.36,
    center + usable * 0.36,
    9 + i * 1.7,
    (i % 2 ? -1 : 1) * 6,
    1.45,
  );
  if (direction < 0)
    for (let j = 0; j < loose.length; j += 2) {
      loose[j] = usable - loose[j];
      weave[j] = usable - weave[j];
    }
  const angle = (i * Math.PI) / 2,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const mark = petal.map((n, j) => {
    const x = (petal[j - (j % 2)] - 72) * 0.145,
      y = (petal[j - (j % 2) + 1] - 72) * 0.145;
    return j % 2 ? 12 + x * s + y * c : center + x * c - y * s;
  });
  return { loose, weave, mark };
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
      paths.forEach((p, i) => p.setAttribute("d", path(artwork[i].mark)));
      svg.dataset.phase = "resolved";
    };
    const paint = (ms: number) => {
      const t = ms % 7200;
      svg.dataset.phase =
        t < 1800
          ? "weaving"
          : t < 3300
            ? "gathering"
            : t < 4750
              ? "resolved"
              : "unfolding";
      paths.forEach((p, i) => {
        const { loose, weave, mark } = artwork[i];
        // Paired strands lead; the other pair joins after the crossing clears.
        const delay = [0, 110, 290, 200][i];
        const d =
          t < 1800
            ? mix(loose, weave, (t - 250 - delay) / 1300)
            : t < 3300
              ? mix(weave, mark, (t - 1800 - delay) / 1100)
              : t < 4750
                ? mark
                : t < 5950
                  ? mix(mark, weave, (t - 4750 - delay) / 850)
                  : mix(weave, loose, (t - 5950) / 1050);
        p.setAttribute("d", path(d));
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
        <path key={i} d={path(poses(100, i).mark)} />
      ))}
    </svg>
  );
}
