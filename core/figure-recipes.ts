/**
 * Verified textbook figures. Each one renders as-is (tests/illustration.test.ts draws every recipe), so a model
 * starts from a figure that works and changes the values, never guessing the shape of the description. The same
 * items draw in the chat (```visual with "kind":"figure") and in PDFs (Kinetra figure {"module":"mowr","fn":"illustration"}).
 */
export type FigureRecipe = { name: string; use: string; figure: { items: unknown[]; view?: unknown }; notes: string };

const t30 = Math.tan(Math.PI / 6), c30 = Math.cos(Math.PI / 6);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const figureRecipes: FigureRecipe[] = [
  {
    name: 'spring scale between two hanging masses',
    use: 'two masses hanging over pulleys at the corners of a table, joined through a spring scale (tension equals one weight)',
    figure: { items: [
      { type: 'table', id: 'table', x: 0, y: 1.5, w: 5, h: 3 },
      { type: 'pulley', id: 'pL', x: -2.75, y: 3.3, r: 0.35, support: [-2.5, 3] },
      { type: 'pulley', id: 'pR', x: 2.75, y: 3.3, r: 0.35, support: [2.5, 3] },
      { type: 'scale', id: 'scale', from: [-1.1, 3.65], to: [1.1, 3.65] },
      { type: 'ball', id: 'mL', x: -3.1, y: 0.7, r: 0.45, label: 'm' },
      { type: 'ball', id: 'mR', x: 3.1, y: 0.7, r: 0.45, label: 'm' },
      { type: 'rope', path: ['mL.top', { around: 'pL', side: 'over' }, 'scale.a'] },
      { type: 'rope', path: ['scale.b', { around: 'pR', side: 'over' }, 'mR.top'] },
    ] },
    notes: 'A ball hangs straight down when its centre x equals the pulley centre x ± radius. The rope reaches the scale at the pulley top (y = pulley y + r).',
  },
  {
    name: 'hanging pulley with a spring scale (Atwood)',
    use: 'a pulley hung from the ceiling through a spring scale, with a mass on each side; also the Atwood machine',
    figure: { items: [
      { type: 'ceiling', id: 'ceiling', y: 6, left: -1.6, right: 1.6 },
      { type: 'scale', id: 'scale', from: [0, 6], to: [0, 4.75] },
      { type: 'pulley', id: 'p', x: 0, y: 4.1, r: 0.5, support: 'scale.b' },
      { type: 'block', id: 'm1', x: -0.5, y: 1.5, w: 0.7, h: 0.8, label: 'm' },
      { type: 'block', id: 'm2', x: 0.5, y: 1.5, w: 0.7, h: 0.8, label: 'm' },
      { type: 'rope', path: ['m1.top', { around: 'p', side: 'over' }, 'm2.top'] },
    ] },
    notes: 'Blocks hang vertically when their x = pulley x ± r. For an Atwood machine give the blocks different labels and add force arrows (T up, m g down) at their centres.',
  },
  {
    name: 'block on an incline held by a spring scale',
    use: 'a block on a frictionless ramp held by a scale or rope parallel to the slope',
    figure: { items: [
      { type: 'incline', id: 'ramp', x: 0, y: 0, base: 6, angle: 30 },
      { type: 'wall', id: 'post', from: [6, r3(6 * t30)], to: [6, r3(6 * t30 + 1.4)], side: 'right' },
      { type: 'block', id: 'm', on: 'ramp', at: 0.42, w: 0.9, h: 0.8, label: 'm' },
      { type: 'scale', id: 'scale', from: 'm.right', to: [6, r3(6 * t30 + 0.4 / c30)] },
    ] },
    notes: 'A block placed with "on" sits on the slope at fraction "at" from the bottom and turns with it; its "right" anchor faces up the slope. A line parallel to the slope at height k meets x = X at y = X·tanθ + k/cosθ.',
  },
  {
    name: 'free-body diagram on an incline',
    use: 'forces on a block on a slope: weight, normal force and friction, with the angle marked',
    figure: { items: [
      { type: 'incline', id: 'ramp', x: 0, y: 0, base: 7, angle: 30 },
      { type: 'block', id: 'b', on: 'ramp', at: 0.5, w: 1.2, h: 0.9, label: 'm' },
      { type: 'force', at: 'b.center', dir: -90, length: 2.2, label: 'mg' },
      { type: 'force', at: 'b.center', dir: 120, length: 1.9, label: 'N' },
      { type: 'force', at: 'b.center', dir: 30, length: 1.1, label: 'f', color: 'velocity' },
      { type: 'line', points: ['b.center', { at: 'b.center', dir: -60, length: 1.9 }], dash: true, width: 1 },
      { type: 'angle', at: 'b.center', from: -90, to: -60, r: 0.9, label: 'θ' },
    ] },
    notes: 'dir is degrees from +x, counter-clockwise (90 = up, −90 = down). On a slope of angle θ rising to the right: up the slope is θ, the normal is θ+90, down the slope is θ+180. Lengths should be proportional to the magnitudes (here N = mg cosθ).',
  },
  {
    name: 'wheelbarrow lever (torques)',
    use: 'levers, torque and mechanical advantage: input and output forces with their perpendicular lever arms, plus a free-body inset',
    figure: { view: { x: [-5.2, 3.6], y: [-1.6, 3.2] }, items: [
      { type: 'ground', id: 'g', y: 0, left: -5, right: 1.2 },
      { type: 'wheel', id: 'w', x: 0, y: 0.38, r: 0.38 },
      { type: 'polygon', points: [[-2.6, 1.15], [0.3, 1.15], [0.85, 2.1], [-3.0, 2.1]], fill: 'red' },
      { type: 'rod', id: 'handle', from: [-4.6, 1.55], to: [0, 0.38], thickness: 0.09, color: 'wood' },
      { type: 'line', points: [[-1.9, 1.2], [-2.0, 0.3]], width: 3, color: '#666666' },
      { type: 'point', id: 'cg', at: [-0.55, 1.75], label: 'CG', color: '#8b1d2c' },
      { type: 'force', at: 'cg.center', dir: -90, length: 1.0, label: 'w', pointing: 'into' },
      { type: 'force', at: 'cg.center', dir: 90, length: 0.85, label: 'F_o', style: 'light', pointing: 'into' },
      { type: 'force', at: [-4.6, 0.4], dir: 90, length: 1.0, label: 'F_i' },
      { type: 'force', at: 'w.bottom', dir: 90, length: 1.1, label: 'N', pointing: 'into' },
      { type: 'line', points: [[-4.6, 0.4], [-4.6, -0.75]], dash: true, width: 1 },
      { type: 'line', points: [[-0.55, 0.9], [-0.55, -1.25]], dash: true, width: 1 },
      { type: 'dimension', from: [-4.6, -0.6], to: [0, -0.6], label: 'l_i = r_{i⊥}' },
      { type: 'dimension', from: [-0.55, -1.1], to: [0, -1.1], label: 'l_o = r_{o⊥}' },
      { type: 'fbd', x: 2.6, y: 0.9, scale: 1.1, forces: [{ label: 'N', dir: 90, length: 1 }, { label: 'F_i', dir: 90, length: 0.35 }, { label: 'w', dir: -90, length: 1.25 }] },
    ] },
    notes: '"pointing":"into" draws the arrow ending at the point (a push, a support or a contact force from below). Lever arms are dimension items between the line of action and the pivot.',
  },
  {
    name: 'seesaw lever on a pivot',
    use: 'balancing torques: a beam on a fulcrum with loads at different distances',
    figure: { items: [
      { type: 'ground', y: -0.7, left: -4.5, right: 4.5 },
      { type: 'pivot', id: 'f', at: [0, 0], size: 0.7 },
      { type: 'rod', id: 'beam', from: [-4, 0.06], to: [4, 0.06], thickness: 0.12, color: 'wood' },
      { type: 'block', id: 'a', on: 'beam', at: 0.12, w: 0.9, h: 0.9, label: 'm_1' },
      { type: 'block', id: 'b', on: 'beam', at: 0.8, w: 0.7, h: 0.7, label: 'm_2' },
      { type: 'force', at: 'a.center', dir: -90, length: 1.6, label: 'm_1g' },
      { type: 'force', at: 'b.center', dir: -90, length: 1.25, label: 'm_2g' },
      { type: 'dimension', from: [-3.04, 0.06], to: [0, 0.06], offset: 2.0, label: 'd_1' },
      { type: 'dimension', from: [0, 0.06], to: [2.4, 0.06], offset: 2.0, label: 'd_2' },
    ] },
    notes: 'Blocks placed "on" a rod sit on its upper side; "at" is the fraction from the rod\'s "from" end. Dimension offset moves the measuring line sideways (positive = to the left of from→to, which is up here).',
  },
  {
    name: 'charged sphere near a charged wire, with field lines',
    use: 'electrostatics: a charged sphere, wire, rod or point charges with computed electric field lines',
    figure: { view: { x: [-4, 4], y: [-2.4, 3.6] }, items: [
      { type: 'wire', id: 'wire', from: [-3.2, 0], to: [3.2, 0], thickness: 0.2, q: -3, color: 'steel', label: 'negatively charged wire' },
      { type: 'ball', id: 'sphere', x: 0, y: 2, r: 0.55, q: 1, color: 'gold', label: 'positive sphere', labelPosition: 'above' },
      { type: 'fieldLines', lines: 16 },
    ] },
    notes: 'q is the signed total charge (any unit; only ratios matter). Field lines are traced from the charges as 3D objects lying in the page (spheres as point charges, rods and wires as uniform line charges), start on positive charges and end on negative ones or leave the view; their density is qualitative.',
  },
  {
    name: 'electric dipole field',
    use: 'two point charges (dipole, like or unlike charges) with field lines',
    figure: { view: { x: [-4, 4], y: [-2.6, 2.6] }, items: [
      { type: 'charge', id: 'p', at: [-1.5, 0], q: 1, r: 0.25, label: '+q' },
      { type: 'charge', id: 'n', at: [1.5, 0], q: -1, r: 0.25, label: '−q' },
      { type: 'fieldLines', lines: 18 },
    ] },
    notes: 'Use q of the same sign for two like charges (lines repel). Make the charges unequal (q: 2 and −1) to show that more lines leave the larger charge.',
  },
  {
    name: 'rotating liquid in a vessel',
    use: 'fluids: a liquid surface in a container, flat or curved (rotating vessel paraboloid, meniscus), with labelled points',
    figure: { items: [
      { type: 'container', id: 'v', x: 0, y: 0, w: 4, h: 5, level: 2.2, surface: '0.45*x^2' },
      { type: 'line', points: [[0, -0.2], [0, 5.6]], width: 1.2 },
      { type: 'text', at: [0, 5.9], text: 'A' },
      { type: 'text', at: [0.25, 0.25], text: 'B' },
      { type: 'line', points: [[-1.6, 3.35], [0, 3.35]], width: 1 },
      { type: 'line', points: [[0, 5.5], [-1.6, 3.35]], width: 1 },
      { type: 'text', at: [-2.35, 3.35], text: 'D' },
      { type: 'text', at: [0.25, 3.35], text: 'C' },
      { type: 'line', points: [[0, 2.45], [0.75, 2.45]], width: 1 },
      { type: 'text', at: [-0.25, 2.45], text: 'E' },
      { type: 'text', at: [1.0, 2.55], text: 'F' },
    ] },
    notes: 'surface is the height of the liquid above "level" as a formula in x, measured from the vessel centre (0.45*x^2 is the paraboloid of a rotating liquid, ω²x²/2g). Omit it for a flat surface.',
  },
  {
    name: 'mass on a spring',
    use: 'simple harmonic motion: a block hanging from a spring, or a spring and block on a floor',
    figure: { items: [
      { type: 'ceiling', y: 4, left: -1.2, right: 1.2 },
      { type: 'spring', id: 's', from: [0, 4], to: [0, 1.6], coils: 9, label: 'k' },
      { type: 'block', id: 'm', x: 0, y: 1.2, w: 0.9, h: 0.8, label: 'm' },
      { type: 'line', points: [[0.7, 1.6], [1.7, 1.6]], dash: true, width: 1, label: 'equilibrium' },
      { type: 'force', at: 'm.center', dir: -90, length: 1.1, label: 'mg' },
      { type: 'force', at: { at: 'm.top', dx: 0.3 }, dir: 90, length: 1.0, label: 'F_s' },
    ] },
    notes: 'For a horizontal spring use a wall item (x, bottom, top) and a ground, with the spring from the wall to the block\'s "left" anchor.',
  },
];

