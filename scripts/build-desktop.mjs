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
    process.env.MOWR_ACCOUNT_SERVICE ||
    "https://mowr-accounts.mohamed-khaled011008.workers.dev",
};
// Without these the app says "Sign-in is unavailable in this build", so a missing .env.local must fail loudly
// (a git worktree has none unless it is copied in). MOWR_ALLOW_NO_SIGNIN=1 is for local experiments only.
if ((!publicConfig.url || !publicConfig.key) && process.env.MOWR_ALLOW_NO_SIGNIN !== "1")
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
await copyFile("desktop/icon.ico", "desktop-package/desktop/icon.ico");
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  "desktop-package/package.json",
  JSON.stringify({
    name: "mowr-desktop",
    version: manifest.version,
    description: "Mowr local desktop workspace",
    main: "desktop-dist/main.cjs",
    author: { name: "Mowr Ai" },
  }),
);
