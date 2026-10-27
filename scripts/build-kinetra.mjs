import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import ts from "typescript";
/** Declarations only: exact argument shapes and doc comments, without implementation bodies. */
const declarations = (source) => {
  try {
    const out = ts.transpileDeclaration(source, { compilerOptions: { removeComments: false } }).outputText;
    return out.trim() ? out : source;
  } catch {
    return source;
  }
};
const root = "vendor/kinetra/packages/plugin/skills";
const skills = {};
for (const name of (await readdir(root)).sort())
  skills[name] = await readFile(root + "/" + name + "/SKILL.md", "utf8");
const source = await readFile("desktop/kinetra-worker.ts", "utf8");
const modules = ["clem", ...source.matchAll(/core\/src\/([^"']+)/g)].map(
  (value) => (typeof value === "string" ? value : value[1]),
);
const api = {};
async function references(folder, prefix = "") {
  for (const item of (await readdir(folder, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (item.isDirectory())
      await references(join(folder, item.name), prefix + item.name + "/");
    else if (item.name.endsWith(".ts"))
      api[prefix + item.name.slice(0, -3)] = declarations(
        await readFile(join(folder, item.name), "utf8"),
      );
  }
}
await references("vendor/kinetra/packages/core/src");
api.clem = declarations(await readFile("desktop/kinetra-adapters.ts", "utf8")) + "\n" + declarations(await readFile("desktop/kinetra-diagrams.ts", "utf8"));
// The composition toolkit's rules for Clem's kinetra-compose skill: the error table, the practical rules and the
// cheat-sheet of docs/toolkit/rules.md, without the npm/import workflow and the long worked examples.
const rules = (await readFile("vendor/kinetra/docs/toolkit/rules.md", "utf8")).replace(/\r\n/g, "\n");
const section = (from, to) => {
  const start = rules.indexOf(from), end = to ? rules.indexOf(to, start + 1) : rules.length;
  if (start < 0 || end < 0) throw Error(`docs/toolkit/rules.md has no "${from}" … "${to}" section`);
  return rules.slice(start, end).trim();
};
const composeRules = [section("| Code | What to do |", "\n\n"), section("## Practical rules learned", "## Six worked examples")]
  .join("\n\n")
  // About calling the core parser directly, which Clem's models never do.
  .replace(/- \*\*Expression parser quirk\.\*\*[\s\S]*?(?=\n## )/, "")
  // Hard-wrapped Markdown lines joined, so the guide costs fewer tokens.
  .replace(/\n {2,}/g, " ")
  .replace(/- \*\*Computed curves:\*\*[^\n]*/, "- **Computed curves:** streamlines, root-locus branches and similar curves: compute the points first (a Kinetra call), put them in as `series` data, and check them independently (an invariant, the angle condition).")
  .replace(/ \(all options in \[parts\.md\]\(parts\.md\)\)/, " (options and an example of each: clem composeParts)");
await mkdir("desktop/generated", { recursive: true });
await writeFile(
  "desktop/generated/kinetra.json",
  JSON.stringify({ skills, modules, api, composeRules }),
);
