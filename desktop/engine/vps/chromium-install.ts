// Chromium for the VPS worker's drawing page (desktop/chromium-page.ts, docs/GUC-VPS-ENGINE.md "Files on the VPS").
// Clem's Docker image carries Debian's chromium; a worker run by systemd uses a browser already on the server, and
// otherwise fetches Google's headless shell (Chrome for Testing, linux x64) once, on first use, into its data folder:
// no administrator rights needed. If even that can't run (a missing system library, another CPU), the person is told in
// one plain sentence what to say to install it.
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { Unzip, UnzipInflate } from "fflate";
import { findChromium } from "../../chromium-page.ts";

const INDEX = "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
export const shellPath = (data: string) => join(data, "chromium", "chrome-headless-shell-linux64", "chrome-headless-shell");

/** A browser for drawing pages: one on the server, else the headless shell (fetched once). Undefined when none can be had. */
export function chromiumBinary(o: { data: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch; log?: (m: string) => void }) {
  let fetching: Promise<string | undefined> | undefined;
  return async () => {
    const found = findChromium([shellPath(o.data)], o.env);
    if (found) return found;
    if (process.platform !== "linux" || process.arch !== "x64") return undefined;
    return fetching ||= install(o).catch((e) => { o.log?.("[worker] chromium: " + (e as Error).message); fetching = undefined; return undefined; });
  };
}

async function install(o: { data: string; fetch?: typeof fetch; log?: (m: string) => void }) {
  const get = o.fetch || fetch;
  const index = await (await get(INDEX, { signal: AbortSignal.timeout(30_000) })).json() as any;
  const url = index?.channels?.Stable?.downloads?.["chrome-headless-shell"]?.find((d: any) => d.platform === "linux64")?.url;
  if (typeof url !== "string" || !url.startsWith("https://")) throw Error("no headless shell to download");
  o.log?.("[worker] chromium: fetching the headless shell for drawing pages");
  const dir = join(o.data, "chromium"), part = dir + ".part";
  await rm(part, { recursive: true, force: true });
  await mkdir(part, { recursive: true });
  const res = await get(url, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body) throw Error("download failed (" + res.status + ")");
  // Unzipped as it arrives, file by file: the whole archive is never held in memory.
  const writes: Promise<void>[] = [];
  const unzip = new Unzip((file) => {
    if (file.name.endsWith("/") || file.name.includes("..")) { file.start(); return; }
    const target = join(part, file.name);
    mkdirSync(dirname(target), { recursive: true });
    const out = createWriteStream(target);
    writes.push(new Promise<void>((resolve, reject) => {
      file.ondata = (err, chunk, final) => { if (err) return reject(err); out.write(chunk); if (final) out.end(resolve); };
      out.on("error", reject);
    }));
    file.start();
  });
  unzip.register(UnzipInflate);
  for await (const chunk of Readable.fromWeb(res.body as any)) unzip.push(new Uint8Array(chunk as Buffer));
  unzip.push(new Uint8Array(0), true);
  await Promise.all(writes);
  const bin = join(part, "chrome-headless-shell-linux64", "chrome-headless-shell");
  if (!existsSync(bin)) throw Error("the download had no browser in it");
  await chmod(bin, 0o755);
  await rm(dir, { recursive: true, force: true });
  await rename(part, dir);
  return shellPath(o.data);
}

/** What the agent says, once, when pages can't be drawn on this server. */
export const NO_CHROMIUM = "Your VPS can't draw pages yet (Clem's page drawer, Chromium, can't run there). Say \"install Chromium on my VPS\" and Clem will ask once before running the install.";
