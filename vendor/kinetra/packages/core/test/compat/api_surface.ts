/**
 * Snapshot of Kinetra's public surface: core runtime exports (name, kind and
 * declared arity), CLI commands and help text, npm scripts and plugin files.
 * api-lock.json records the surface as it was before the toolkit work began;
 * the lock test fails if anything recorded there disappears or changes.
 * Additions are allowed.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export interface ApiSurface {
  coreExports: Record<string, string>;
  cliUsageLines: string[];
  cliDiagramHelp: string;
  npmScripts: Record<string, string>;
  pluginFiles: Record<string, string>;
}

export async function coreExports(): Promise<Record<string, string>> {
  const mod = await import("../../src/index.js") as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const name of Object.keys(mod).sort()) {
    const v = mod[name];
    out[name] = typeof v === "function" ? `function/${(v as Function).length}` : typeof v;
  }
  return out;
}

export function runCli(args: string[]): { stdout: string; status: number | null } {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--import", "./scripts/_register.mjs", "packages/cli/src/bin/kinetra.ts", ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  return { stdout: r.stdout, status: r.status };
}

export function pluginFiles(): Record<string, string> {
  const root = join(REPO_ROOT, "packages", "plugin");
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "__pycache__") walk(p); continue; }
      // Hash with normalized line endings so a CRLF checkout matches.
      const bytes = readFileSync(p);
      const isText = !bytes.includes(0);
      const content = isText ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : bytes;
      out[relative(root, p).replace(/\\/g, "/")] = createHash("sha256").update(content).digest("hex");
    }
  };
  walk(root);
  return out;
}

export async function currentSurface(): Promise<ApiSurface> {
  const usage = runCli(["--help"]).stdout;
  return {
    coreExports: await coreExports(),
    cliUsageLines: usage.split(/\r?\n/).filter(l => l.trim().length > 0),
    cliDiagramHelp: runCli(["diagram", "--help"]).stdout,
    npmScripts: JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts,
    pluginFiles: pluginFiles(),
  };
}
