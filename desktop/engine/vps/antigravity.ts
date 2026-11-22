// Gemini on the VPS is the same Antigravity as on this PC (desktop/antigravity.ts): Google's official Antigravity agent
// for other apps ("antigravity-acp" in the Agent Client Protocol registry), its Linux build, downloaded from Google by
// the worker, checked against the registry's sha256 and run unmodified, spoken to over ACP. It signs in with the
// person's own Google account (their Google AI plan) through Google's own page, opened in Clem's sign-in window on the
// PC; the sign-in stays in the worker's data folder (its own, never a copy of this PC's). Clem never calls Google itself.
//
// This file runs inside the worker. The desktop drives it over SSH as `node index.cjs agy <install|login|status|fetch>`
// (worker/index.ts), and the worker answers with `antigravityComplete`.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { rootCertificates } from "node:tls";
import { pipeline } from "node:stream/promises";
import { Unzip, UnzipInflate } from "fflate";
import { AcpConnection } from "../../acp.ts";
import { ANTIGRAVITY_REGISTRY, ANTIGRAVITY_URL_MARKER, ANTIGRAVITY_URL_PRINTED, googleSignInUrl, replyProblem } from "../../antigravity-engine.ts";
import type { Complete } from "./headless.ts";

const PLATFORMS: Record<string, { key: string; file: string }> = { x64: { key: "linux-x86_64", file: "x86_64" }, arm64: { key: "linux-aarch64", file: "arm64" } };
/** The largest download accepted (Google's archives are a few hundred MB at most). */
const MAX_ARCHIVE = 1_000_000_000;
/** What the worker prints for the desktop: the Google sign-in page, then whether the sign-in finished. */
export const AGY_SIGNIN = "CLEM_AGY_SIGNIN ", AGY_DONE = "CLEM_AGY_DONE ";

export type AgyRelease = { version: string; url: string; sha256: string; cmd: string; args: string[] };
/** This server's build from the registry listing, only when it is Google's own download of the version listed. */
export function linuxRelease(manifest: any, arch: string = process.arch): AgyRelease | null {
  const platform = PLATFORMS[arch];
  const version = String(manifest?.version || "");
  const b = manifest?.distribution?.binary?.[platform?.key || ""];
  if (!platform || !b || manifest?.id !== "antigravity-acp" || !/^\d+\.\d+\.\d+$/.test(version)) return null;
  const url = String(b.archive || ""), sha256 = String(b.sha256 || "").toLowerCase(), cmd = String(b.cmd || "");
  const args = Array.isArray(b.args) ? b.args.filter((a: unknown) => typeof a === "string" && a.length < 200) : [];
  if (url !== `https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-${version}-linux-${platform.file}.zip`) return null;
  if (!/^[0-9a-f]{64}$/.test(sha256) || !/^\.\/[\w.-]+$/.test(cmd)) return null;
  return { version, url, sha256, cmd: cmd.slice(2), args };
}

