import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
const root = "vendor/kinetra/packages/plugin/skills";
const skills = {};
for (const name of (await readdir(root)).sort())
  skills[name] = await readFile(root + "/" + name + "/SKILL.md", "utf8");
const source = await readFile("desktop/kinetra-worker.ts", "utf8");
const modules = ["mowr", ...source.matchAll(/core\/src\/([^"']+)/g)].map(
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
      api[prefix + item.name.slice(0, -3)] = await readFile(
        join(folder, item.name),
        "utf8",
      );
  }
}
await references("vendor/kinetra/packages/core/src");
api.mowr = await readFile("desktop/kinetra-adapters.ts", "utf8");
await mkdir("desktop/generated", { recursive: true });
await writeFile(
  "desktop/generated/kinetra.json",
  JSON.stringify({ skills, modules, api }),
);
