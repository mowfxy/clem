import { test } from "node:test";
import assert from "node:assert/strict";
import { javaMainClass } from "../../desktop/code-runner.ts";

test("the Java class to start is the top-level one holding main, not a nested class declared before it", () => {
  assert.equal(javaMainClass("public class Calc {\n  static class Helper {}\n  public static void main(String[] a) {}\n}"), "Calc");
  assert.equal(javaMainClass("class Node { int v; }\nclass App {\n  // class Fake { }\n  public static void main(String[] a) { String s = \"class X {\"; }\n}"), "App");
  assert.equal(javaMainClass("class Lonely {}"), undefined);
});
