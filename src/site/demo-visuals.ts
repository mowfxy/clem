/** Visual descriptions for the website demo, written in the same language models use in the app. */
export const demoSpecs: Record<string, unknown> = {
  partials: {
    kind: '3d', title: 'Partial derivatives as slopes', subject: 'Calculus', equation: String.raw`\frac{\partial z}{\partial x} = 2x, \quad \frac{\partial z}{\partial y} = 2y`,
    caption: 'z = x² + y². Each slice holds one variable fixed; the arrows are the slopes along x and y.',
    params: [{ key: 'a', label: 'Point x', min: -1.5, max: 1.5, step: 0.05, value: 1 }, { key: 'b', label: 'Point y', min: -1.5, max: 1.5, step: 0.05, value: 1 }],
    readouts: [{ label: '∂z/∂x', expr: '2*a' }, { label: '∂z/∂y', expr: '2*b' }],
    x: { min: -2, max: 2, label: 'x' }, y: { min: -2, max: 2, label: 'y' }, z: { min: 0, max: 8, label: 'z' }, camera: { azimuth: 30, elevation: 36 },
    objects: [
      { type: 'surface', expr: 'x^2 + y^2' },
      { type: 'curve', x: 's', y: 'b', z: 's^2 + b^2', from: -2, to: 2, color: 'coral', label: 'y held fixed' },
      { type: 'curve', x: 'a', y: 's', z: 'a^2 + s^2', from: -2, to: 2, color: 'blue', label: 'x held fixed' },
      { type: 'vector', x: 'a', y: 'b', z: 'a^2 + b^2', dx: 0.7, dy: 0, dz: '0.7*2*a', color: 'coral' },
      { type: 'vector', x: 'a', y: 'b', z: 'a^2 + b^2', dx: 0, dy: 0.7, dz: '0.7*2*b', color: 'blue' },
      { type: 'point', x: 'a', y: 'b', z: 'a^2 + b^2', color: 'ink', label: 'P' },
    ],
  },
  methane: {
    kind: '3d', title: 'Methane is tetrahedral', subject: 'Chemistry', equation: String.raw`\ce{CH4}`, caption: 'Four C–H bonds of 1.09 Å, 109.5° apart. Drag to turn it.', autoRotate: true,
    objects: [{ type: 'molecule', labels: true, atoms: [{ el: 'C', x: 0, y: 0, z: 0 }, { el: 'H', x: 0.629, y: 0.629, z: 0.629 }, { el: 'H', x: -0.629, y: -0.629, z: 0.629 }, { el: 'H', x: -0.629, y: 0.629, z: -0.629 }, { el: 'H', x: 0.629, y: -0.629, z: -0.629 }] }],
  },
};
