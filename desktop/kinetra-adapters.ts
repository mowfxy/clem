import { parseExpr } from "../vendor/kinetra/packages/core/src/math/expression";
import { evaluate } from "../vendor/kinetra/packages/core/src/math/eval";
import { integrate } from "../vendor/kinetra/packages/core/src/math/calculus";
import {
  renderVectorField,
  renderScalarField,
  type VectorFieldModel,
  type ScalarFieldModel,
} from "../vendor/kinetra/packages/core/src/diagram/fields";
import { renderPlotSvg } from "../vendor/kinetra/packages/core/src/graph/render_svg";
import { parseBoolExpr } from "../vendor/kinetra/packages/core/src/dld/expression";
import { expressionToCircuit } from "../vendor/kinetra/packages/core/src/dld/circuit";
import { renderLogicSchematic } from "../vendor/kinetra/packages/core/src/diagram/logic_schematic";
import { ingestText } from "../vendor/kinetra/packages/core/src/ingest/text";
import { chunkText } from "../vendor/kinetra/packages/core/src/ingest/chunk";
import {
  makeHybridIndex,
  addToHybridIndex,
  searchHybrid,
} from "../vendor/kinetra/packages/core/src/retrieval/hybrid";
import { solveNetlist, solveNetlistTransient } from "../vendor/kinetra/packages/core/src/circuit/spice";
import type { Netlist } from "../vendor/kinetra/packages/core/src/circuit/circuit";
import { formatValue } from "../vendor/kinetra/packages/core/src/diagram/schematic_kit";
/**
 * The DC solution of the netlist renderCircuit draws ({elements:[{kind,from,to,label,value,unit}]}, node "0" is
 * ground): node voltages, each element's voltage (V(from) − V(to)), current (from → to) and absorbed power, and every
 * named current and voltage. Solve and draw from one netlist so the numbers in the text are the circuit in the figure.
 */
export function solveCircuit(netlist: Netlist) {
  const solved = solveNetlist(netlist);
  const v = (x: number) => formatValue(x, "V"), a = (x: number) => formatValue(x, "A"), w = (x: number) => formatValue(x, "W");
  // A named quantity is a voltage when an element names it as one ("$v_o$", "U_R", "ΔV"), whatever letter it starts with.
  const voltages = new Set(netlist.elements.map((e) => e.voltage).filter(Boolean));
  return {
    ...solved,
    summary: [
      ...Object.entries(solved.nodes).filter(([n]) => n !== solved.ground).map(([n, x]) => `node ${n}: ${v(x)}`),
      ...solved.elements.map((e) => `${e.label} (${e.kind}, ${e.from}→${e.to}): ${v(e.voltage)}, ${a(e.current)}, ${w(e.power)} absorbed${e.conducting === undefined ? "" : e.conducting ? ", conducting" : ", off"}`),
      ...Object.entries(solved.quantities).map(([name, x]) => `${name} = ${voltages.has(name) ? v(x) : a(x)}`),
    ],
  };
}
/** Transient response of the same netlist (backward Euler): at most 201 evenly spaced samples, so long runs stay small. */
export function circuitTransient(netlist: Netlist, options: { endTime: number; dt: number; startTime?: number; events?: { t: number; element: string; closed: boolean }[] }) {
  const { endTime, dt, startTime = 0 } = options || ({} as any);
  if (![endTime, dt, startTime].every(Number.isFinite) || dt <= 0 || endTime <= startTime) throw Error("circuitTransient needs {endTime, dt} with dt > 0 and endTime after startTime");
  if ((endTime - startTime) / dt > 200_000) throw Error("At most 200000 time steps: use a larger dt");
  const r = solveNetlistTransient(netlist, { startTime, endTime, dt, events: options.events });
  const step = Math.max(1, Math.ceil(r.times.length / 201));
  const pick = <T,>(values: T[]) => values.filter((_, i) => i % step === 0 || i === values.length - 1);
  return {
    times: pick(r.times),
    nodes: Object.fromEntries(Object.entries(r.nodes).map(([k, values]) => [k, pick(values)])),
    currents: Object.fromEntries(Object.entries(r.currents).map(([k, values]) => [k, pick(values)])),
    units: { time: "s", voltage: "V", current: "A" },
  };
}
/** Concept diagrams for documents (flowcharts, charts, timelines, cycles, mind maps, trees, Venn diagrams). */
export { flowchart, chart, timeline, cycle, mindMap, tree, venn } from "./kinetra-diagrams";
/** Textbook illustrations (pulleys, inclines, levers, springs, vessels, charges and field lines): {items, view?} → SVG. Recipes: core/figure-recipes.ts. */
export { renderIllustration as illustration } from "../core/illustration";
/** A chat ```visual (plot, chart, diagram, figure or 3d) printed as it was drawn, on white paper: the visual's JSON → SVG.
 *  Loaded on first use: its schema is most of the worker's size, and every other call starts a worker without it. */
