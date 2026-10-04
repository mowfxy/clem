import { useEffect, useRef, useState, type ReactNode } from "react";

/** A fixed-size drawing (a slide, a page) scaled to the width its container allows, keeping its proportions. */
export function Scaled({ width, height, className, children, max = 1.6 }: { width: number; height: number; className?: string; children: ReactNode; max?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(max, (el.clientWidth || width) / width));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, [width, max]);
  return <div ref={box} className={className} style={{ width: "100%", maxWidth: width * max, height: height * scale, position: "relative", overflow: "hidden" }}>
    <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "0 0", position: "absolute", left: 0, top: 0 }}>{children}</div>
  </div>;
}
