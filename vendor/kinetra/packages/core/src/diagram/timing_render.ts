/**
 * Timing diagram renderer. Takes a list of signal transitions and renders
 * square waves, including clock signals, annotations, and intervals.
 */

import { createArtifact, withRendering } from "../artifacts.js";
import { el, line, renderSvg, text } from "./primitives.js";
import type { Color, SvgElement } from "./primitives.js";
import type { LogicValue, TimingSpec } from "../dld/timing.js";

export interface TimingRenderOptions {
  width: number;
  height: number;
  title?: string;
  /** Time range (defaults to [0, max transition]). */
  tMin?: number; tMax?: number;
  /** Pixel scale per second; defaults to width / (tMax - tMin) * 0.95. */
  pxPerUnit?: number;
}

export function renderTimingDiagram(spec: TimingSpec, opts: TimingRenderOptions): string {
  if (![opts.width,opts.height,spec.duration].every(n=>Number.isFinite(n)&&n>0)) throw new Error("Timing: viewport and duration must be positive and finite");
  if(new Set(spec.signals).size!==spec.signals.length)throw new Error("Timing: duplicate signal names");
  for(const tr of spec.transitions)if(!Number.isFinite(tr.time)||tr.time<0||tr.time>spec.duration||!spec.signals.includes(tr.signal)||![0,1,"X","Z"].includes(tr.to))throw new Error("Timing: invalid transition");
  const signals = spec.signals.map(name=>({name,initial:0 as LogicValue,transitions:spec.transitions.filter(tr=>tr.signal===name).map(tr=>({t:tr.time,value:tr.to}))}));
  if (signals.length === 0) return renderSvg(el("g", {}, []), { viewBox: `0 0 ${opts.width} ${opts.height}`, width: opts.width, height: opts.height });
  const tMin = opts.tMin ?? 0;
  const tMax = opts.tMax ?? spec.duration;
  if(![tMin,tMax].every(Number.isFinite)||tMin<0||tMax<=tMin||tMax>spec.duration)throw new Error("Timing: invalid time interval");
  const left=Math.max(50,...spec.signals.map(name=>name.length*7+16));
  const innerW = opts.width - left - 16;
  const innerH = opts.height - 70;
  if(innerW<=0 || innerH<signals.length*24)throw new Error("Timing: viewport too small for tracks");
  const trackH = innerH / signals.length;
  const timeScale=opts.pxPerUnit ?? innerW/(tMax-tMin);
  if(!Number.isFinite(timeScale)||timeScale<=0||timeScale*(tMax-tMin)>innerW)throw new Error("Timing: pxPerUnit must fit the viewport");
  const px = (t: number) => left+(t-tMin)*timeScale;
  const out: SvgElement[] = [];
  if (opts.title) out.push(text(opts.width / 2, 18, opts.title, "#222", 14, "middle"));
  // Time grid (5 vertical divisions)
  const divisions = 8;
  for (let i = 0; i <= divisions; i++) {
    const t = tMin + (i / divisions) * (tMax - tMin);
    const x = px(t);
    out.push(line(x, 40, x, opts.height - 30, "#eee", 1));
    out.push(text(x, opts.height - 12, t.toFixed(2), "#666", 9, "middle"));
  }
  // Signal labels and waveforms
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    const y = 40 + i * trackH + trackH / 2;
    out.push(text(8, y + 4, s.name, "#222", 11, "start"));
    // baseline
    out.push(line(left, y + trackH / 2 - 4, px(tMax), y + trackH / 2 - 4, "#f8f8f8", 1));
    let cur: LogicValue = s.initial ?? 0;
    let curT = tMin;
    const sorted = [...s.transitions].sort((a, b) => a.t - b.t);
    const drawSegment = (t0: number, t1: number, value: LogicValue) => {
      if (t1 <= t0) return;
      const x0 = px(t0);
      const x1 = px(t1);
      const hi = y - trackH * 0.3;
      const lo = y + trackH * 0.3;
      const lvl = value === 1 ? hi : value === 0 ? lo : (hi + lo) / 2;
      const wave=line(x0,lvl,x1,lvl,"#222",1.6,value==="Z" ? "4 3":undefined);
      wave.attrs["data-signal"]=s.name;wave.attrs["data-value"]=String(value);
      out.push(wave);
      if(value==="X"||value==="Z")out.push(text((x0+x1)/2,lvl-5,value,"#555",10,"middle"));
    };
    for (const tr of sorted) {
      if(tr.t<=tMin){cur=tr.value;continue;}
      if(tr.t>=tMax)break;
      drawSegment(curT, tr.t, cur);
      const before=cur;
      cur = tr.value;
      curT = tr.t;
      // Vertical edge
      const hi = y - trackH * 0.3;
      const lo = y + trackH * 0.3;
      const x = px(tr.t);
      const level=(value:LogicValue)=>value===1?hi:value===0?lo:(hi+lo)/2;
      if(before!==cur)out.push(line(x,level(before),x,level(cur),"#222",1.6));
    }
    drawSegment(curT, tMax, cur);
  }
  // Annotations
  for (const a of spec.annotations) {
    if(!Number.isFinite(a.time))throw new Error("Timing: annotation time must be finite");
    if(a.time<tMin||a.time>tMax)continue;
    const x = px(a.time);
    out.push(line(x, 40, x, opts.height - 30,"#c0392b", 1, "3 3"));
    out.push(text(x, 32, a.text,"#c0392b", 10, "middle"));
  }
  const root = el("g", {}, out);
  return renderSvg(root, { viewBox: `0 0 ${opts.width} ${opts.height}`, width: opts.width, height: opts.height, background: "#fff" });
}

export function timingArtifact(spec: TimingSpec, opts: TimingRenderOptions, title = "Timing diagram"): ReturnType<typeof createArtifact<"timing-diagram", TimingSpec>> {
  const a = createArtifact({ kind: "timing-diagram", title, model: spec });
  return withRendering(a, "svg", { format: "svg", content: renderTimingDiagram(spec, opts), contentType: "image/svg+xml" });
}
