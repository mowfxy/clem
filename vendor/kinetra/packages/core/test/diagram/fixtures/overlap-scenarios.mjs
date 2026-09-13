// visual_oracle_extra.mjs
// Extended oracle models for renderer overlap audit. Covers the diagram
// catalog that the original S1-S7 set did not exercise:
//   fields (vector + scalar), pulley (single + Atwood),
//   logic_schematic (small + large), and additional circuit_schematic
//   stress scenarios (RLC + Wheatstone bridge).
//
// Each entry is a [scenarioId, rendererName, oracleModel] triple. The
// rendererName matches the export in packages/core/src/diagram/*.ts.

export const EXTRA_SCENARIOS = [
  // --- fields: vector (uniform horizontal flow) ---
  ['F1', 'renderVectorField', {
    type: 'vector',
    field: (p) => ({ x: 1, y: 0 }),
    world: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
    width: 600, height: 400,
    cols: 6, rows: 6,
    title: 'Uniform flow'
  }],
  // --- fields: scalar (Gaussian hill) ---
  ['F2', 'renderScalarField', {
    type: 'scalar',
    field: (p) => Math.exp(-(p.x*p.x + p.y*p.y)),
    world: { xMin: -3, xMax: 3, yMin: -3, yMax: 3 },
    width: 600, height: 400,
    cols: 12, rows: 10,
    contours: [0.1, 0.4, 0.7],
    title: 'Gaussian hill'
  }],
  // --- pulley: single fixed pulley with two masses (compound) ---
  ['P1', 'renderPulley', {
    pulleys: [
      { center: { x: 0, y: 4 }, radius: 0.6, fixed: true, label: 'A' }
    ],
    masses: [
      { mass: 2, position: { x: -1.5, y: 1 }, size: { w: 0.6, h: 0.6 }, label: 'm1=2kg' },
      { mass: 3, position: { x: 1.5, y: 1 }, size: { w: 0.6, h: 0.6 }, label: 'm2=3kg' }
    ],
    tension: 19.6,
    world: { xMin: -3, xMax: 3, yMin: -0.5, yMax: 5.5 },
    width: 600, height: 400,
    title: 'Single fixed pulley'
  }],
  // --- pulley: Atwood machine (two pulleys, two masses) ---
  ['P2', 'renderPulley', {
    pulleys: [
      { center: { x: -1, y: 4 }, radius: 0.5, fixed: true, label: 'A' },
      { center: { x: 1, y: 4 }, radius: 0.5, fixed: true, label: 'B' }
    ],
    masses: [
      { mass: 2, position: { x: -1, y: 1 }, size: { w: 0.6, h: 0.6 }, label: 'm1=2kg' },
      { mass: 4, position: { x: 1, y: 0.5 }, size: { w: 0.6, h: 0.6 }, label: 'm2=4kg' }
    ],
    tension: 26.13,
    world: { xMin: -3, xMax: 3, yMin: -0.5, yMax: 5.5 },
    width: 600, height: 400,
    title: 'Atwood machine'
  }],
  // --- logic_schematic: 3-input AND gate ---
  ['L1', 'renderLogicSchematic', {
    circuit: {
      inputs: [
        { id: 'IN_A', label: 'A' },
        { id: 'IN_B', label: 'B' },
        { id: 'IN_C', label: 'C' }
      ],
      outputs: [
        { id: 'OUT_Y', label: 'Y' }
      ],
      gates: [
        { id: 'IN_A', kind: 'INPUT', output: 'net_a' },
        { id: 'IN_B', kind: 'INPUT', output: 'net_b' },
        { id: 'IN_C', kind: 'INPUT', output: 'net_c' },
        { id: 'G1', kind: 'AND', inputs: ['net_a', 'net_b'], output: 'net_ab' },
        { id: 'G2', kind: 'AND', inputs: ['net_ab', 'net_c'], output: 'net_y' },
        { id: 'OUT_Y', kind: 'OUTPUT', inputs: ['net_y'] }
      ]
    },
    width: 600, height: 300,
    title: '3-input AND'
  }],
  // --- logic_schematic: XOR + NOT combination (XNOR) ---
  ['L2', 'renderLogicSchematic', {
    circuit: {
      inputs: [
        { id: 'IN_A', label: 'A' },
        { id: 'IN_B', label: 'B' }
      ],
      outputs: [
        { id: 'OUT_Y', label: 'Y' }
      ],
      gates: [
        { id: 'IN_A', kind: 'INPUT', output: 'net_a' },
        { id: 'IN_B', kind: 'INPUT', output: 'net_b' },
        { id: 'G1', kind: 'XOR', inputs: ['net_a', 'net_b'], output: 'net_x' },
        { id: 'G2', kind: 'NOT', inputs: ['net_x'], output: 'net_y' },
        { id: 'OUT_Y', kind: 'OUTPUT', inputs: ['net_y'] }
      ]
    },
    width: 600, height: 300,
    title: 'XNOR'
  }],
  // --- circuit_schematic: RLC low-pass ---
  ['C2', 'renderSchematic', {
    components: [
      { id: 'V1', kind: 'voltage-source', position: { x: 0, y: 0 }, label: 'V', unit: 'V', value: 5 },
      { id: 'R1', kind: 'resistor',       position: { x: 4, y: 0 }, label: 'R', unit: 'Ohm', value: 100 },
      { id: 'L1', kind: 'inductor',       position: { x: 8, y: 0 }, label: 'L', unit: 'H',  value: 0.01 },
      { id: 'C1', kind: 'capacitor',      position: { x: 12, y: 2 }, label: 'C', unit: 'F', value: 1e-6 },
      { id: 'G1', kind: 'ground',         position: { x: 12, y: 4 } }
    ],
    wires: [
      { from: { componentId: 'V1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
      { from: { componentId: 'V1', pin: 0 }, to: { componentId: 'R1', pin: 0 } },
      { from: { componentId: 'R1', pin: 1 }, to: { componentId: 'L1', pin: 0 } },
      { from: { componentId: 'L1', pin: 1 }, to: { componentId: 'C1', pin: 0 } },
      { from: { componentId: 'C1', pin: 1 }, to: { componentId: 'G1', pin: 0 } }
    ],
    world: { xMin: -1, xMax: 15, yMin: -2, yMax: 6 },
    width: 800, height: 400,
    title: 'RLC low-pass'
  }],
  // --- circuit_schematic: Wheatstone bridge ---
  ['C3', 'renderSchematic', {
    components: [
      { id: 'V1', kind: 'voltage-source', position: { x: 0, y: 0 }, label: 'V', unit: 'V', value: 5 },
      { id: 'R1', kind: 'resistor',       position: { x: 4, y: -2 }, label: 'R1', unit: 'Ohm', value: 100 },
      { id: 'R2', kind: 'resistor',       position: { x: 4, y: 2 }, label: 'R2', unit: 'Ohm', value: 100 },
      { id: 'R3', kind: 'resistor',       position: { x: 8, y: -2 }, label: 'R3', unit: 'Ohm', value: 100 },
      { id: 'R4', kind: 'resistor',       position: { x: 8, y: 2 }, label: 'R4', unit: 'Ohm', value: 100 },
      { id: 'M1', kind: 'voltage-source',          position: { x: 6, y: 0 }, label: 'M', unit: '', value: 0 },
      { id: 'G1', kind: 'ground',         position: { x: 0, y: 4 } }
    ],
    wires: [
      { from: { componentId: 'V1', pin: 0 }, to: { componentId: 'R1', pin: 0 } },
      { from: { componentId: 'V1', pin: 0 }, to: { componentId: 'R2', pin: 0 } },
      { from: { componentId: 'V1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
      { from: { componentId: 'R1', pin: 1 }, to: { componentId: 'R3', pin: 0 } },
      { from: { componentId: 'R2', pin: 1 }, to: { componentId: 'R4', pin: 0 } },
      { from: { componentId: 'R3', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
      { from: { componentId: 'R4', pin: 1 }, to: { componentId: 'G1', pin: 0 } }
    ],
    world: { xMin: -1, xMax: 11, yMin: -3, yMax: 5 },
    width: 800, height: 400,
    title: 'Wheatstone bridge'
  }]
];
