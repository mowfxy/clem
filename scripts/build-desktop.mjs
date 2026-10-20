import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile, cp,rm } from "node:fs/promises";
import {resolve,sep} from 'node:path';
import { config } from "dotenv";
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
  external: ["electron"],
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
