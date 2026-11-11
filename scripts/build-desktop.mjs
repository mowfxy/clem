import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile, cp,rm } from "node:fs/promises";
import {resolve,sep} from 'node:path';
import { config } from "dotenv";
import { buildWorker } from "./build-worker.mjs";
config({ path: ".env.local", quiet: true });
for(const folder of ['desktop-dist','desktop-package']){
 const root=resolve('.'),target=resolve(folder);
 if(!target.startsWith(root+sep)||target===root)throw Error('Invalid generated-output directory.');
 await rm(target,{recursive:true,force:true});
}
// Only these public settings enter the bundle. Never copy the environment file.
const publicConfig = {
  url: process.env.SUPABASE_URL || "",
  key:
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "",
  service:
    process.env.CLEM_ACCOUNT_SERVICE ||
    "https://clem-accounts.mohamed-khaled011008.workers.dev",
};
// Without these the app says "Sign-in is unavailable in this build", so a missing .env.local must fail loudly
// (a git worktree has none unless it is copied in). CLEM_ALLOW_NO_SIGNIN=1 is for local experiments only.
if ((!publicConfig.url || !publicConfig.key) && process.env.CLEM_ALLOW_NO_SIGNIN !== "1")
  throw Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are missing from .env.local, so sign-in would not work in this build.");
await mkdir("desktop-dist", { recursive: true });
await build({
  entryPoints: ["desktop/main.ts"],
  outfile: "desktop-dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  // pg-native is node-postgres' optional native driver; pg-boss runs on PGlite through its adapter instead.
  // ssh2's optional native crypto and cpu-features: it falls back to pure JavaScript when they are missing.
  external: ["electron", "pg-native", "cpu-features", "*.node"],
  // ES modules bundled into CommonJS (PGlite finds its .wasm files from import.meta.url) see this file's own URL.
  banner: { js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
  define: { "import.meta.url": "__importMetaUrl" },
  plugins: [
    {
      name: "public-config",
      setup(b) {
        b.onLoad({ filter: /public-config\.json$/ }, () => ({
          contents: JSON.stringify(publicConfig),
          loader: "json",
        }));
      },
    },
  ],
});
await build({entryPoints:["desktop/kinetra-worker.ts"],outfile:"desktop-dist/kinetra-worker.cjs",bundle:true,platform:"node",format:"cjs"});
await build({entryPoints:["desktop/anki-worker.ts"],outfile:"desktop-dist/anki-worker.cjs",bundle:true,platform:"node",format:"cjs"});
// The engine's database: PGlite loads its WebAssembly and data files from beside the bundle, and the engine applies
// its SQL migrations from desktop-dist/migrations (desktop/engine).
for (const file of ["pglite.wasm", "pglite.data", "initdb.wasm"]) await copyFile("node_modules/@electric-sql/pglite/dist/" + file, "desktop-dist/" + file);
await cp("desktop/engine/migrations", "desktop-dist/migrations", { recursive: true });
// The VPS worker (worker/index.ts), uploaded over SFTP from here when the person turns it on.
await buildWorker("desktop-dist/worker");
// KaTeX's stylesheet and woff2 fonts, inlined into the print page of generated PDFs (desktop/katex-print.ts).
await mkdir("desktop-dist/katex/fonts", { recursive: true });
await copyFile("node_modules/katex/dist/katex.min.css", "desktop-dist/katex/katex.min.css");
await cp("node_modules/katex/dist/fonts", "desktop-dist/katex/fonts", { recursive: true, filter: (source) => !/\.(woff|ttf)$/.test(source) });
await copyFile("desktop/preload.cjs", "desktop-dist/preload.cjs");
await copyFile("desktop/capture-preload.cjs", "desktop-dist/capture-preload.cjs");
await mkdir("desktop-package/desktop", { recursive: true });
await cp("dist", "desktop-package/dist", { recursive: true });
await cp("desktop-dist", "desktop-package/desktop-dist", { recursive: true });
await mkdir("desktop-package/licenses",{recursive:true});
await copyFile("vendor/kinetra/LICENSE","desktop-package/licenses/kinetra.txt");
await copyFile("node_modules/libheif-js/LICENSE","desktop-package/licenses/libheif-js-LGPL-3.0.txt");
await copyFile("THIRD-PARTY-NOTICES.md","desktop-package/licenses/THIRD-PARTY-NOTICES.md");
await copyFile("desktop/icon.ico", "desktop-package/desktop/icon.ico");
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  "desktop-package/package.json",
  JSON.stringify({
    name: "clem-desktop",
    version: manifest.version,
    description: "Clem local desktop workspace",
    main: "desktop-dist/main.cjs",
    author: { name: "Clem" },
  }),
);
