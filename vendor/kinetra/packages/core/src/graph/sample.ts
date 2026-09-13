/** Sampling helpers for plot specifications. */

import { evaluate, sample1d } from "../math/eval.js";
import { sampleParametric } from "../math/eval.js";
import type { PlotSpec } from "./spec.js";
import type { DataPoint } from "./spec.js";
import type { Expr } from "../math/expression.js";

export function samplePlot(spec: PlotSpec, steps = 400): { x: number; y: number }[] {
  switch (spec.type) {
    case "function2d":
    case "piecewise2d": {
      if (!spec.functions || spec.functions.length === 0) return [];
      const out: { x: number; y: number }[] = [];
      const [xmin, xmax] = spec.xRange;
      for (let i = 0; i < steps; i++) {
        const x = xmin + (xmax - xmin) * (i / (steps - 1));
        // For multi-function plots, only return the first function here. Use sampleMulti for multi.
        let y: number;
        try { y = evaluate(spec.functions[0].expression, { vars: { x } }); } catch { y = NaN; }
        out.push({ x, y });
      }
      return out;
    }
    case "parametric2d": {
      if (!spec.parametric) return [];
      const [tmin, tmax] = spec.parametric.tRange;
      const xs = sample1d(spec.parametric.x, spec.parametric.var, tmin, tmax, steps);
      const ys = sample1d(spec.parametric.y, spec.parametric.var, tmin, tmax, steps);
      return xs.map((p, i) => ({ x: p.y, y: ys[i].y }));
    }
    case "scatter":
    case "histogram":
      return (spec.data ?? []).map((p: DataPoint) => ({ x: p.x, y: p.y }));
    case "complex": {
      if (!spec.functions || spec.functions.length === 0) return [];
      const out: { x: number; y: number }[] = [];
      const [xmin, xmax] = spec.xRange;
      for (let i = 0; i < steps; i++) {
        const x = xmin + (xmax - xmin) * (i / (steps - 1));
        const re = evaluate(spec.functions[0].expression, { vars: { x } });
        out.push({ x: re, y: 0 });
      }
      return out;
    }
    default:
      return [];
  }
}

/** Sample multiple functions for overlay plots. */
export function sampleMulti(spec: PlotSpec, steps = 400): { x: number; series: { y: number; label: string; color?: string }[] }[] {
  if (!spec.functions) return [];
  const [xmin, xmax] = spec.xRange;
  const out: { x: number; series: { y: number; label: string; color?: string }[] }[] = [];
  for (let i = 0; i < steps; i++) {
    const x = xmin + (xmax - xmin) * (i / (steps - 1));
    const row = { x, series: spec.functions.map((f) => {
      let y: number;
      try { y = evaluate(f.expression, { vars: { x } }); } catch { y = NaN; }
      return { y, label: f.label, color: f.color };
    }) };
    out.push(row);
  }
  return out;
}
