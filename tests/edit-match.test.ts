import test from "node:test";
import assert from "node:assert/strict";
import { applyEdit } from "../core/diff.ts";

const file = "def area(r):\n    # circle\n    return 3.14 * r * r\n\nprint(\"done\")\n";

test("an exact find replaces the one place it occurs", () => {
  assert.equal(applyEdit(file, { find: "3.14", replace: "math.pi" }), file.replace("3.14", "math.pi"));
  assert.throws(() => applyEdit("a a", { find: "a", replace: "b" }), /more than once/);
});

test("a find the model re-indented or retyped still lands, indented as the file is", () => {
  // Written with two spaces instead of four, and the comment's spacing changed.
  const edit = { find: "  #  circle\n  return 3.14 * r * r", replace: "  # circle, exactly\n  return math.pi * r * r" };
  assert.equal(applyEdit(file, edit), "def area(r):\n    # circle, exactly\n    return math.pi * r * r\n\nprint(\"done\")\n");
  // Curly quotes for the file's straight ones.
  assert.equal(applyEdit(file, { find: "print(“done”)", replace: "print(\"ok\")" }), file.replace("print(\"done\")", "print(\"ok\")"));
  // A blank line the model left out.
  assert.equal(applyEdit(file, { find: "r * r\nprint", replace: "r * r\n\n\nprint" }), file.replace("r * r\n\nprint", "r * r\n\n\nprint"));
});

test("loose matching never guesses between places or invents a match", () => {
  assert.throws(() => applyEdit("x  =  1\nx = 1\n", { find: "x =   1", replace: "y" }), /more than once/);
  assert.throws(() => applyEdit(file, { find: "return 2 * r", replace: "y" }), /not in the file as it is now/);
  assert.throws(() => applyEdit(file, { find: "   ", replace: "y" }), /does not say what to replace/);
});

test("Windows line breaks are kept when the loose match is used", () => {
  const crlf = file.replace(/\n/g, "\r\n");
  assert.equal(applyEdit(crlf, { find: "  # circle\n  return 3.14 * r * r", replace: "  return 3 * r * r" }), "def area(r):\r\n    return 3 * r * r\r\n\r\nprint(\"done\")\r\n");
});