export async function visual(spec: Record<string, unknown>): Promise<string> {
  return (await import("../core/visual-print")).printVisualSvg(spec);
}
/** JSON-friendly adapters. Expressions use Kinetra's parser, never eval or new Function. */
export function integrateExpression(
  expression: string,
  variable: string,
  from: number,
  to: number,
) {
  const ast = parseExpr(expression);
  if (![from, to].every(Number.isFinite)) throw Error("Finite bounds required");
  return integrate((x) => evaluate(ast, { vars: { [variable]: x } }), from, to);
}
export function vectorField(
  model: Omit<VectorFieldModel, "field"> & {
    xExpression: string;
    yExpression: string;
  },
) {
  const x = parseExpr(model.xExpression),
    y = parseExpr(model.yExpression);
  return renderVectorField({
    ...model,
    field: (p) => ({
      x: evaluate(x, { vars: { x: p.x, y: p.y } }),
      y: evaluate(y, { vars: { x: p.x, y: p.y } }),
    }),
  });
}
export function scalarField(
  model: Omit<ScalarFieldModel, "field"> & { expression: string },
) {
  const ast = parseExpr(model.expression);
  return renderScalarField({
    ...model,
    field: (p) => evaluate(ast, { vars: { x: p.x, y: p.y } }),
  });
}
type PlotFunction = { expression: string; label: string; color?: string; style?: "solid" | "dashed" | "dotted" };
/**
 * Function plots from plain expressions such as "x^2 - 3*sin(x)". Kinetra's plot renderer
 * takes parsed expression trees and silently draws empty axes for anything else; this
 * adapter parses first and refuses a plot with no finite values, so a PDF never ships a blank graph.
 */
export function plot(spec: {
  title: string;
  xRange: [number, number];
  yRange?: [number, number];
  xLabel?: string;
  yLabel?: string;
  functions?: PlotFunction[];
  data?: { x: number; y: number; yerr?: number; label?: string }[];
  width?: number;
  height?: number;
}) {
  if (!spec || typeof spec.title !== "string") throw Error("plot needs a title");
  const [from, to] = spec.xRange || [];
  if (![from, to].every(Number.isFinite) || from >= to) throw Error("plot needs xRange [min, max] with min < max");
  const functions = (spec.functions || []).slice(0, 7).map((f) => ({ ...f, expression: parseExpr(String(f.expression)) }));
  if (!functions.length && !spec.data?.length) throw Error("plot needs functions or data");
  for (const f of functions) {
    let finite = 0;
    for (let i = 0; i <= 50; i++) {
      try { if (Number.isFinite(evaluate(f.expression, { vars: { x: from + ((to - from) * i) / 50 } }))) finite++; } catch {}
    }
    if (!finite) throw Error(`"${f.label}" has no real values on [${from}, ${to}]. Use x as the variable and check the range.`);
  }
  return renderPlotSvg(
    {
      id: "mowr-plot",
      title: spec.title,
      type: functions.length ? "function2d" : "scatter",
      xRange: [from, to],
      yRange: spec.yRange,
      xAxis: { label: spec.xLabel, grid: true },
      yAxis: { label: spec.yLabel, grid: true },
      functions,
      data: spec.data,
      showLegend: functions.length > 1 || (functions.length > 0 && !!spec.data?.length),
    },
    { width: spec.width ?? 640, height: spec.height ?? 400 },
  );
}
/** Gate-level schematic of a Boolean expression such as "A B + !C" or "(A + B)'". */
export function logicDiagram(expression: string, output = "F", title?: string, width = 760, height = 420) {
  const circuit = expressionToCircuit(output, parseBoolExpr(String(expression)));
  const named = circuit.outputs[0];
  if (named) named.label = output;
  return renderLogicSchematic({ circuit, width, height, title });
}
/** Returns source text and locators; it does not read files or save an index. */
export function retrieve(
  documents: { title: string; text: string }[],
  query: string,
  limit = 5,
) {
  if (
    documents.length > 30 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20
  )
    throw Error("Invalid retrieval size");
  const idx = makeHybridIndex();
  for (const doc of documents)
    for (const chunk of chunkText(ingestText(doc.text, doc.title)))
      addToHybridIndex(idx, chunk);
  return searchHybrid(idx, query, limit);
}
/** Printable revision dates. Subject mastery remains in Mowr's subject records. */
export function studySchedule(
  topics: string[],
  start: string,
  intervals = [1, 3, 7, 14, 30],
) {
  const at = Date.parse(start);
  if (
    !Number.isFinite(at) ||
    topics.length > 100 ||
    intervals.length > 30 ||
    intervals.some((d) => !Number.isInteger(d) || d < 0 || d > 3650)
  )
    throw Error("Invalid study schedule");
  return topics.map((topic) => ({
    topic,
    reviews: intervals.map((days) =>
      new Date(at + days * 86400000).toISOString().slice(0, 10),
    ),
  }));
}