type Installed = { version: string; dir: string; cmd: string; args: string[] };
const root = (data: string) => join(data, "cli", "antigravity");
/** The newest copy installed in the worker's data folder (kept across worker refreshes). */
export function installedAgy(data: string): Installed | null {
  try {
    const found = readdirSync(root(data), { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d+\.\d+\.\d+$/.test(e.name))
      .map((e) => { try { const m = JSON.parse(readFileSync(join(root(data), e.name, "clem-install.json"), "utf8")); return { version: e.name, dir: join(root(data), e.name), cmd: String(m.cmd), args: Array.isArray(m.args) ? m.args.map(String) : [] }; } catch { return null; } })
      .filter((x): x is Installed => !!x && existsSync(join(x.dir, x.cmd)))
      .sort((a, b) => cmpVersion(b.version, a.version));
    return found[0] || null;
  } catch { return null; }
}
const cmpVersion = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

/** Unpacks a zip archive file into `dir`, streamed: neither the archive nor a file in it is ever held in memory whole
 *  (Google's Linux archive is about 270 MB and unpacks to about 850 MB). */
async function unzipTo(archive: string, dir: string) {
  const writes: Promise<void>[] = [];
  let failed = null as Error | null;
  // fflate hands an entry's bytes only to an entry started at once, so its folder and file are made right here.
  const unzip = new Unzip((file) => {
    const target = normalize(join(dir, file.name));
    if (!target.startsWith(normalize(dir) + sep) || file.name.endsWith("/")) return;
    mkdirSync(dirname(target), { recursive: true });
    const out = createWriteStream(target, { mode: 0o755 });
    writes.push(new Promise<void>((resolve, reject) => { out.on("error", reject); out.on("finish", () => resolve()); }));
    file.ondata = (err, chunk, final) => { if (err) { failed = err; out.destroy(err); return; } out.write(chunk); if (final) out.end(); };
    file.start();
  });
  unzip.register(UnzipInflate);
  for await (const chunk of createReadStream(archive, { highWaterMark: 1 << 20 })) unzip.push(chunk as Uint8Array);
  unzip.push(new Uint8Array(0), true);
  await Promise.all(writes);
  if (failed) throw failed;
}

/** Installs (or updates to) the newest Linux build Google lists; leaves an up-to-date copy as it is. */
export async function installAgy(data: string, o: { fetch?: typeof fetch; arch?: string } = {}): Promise<Installed> {
  const get = o.fetch || fetch;
  let manifest: any;
  try { manifest = await (await get(ANTIGRAVITY_REGISTRY, { signal: AbortSignal.timeout(30_000) })).json(); }
  catch { throw Error("Couldn't reach Google's Gemini download from your VPS."); }
  const release = linuxRelease(manifest, o.arch);
  if (!release) throw Error("Google doesn't list a Gemini build for this server.");
  const have = installedAgy(data);
  if (have && cmpVersion(have.version, release.version) >= 0) return have;
  const res = await get(release.url, { signal: AbortSignal.timeout(30 * 60_000) }).catch(() => null);
  if (!res?.ok || !/^https:\/\/([a-z0-9-]+\.)*(google\.com|gvt1\.com)\//.test(res.url || release.url)) throw Error("The Gemini download failed on your VPS.");
  if (!res.body || Number(res.headers.get("content-length") || 0) > MAX_ARCHIVE) throw Error("The Gemini download is larger than expected.");
  const staging = join(root(data), ".staging-" + release.version), final = join(root(data), release.version), archive = staging + ".zip";
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    // Saved to disk and hashed on the way; unpacked only when it is exactly the file the registry lists.
    const hash = createHash("sha256");
    let size = 0;
    const body = Readable.fromWeb(res.body as any);
    body.on("data", (chunk: Buffer) => { size += chunk.length; hash.update(chunk); if (size > MAX_ARCHIVE) body.destroy(Error("The Gemini download is larger than expected.")); });
    await pipeline(body, createWriteStream(archive));
    if (hash.digest("hex") !== release.sha256) throw Error("The Gemini download isn't the one Google lists, so Clem didn't install it.");
    await unzipTo(archive, staging);
    if (!existsSync(join(staging, release.cmd))) throw Error("The Gemini download didn't have the program Google lists.");
    await chmod(join(staging, release.cmd), 0o755);
    await writeFile(join(staging, "clem-install.json"), JSON.stringify({ cmd: release.cmd, args: release.args }));
    await rm(final, { recursive: true, force: true });
    await rename(staging, final);
  } finally {
    await rm(archive, { force: true }).catch(() => {});
    await rm(staging, { recursive: true, force: true }).catch(() => {});
  }
  // Only the newest copy is kept (the worker restarts on it).
  for (const e of readdirSync(root(data), { withFileTypes: true })) if (e.isDirectory() && e.name !== release.version) await rm(join(root(data), e.name), { recursive: true, force: true }).catch(() => {});
  return installedAgy(data)!;
}

/** The agent's own folders, under the worker's data folder: its sign-in and settings (GEMINI_HOME), its temporary files
 *  (one folder per running agent, under tmpRoot: an agent never shares it, and one starting never wipes another's). */
const homeOf = (data: string) => join(data, "antigravity");
const tmpRoot = (data: string) => join(data, "tmp", "agy");
/** Only what the agent needs: an API key or Google Cloud setting in the environment would bypass the plan. Its sign-in
 *  page goes through BROWSER, Clem's helper, which prints it on stderr for Clem instead of opening anything. */
export function agyEnv(data: string, base: NodeJS.ProcessEnv = process.env, harness?: string, certs?: string, temp = tmpRoot(data)): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR"]) if (base[key]) env[key] = base[key];
  const helper = `process.stderr.write(${JSON.stringify(ANTIGRAVITY_URL_MARKER)}+JSON.stringify(process.argv[1])+"\\n",()=>process.exit(0))`;
  const quote = (s: string) => `'${s.replace(/'/g, `'"'"'`)}'`;
  return { ...env, ...(certs && !env.SSL_CERT_FILE ? { SSL_CERT_FILE: certs } : {}), HOME: join(data, "home"), GEMINI_HOME: homeOf(data), AGY_ACP_FORCE_FILE_STORAGE: "1", ...(harness ? { ANTIGRAVITY_HARNESS_PATH: harness } : {}), PYTHONUNBUFFERED: "1", NO_COLOR: "1",
    BROWSER: [process.execPath, "-e", helper, "--", "%s"].map(quote).join(" "), TMPDIR: temp, TEMP: temp, TMP: temp };
}

