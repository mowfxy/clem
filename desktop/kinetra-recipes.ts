/**
 * Known-good Kinetra figures. Every recipe is rendered by the real worker in
 * tests/desktop/kinetra.test.ts, so the model starts from JSON that works instead of
 * guessing argument shapes. Adapt values; keep the structure.
 */
import { figureRecipes, figureVocabulary } from "../core/figure-recipes.ts";

export type KinetraRecipe = { name: string; use: string; figure: { module: string; fn: string; args: unknown[] }; notes: string };

export const kinetraRecipes: KinetraRecipe[] = [
  {
    name: "function plot",
    use: "graphs of y = f(x): one or several curves, or measured data points",
    figure: { module: "mowr", fn: "plot", args: [{ title: "Quadratic and its derivative", xRange: [-3, 3], xLabel: "x", yLabel: "y", functions: [{ expression: "x^2 - 1", label: "f(x) = x² − 1" }, { expression: "2*x", label: "f′(x) = 2x", style: "dashed" }] }] },
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
    figure: { module: "mowr", fn: "vectorField", args: [{ type: "vector", xExpression: "x/((x^2+y^2)^1.5+0.05)", yExpression: "y/((x^2+y^2)^1.5+0.05)", world: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 }, width: 480, height: 480, cols: 15, rows: 15, title: "Field of a positive point charge" }] },
    notes: "Expressions in x and y. Use mowr vectorField / scalarField (scalar: expression, contours:[levels]); diagram/fields needs functions and cannot be called directly.",
  },
  {
    name: "circuit schematic",
    use: "analog circuits from a netlist: resistors, capacitors, inductors, independent and dependent sources, diodes, switches, meters",
    figure: { module: "diagram/circuit_schematic", fn: "renderCircuit", args: [{ title: "Nodal analysis with a dependent source", elements: [{ kind: "current-source", from: "0", to: "1", value: 1, unit: "A" }, { kind: "resistor", from: "1", to: "0", label: "R_1", value: 4, unit: "Ω" }, { kind: "dependent-voltage-source", from: "2", to: "1", label: "4i_o" }, { kind: "resistor", from: "2", to: "0", label: "R_2", value: 1, unit: "Ω", current: "i_o" }, { kind: "resistor", from: "1", to: "3", label: "R_3", value: 1, unit: "Ω", voltage: "v_o" }, { kind: "dependent-current-source", from: "2", to: "3", label: "2v_o" }, { kind: "resistor", from: "3", to: "4", label: "R_4", value: 2, unit: "Ω" }, { kind: "voltage-source", from: "0", to: "4", value: 10, unit: "V" }] }] },
    notes: "Describe the circuit as elements between named nodes; Mowr does the whole layout (ground rail, right-angle wires, junction dots, labels clear of everything), so never give coordinates. Node \"0\" (or gnd) is ground. Kinds: resistor, capacitor, inductor, voltage-source, current-source, dependent-voltage-source, dependent-current-source, ac-source, battery, switch (closed:true), diode, led, lamp, ammeter, voltmeter, wire. Voltage sources and batteries have + at \"to\"; current sources and diodes point from \"from\" to \"to\". label is the name only (R_1, V_s, 4i_o; _ makes a subscript); put the number in value and unit (\"Ω\", \"kΩ\", \"V\", \"mA\"), never both in label. current:\"i_x\" draws a current arrow, voltage:\"v_x\" draws + − marks (+ at from). Optional order:[node names] fixes the left-to-right node order. Copy the topology exactly from the problem. Solve and draw from ONE netlist: first {\"action\":\"call\",\"module\":\"mowr\",\"fn\":\"solveCircuit\",\"args\":[this same netlist object]} returns every node voltage, each element's voltage (V(from) − V(to)), current (from → to) and power, and each named current/voltage; state those numbers and put this identical netlist in the figure. Dependent sources are controlled by the element whose current or voltage their label names (\"4i_o\" = 4 × the current:\"i_o\" element). Capacitors are open and inductors shorts in DC; for a switching or RC/RL response use mowr circuitTransient [netlist, {endTime, dt}].",
  },
  {
    name: "logic circuit",
    use: "gate-level diagram of a Boolean expression",
    figure: { module: "mowr", fn: "logicDiagram", args: ["A B + !C", "F", "F = AB + C′"] },
    notes: "Operators: juxtaposition or * for AND, + for OR, ! or ' for NOT, ^ for XOR. Simplify first with dld/simplify if the user asked for a minimal circuit. dld/kmap buildKMap counts the first variable as the lowest minterm bit, so for a textbook F(A,B,C) = Σm(…) pass variables reversed ([\"C\",\"B\",\"A\"]).",
  },
];


