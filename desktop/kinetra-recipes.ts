/**
 * Known-good Kinetra figures. Every recipe is rendered by the real worker in
 * tests/desktop/kinetra.test.ts, so the model starts from JSON that works instead of
 * guessing argument shapes. Adapt values; keep the structure.
 */
import { figureRecipes, figureVocabulary } from "../core/figure-recipes.ts";
import beam from "../vendor/kinetra/examples/toolkit/proof/01-beam-shear-moment.json" with { type: "json" };
import truss from "../vendor/kinetra/examples/toolkit/proof/02-truss-method-of-joints.json" with { type: "json" };
import ladder from "../vendor/kinetra/examples/toolkit/proof/03-ladder-equilibrium.json" with { type: "json" };
import damper from "../vendor/kinetra/examples/toolkit/proof/06-mass-spring-damper-response.json" with { type: "json" };
import mohr from "../vendor/kinetra/examples/toolkit/proof/07-mohr-circle.json" with { type: "json" };
import stressStrain from "../vendor/kinetra/examples/toolkit/proof/08-stress-strain.json" with { type: "json" };
import carnot from "../vendor/kinetra/examples/toolkit/proof/09-carnot-pv.json" with { type: "json" };
import heatEngine from "../vendor/kinetra/examples/toolkit/proof/10-heat-engine-energy-flow.json" with { type: "json" };
import pumpTank from "../vendor/kinetra/examples/toolkit/proof/11-pump-tank-system.json" with { type: "json" };
import venturi from "../vendor/kinetra/examples/toolkit/proof/12-venturi-bernoulli.json" with { type: "json" };
import refraction from "../vendor/kinetra/examples/toolkit/proof/13-refraction-tir.json" with { type: "json" };
import standingWave from "../vendor/kinetra/examples/toolkit/proof/14-standing-wave.json" with { type: "json" };
import wireField from "../vendor/kinetra/examples/toolkit/proof/16-wire-magnetic-field.json" with { type: "json" };
import wheatstone from "../vendor/kinetra/examples/toolkit/proof/17-wheatstone-bridge.json" with { type: "json" };
import opamp from "../vendor/kinetra/examples/toolkit/proof/18-inverting-amplifier.json" with { type: "json" };
import rlcPhasors from "../vendor/kinetra/examples/toolkit/proof/19-rlc-phasors.json" with { type: "json" };
import threePhase from "../vendor/kinetra/examples/toolkit/proof/20-three-phase-phasors.json" with { type: "json" };
import bode from "../vendor/kinetra/examples/toolkit/proof/21-bode-second-order.json" with { type: "json" };
import step from "../vendor/kinetra/examples/toolkit/proof/22-step-response.json" with { type: "json" };
import feedback from "../vendor/kinetra/examples/toolkit/proof/24-feedback-block-diagram.json" with { type: "json" };
import fsm from "../vendor/kinetra/examples/toolkit/proof/25-moore-fsm.json" with { type: "json" };
import datapath from "../vendor/kinetra/examples/toolkit/proof/27-cpu-datapath.json" with { type: "json" };
import hydrogen from "../vendor/kinetra/examples/toolkit/proof/29-hydrogen-energy-levels.json" with { type: "json" };
import minkowski from "../vendor/kinetra/examples/toolkit/proof/30-minkowski-diagram.json" with { type: "json" };

export type KinetraRecipe = { name: string; use: string; figure: { module: string; fn: string; args: unknown[] }; notes: string };