/** Where the agent finds the certificates it trusts for Google's servers. The worker's image (node:22-slim) has no
 *  system bundle, so Google's agent couldn't verify Google and failed with "Internal error" (CERTIFICATE_VERIFY_FAILED).
 *  The server's own bundle when it has one, else Node's built-in roots, written to the worker's data folder. */
const SYSTEM_BUNDLES = ["/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem", "/etc/ssl/ca-bundle.pem"];
export async function caBundle(data: string, bundles = SYSTEM_BUNDLES): Promise<string> {
  const found = bundles.find((p) => existsSync(p));
  if (found) return found;
  const file = join(data, "certs", "roots.pem");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, rootCertificates.join("\n") + "\n");
  return file;
}

/** The agent's own words for a failure (its "Internal error" carries the reason in `data.details`). */
const reason = (e: unknown) => { const x = e as { message?: string; data?: { details?: unknown } }; const d = typeof x?.data?.details === "string" ? x.data.details : ""; return [x?.message || "", d].filter(Boolean).join(": "); };

export class SignedOutAgy extends Error {}
type Live = { acp: AcpConnection; child: ChildProcessWithoutNullStreams; temp: string; sessions: string[]; text: Map<string, (t: string) => void>; at: number };

// ---------- Processes ----------
// Google's agent starts a helper (localharness, about 150 MB) for every conversation and keeps it until the agent itself
// ends: there is no way to close one conversation. So each answer gets an agent of its own, ended with everything it
// started once the answer is in (its own process group), and the next one is started then. Kept for the worker's whole
// life, conversations piled up helpers until the server ran out of memory.
const running = new Set<Live>();
let exitHook = false;
/** Ends the agent with its helpers (its process group), then removes its temporary folder and its conversations. */
export async function stopAgy(live: Live, data: string) {
  running.delete(live);
  endGroup(live.child);
  await new Promise<void>((resolve) => { if (live.child.exitCode !== null || live.child.signalCode !== null) return resolve(); const t = setTimeout(resolve, 5000); t.unref?.(); live.child.once("close", () => { clearTimeout(t); resolve(); }); });
  await rm(live.temp, { recursive: true, force: true }).catch(() => {});
  await forgetSessions(data, live.sessions).catch(() => {});
}
function endGroup(child: ChildProcessWithoutNullStreams) {
  if (child.pid) try { process.kill(-child.pid, "SIGKILL"); } catch { /* not a group of its own (tests), or gone */ }
  try { child.kill("SIGKILL"); } catch { /* gone */ }
}
/** The files Google's agent keeps for conversations Clem is done with (each answer is a conversation of its own). */
async function forgetSessions(data: string, ids: string[]) {
  if (!ids.length) return;
  for (const folder of ["conversations", "brain"]) {
    const base = join(homeOf(data), "antigravity-acp", folder);
    for (const entry of await readdir(base).catch(() => [] as string[])) if (ids.some((id) => entry.includes(id))) await rm(join(base, entry), { recursive: true, force: true }).catch(() => {});
  }
}
/** Temporary folders of agents that no longer run (a worker that was restarted, a command that was cut off). */
async function sweepTemp(data: string) {
  for (const name of await readdir(tmpRoot(data)).catch(() => [] as string[])) {
    const dir = join(tmpRoot(data), name);
    const pid = Number(await readFile(join(dir, "pid"), "utf8").catch(() => ""));
    let alive = false;
    if (pid > 0) try { process.kill(pid, 0); alive = true; } catch (e) { alive = (e as NodeJS.ErrnoException).code === "EPERM"; }
    if (!alive) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Starts the agent and signs it in: `login` gets Google's sign-in page when it asks for one, else that is "signed out". */
export async function openAgy(data: string, login?: (url: string) => void, start = (cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) => spawn(cmd, args, { cwd, env, stdio: "pipe", detached: true })): Promise<Live> {
  const install = installedAgy(data);
  if (!install) throw new SignedOutAgy("Gemini isn't installed on your VPS.");
  const work = join(data, "work", "agy");
  for (const d of [join(homeOf(data), "antigravity-acp"), work, join(data, "home"), tmpRoot(data)]) await mkdir(d, { recursive: true });
  // Only Google's own sign-in, chosen in its settings; never another app's hooks or MCP servers (this home is Clem's own).
  await writeFile(join(homeOf(data), "antigravity-acp", "settings.json"), JSON.stringify({ auth: { type: "oauth-personal" } }) + "\n");
  await sweepTemp(data);
  const temp = join(tmpRoot(data), randomBytes(6).toString("hex"));
  await mkdir(temp, { recursive: true });
  // Google's harness ships beside the agent (as on Windows), which is told where it is.
  const harness = join(install.dir, "localharness_external");
  let child: ChildProcessWithoutNullStreams;
  try { child = start(join(install.dir, install.cmd), install.args, agyEnv(data, process.env, existsSync(harness) ? harness : undefined, await caBundle(data), temp), work) as ChildProcessWithoutNullStreams; }
  catch (e) { await rm(temp, { recursive: true, force: true }).catch(() => {}); throw Error("Gemini on your VPS couldn't start: " + ((e as Error)?.message || "").slice(0, 200)); }
  if (child.pid) await writeFile(join(temp, "pid"), String(child.pid)).catch(() => {});
  const acp = new AcpConnection(child);
  const live: Live = { acp, child, temp, sessions: [], text: new Map(), at: Date.now() };
  running.add(live);
  // Whatever happens to this process (a command that ends, a crash), the agents it started end with it.
  if (!exitHook) { exitHook = true; process.once("exit", () => { for (const l of running) endGroup(l.child); }); }
  let failSignIn: (e: Error) => void = () => {}, shown = false, pending = "", tail = "";
  const signIn = new Promise<never>((_, reject) => { failSignIn = reject; });
  signIn.catch(() => {});
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (part: string) => {
    tail = (tail + part).slice(-4000);
    pending = (pending + part).slice(-40_000);
    const lines = pending.split("\n");
    pending = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      const found = line.startsWith(ANTIGRAVITY_URL_MARKER) ? (() => { try { return String(JSON.parse(line.slice(ANTIGRAVITY_URL_MARKER.length))); } catch { return ""; } })() : line.startsWith(ANTIGRAVITY_URL_PRINTED) ? line.slice(ANTIGRAVITY_URL_PRINTED.length) : "";
      const url = found && googleSignInUrl(found);
      if (!url) continue;
      if (!login) failSignIn(new SignedOutAgy("Gemini on your VPS is signed out. Set up the AI again in Settings."));
      else if (!shown) { shown = true; login(url); }
    }
  });
  acp.onRequest = async (method, params) => {
    // Nothing the agent asks for runs here: the worker's answers are text, and Clem's own actions do the work.
    if (method !== "session/request_permission") throw Object.assign(Error("Not supported"), { code: -32601 });
    const reject = (Array.isArray(params?.options) ? params.options : []).find((o: any) => o?.kind === "reject_once")?.optionId;
    return reject ? { outcome: { outcome: "selected", optionId: reject } } : { outcome: { outcome: "cancelled" } };
  };
  acp.onNotification = (method, params) => {
    const u = params?.update;
    if (method === "session/update" && u?.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") live.text.get(String(params?.sessionId || ""))?.(String(u.content.text || ""));
  };
  try {
    await Promise.race([acp.request("initialize", { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "clem", title: "Clem", version: "1" } }, 300_000), signIn]);
    await Promise.race([acp.request("authenticate", { methodId: "oauth-personal" }, login ? 15 * 60_000 : 120_000), signIn]);
    return live;
  } catch (e) {
    await stopAgy(live, data);
    if (e instanceof SignedOutAgy) throw e;
    const m = reason(e);
    if (/authentication required|not authenticated|unauthenticated|invalid_grant|sign in|onboarding failed/i.test(m)) throw new SignedOutAgy("Gemini on your VPS is signed out. Set up the AI again in Settings.");
    throw Error("Gemini on your VPS couldn't start: " + (m || tail.trim().split("\n").slice(-2).join(" ") || "it stopped without saying why").slice(0, 240));
  }
}

