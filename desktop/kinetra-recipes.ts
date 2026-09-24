/**
 * Known-good Kinetra figures. Every recipe is rendered by the real worker in
 * tests/desktop/kinetra.test.ts, so the model starts from JSON that works instead of
 * guessing argument shapes. Adapt values; keep the structure.
 */
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
    use: "analog circuits: sources, resistors, capacitors, inductors, switches",
    figure: { module: "diagram/circuit_schematic", fn: "renderSchematic", args: [{ components: [{ id: "V1", kind: "voltage-source", label: "V1", value: 12, unit: "V", position: { x: 0, y: 2 }, rotationDeg: 90 }, { id: "R1", kind: "resistor", label: "R1", value: 100, unit: "Ω", position: { x: 2, y: 4 } }, { id: "R2", kind: "resistor", label: "R2", value: 200, unit: "Ω", position: { x: 4, y: 2 }, rotationDeg: 90 }], wires: [{ from: { componentId: "V1", pin: 1 }, to: { componentId: "R1", pin: 0 }, via: [{ x: 0, y: 4 }] }, { from: { componentId: "R1", pin: 1 }, to: { componentId: "R2", pin: 1 }, via: [{ x: 4, y: 4 }] }, { from: { componentId: "R2", pin: 0 }, to: { componentId: "V1", pin: 0 }, via: [{ x: 4, y: 0 }, { x: 0, y: 0 }] }], world: { xMin: -1.5, xMax: 5.5, yMin: -1, yMax: 5 }, width: 560, height: 440, title: "Voltage divider" }] },
    notes: "Every wire joins two pins (0 or 1); use via points for right angles. Solve values with circuit/circuit or circuit/spice before labelling currents.",
  },
  {
    name: "logic circuit",
    use: "gate-level diagram of a Boolean expression",
    figure: { module: "mowr", fn: "logicDiagram", args: ["A B + !C", "F", "F = AB + C′"] },
    notes: "Operators: juxtaposition or * for AND, + for OR, ! or ' for NOT, ^ for XOR. Simplify first with dld/simplify if the user asked for a minimal circuit.",
  },
];

export const recipeText = () =>
  kinetraRecipes.map((r) => `- ${r.name} (${r.use}): {"figure":${JSON.stringify(r.figure)}} — ${r.notes}`).join("\n");