export const kinetraRecipes: KinetraRecipe[] = [
  {
    name: "function plot",
    use: "graphs of y = f(x): one or several curves, or measured data points",
    figure: { module: "clem", fn: "plot", args: [{ title: "Quadratic and its derivative", xRange: [-3, 3], xLabel: "x", yLabel: "y", functions: [{ expression: "x^2 - 1", label: "f(x) = x² − 1" }, { expression: "2*x", label: "f′(x) = 2x", style: "dashed" }] }] },
    notes: "Variable must be x. Operators + - * / ^, functions sin cos tan exp ln log sqrt abs. Data points: data:[{x,y}] instead of functions. The adapter rejects curves with no real values.",
  },
  {
    name: "projectile",
    use: "projectile motion trajectory with apex and range",
    figure: { module: "diagram/projectile", fn: "renderProjectile", args: [{ initialPosition: { x: 0, y: 0 }, initialSpeed: 20, launchAngleDeg: 40, gravity: 9.81, width: 640, height: 400, showInitialVectors: true, showKeyPoints: true }] },
    notes: "SI units; gravity positive. Numbers in the text should come from call diagram/projectile projectileAnalytics with the same model.",
  },
  {
    name: "free-body diagram",
    use: "forces on a body: weight, normal, friction, tension, applied force",
    figure: { module: "diagram/freebody", fn: "renderFBD", args: [{ bodyPosition: { x: 0, y: 0 }, bodySize: { w: 2, h: 1.2 }, bodyLabel: "5 kg", frameAngleDeg: 0, forces: [{ point: { x: 0, y: 0 }, components: { x: 0, y: -49 }, magnitude: 49, unit: "N", label: "W" }, { point: { x: 0, y: 0 }, components: { x: 0, y: 49 }, magnitude: 49, unit: "N", label: "N" }, { point: { x: 0, y: 0 }, components: { x: 20, y: 0 }, magnitude: 20, unit: "N", label: "F" }, { point: { x: 0, y: 0 }, components: { x: -9.8, y: 0 }, magnitude: 9.8, unit: "N", label: "f" }], world: { xMin: -5, xMax: 5, yMin: -4, yMax: 4 }, width: 520, height: 420 }] },
    notes: "components are world x/y in the force's unit and must match magnitude (|components| = magnitude). The renderer does not infer forces: include every force from the problem, with correct signs.",
  },
  {
    name: "pulley (Atwood)",
    use: "fixed pulley / Atwood machine with two hanging masses",
    figure: { module: "diagram/pulley", fn: "renderPulley", args: [{ pulleys: [{ center: { x: 0, y: 4 }, radius: 0.6, fixed: true }], masses: [{ mass: 3, position: { x: -0.6, y: 1.5 }, size: { w: 0.8, h: 0.8 }, label: "3 kg" }, { mass: 5, position: { x: 0.6, y: 0.8 }, size: { w: 0.8, h: 0.8 }, label: "5 kg" }], tension: 36.8, configuration: "atwood", world: { xMin: -3, xMax: 3, yMin: 0, yMax: 5.5 }, width: 480, height: 440 }] },
    notes: "Place masses directly under the wheel's left/right edges (x = center ± radius). Compute tension with call diagram/pulley atwoodDynamics [m1, m2, 9.81] first.",
  },
  {
    name: "thin lens / mirror",
    use: "ray diagram for a converging or diverging lens, or a concave/convex/plane mirror",
    figure: { module: "diagram/optics", fn: "renderOptics", args: [{ element: { kind: "thin-lens-converging", x: 0, y: 0, focal: 10 }, objectHeight: 4, objectBase: { x: -25, y: 0 }, world: { xMin: -35, xMax: 35, yMin: -12, yMax: 12 }, width: 640, height: 320 }] },
    notes: "Other elements: {kind:'thin-lens-diverging',x,y,focal}, {kind:'concave-mirror'|'convex-mirror',x,y,focal,radius}, {kind:'plane-mirror',x,yMin,yMax}. Image position/magnification: call diagram/optics lensImage with the same model.",
  },
  {
    name: "charged rods",
    use: "textbook electrostatic attraction or repulsion between a suspended rod and a nearby rod",
    figure: { module: "diagram/electrostatics", fn: "renderElectrostaticRods", args: [{ width: 900, height: 760, world: { xMin: 0, xMax: 900, yMin: 0, yMax: 760 }, suspended: { from: { x: 300, y: 310 }, to: { x: 700, y: 397 }, radius: 21, material: "rubber", label: "Rubber", charge: -1, chargeRegion: [0.04, 0.29], chargeCount: 5, forceFraction: 0.12 }, nearby: { from: { x: 155, y: 150 }, to: { x: 435, y: 211 }, radius: 19, material: "glass", label: "Glass", charge: 1, chargeRegion: [0.07, 0.93], chargeCount: 9, forceFraction: 0.9 }, suspension: { anchor: { x: 505, y: 650 }, fork: { x: 505, y: 480 }, attachments: [0.34, 0.69] }, showRotationCue: true }] },
    notes: "Qualitative only: charge is a sign (+1/-1); like signs repel. Change charge/material/label; keep geometry unless needed.",
  },
  {
    name: "vector field",
    use: "2D vector fields such as electric fields or flows",
    figure: { module: "clem", fn: "vectorField", args: [{ type: "vector", xExpression: "x/((x^2+y^2)^1.5+0.05)", yExpression: "y/((x^2+y^2)^1.5+0.05)", world: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }, width: 480, height: 480, cols: 15, rows: 15, title: "Field of a positive point charge" }] },
    notes: "Expressions in x and y. Use clem vectorField / scalarField (scalar: expression, contours:[levels]); diagram/fields needs functions and cannot be called directly.",
  },
  {
    name: "circuit schematic",
    use: "analog circuits from a netlist: resistors, capacitors, inductors, independent and dependent sources, diodes, switches, meters",
    figure: { module: "diagram/circuit_schematic", fn: "renderCircuit", args: [{ title: "Nodal analysis with a dependent source", elements: [{ kind: "current-source", from: "0", to: "1", value: 1, unit: "A" }, { kind: "resistor", from: "1", to: "0", label: "R_1", value: 4, unit: "Ω" }, { kind: "dependent-voltage-source", from: "2", to: "1", label: "4i_o" }, { kind: "resistor", from: "2", to: "0", label: "R_2", value: 1, unit: "Ω", current: "i_o" }, { kind: "resistor", from: "1", to: "3", label: "R_3", value: 1, unit: "Ω", voltage: "v_o" }, { kind: "dependent-current-source", from: "2", to: "3", label: "2v_o" }, { kind: "resistor", from: "3", to: "4", label: "R_4", value: 2, unit: "Ω" }, { kind: "voltage-source", from: "0", to: "4", value: 10, unit: "V" }] }] },
    notes: "Describe the circuit as elements between named nodes; Clem does the whole layout (ground rail, right-angle wires, junction dots, labels clear of everything), so never give coordinates. Node \"0\" (or gnd) is ground. Kinds: resistor, capacitor, inductor, voltage-source, current-source, dependent-voltage-source, dependent-current-source, ac-source, battery, switch (closed:true), diode, led, lamp, ammeter, voltmeter, wire. Voltage sources and batteries have + at \"to\"; current sources and diodes point from \"from\" to \"to\". label is the name only (R_1, V_s, 4i_o; _ makes a subscript); put the number in value and unit (\"Ω\", \"kΩ\", \"V\", \"mA\"), never both in label. current:\"i_x\" draws a current arrow, voltage:\"v_x\" draws + − marks (+ at from). Optional order:[node names] fixes the left-to-right node order. Copy the topology exactly from the problem. Solve and draw from ONE netlist: first {\"action\":\"call\",\"module\":\"clem\",\"fn\":\"solveCircuit\",\"args\":[this same netlist object]} returns every node voltage, each element's voltage (V(from) − V(to)), current (from → to) and power, and each named current/voltage; state those numbers and put this identical netlist in the figure. Dependent sources are controlled by the element whose current or voltage their label names (\"4i_o\" = 4 × the current:\"i_o\" element). Capacitors are open and inductors shorts in DC; for a switching or RC/RL response use clem circuitTransient [netlist, {endTime, dt}].",
  },
  {
    name: "logic circuit",
    use: "gate-level diagram of a Boolean expression",
    figure: { module: "clem", fn: "logicDiagram", args: ["A B + !C", "F", "F = AB + C′"] },
    notes: "Operators: juxtaposition or * for AND, + for OR, ! or ' for NOT, ^ for XOR. Simplify first with dld/simplify if the user asked for a minimal circuit. dld/kmap buildKMap counts the first variable as the lowest minterm bit, so for a textbook F(A,B,C) = Σm(…) pass variables reversed ([\"C\",\"B\",\"A\"]).",
  },
  {
    name: "domain in the plane",
    use: "the domain of f(x, y) or any region of the plane: shaded set, solid boundary that belongs to it, dashed boundary that does not",
    figure: { module: "clem", fn: "visual", args: [{ kind: "plot", title: "Domain of f(x, y) = √(x + y + 1) / (x − 1)", x: { min: -4, max: 4, label: "x" }, y: { min: -4, max: 4, label: "y" }, equal: true, layers: [{ type: "area", expr: "4", base: "-x-1", from: -4, to: 4, color: "blue" }, { type: "text", x: 2.3, y: 2.5, text: "D", size: 16, color: "blue" }, { type: "function", expr: "-x-1", color: "blue", label: "y = −x − 1" }, { type: "implicit", expr: "x-1", color: "coral", dash: true, label: "x = 1 excluded" }] }] },
    notes: "kind plot. area fills between expr (top) and base (bottom) for x from \"from\" to \"to\"; set the top to the y-axis maximum for a region above a curve; name the region with a text layer inside it, clear of the axes. implicit expr = 0 draws any boundary g(x, y) = 0 (circles, vertical lines); dash:true for points left out. polygon with fill:true for straight-edged regions. equal:true keeps circles round.",
  },
  {
    name: "contour map / level curves",
    use: "level curves f(x, y) = k and contour maps, labelled by level; also implicit curves and boundaries",
    figure: { module: "clem", fn: "visual", args: [{ kind: "plot", title: "Level curves of f(x, y) = x² − y²", x: { min: -3, max: 3, label: "x" }, y: { min: -3, max: 3, label: "y" }, equal: true, layers: [{ type: "implicit", expr: "x^2 - y^2", levels: [-4, -1, 0, 1, 4], label: "k" }] }] },
    notes: "One implicit layer with levels (up to 12) draws every level curve f = k, each labelled \"k = value\". Choose levels evenly in k for a contour map (spacing then shows steepness). Variables x and y; ^ for powers.",
  },
  {
    name: "surface z = f(x, y)",
    use: "the graph of a function of two variables, a quadric surface, or a surface with a trace curve on it",
    figure: { module: "clem", fn: "visual", args: [{ kind: "3d", title: "Graph of z = x² + y² (paraboloid)", x: { min: -2, max: 2, label: "x" }, y: { min: -2, max: 2, label: "y" }, z: { min: 0, max: 8, label: "z" }, objects: [{ type: "surface", expr: "x^2 + y^2", x: [-2, 2], y: [-2, 2], colormap: true, wireframe: true }, { type: "curve", x: "s", y: "1", z: "s^2 + 1", from: -2, to: 2, color: "coral", label: "trace y = 1", width: 3 }], camera: { azimuth: 35, elevation: 25 } }] },
    notes: "Printed as a still from the camera (azimuth and elevation in degrees). surface expr in x and y; curve is parametric in s (traces: fix x or y). Pair it with a contour map of the same f when the text compares them.",
  },
  {
    name: "polar curve",
    use: "polar curves r = f(θ), polar regions and the polar form of a limit",
    figure: { module: "clem", fn: "visual", args: [{ kind: "plot", title: "Cardioid r = 1 + cos θ", x: { min: -1, max: 2.5, label: "x" }, y: { min: -1.5, max: 1.5, label: "y" }, equal: true, layers: [{ type: "polar", r: "1 + cos(theta)", from: 0, to: 6.2832, label: "r = 1 + cos θ" }, { type: "segment", x1: 0, y1: 0, x2: 1.207, y2: -1.207, dash: true, label: "r" }, { type: "point", x: 0, y: 0, label: "O" }] }] },
    notes: "polar r in theta (radians), from/to default 0 to 2π. Add segments for a radius and points for the pole.",
  },
  {
    name: "limit along paths",
    use: "testing a limit at a point along several paths (lines, parabolas) that approach it",
    figure: { module: "clem", fn: "visual", args: [{ kind: "plot", title: "Paths to the origin for f(x, y) = xy / (x² + y²)", x: { min: -2, max: 2, label: "x" }, y: { min: -2, max: 2, label: "y" }, equal: true, layers: [{ type: "function", expr: "0", label: "y = 0: f → 0" }, { type: "function", expr: "x", label: "y = x: f → 1/2" }, { type: "function", expr: "x^2", dash: true, label: "y = x²: f → 0" }, { type: "point", x: 0, y: 0, color: "coral", label: "(0, 0)" }] }] },
    notes: "One function layer per path, labelled with the value f approaches along it; a point at the limit point. Different values along two paths show the limit does not exist.",
  },
];