/** Whether the agent on this server is installed and signed in (it starts, and asks for no sign-in page). */
export async function agySignedIn(data: string, start?: Parameters<typeof openAgy>[2]) {
  if (!installedAgy(data)) return false;
  try { const live = await openAgy(data, undefined, start); await stopAgy(live, data); return true; } catch { return false; }
}

/** One answer this long at most; a spare agent older than SPARE_AGE is replaced (it only ever waited, so nothing is lost). */
const STEP_MS = 300_000, SPARE_AGE = 60 * 60_000;
/** Answers at once at most (each is an agent and its helper); more wait their turn. */
const AT_ONCE = 2;
/** Free memory above which the next agent starts while an answer runs (one agent and its helper take about 550 MB), so
 *  the next step of a reply doesn't wait for it; below it, the next one starts once the answer's agent has ended. */
const ROOM_FOR_TWO = 1.5 * 1024 ** 3;
export type AgyModel = { complete: Complete; signedIn: () => Promise<boolean>; stop: () => Promise<void> };

/** The worker's model through the agent: each answer is one conversation on an agent of its own (see "Processes"), its
 *  rules as the conversation's system prompt, no tools. `keep` (the worker): one agent, started and signed in ahead,
 *  always waits for the next answer, so an answer never waits for an agent to start. */
