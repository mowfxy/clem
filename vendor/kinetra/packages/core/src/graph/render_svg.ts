/**
 * Plot SVG renderer. Converts a PlotSpec + samples into a standalone SVG.
 *
 * The renderer is fully deterministic: given the same spec, the output is
 * byte-stable except for floating-point precision. No external charting
 * library is used.
 */

import type { PlotSpec } from "./spec.js";
import { sampleMulti, samplePlot } from "./sample.js";

export interface RenderOptions {
  width?: number;
  height?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  showAxes?: boolean;
  showGrid?: boolean;
  showLegend?: boolean;
  fontFamily?: string;
  fontSize?: number;
  background?: string;
}

const DEFAULT_PALETTE = ["#1565c0", "#c62828", "#2e7d32", "#6a1b9a", "#ef6c00", "#00838f", "#5d4037"];

export function renderPlotSvg(spec: PlotSpec, opts: RenderOptions = {}): string {
  const width = opts.width ?? spec.size?.width ?? 640;
  const height = opts.height ?? spec.size?.height ?? 400;
  const margin = opts.margin ?? { top: 20, right: 20, bottom: 50, left: 60 };
  const showAxes = opts.showAxes ?? true;
  const showGrid = opts.showGrid ?? true;
  const showLegend = opts.showLegend ?? spec.showLegend ?? true;
  const font = opts.fontFamily ?? "Inter, system-ui, sans-serif";
  const fontSize = opts.fontSize ?? 12;
  const bg = opts.background ?? "#ffffff";

  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // Compute scales.
  const xMin = spec.xRange[0];
  const xMax = spec.xRange[1];
  let yMin = spec.yRange?.[0] ?? Number.POSITIVE_INFINITY;
  let yMax = spec.yRange?.[1] ?? Number.NEGATIVE_INFINITY;
  const rows = spec.type === "function2d" || spec.type === "piecewise2d"
    ? sampleMulti(spec)
    : samplePlot(spec).map((p) => ({ x: p.x, series: [{ y: p.y, label: "" }] }));
  for (const r of rows) {
    for (const s of r.series) {
      if (Number.isFinite(s.y)) {
        if (s.y < yMin) yMin = s.y;
        if (s.y > yMax) yMax = s.y;
      }
    }
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
  if (yMin === yMax) { yMin -= 0.5; yMax += 0.5; }
  // Pad 5% top and bottom
  const pad = (yMax - yMin) * 0.05;
  yMin -= pad; yMax += pad;

  const xScale = (x: number) => margin.left + ((x - xMin) / (xMax - xMin)) * innerW;
  const yScale = (y: number) => margin.top + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

  const elements: string[] = [];

  if (bg) {
    elements.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>`);
  }
  elements.push(`<text x="${width / 2}" y="${margin.top / 2 + 4}" text-anchor="middle" font-family="${font}" font-size="${fontSize + 2}" font-weight="600" fill="#111">${escapeXml(spec.title)}</text>`);

  if (showGrid) {
    const gridLines: string[] = [];
    const xTicks = makeTicks(xMin, xMax, 8);
    for (const t of xTicks) {
      const x = xScale(t);
      gridLines.push(`<line x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(2)}" y2="${margin.top + innerH}" stroke="#eaeaea"/>`);
    }
    const yTicks = makeTicks(yMin, yMax, 6);
    for (const t of yTicks) {
      const y = yScale(t);
      gridLines.push(`<line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${margin.left + innerW}" y2="${y.toFixed(2)}" stroke="#eaeaea"/>`);
    }
    elements.push(...gridLines);
  }

  if (showAxes) {
    elements.push(`<line x1="${margin.left}" y1="${margin.top + innerH}" x2="${margin.left + innerW}" y2="${margin.top + innerH}" stroke="#222" stroke-width="1"/>`);
    elements.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + innerH}" stroke="#222" stroke-width="1"/>`);

    const xTicks = makeTicks(xMin, xMax, 8);
    for (const t of xTicks) {
      const x = xScale(t);
      elements.push(`<line x1="${x.toFixed(2)}" y1="${margin.top + innerH}" x2="${x.toFixed(2)}" y2="${margin.top + innerH + 4}" stroke="#222"/>`);
      elements.push(`<text x="${x.toFixed(2)}" y="${margin.top + innerH + 16}" font-size="${fontSize}" font-family="${font}" text-anchor="middle" fill="#333">${formatTick(t)}</text>`);
    }
    const yTicks = makeTicks(yMin, yMax, 6);
    for (const t of yTicks) {
      const y = yScale(t);
      elements.push(`<line x1="${margin.left - 4}" y1="${y.toFixed(2)}" x2="${margin.left}" y2="${y.toFixed(2)}" stroke="#222"/>`);
      elements.push(`<text x="${margin.left - 6}" y="${(y + 4).toFixed(2)}" font-size="${fontSize}" font-family="${font}" text-anchor="end" fill="#333">${formatTick(t)}</text>`);
    }
    if (spec.xAxis.label) {
      elements.push(`<text x="${margin.left + innerW / 2}" y="${height - 8}" text-anchor="middle" font-size="${fontSize}" font-family="${font}" fill="#222">${escapeXml(spec.xAxis.label)}</text>`);
    }
    if (spec.yAxis.label) {
      elements.push(`<text x="12" y="${margin.top + innerH / 2}" text-anchor="middle" font-size="${fontSize}" font-family="${font}" fill="#222" transform="rotate(-90 12 ${margin.top + innerH / 2})">${escapeXml(spec.yAxis.label)}</text>`);
    }
  }

  // Draw series.
  const numSeries = rows[0]?.series.length ?? 0;
  for (let s = 0; s < numSeries; s++) {
    const color = DEFAULT_PALETTE[s % DEFAULT_PALETTE.length];
    const path: string[] = [];
    let started = false;
    for (const r of rows) {
      const yv = r.series[s]?.y;
      if (yv === undefined || !Number.isFinite(yv)) {
        if (started) path.push("Z");
        started = false;
        continue;
      }
      const x = xScale(r.x);
      const y = yScale(yv);
      path.push(`${started ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`);
      started = true;
    }
    if (started) path.push("Z");
    if (path.length > 0) {
      elements.push(`<path d="${path.join(" ")}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>`);
    }
  }

  if (showLegend && spec.functions && spec.functions.length > 1) {
    const items = spec.functions.map((f, i) => ({ label: f.label, color: DEFAULT_PALETTE[i % DEFAULT_PALETTE.length] }));
    const lx = margin.left + innerW - 160;
    const ly = margin.top + 10;
    elements.push(`<rect x="${lx - 8}" y="${ly - 8}" width="160" height="${items.length * 18 + 12}" fill="rgba(255,255,255,0.85)" stroke="#ccc"/>`);
    items.forEach((it, i) => {
      const y = ly + i * 18;
      elements.push(`<rect x="${lx}" y="${y}" width="12" height="3" y="${y + 4}" fill="${it.color}"/>`);
      elements.push(`<text x="${lx + 20}" y="${y + 8}" font-size="${fontSize}" font-family="${font}" fill="#222">${escapeXml(it.label)}</text>`);
    });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n${elements.join("\n")}\n</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function makeTicks(min: number, max: number, count: number): number[] {
  const range = max - min;
  const rawStep = range / (count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
  const step = Math.ceil(rawStep / mag) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) {
    out.push(Number(v.toFixed(10)));
  }
  return out;
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1e4 || (Math.abs(v) > 0 && Math.abs(v) < 1e-3)) return v.toExponential(2);
  return Number(v.toFixed(4)).toString();
}
