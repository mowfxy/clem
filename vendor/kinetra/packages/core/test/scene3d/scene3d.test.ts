import { test } from "node:test";
import assert from "node:assert/strict";
import {
  identityMat4, vec3, vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Cross,
  vec3Length, vec3Normalize, defaultCamera, defaultAxes, validateScene3D,
} from "../../src/scene3d/types.js";
import {
  mulMat4, translation, scaleMat, rotationXEuler, rotationYEuler,
  rotationZEuler, eulerXYZ, transformPoint, cross, dot, normalize, length,
} from "../../src/scene3d/coords.js";
import {
  buildView, project, isFrontFacing, polygonDepth, cameraRight, cameraUp,
} from "../../src/scene3d/projection.js";
import { renderScene3D } from "../../src/scene3d/render_svg.js";

const near = (a, b, tol = 1e-6) => Math.abs(a - b) < tol;

test("vector: vec3Sub and vec3Add are inverses", () => {
  const a = vec3(1, 2, 3), b = vec3(4, -1, 0.5);
  assert.deepEqual(vec3Add(vec3Sub(a, b), b), a);
});

test("vector: dot is commutative and distributes over addition", () => {
  const a = vec3(1, 2, 3), b = vec3(4, -1, 0.5);
  assert.equal(vec3Dot(a, b), vec3Dot(b, a));
  const c = vec3(-2, 7, 0.25);
  assert.ok(near(vec3Dot(vec3Add(a, b), c), vec3Dot(a, c) + vec3Dot(b, c)));
});

test("vector: cross product is perpendicular to inputs", () => {
  const a = vec3(1, 2, 3), b = vec3(-1, 4, 2);
  const c = vec3Cross(a, b);
  assert.ok(near(vec3Dot(c, a), 0));
  assert.ok(near(vec3Dot(c, b), 0));
});

test("vector: vec3Normalize produces a unit vector", () => {
  const v = vec3Normalize(vec3(3, 4, 0));
  assert.ok(near(vec3Length(v), 1));
});

test("matrix: identity * identity == identity and T * v is translation", () => {
  const I = identityMat4();
  const P = mulMat4(I, I);
  for (let i = 0; i < 16; i++) assert.equal(P.m[i], I.m[i]);
  const t = translation(3, -2, 7);
  const p = transformPoint(t, vec3(0, 0, 0));
  assert.ok(near(p.x, 3) && near(p.y, -2) && near(p.z, 7));
});

test("matrix: rotation around X by 180 deg maps (0,1,0) to (0,-1,0)", () => {
  const R = rotationXEuler(180);
  const p = transformPoint(R, vec3(0, 1, 0));
  assert.ok(near(p.x, 0, 1e-9) && near(p.y, -1, 1e-9) && near(p.z, 0, 1e-9));
});

test("matrix: rotation around Y by 90 deg maps (0,0,1) to (1,0,0)", () => {
  const R = rotationYEuler(90);
  const p = transformPoint(R, vec3(0, 0, 1));
  assert.ok(near(p.x, 1, 1e-9) && near(p.y, 0, 1e-9) && near(p.z, 0, 1e-9));
});

test("matrix: rotation around Z by 90 deg maps (1,0,0) to (0,1,0)", () => {
  const R = rotationZEuler(90);
  const p = transformPoint(R, vec3(1, 0, 0));
  assert.ok(near(p.x, 0, 1e-9) && near(p.y, 1, 1e-9) && near(p.z, 0, 1e-9));
});

test("matrix: 360 deg rotation equals identity", () => {
  for (const rot of [rotationXEuler, rotationYEuler, rotationZEuler]) {
    const p = transformPoint(rot(360), vec3(1, 2, 3));
    assert.ok(near(p.x, 1, 1e-9) && near(p.y, 2, 1e-9) && near(p.z, 3, 1e-9));
  }
});

test("matrix: eulerXYZ at (0,0,0) equals identity", () => {
  const M = eulerXYZ(vec3(0, 0, 0));
  const I = identityMat4();
  for (let i = 0; i < 16; i++) assert.ok(near(M.m[i], I.m[i]));
});

test("matrix: scaleMat scales each axis independently", () => {
  const S = scaleMat(2, 3, 4);
  const p = transformPoint(S, vec3(1, 1, 1));
  assert.ok(near(p.x, 2) && near(p.y, 3) && near(p.z, 4));
});

test("camera: lookAt produces an orthonormal right vector", () => {
  const cam = { position: vec3(0, 0, 5), target: vec3(0, 0, 0), up: vec3(0, 1, 0) };
  const r = cameraRight(cam);
  assert.ok(near(length(r), 1, 1e-9));
  assert.ok(near(dot(r, cam.up), 0, 1e-9));
});

test("camera: cameraUp is perpendicular to forward and right", () => {
  const cam = { position: vec3(1, 2, 3), target: vec3(0, 0, 0), up: vec3(0, 1, 0) };
  const r = cameraRight(cam);
  const u = cameraUp(cam);
  assert.ok(near(dot(r, u), 0, 1e-9));
  assert.ok(near(length(u), 1, 1e-9));
});

test("projection: project maps centre to centre", () => {
  const cam = { position: vec3(0, 0, 5), target: vec3(0, 0, 0), up: vec3(0, 1, 0), fovDeg: 90, near: 0.1, far: 100 };
  const v = buildView({ camera: cam, width: 800, height: 600, perspective: true });
  const p = project(v, vec3(0, 0, 0));
  assert.ok(near(p.x, 400) && near(p.y, 300));
});