export function antigravityModel(data: string, o: { start?: Parameters<typeof openAgy>[2]; keep?: boolean; /** Tests: free memory. */ free?: () => number } = {}): AgyModel {
  const free = o.free || freemem;
  let spare: { live: Promise<Live>; at: number } | null = null, active = 0, stopped = false;
  const queue: (() => void)[] = [];
  const warm = () => {
    if (stopped || spare) return spare?.live;
    const live = openAgy(data, undefined, o.start);
    const entry = { live, at: Date.now() };
    spare = entry;
    // One that ended while it waited (it crashed, or couldn't start) is started again for the next answer, not reused.
    live.then((l) => l.child.once("close", () => { if (spare === entry) spare = null; }), () => { if (spare === entry) spare = null; });
    return live;
  };
  /** The spare agent for an answer (a new one when there is none, or it is too old), and the next spare started. */
  const take = async (): Promise<Live> => {
    if (spare && Date.now() - spare.at > SPARE_AGE) { const old = spare.live; spare = null; void old.then((l) => stopAgy(l, data), () => {}); }
    const live = spare?.live || openAgy(data, undefined, o.start);
    spare = null;
    const l = await live;
    if (l.acp.closed) { void stopAgy(l, data); return openAgy(data, undefined, o.start); }
    return l;
  };
  const turn = async () => { if (active >= AT_ONCE) await new Promise<void>((r) => queue.push(r)); active++; };
  const done = () => { active--; queue.shift()?.(); };
  if (o.keep) warm()?.catch(() => {});
  const complete: Complete = async ({ system, user }) => {
    await turn();
    let l: Live | undefined;
    try {
      l = await take();
      // Room for two: the next agent gets ready while this one answers.
      if (o.keep && free() > ROOM_FOR_TWO) warm()?.catch(() => {});
      const created = await l.acp.request("session/new", { cwd: join(data, "work", "agy"), mcpServers: [], _meta: { antigravity: { systemPrompt: { append: system }, enabledTools: [] } } }, 120_000);
      const session = String(created?.sessionId || "");
      if (!session) throw Error("Gemini on your VPS didn't open a conversation.");
      l.sessions.push(session);
      let text = "";
      l.text.set(session, (t) => { text += t; });
      try { await l.acp.request("session/prompt", { sessionId: session, prompt: [{ type: "text", text: user }] }, STEP_MS); }
      catch (e) {
        l.acp.notify("session/cancel", { sessionId: session });
        const m = reason(e);
        if (/authentication required|not authenticated|unauthenticated|invalid_grant/i.test(m)) throw new SignedOutAgy("Gemini on your VPS is signed out. Set up the AI again in Settings.");
        throw Error(/SUBSCRIPTION_REQUIRED/.test(m) ? "Google says this account has no Gemini plan." : /timed out/.test(m) ? "Gemini on your VPS took too long to answer." : m || "Gemini on your VPS couldn't answer.");
      } finally { l.text.delete(session); }
      // A turn that failed comes back as a message of its own ("Usage Limit Reached", "Agent execution error: …"): it is
      // an error, never an answer handed on as if Gemini had said it.
      const problem = replyProblem(text);
      if (problem) throw problem.kind === "signed-out" ? new SignedOutAgy("Gemini on your VPS is signed out. Set up the AI again in Settings.") : Error(problem.message.replace(/ Try again later or pick another model\.| Check Gemini in Settings → Models\.| Check your Google AI plan, or pick another model\./, ""));
      if (!text.trim()) throw Error("Gemini on your VPS gave an empty answer.");
      return text.trim();
    } finally {
      // The answer's agent goes with its helper; the next one is started now, while Clem uses this answer.
      if (l) await stopAgy(l, data);
      done();
      if (o.keep) warm()?.catch(() => {});
    }
  };
  return {
    complete,
    // The agent kept for the next answer starts and signs in: that is the check, so no second agent starts for it.
    signedIn: async () => {
      if (!installedAgy(data)) return false;
      const live = o.keep ? warm() : undefined;
      if (live) return live.then(() => true, () => false);
      return agySignedIn(data, o.start);
    },
    stop: async () => { stopped = true; const s = spare; spare = null; if (s) await s.live.then((l) => stopAgy(l, data), () => {}); },
  };
}
/** The model alone (see antigravityModel). */
export function antigravityComplete(data: string, o: { start?: Parameters<typeof openAgy>[2]; keep?: boolean } = {}): Complete {
  return antigravityModel(data, o).complete;
}