/** Concept diagrams: processes, data, sequences and structures that any subject needs, not only physics. */
export const diagramRecipes: KinetraRecipe[] = [
  {
    name: "flowchart",
    use: "processes, algorithms, procedures, decision paths, pathways (biology, chemistry, business, computing)",
    figure: { module: "clem", fn: "flowchart", args: [{ title: "Enzyme-catalysed reaction", direction: "down", nodes: [{ id: "s", label: "Substrate meets enzyme", shape: "start" }, { id: "b", label: "Substrate binds the active site" }, { id: "d", label: "Correct shape and conditions?", shape: "decision" }, { id: "c", label: "Enzyme–substrate complex forms" }, { id: "p", label: "Products released; enzyme unchanged", shape: "end" }, { id: "n", label: "No reaction", shape: "end" }], edges: [{ from: "s", to: "b" }, { from: "b", to: "d" }, { from: "d", to: "c", label: "Yes" }, { from: "d", to: "n", label: "No" }, { from: "c", to: "p" }] }] },
    notes: "shape: process (default), decision (diamond, label the out-edges Yes/No), start, end, io (input/output), note. direction \"right\" for wide, short processes. Loops (an edge back to an earlier node) are drawn around the side. Up to 40 nodes.",
  },
  {
    name: "bar chart",
    use: "comparing quantities across categories; grouped series; type hbar for long labels, stacked for parts of a whole",
    figure: { module: "clem", fn: "chart", args: [{ title: "Energy use by sector", type: "bar", labels: ["Industry", "Transport", "Homes", "Services"], series: [{ name: "2015", values: [34, 29, 22, 15] }, { name: "2025", values: [31, 30, 21, 18] }], yLabel: "Share of total", unit: "%" }] },
    notes: "Every series has exactly one number per label. type: bar | hbar | stacked | line | pie (pie uses the first series). Use real or computed values only.",
  },
  {
    name: "line chart",
    use: "trends over time or any ordered variable",
    figure: { module: "clem", fn: "chart", args: [{ title: "Population growth", type: "line", labels: ["1990", "2000", "2010", "2020"], series: [{ name: "Population", values: [5.3, 6.1, 6.9, 7.8] }], yLabel: "People", unit: "bn" }] },
    notes: "For y = f(x) curves use the function plot recipe instead.",
  },
  {
    name: "timeline",
    use: "historical events, project phases, schedules, life cycles in order",
    figure: { module: "clem", fn: "timeline", args: [{ title: "Key steps in the French Revolution", events: [{ date: "1789", label: "Storming of the Bastille", detail: "14 July" }, { date: "1791", label: "Constitution adopted" }, { date: "1793", label: "Reign of Terror begins" }, { date: "1799", label: "Napoleon takes power" }] }] },
    notes: "Up to 30 events in order; more than 8 are drawn as a vertical list with details.",
  },
  {
    name: "cycle",
    use: "repeating processes: water cycle, cell cycle, Krebs cycle, product life cycle, feedback loops",
    figure: { module: "clem", fn: "cycle", args: [{ title: "The water cycle", center: "Water cycle", steps: [{ label: "Evaporation", detail: "Sun heats surface water" }, { label: "Condensation", detail: "Vapour forms clouds" }, { label: "Precipitation" }, { label: "Collection", detail: "Rivers, lakes, oceans" }] }] },
    notes: "3–12 steps in order; the arrow from the last step returns to the first.",
  },
  {
    name: "mind map",
    use: "a topic overview, revision summary or brainstorm: a central idea with branches and sub-points",
    figure: { module: "clem", fn: "mindMap", args: [{ title: "Cell biology overview", center: "The cell", branches: [{ label: "Organelles", children: ["Nucleus", "Mitochondria", "Ribosomes"] }, { label: "Transport", children: ["Diffusion", "Osmosis", "Active transport"] }, { label: "Division", children: ["Mitosis", "Meiosis"] }, { label: "Types", children: ["Prokaryotic", "Eukaryotic"] }] }] },
    notes: "Up to 10 branches with up to 8 short children each.",
  },
  {
    name: "tree / hierarchy",
    use: "classification, taxonomy, organisation chart, decision tree, family of concepts",
    figure: { module: "clem", fn: "tree", args: [{ title: "Classification of matter", root: { label: "Matter", children: [{ label: "Pure substances", children: [{ label: "Elements" }, { label: "Compounds" }] }, { label: "Mixtures", children: [{ label: "Homogeneous", detail: "e.g. salt water" }, { label: "Heterogeneous", detail: "e.g. sand in water" }] }] } }] },
    notes: "Up to 60 nodes and 6 levels; detail is an optional short second line.",
  },
  {
    name: "Venn diagram",
    use: "similarities and differences between two or three things",
    figure: { module: "clem", fn: "venn", args: [{ title: "Mitosis and meiosis", sets: [{ label: "Mitosis", items: ["2 daughter cells", "Identical", "Growth and repair"] }, { label: "Meiosis", items: ["4 daughter cells", "Genetically different", "Gametes"] }], overlap: ["DNA replicates first", "Spindle fibres", "Nuclear division"] }] },
    notes: "2 or 3 sets; for 3 sets, overlaps: {AB:[…],AC:[…],BC:[…],all:[…]}. Keep items to a few words.",
  },
  {
    name: "chat visual",
    use: "a ```visual already drawn in the conversation (plot, chart, diagram, figure or 3d), printed unchanged",
    figure: { module: "clem", fn: "visual", args: [{ kind: "diagram", title: "Request lifecycle", direction: "right", nodes: [{ id: "a", label: "Client request" }, { id: "b", label: "Validate input", shape: "pill" }, { id: "c", label: "Store result" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c", label: "valid" }] }] },
    notes: "args[0] is the visual's JSON object exactly as written in the ```visual block. Printed on white paper; sliders at their starting values, animations at their final frame, every step shown.",
  },
];

/**
 * Textbook illustrations (core/illustration.ts): the drawings of a physics book, with apparatus drawn as it looks
 * (shaded blocks and balls, pulleys and ropes on true tangents, spring scales, inclines, levers, vessels, charges with
 * computed field lines). The same figures draw in the chat as ```visual kind "figure".
 */
export const illustrationRecipes: KinetraRecipe[] = figureRecipes.map((r) => ({ name: `textbook figure: ${r.name}`, use: r.use, figure: { module: "clem", fn: "illustration", args: [r.figure] }, notes: r.notes }));

/** The full item list for {"module":"clem","fn":"illustration"} figures, returned by {"action":"skill","name":"figures"}. */
export const illustrationGuide = `${figureVocabulary}
Call it as {"module":"clem","fn":"illustration","args":[{"items":[…],"view"?:{…}}]}. Start from the closest textbook figure recipe and change positions, sizes and labels; keep every id unique and refer only to anchors of items that exist.`;

/**
 * Composed figures (vendor/kinetra/examples/toolkit/proof): checked toolkit models for engineering figures no other
 * recipe draws. Each is 1–4 kB, so they go only with a request about their topic (recipeTopics) or by name
 * ({"action":"recipes","name":…}); the long generated ones (dipole field lines, root locus) are left out, and the
 * K-map, flowchart, incline and Atwood figures already have recipes of their own.
 */
const proof = (name: string, use: string, model: unknown): KinetraRecipe => ({
  name: `composed: ${name}`,
  use,
  figure: { module: "clem", fn: "compose", args: [model] },
  notes: "Keep the structure and the checks; change vars, then compose. In a chat ```kinetra block the card shows the title, so leave the model's \"title\" out. Read new parts with clem composeParts; {\"action\":\"skill\",\"name\":\"kinetra-compose\"} has the rules.",
});
export const composeRecipes: KinetraRecipe[] = [
  proof("beam shear and bending moment", "simply supported beam with a point load, reactions, shear force and bending moment diagrams", beam),
  proof("truss (method of joints)", "plane truss with member forces in tension and compression", truss),
  proof("ladder equilibrium", "ladder against a wall: free-body diagram with friction and moments", ladder),
  proof("mass–spring–damper response", "damped oscillator: system sketch and free response x(t)", damper),
  proof("Mohr's circle", "plane stress: Mohr's circle with principal stresses and maximum shear", mohr),
  proof("stress–strain curve", "engineering stress–strain curve: yield, ultimate strength, fracture, toughness area", stressStrain),
  proof("Carnot cycle on a P–V diagram", "thermodynamic cycle on P–V axes with isotherms, adiabats and the work area", carnot),
  proof("heat engine energy flow", "heat engine between two reservoirs: Q_H, W, Q_C and efficiency", heatEngine),
  proof("pump and tank system", "pumping between two tanks: pipe, pump head, elevation and head loss", pumpTank),
  proof("Venturi meter (Bernoulli)", "Venturi meter: continuity, Bernoulli and the head difference", venturi),
  proof("refraction and total internal reflection", "light at a boundary: Snell's law, critical angle, total internal reflection", refraction),
  proof("standing wave", "standing wave on a string: harmonics, nodes and antinodes", standingWave),
  proof("magnetic field of a wire", "magnetic field around a long straight current-carrying wire", wireField),
  proof("Wheatstone bridge", "Wheatstone bridge circuit with solved branch currents", wheatstone),
  proof("inverting op-amp amplifier", "op-amp inverting amplifier with virtual ground and gain", opamp),
  proof("RLC phasor diagram", "series RLC circuit: voltage phasors and impedance", rlcPhasors),
  proof("three-phase phasors", "balanced three-phase supply: phase and line voltage phasors", threePhase),
  proof("Bode plot", "Bode magnitude and phase plot of a second-order system with its resonant peak", bode),
  proof("step response", "second-order step response: overshoot, peak time, settling time", step),
  proof("feedback block diagram", "control system block diagram: unity feedback loop with a summing junction", feedback),
  proof("Moore state machine", "finite state machine (Moore): states, transitions and outputs", fsm),
  proof("CPU datapath", "single-cycle CPU datapath: PC, memories, register file, ALU and multiplexers", datapath),
  proof("hydrogen energy levels", "atomic energy level diagram with emission lines and wavelengths", hydrogen),
  proof("Minkowski diagram", "special relativity spacetime diagram with a moving frame's axes", minkowski),
];
/** One recipe by name, or every one whose name has the word ("composed" lists the composed figures). */
export function recipesNamed(name: string) {
  const want = name.trim().toLowerCase();
  return [...allRecipes(), ...composeRecipes].filter((r) => r.name.toLowerCase().includes(want));
}

/** Every recipe: the science recipes, the concept diagrams and the textbook figures. */
export const allRecipes = () => [...kinetraRecipes, ...diagramRecipes, ...illustrationRecipes];
export const recipeText = (recipes: KinetraRecipe[] = allRecipes()) =>
  recipes.map((r) => `- ${r.name} (${r.use}): {"figure":${JSON.stringify(r.figure)}} — ${r.notes}`).join("\n");
/** The composed figures by name only, for {"action":"recipes"}: each model is sent when asked for or when the topic is. */
export const composeIndex = () => `Composed figures (clem compose; {"action":"recipes","name":"composed: …"} returns the model): ${composeRecipes.map((r) => r.name.slice(10)).join("; ")}.`;

/**
 * What each science recipe is about. A recipe goes with the instructions when the request, the conversation or its
 * sources mention its topic; concept diagrams (flowcharts, charts, timelines…) serve every subject and always go.
 * Generous on purpose: a recipe sent needlessly costs some prompt, one left out costs a figure drawn from guesswork.
 */
const MECHANICS = "force|newton|mechanic|dynamics|statics|equilibrium|tension|weight|mass|accelerat|friction";
const ELECTROSTATICS = "electrostat|charge|coulomb|electric field|field lines?|static electric|insulator|conductor|induction";
const CALCULUS = "calculus|partial derivative|gradient|\\bmaths?\\b|mathematic|graph(?:s|ing)?\\b|sketch";
const topic = (words: string) => new RegExp(words, "i");
export const recipeTopics: Record<string, RegExp> = {
  "function plot": /plot|graph|curve|function|f\s*\(\s*x\s*\)|y\s*=|parabol|quadratic|polynomial|trig|\bsin\b|\bcos\b|\btan\b|exponential|logarithm|derivative|differentiat|integral|integrat|calculus|scatter|data points?|asymptot|equation|maths?\b|mathematic/i,
  "domain in the plane": topic(`domain|region|inequalit|several variables|two variables|multivariable|f\\s*\\(\\s*x\\s*,\\s*y|${CALCULUS}`),
  "contour map / level curves": topic(`contour|level (?:curve|set|surface)|isoline|implicit|several variables|two variables|multivariable|f\\s*\\(\\s*x\\s*,\\s*y|${CALCULUS}`),
  "surface z = f(x, y)": topic(`surface|paraboloid|hyperboloid|ellipsoid|quadric|saddle|traces?\\b|z\\s*=|3d graph|several variables|two variables|multivariable|f\\s*\\(\\s*x\\s*,\\s*y|${CALCULUS}`),
  "polar curve": topic(`polar|cardioid|rose curve|limaçon|limacon|\\btheta\\b|θ|${CALCULUS}`),
  "limit along paths": topic(`limits?\\b|continu|paths?\\b|approach|squeeze|sandwich|several variables|two variables|multivariable|${CALCULUS}`),
  projectile: topic(`projectile|trajector|launch|thrown|throw|kinematic|free fall|motion|velocity|range|apex|${MECHANICS}`),
  "free-body diagram": topic(`free[- ]?body|fbd|normal|incline|ramp|slope|${MECHANICS}`),
  "pulley (Atwood)": topic(`pulley|atwood|rope|hanging|${MECHANICS}`),
  "thin lens / mirror": /lens|mirror|optic|ray diagram|focal|refract|reflect|image distance|magnif|light/i,
  "charged rods": topic(`\\brods?\\b|rubb|attract|repel|${ELECTROSTATICS}`),
  "vector field": topic(`vector field|electric field|magnetic field|\\bflows?\\b|flux|gradient|divergence|curl|potential|${ELECTROSTATICS}`),
  "circuit schematic": /circuit|resistor|resistance|capacitor|inductor|voltage|current|\bohms?\b|Ω|kirchhoff|kvl|kcl|nodal|mesh analysis|th[eé]venin|norton|diode|battery|power supply|op-?amp|\brlc?\b|\brc\b|transistor|ammeter|voltmeter|electronic|electric|schematic|netlist/i,
  "logic circuit": /logic|boolean|\bgates?\b|nand|\bnor\b|xor|k-?map|karnaugh|truth table|digital|flip-?flop|combinational|sum of products|minterm/i,
  "textbook figure: spring scale between two hanging masses": topic(`spring (?:scale|balance)|scale|pulley|hanging|${MECHANICS}`),
  "textbook figure: hanging pulley with a spring scale (Atwood)": topic(`pulley|atwood|spring (?:scale|balance)|hanging|${MECHANICS}`),
  "textbook figure: block on an incline held by a spring scale": topic(`incline|ramp|slope|spring (?:scale|balance)|${MECHANICS}`),
  "textbook figure: free-body diagram on an incline": topic(`incline|ramp|slope|free[- ]?body|normal|${MECHANICS}`),
  "textbook figure: wheelbarrow lever (torques)": /lever|torque|moment|wheelbarrow|fulcrum|pivot|mechanical advantage|rotation|statics|equilibrium/i,
  "textbook figure: seesaw lever on a pivot": /seesaw|lever|torque|moment|fulcrum|pivot|balanc|statics|equilibrium/i,
  "textbook figure: charged sphere near a charged wire, with field lines": topic(`sphere|wire|${ELECTROSTATICS}`),
  "textbook figure: electric dipole field": topic(`dipole|point charges?|${ELECTROSTATICS}`),
  "textbook figure: rotating liquid in a vessel": /liquid|fluid|vessel|beaker|container|buoyan|pressure|meniscus|rotat|hydro|archimedes|water/i,
  "textbook figure: mass on a spring": /spring|hooke|oscillat|harmonic|\bshm\b|vibrat|pendulum|elastic/i,
  // Composed figures: specific engineering words only, since each model is several kB.
  "composed: beam shear and bending moment": /\bbeams?\b|shear (?:force|diagram)|bending moment|\bsfd\b|\bbmd\b|cantilever|simply supported|reactions? at/i,
  "composed: truss (method of joints)": /\btruss(?:es)?\b|method of (?:joints|sections)|member forces?/i,
  "composed: ladder equilibrium": /\bladders?\b/i,
  "composed: mass–spring–damper response": /damp(?:er|ed|ing)\b|dashpot|spring[- –]mass|mass[- –]spring|free response|natural frequency|damping ratio/i,
  "composed: Mohr's circle": /\bmohr|principal stress|plane stress|stress transformation|maximum shear stress/i,
  "composed: stress–strain curve": /stress[- –]strain|yield (?:strength|point|stress)|ultimate (?:tensile )?strength|young'?s modulus|tensile test|necking/i,
  "composed: Carnot cycle on a P–V diagram": /\bcarnot|\bp[- –]?v diagram|pressure[- –]volume|thermodynamic cycles?|isotherm|adiabat|otto cycle|diesel cycle|rankine|brayton/i,
  "composed: heat engine energy flow": /heat engines?|heat pumps?|refrigerators?|thermal efficiency|\bcarnot|second law of thermo|(?:hot|cold|thermal) reservoirs?/i,
  "composed: pump and tank system": /\bpumps?\b|head loss|pump head|pipe flow|piping/i,
  "composed: Venturi meter (Bernoulli)": /venturi|bernoulli|continuity equation|flow meter|nozzle/i,
  "composed: refraction and total internal reflection": /refract|snell|total internal reflection|critical angle|\btir\b|optical fib/i,
  "composed: standing wave": /standing waves?|(?:first|second|third|fundamental) harmonic|\bnodes? and antinodes?|antinode|vibrating string|resonan(?:ce|t) (?:on|in) a (?:string|pipe|tube)/i,
  "composed: magnetic field of a wire": /magnetic field|right[- ]hand rule|biot|amp[eè]re'?s law|current[- ]carrying wire|solenoid/i,
  "composed: Wheatstone bridge": /wheatstone|bridge circuit|galvanometer|strain gauge/i,
  "composed: inverting op-amp amplifier": /op[- ]?amps?\b|operational amplifier|inverting amplifier|virtual ground|amplifier gain/i,
  "composed: RLC phasor diagram": /phasors?|\brlc\b|impedance|reactance|power factor|\bac circuits?/i,
  "composed: three-phase phasors": /three[- ]phase|3[- ]phase|line voltage|phase voltage|\bdelta\b.*\bwye\b|\bwye\b|star[- ]delta/i,
  "composed: Bode plot": /\bbode|frequency response|gain margin|phase margin|resonant peak|transfer function/i,
  "composed: step response": /step response|overshoot|settling time|rise time|peak time|second[- ]order system|damping ratio|transient response/i,
  "composed: feedback block diagram": /block diagrams?|feedback (?:loop|control|system)|control (?:loop|system)s?|closed[- ]loop|summing junction|\bpid control/i,
  "composed: Moore state machine": /state machines?|\bfsm\b|finite[- ]state|moore|mealy|state (?:diagram|transition)|sequence detector|automat(?:on|a)\b|\bdfa\b|\bnfa\b/i,
  "composed: CPU datapath": /datapath|data path|\bcpu\b|\balu\b|register file|instruction (?:fetch|cycle|set)|single[- ]cycle|pipelin|mips|risc[- ]?v|computer architecture|control unit/i,
  "composed: hydrogen energy levels": /energy levels?|bohr|hydrogen atom|emission (?:line|spectr)|absorption spectr|electron transition|spectral lines?|photon emi/i,
  "composed: Minkowski diagram": /minkowski|spacetime|space-time|special relativity|lorentz|light cone|time dilation|length contraction|worldline/i,
};

/**
 * The recipes for one request: every concept diagram, and each science recipe whose topic `text` mentions (a recipe
 * without a topic always goes). With pictures attached every recipe goes, since a scanned problem names its apparatus
 * only in the picture. `omitted` counts the recipes left out (the instructions then say how to get them).
 */
export function recipesFor(text: string, { pictures = false }: { pictures?: boolean } = {}) {
  const science = [...kinetraRecipes, ...illustrationRecipes];
  const chosen = new Set(pictures ? science : science.filter((r) => recipeTopics[r.name]?.test(text) ?? true));
  // Composed figures go only by topic, pictures or not: all of them would be most of the prompt.
  const composed = composeRecipes.filter((r) => recipeTopics[r.name].test(text));
  return { recipes: [...allRecipes().filter((r) => !science.includes(r) || chosen.has(r)), ...composed], omitted: science.length - chosen.size, composed: composed.length };
}