/** The recipes as instruction text; `only` picks some by index when the whole list would be too long. */
export const figureRecipeText = (only?: number[]) => figureRecipes.filter((_, i) => !only || only.includes(i)).map(r =>`- ${r.name} (${r.use}): ${JSON.stringify(r.figure)} — ${r.notes}`).join('\n');

/** The whole item vocabulary, kept beside the recipes so chat and PDF instructions describe the same thing (core/illustration.ts layout and draw). */
export const figureVocabulary = `TEXTBOOK FIGURE ITEMS (world units, y up, angles in degrees counter-clockwise from +x; any number may be a formula using slider keys and t):
- Points are [x,y], an anchor "id.name", a position along an item "id@0.3", or an offset {"at":"id.name","dir":30,"length":1.5} / {"at":[x,y],"dx":1,"dy":0}.
- Surfaces: ground / ceiling {"y":0,"left":-4,"right":4} or {"from":[x,y],"to":[x,y]}; wall {"x":5,"bottom":0,"top":3} or from/to; "side" (below|above|left|right) picks the hatched side. surface: any hatched line.
- incline {"x","y" (the acute corner),"base","angle","facing":"right"|"left","angleLabel":"θ"}: anchors bottom, corner, top; blocks and balls sit on it with "on":"rampId","at":0..1 (from the bottom).
- table / rect {"x","y" (centre),"w","h","fill"}. block {"x","y" (centre),"w","h","angle"} or {"on":id,"at":f}; anchors center, top, bottom, left, right, topLeft…; on a slope "right" faces up the slope; label sits inside ("labelPosition":"left|right|above|below" moves it out).
- ball {"x","y","r"} or {"on":id,"at":f}; "q" charges it. pulley {"x","y","r","support":point} (the strap to its mount). wheel {"x","y","r"}.
- rope {"path":[point, {"around":"pulleyId","side":"over|under|left|right"}, …, point]}: follows true tangents and wraps the rim; starts and ends at points (use anchors such as "m1.top").
- spring {"from","to","coils"}; scale (spring balance) {"from","to","reading":0..1}, anchors a (from) and b (to); rod {"from","to","thickness","color"} (beams, levers, handles), wire (thin rod); pivot {"at","size","style":"triangle"|"pin"}.
- container {"x" (centre),"y" (bottom),"w","h","level","surface":"formula in x from the centre","liquid":"water|oil|mercury"}.
- force {"at":point,"dir":deg,"length"} or {"at","to"} or {"at","dx","dy"}; "pointing":"into" ends the arrow at the point (pushes, supports, contact forces); "style":"light"|"dashed"; "color":"velocity"|"acceleration"; labels like "F_{net}", "m_1g" are bold vectors.
- dimension {"from","to","offset","label"} (lever arms, lengths); angle {"at", "from":deg,"to":deg} or {"at","a":point,"b":point}, "label"; line {"points":[…],"dash","arrow":"end|both"}; curve {"y":"formula in x","from","to"} or {"x":"…s…","y":"…s…","from","to"}; polygon {"points","fill"}; ellipse {"x","y","rx","ry","dash"}; point {"at","label"}; text {"at","text"}.
- Electrostatics: "q" (signed total charge) on ball, rod, wire, block or rect; charge {"at","q","r"} for point charges; fieldLines {"lines":16} traces the field of every charged item (spheres as point charges, rods and wires as uniform line charges).
- fbd {"x","y","scale","forces":[{"label":"N","dir":90,"length":1}]}: a free-body inset (a dot with arrows).
- Every item may have "id", "label", "color" (orange blue red green gray yellow purple teal steel copper brass gold wood glass rubber water, or #hex). Labels: _ subscript, ^ superscript, \\theta → θ. "view":{"x":[a,b],"y":[c,d]} fixes the frame (otherwise it fits the items).`;