/** `node index.cjs agy <command>` inside the worker, for the desktop over SSH. Prints one result line; exits. */
export async function agyCommand(args: string[], data: string, print = (line: string) => process.stdout.write(line + "\n")): Promise<number> {
  const [cmd, arg] = args;
  if (cmd === "install") { const i = await installAgy(data); print(`installed ${i.version}`); return 0; }
  if (cmd === "status") { print((await agySignedIn(data)) ? "signed-in" : "signed-out"); return 0; }
  // Google's page went back to the agent's loopback address on this server: hand it there (only that address).
  if (cmd === "fetch") {
    if (!/^http:\/\/127\.0\.0\.1:\d{4,5}\/\?/.test(arg || "")) { print("bad address"); return 2; }
    await fetch(arg, { signal: AbortSignal.timeout(30_000) }).catch(() => {});
    return 0;
  }
  if (cmd === "login") {
    // Signed in already: nothing to show. Otherwise the page is printed and this waits until Google's page returns.
    try {
      const live = await openAgy(data, (url) => print(AGY_SIGNIN + url));
      await stopAgy(live, data);
      print(AGY_DONE + "ok");
      return 0;
    } catch (e) { print(AGY_DONE + "failed " + ((e as Error)?.message || "").slice(0, 300)); return 1; }
  }
  print("usage: agy install|status|login|fetch <url>");
  return 2;
}
