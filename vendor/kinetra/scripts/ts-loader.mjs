// Custom Node loader that resolves ".js" imports to ".ts" siblings.
// Used so existing source code can keep its ".js" extensions (ESM-correct)
// while still running with --experimental-strip-types.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  // Only attempt to redirect when the request is bare-relative (e.g. "./x.js")
  // or when the import already had a .js extension and we're in a TS file.
  if (specifier.startsWith(".") && specifier.endsWith(".js")) {
    const parentURL = context.parentURL ?? "";
    if (parentURL) {
      const tsTarget = fileURLToPath(new URL(specifier.replace(/\.js$/, ".ts"), parentURL));
      if (existsSync(tsTarget)) {
        return nextResolve(specifier.replace(/\.js$/, ".ts"), context);
      }
    }
  }
  return nextResolve(specifier, context);
}