/** Concept diagrams: processes, data, sequences and structures that any subject needs, not only physics. */
export const diagramRecipes: KinetraRecipe[] = [
  {
    name: "flowchart",
    use: "processes, algorithms, procedures, decision paths, pathways (biology, chemistry, business, computing)",
    figure: { module: "mowr", fn: "flowchart", args: [{ title: "Enzyme-catalysed reaction", direction: "down", nodes: [{ id: "s", label: "Substrate meets enzyme", shape: "start" }, { id: "b", label: "Substrate binds the active site" }, { id: "d", label: "Correct shape and conditions?", shape: "decision" }, { id: "c", label: "Enzyme–substrate complex forms" }, { id: "p", label: "Products released; enzyme unchanged", shape: "end" }, { id: "n", label: "No reaction", shape: "end" }], edges: [{ from: "s", to: "b" }, { from: "b", to: "d" }, { from: "d", to: "c", label: "Yes" }, { from: "d", to: "n", label: "No" }, { from: "c", to: "p" }] }] },
    notes: "shape: process (default), decision (diamond, label the out-edges Yes/No), start, end, io (input/output), note. direction \"right\" for wide, short processes. Loops (an edge back to an earlier node) are drawn around the side. Up to 40 nodes.",
  },
  {
    name: "bar chart",
    use: "comparing quantities across categories; grouped series; type hbar for long labels, stacked for parts of a whole",
    figure: { module: "mowr", fn: "chart", args: [{ title: "Energy use by sector", type: "bar", labels: ["Industry", "Transport", "Homes", "Services"], series: [{ name: "2015", values: [34, 29, 22, 15] }, { name: "2025", values: [31, 30, 21, 18] }], yLabel: "Share of total", unit: "%" }] },
    notes: "Every series has exactly one number per label. type: bar | hbar | stacked | line | pie (pie uses the first series). Use real or computed values only.",
  },
  {
    name: "line chart",
    use: "trends over time or any ordered variable",
    figure: { module: "mowr", fn: "chart", args: [{ title: "Population growth", type: "line", labels: ["1990", "2000", "2010", "2020"], series: [{ name: "Population", values: [5.3, 6.1, 6.9, 7.8] }], yLabel: "People", unit: "bn" }] },
    notes: "For y = f(x) curves use the function plot recipe instead.",
  },
  {
    name: "timeline",
    use: "historical events, project phases, schedules, life cycles in order",
    figure: { module: "mowr", fn: "timeline", args: [{ title: "Key steps in the French Revolution", events: [{ date: "1789", label: "Storming of the Bastille", detail: "14 July" }, { date: "1791", label: "Constitution adopted" }, { date: "1793", label: "Reign of Terror begins" }, { date: "1799", label: "Napoleon takes power" }] }] },
    notes: "Up to 30 events in order; more than 8 are drawn as a vertical list with details.",
  },
  {
    name: "cycle",
    use: "repeating processes: water cycle, cell cycle, Krebs cycle, product life cycle, feedback loops",
    figure: { module: "mowr", fn: "cycle", args: [{ title: "The water cycle", center: "Water cycle", steps: [{ label: "Evaporation", detail: "Sun heats surface water" }, { label: "Condensation", detail: "Vapour forms clouds" }, { label: "Precipitation" }, { label: "Collection", detail: "Rivers, lakes, oceans" }] }] },
    notes: "3–12 steps in order; the arrow from the last step returns to the first.",
  },
  {
    name: "mind map",
    use: "a topic overview, revision summary or brainstorm: a central idea with branches and sub-points",
    figure: { module: "mowr", fn: "mindMap", args: [{ title: "Cell biology overview", center: "The cell", branches: [{ label: "Organelles", children: ["Nucleus", "Mitochondria", "Ribosomes"] }, { label: "Transport", children: ["Diffusion", "Osmosis", "Active transport"] }, { label: "Division", children: ["Mitosis", "Meiosis"] }, { label: "Types", children: ["Prokaryotic", "Eukaryotic"] }] }] },
    notes: "Up to 10 branches with up to 8 short children each.",
  },
  {
    name: "tree / hierarchy",
    use: "classification, taxonomy, organisation chart, decision tree, family of concepts",
    figure: { module: "mowr", fn: "tree", args: [{ title: "Classification of matter", root: { label: "Matter", children: [{ label: "Pure substances", children: [{ label: "Elements" }, { label: "Compounds" }] }, { label: "Mixtures", children: [{ label: "Homogeneous", detail: "e.g. salt water" }, { label: "Heterogeneous", detail: "e.g. sand in water" }] }] } }] },
    notes: "Up to 60 nodes and 6 levels; detail is an optional short second line.",
  },
  {
    name: "Venn diagram",
    use: "similarities and differences between two or three things",
    figure: { module: "mowr", fn: "venn", args: [{ title: "Mitosis and meiosis", sets: [{ label: "Mitosis", items: ["2 daughter cells", "Identical", "Growth and repair"] }, { label: "Meiosis", items: ["4 daughter cells", "Genetically different", "Gametes"] }], overlap: ["DNA replicates first", "Spindle fibres", "Nuclear division"] }] },
    notes: "2 or 3 sets; for 3 sets, overlaps: {AB:[…],AC:[…],BC:[…],all:[…]}. Keep items to a few words.",
  },
  {
    name: "chat visual",
    use: "a ```visual already drawn in the conversation (plot, chart, diagram, figure or 3d), printed unchanged",
    figure: { module: "mowr", fn: "visual", args: [{ kind: "diagram", title: "Request lifecycle", direction: "right", nodes: [{ id: "a", label: "Client request" }, { id: "b", label: "Validate input", shape: "pill" }, { id: "c", label: "Store result" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c", label: "valid" }] }] },
    notes: "args[0] is the visual's JSON object exactly as written in the ```visual block. Printed on white paper; sliders at their starting values, animations at their final frame, every step shown.",
  },
];

/**
 * Textbook illustrations (core/illustration.ts): the drawings of a physics book, with apparatus drawn as it looks
 * (shaded blocks and balls, pulleys and ropes on true tangents, spring scales, inclines, levers, vessels, charges with
 * computed field lines). The same figures draw in the chat as ```visual kind "figure".
 */
export const illustrationRecipes: KinetraRecipe[] = figureRecipes.map((r) => ({ name: `textbook figure: ${r.name}`, use: r.use, figure: { module: "mowr", fn: "illustration", args: [r.figure] }, notes: r.notes }));

/** The full item list for {"module":"mowr","fn":"illustration"} figures, returned by {"action":"skill","name":"figures"}. */
export const illustrationGuide = `${figureVocabulary}
Call it as {"module":"mowr","fn":"illustration","args":[{"items":[…],"view"?:{…}}]}. Start from the closest textbook figure recipe and change positions, sizes and labels; keep every id unique and refer only to anchors of items that exist.`;

/** Every recipe: the science recipes, the concept diagrams and the textbook figures. */
export const allRecipes = () => [...kinetraRecipes, ...diagramRecipes, ...illustrationRecipes];
export const recipeText = (recipes: KinetraRecipe[] = allRecipes()) =>
  recipes.map((r) => `- ${r.name} (${r.use}): {"figure":${JSON.stringify(r.figure)}} — ${r.notes}`).join("\n");

/**
 * What each science recipe is about. A recipe goes with the instructions when the request, the conversation or its
 * sources mention its topic; concept diagrams (flowcharts, charts, timelines…) serve every subject and always go.
 * Generous on purpose: a recipe sent needlessly costs some prompt, one left out costs a figure drawn from guesswork.
 */
const MECHANICS = "force|newton|mechanic|dynamics|statics|equilibrium|tension|weight|mass|accelerat|friction";
const ELECTROSTATICS = "electrostat|charge|coulomb|electric field|field lines?|static electric|insulator|conductor|induction";
const topic = (words: string) => new RegExp(words, "i");
export const recipeTopics: Record<string, RegExp> = {
  "function plot": /plot|graph|curve|function|f\s*\(\s*x\s*\)|y\s*=|parabol|quadratic|polynomial|trig|\bsin\b|\bcos\b|\btan\b|exponential|logarithm|derivative|differentiat|integral|integrat|calculus|scatter|data points?|asymptot|equation|maths?\b|mathematic/i,
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
};

/**
 * The recipes for one request: every concept diagram, and each science recipe whose topic `text` mentions (a recipe
 * without a topic always goes). With pictures attached every recipe goes, since a scanned problem names its apparatus
 * only in the picture. `omitted` counts the recipes left out (the instructions then say how to get them).
 */
export function recipesFor(text: string, { pictures = false }: { pictures?: boolean } = {}) {
  const science = [...kinetraRecipes, ...illustrationRecipes];
  const chosen = new Set(pictures ? science : science.filter((r) => recipeTopics[r.name]?.test(text) ?? true));
  return { recipes: allRecipes().filter((r) => !science.includes(r) || chosen.has(r)), omitted: science.length - chosen.size };
}
