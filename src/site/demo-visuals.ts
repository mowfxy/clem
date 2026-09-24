/** Visual descriptions for the website demo, written in the same language models use in the app. */
export const demoSpecs: Record<string, unknown> = {
  photosynthesis: {
    kind: 'diagram', title: 'How photosynthesis works', subject: 'Biology', caption: 'Light reactions in the thylakoid; the Calvin cycle in the stroma.',
    nodes: [
      { id: 'light', label: 'Sunlight', shape: 'circle' }, { id: 'water', label: 'Water', shape: 'pill' }, { id: 'lr', label: 'Light reactions' },
      { id: 'o2', label: 'Oxygen', shape: 'pill' }, { id: 'co2', label: 'CO₂', shape: 'pill' }, { id: 'cc', label: 'Calvin cycle' }, { id: 'sugar', label: 'Glucose', shape: 'circle' },
    ],
    edges: [{ from: 'light', to: 'lr', flow: true }, { from: 'water', to: 'lr' }, { from: 'lr', to: 'o2' }, { from: 'lr', to: 'cc', label: 'ATP + NADPH', flow: true }, { from: 'co2', to: 'cc' }, { from: 'cc', to: 'sugar', flow: true }],
    steps: [
      { title: 'Capture light', text: 'Chlorophyll absorbs light and splits water, releasing oxygen.', focus: ['light', 'water', 'lr', 'o2'] },
      { title: 'Store energy', text: 'The light reactions charge ATP and NADPH.', focus: ['lr', 'cc'] },
      { title: 'Fix carbon', text: 'The Calvin cycle builds glucose from CO₂.', focus: ['co2', 'cc', 'sugar'] },
    ],
  },
  wave: {
    kind: 'plot', title: 'Standing wave', subject: 'Waves', equation: 'y = 2A·sin(nπx)·cos(ωt)', caption: 'Two equal waves moving in opposite directions.',
    params: [{ key: 'A', label: 'Amplitude', min: 0.2, max: 1.5, step: 0.1, value: 1 }, { key: 'n', label: 'Harmonic', min: 1, max: 5, step: 1, value: 2 }],
    x: { min: 0, max: 1, label: 'Position' }, y: { min: -3.2, max: 3.2 },
    layers: [
      { type: 'function', expr: 'A*sin(n*pi*x - 2*t)', color: 'soft', dash: true },
      { type: 'function', expr: 'A*sin(n*pi*x + 2*t)', color: 'soft', dash: true },
      { type: 'function', expr: '2*A*sin(n*pi*x)*cos(2*t)', color: 'blue', label: 'sum' },
    ],
    readouts: [{ label: 'Nodes', expr: 'n+1', digits: 0 }, { label: 'Wavelength', expr: '2/n', unit: 'L' }],
  },
  market: {
    kind: 'plot', title: 'Supply and demand', subject: 'Economics', caption: 'Linear curves; shifts move the equilibrium.',
    params: [{ key: 'd', label: 'Demand shift', min: -30, max: 30, step: 1, value: 0 }, { key: 's', label: 'Supply shift', min: -30, max: 30, step: 1, value: 0 }],
    x: { min: 0, max: 100, label: 'Quantity' }, y: { min: 0, max: 130, label: 'Price' },
    layers: [
      { type: 'function', expr: '100 - x + d', color: 'blue', label: 'Demand' },
      { type: 'function', expr: '20 + x - s', color: 'coral', label: 'Supply' },
      { type: 'segment', x1: '(80+d+s)/2', y1: 0, x2: '(80+d+s)/2', y2: '20 + (80+d+s)/2 - s', dash: true },
      { type: 'segment', x1: 0, y1: '20 + (80+d+s)/2 - s', x2: '(80+d+s)/2', y2: '20 + (80+d+s)/2 - s', dash: true },
      { type: 'point', x: '(80+d+s)/2', y: '20 + (80+d+s)/2 - s', color: 'ink', label: 'equilibrium' },
    ],
    readouts: [{ label: 'Quantity', expr: '(80+d+s)/2', digits: 0 }, { label: 'Price', expr: '20 + (80+d+s)/2 - s', digits: 0 }],
  },
  savings: {
    kind: 'chart', title: 'Compound interest', subject: 'Finance', caption: '$1,000 saved once, interest reinvested yearly.',
    params: [{ key: 'r', label: 'Annual rate', min: 0, max: 12, step: 0.5, value: 6, unit: '%' }],
    chart: { type: 'bar', labels: ['Year 1', 'Year 5', 'Year 10', 'Year 15', 'Year 20'], series: [{ name: 'Balance', values: ['1000*(1+r/100)', '1000*(1+r/100)^5', '1000*(1+r/100)^10', '1000*(1+r/100)^15', '1000*(1+r/100)^20'] }], unit: '$' },
  },
};