test("projection: off-axis point projects to corresponding side", () => {
  const cam = { position: vec3(0, 0, 5), target: vec3(0, 0, 0), up: vec3(0, 1, 0), fovDeg: 90, near: 0.1, far: 100 };
  const v = buildView({ camera: cam, width: 800, height: 600, perspective: true });
  const right = project(v, vec3(1, 0, 0));
  const up = project(v, vec3(0, 1, 0));
  assert.ok(right.x > 400);
  assert.ok(up.y < 300);
});

test("projection: closer point has larger absolute depth", () => {
  const cam = { position: vec3(0, 0, 10), target: vec3(0, 0, 0), up: vec3(0, 1, 0), fovDeg: 60, near: 0.1, far: 100 };
  const v = buildView({ camera: cam, width: 800, height: 600, perspective: true });
  const close = project(v, vec3(0, 0, 1));
  const far = project(v, vec3(0, 0, 9));
  assert.ok(close.depth > far.depth);
});

test("projection: orthographic is unaffected by depth", () => {
  const cam = { position: vec3(0, 0, 5), target: vec3(0, 0, 0), up: vec3(0, 1, 0), fovDeg: 60, near: -100, far: 100 };
  const v = buildView({ camera: cam, width: 800, height: 600, perspective: false });
  const a = project(v, vec3(1, 0, 0));
  const b = project(v, vec3(1, 0, 50));
  assert.ok(near(a.x, b.x) && near(a.y, b.y));
});

test("backface: CCW triangle facing camera is front-facing", () => {
  const cam = { position: vec3(0, 0, 5), target: vec3(0, 0, 0) };
  const a = vec3(-1, -1, 0), b = vec3(1, -1, 0), c = vec3(0, 1, 0);
  assert.equal(isFrontFacing(cam, a, b, c), true);
});

test("backface: reversed winding is back-facing", () => {
  const cam = { position: vec3(0, 0, 5), target: vec3(0, 0, 0) };
  const a = vec3(-1, -1, 0), b = vec3(0, 1, 0), c = vec3(1, -1, 0);
  assert.equal(isFrontFacing(cam, a, b, c), false);
});

test("polygonDepth: average of z is consistent", () => {
  const tri = [vec3(0, 0, 3), vec3(1, 0, 3), vec3(0, 1, 3)];
  assert.equal(polygonDepth(tri), -3);
});

test("scene3D: validateScene3D rejects zero width", () => {
  assert.throws(() => validateScene3D({ camera: defaultCamera(), axes: defaultAxes(), objects: [], labels: [], annotations: [], width: 0, height: 600 }));
});

test("scene3D: validateScene3D rejects far <= near", () => {
  const c = defaultCamera();
  c.far = 0.05;
  c.near = 0.1;
  assert.throws(() => validateScene3D({ camera: c, axes: defaultAxes(), objects: [], labels: [], annotations: [], width: 800, height: 600 }));
});

test("scene3D: validateScene3D rejects bad fov", () => {
  const c = defaultCamera();
  c.fovDeg = 0;
  assert.throws(() => validateScene3D({ camera: c, axes: defaultAxes(), objects: [], labels: [], annotations: [], width: 800, height: 600 }));
  c.fovDeg = 200;
  assert.throws(() => validateScene3D({ camera: c, axes: defaultAxes(), objects: [], labels: [], annotations: [], width: 800, height: 600 }));
});

test("scene3D: renderScene3D returns a valid SVG for an empty scene", () => {
  const s = {
    camera: defaultCamera(),
    axes: defaultAxes(),
    objects: [],
    labels: [],
    annotations: [],
    width: 400,
    height: 300,
  };
  const svg = renderScene3D(s);
  assert.ok(svg.startsWith("<?xml"));
  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes("</svg>"));
});

test("scene3D: renderScene3D places axis labels in the SVG", () => {
  const s = {
    camera: defaultCamera(),
    axes: defaultAxes(),
    objects: [],
    labels: [],
    annotations: [],
    width: 400,
    height: 300,
  };
  const svg = renderScene3D(s);
  for (const lbl of ["x", "y", "z"]) {
    // The SVG renderer pretty-prints, so the text content sits on its own
    // line between the open and close tags.
    const re = new RegExp("<text[^>]*>\\s*" + lbl + "\\s*</text>");
    assert.ok(re.test(svg), "expected axis label " + lbl);
  }
});

test("scene3D: renderScene3D is deterministic for the same input", () => {
  const s = {
    camera: defaultCamera(),
    axes: defaultAxes(),
    objects: [],
    labels: [{ at: vec3(1, 1, 1), text: "P" }],
    annotations: [],
    width: 400,
    height: 300,
  };
  const a = renderScene3D(s);
  const b = renderScene3D(s);
  assert.equal(a, b);
});

test("scene3D: rotated camera produces different pixel positions than default", () => {
  const cam1 = defaultCamera();
  const cam2 = Object.assign({}, defaultCamera(), { position: vec3(-4, 3, 6) });
  const s1 = { camera: cam1, axes: defaultAxes(), objects: [{ id: "p", kind: "point", position: vec3(1, 0, 0) }], labels: [], annotations: [], width: 400, height: 300 };
  const s2 = Object.assign({}, s1, { camera: cam2 });
  const a = renderScene3D(s1);
  const b = renderScene3D(s2);
  assert.notEqual(a, b);
});