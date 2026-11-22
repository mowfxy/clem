// The model on the VPS worker (docs/GUC-VPS-ENGINE.md "Model on the VPS"), in order: an API key the person typed for
// the worker (Clem never reads keys from their CLIs), else a CLI Clem installed and signed in to on the VPS from Settings
// (Claude Code, Codex, or Gemini through Google's own Antigravity agent, ./antigravity.ts; or a `claude` or `codex` they put
// there themselves), else none: sweeps run on rules alone and Telegram stays with the desktop.
// The agent that answers with it is desktop/engine/vps/agent.ts (the window's loop, actions and workspace).
import Anthropic from "@anthropic-ai/sdk";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { AppServer } from "../../app-server.ts";
import { streamTurn } from "../../codex-stream.ts";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { antigravityModel, installedAgy } from "./antigravity.ts";

export type Complete = (r: { system: string; user: string; model?: string }) => Promise<string>;
export type ModelKey = { provider: "anthropic"; key: string; model?: string };
export const DEFAULT_MODEL = "claude-opus-5-5";
/** One step of the agent on the server's CLI (a long answer, a deck from many pages). */
const STEP_MS = 300_000;

export function apiComplete(k: ModelKey, client = new Anthropic({ apiKey: k.key })): Complete {
  return async ({ system, user }) => {
    const r = await client.messages.create({ model: k.model || DEFAULT_MODEL, max_tokens: 16000, output_config: { effort: "low" }, system, messages: [{ role: "user", content: user }] } as Anthropic.MessageCreateParamsNonStreaming);
    if (r.stop_reason === "refusal") throw Error("The model declined this request.");
    return r.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  };
}

const run = (cmd: string, args: string[], input: string, timeout = 180_000, env: NodeJS.ProcessEnv = process.env) => new Promise<string>((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...env } });
  let out = "", err = "";
  const t = setTimeout(() => { p.kill(); reject(Error("The model took too long.")); }, timeout);
  p.stdout.on("data", (b) => { out += b; }); p.stderr.on("data", (b) => { err += b; });
  p.on("error", (e) => { clearTimeout(t); reject(e); });
  // A CLI says why it failed on stderr or, like Claude Code in print mode, on stdout: either is kept, so
  // Settings shows the real reason ("Invalid API key", "quota exceeded") instead of "failed".
  p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out.trim()) : reject(Error(failure(cmd, code, err, out))); });
  p.stdin.end(input);
});
/** Why a CLI run failed, in a few lines: its stderr, else the end of its stdout, else its exit code. */
export function failure(cmd: string, code: number | null, err: string, out: string) {
  const tail = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-6).join("\n").slice(-600);
  return tail(err) || tail(out) || `${cmd} stopped with exit code ${code ?? "unknown"} and said nothing.`;
}
/** The environment of the CLIs Clem installed and signed in to on the server itself (desktop/engine/vps/cli.ts):
 *  under the worker's data folder, with their own sign-in folders, never the server user's own ~/.claude or ~/.codex. */
export function ownCliEnv(data: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, HOME: join(data, "home"), CLAUDE_CONFIG_DIR: join(data, "claude"), CODEX_HOME: join(data, "codex"), PATH: join(data, "cli", "node_modules", ".bin") + delimiter + (base.PATH || "") };
}
/** A model failure as one short line for Settings: the CLI's last meaningful line (stack frames and colour codes left out). */
export function aiReason(message: string): string {
  if (/^\s*Not logged in\b/im.test(String(message || ""))) return "Claude Code on your VPS is signed out.";
  const lines = String(message || "").replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l) => l.trim()).filter((l) => l && !/^at\s|^\{$|^\}$|^exitCode:/.test(l));
  return (lines.find((l) => /error|not |can't|cannot|required|denied|expired|invalid|limit|log ?in|sign/i.test(l)) || lines[0] || "it failed without saying why").slice(0, 180);
}
/** The worker's model, its last failure kept (one short line) until an answer works again. */
export function watchedComplete(base: Complete, log?: (m: string) => void): { complete: Complete; error: () => string | undefined } {
  let last: string | undefined;
  return {
    complete: async (r) => {
      try { const out = await base(r); last = undefined; return out; }
      catch (e) { last = aiReason((e as Error)?.message); log?.("[worker] ai: " + last); throw e; }
    },
    error: () => last,
  };
}
// ---------- Kept warm ----------
// Starting a CLI is the slowest part of an answer (the desktop keeps its own open: desktop/claude.ts, desktop/codex.ts),
// so the worker does the same: Claude Code with a spare process always waiting, Codex as one open app-server.
const SEND_MS = STEP_MS;
/** A spare process older than this is replaced (it only ever waits, so nothing is lost). */
const SPARE_AGE = 60 * 60_000;
/** Instructions go in the message: a process started ahead of time can't be given them on its command line. */
const withRules = (system: string, user: string) => (system ? `<instructions>\n${system}\n</instructions>\n\n` : "") + user;
// Claude Code on stream-json, as the desktop runs it: no built-in tools or MCP servers (the agent asks for Clem's actions
// in text), and no session files left behind.
export const CLAUDE_WARM_ARGS = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--tools", "", "--strict-mcp-config", "--no-session-persistence"];

type Proc = { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream; kill(): unknown; on(e: "close" | "error", f: (x?: unknown) => void): unknown };
/** One open Claude Code: each `send` is one message, answered by its `result` event. */
/** The kept process ended before it answered (it couldn't start, or crashed): the caller runs the request the old way. */
export class WarmStopped extends Error {}
class ClaudeProcess {
  dead = false;
  private buffer = ""; private err = ""; private out = "";
  private waiting?: { resolve(s: string): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> };
  private child: Proc;
  constructor(start: () => Proc) {
    this.child = start();
    this.child.stdout.on("data", (b: Buffer) => {
      this.buffer += b.toString("utf8");
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) { this.line(this.buffer.slice(0, i)); this.buffer = this.buffer.slice(i + 1); }
    });
    this.child.stderr.on("data", (b: Buffer) => { this.err = (this.err + b.toString("utf8")).slice(-4000); });
    const gone = (e?: unknown) => { this.dead = true; this.settle(undefined, new WarmStopped((e as Error)?.message || failure("claude", null, this.err, this.out))); };
    this.child.on("close", () => gone()); this.child.on("error", gone);
  }
  private line(raw: string) {
    if (!raw.trim()) return;
    this.out = (this.out + raw + "\n").slice(-4000);
    let e: { type?: string; subtype?: string; is_error?: boolean; result?: unknown };
    try { e = JSON.parse(raw); } catch { return; }
    if (e.type !== "result") return;
    if (e.is_error || (e.subtype && e.subtype !== "success")) this.settle(undefined, Error(String(e.result || e.subtype || "Claude Code failed.").slice(0, 600)));
    else this.settle(String(e.result ?? "").trim());
  }
  private settle(value?: string, error?: Error) {
    const w = this.waiting; if (!w) return;
    this.waiting = undefined; clearTimeout(w.timer);
    if (error) w.reject(error); else w.resolve(value!);
  }
  send(text: string): Promise<string> {
    if (this.dead) return Promise.reject(new WarmStopped(failure("claude", null, this.err, this.out)));
    if (this.waiting) return Promise.reject(Error("Claude Code is still answering."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.settle(undefined, Error("The model took too long.")); this.close(); }, SEND_MS);
      this.waiting = { resolve, reject, timer };
      this.child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
    });
  }
  close() { if (this.dead) return; this.dead = true; try { this.child.kill(); } catch { /* gone */ } }
}

/** Claude Code started ahead of time: one spare is always waiting, and each request takes it (a new spare starts at once). */
export class WarmClaude {
  private spare?: { p: ClaudeProcess; at: number };
  private refresh?: ReturnType<typeof setInterval>;
  private start: () => Proc;
  constructor(env: NodeJS.ProcessEnv, start?: () => Proc) {
    this.start = start || (() => spawn("claude", CLAUDE_WARM_ARGS, { stdio: ["pipe", "pipe", "pipe"], env: { ...env } }) as unknown as Proc);
  }
  /** Keeps one spare ready (replaced when it died or has waited too long). */
  warm() {
    if (this.spare && !this.spare.p.dead && Date.now() - this.spare.at < SPARE_AGE) return;
    this.spare?.p.close();
    try { this.spare = { p: new ClaudeProcess(this.start), at: Date.now() }; } catch { this.spare = undefined; }
    if (!this.refresh) { this.refresh = setInterval(() => this.warm(), 10 * 60_000); this.refresh.unref?.(); }
  }
  complete: Complete = async ({ system, user }) => {
    this.warm();
    const p = this.spare?.p || new ClaudeProcess(this.start);
    this.spare = undefined;
    setImmediate(() => this.warm());
    try { return await p.send(withRules(system, user)); } finally { p.close(); }
  };
  stop() { clearInterval(this.refresh); this.refresh = undefined; this.spare?.p.close(); this.spare = undefined; }
}

/** Codex kept open as `codex app-server` (the connection the desktop keeps warm, desktop/codex.ts): each request is its
 *  own ephemeral, read-only thread on it, with no shell. */
export class WarmCodex {
  private server?: AppServer;
  private start: () => ChildProcessWithoutNullStreams;
  constructor(env: NodeJS.ProcessEnv, start?: () => ChildProcessWithoutNullStreams) {
    this.start = start || (() => spawn("codex", ["app-server", "-c", 'cli_auth_credentials_store="file"', "-c", "features.shell_tool=false", "-c", "features.unified_exec=false"], { stdio: ["pipe", "pipe", "pipe"], env: { ...env } }));
  }
  /** The open connection (a new one when there is none or it closed). */
  warm(): AppServer {
    if (!this.server || this.server.dead) this.server = new AppServer(this.start());
    return this.server;
  }
  complete: Complete = async ({ system, user }) => {
    let server: AppServer;
    try { server = this.warm(); await server.ready; } catch (e) { this.server = undefined; throw new WarmStopped((e as Error)?.message || "Codex couldn't start."); }
    let out = "";
    try { await streamTurn(server, {}, withRules(system, user), undefined, [], (t) => { out += t; }, () => false, {}, SEND_MS); }
    // A connection that died mid-answer runs it again the old way; one that ran out of time doesn't wait twice.
    catch (e) { if (server.dead && !/timed out/i.test(String((e as Error)?.message))) throw new WarmStopped((e as Error)?.message || "Codex stopped."); throw e; }
    if (!out.trim()) throw Error("Codex gave an empty answer.");
    return out.trim();
  };
  stop() { this.server?.close(); this.server = undefined; }
}
/** A CLI that answers one prompt on stdin: Claude Code (`claude -p`) or Codex (`codex exec -`), and Gemini through the
 *  Antigravity agent Clem installed (./antigravity.ts). The ones Clem installed under `data` (and signed in to from
 *  Settings) first, else one the person put on the server's PATH. */
export async function cliComplete(o: { data?: string; /** The worker: keep Claude Code and Codex open between requests (WarmClaude, WarmCodex). */ warm?: boolean; probe?: (cmd: string, env: NodeJS.ProcessEnv) => Promise<boolean>; signedIn?: (cmd: string, env: NodeJS.ProcessEnv) => Promise<boolean>; /** Tests: Gemini's agent. */ agy?: { installed: () => boolean; signedIn: () => Promise<boolean>; complete: Complete } } = {}): Promise<{ name: string; names: string[]; complete: Complete } | undefined> {
  const probe = o.probe || ((cmd: string, env: NodeJS.ProcessEnv) => run(cmd, ["--version"], "", 10_000, env).then(() => true, () => false));
  // Installed is not enough: a CLI that isn't signed in answers every prompt with "Not logged in", after which the
  // next one is tried, so each step pays for it and Settings shows a reason that isn't the real one.
  const signedIn = o.signedIn || (o.probe ? async () => true : cliSignedInHere);
  const own = o.data ? ownCliEnv(o.data) : undefined;
  const has = (cmd: string) => (own ? existsSync(join(o.data!, "cli", "node_modules", ".bin", cmd)) : false);
  // The one Clem signed in on this server comes first (only that one has a sign-in under `data`), then one on PATH.
  const order = (["claude", "codex"] as const).slice().sort((a, b) => Number(has(b)) - Number(has(a)));
  const found: { name: string; complete: Complete }[] = [];
  // Gemini: Google's Antigravity agent Clem installed and signed in on this server. Set up only when it is the person's
  // AI (Settings), so it comes first. Only when it is installed is an agent started: the one kept for the next answer
  // (o.warm) is what checks its sign-in, so the worker never runs two at once (each holds a few hundred MB).
  const model = !o.agy && o.data && installedAgy(o.data) ? antigravityModel(o.data, { keep: o.warm }) : undefined;
  const agy = o.agy || (model ? { installed: () => true, signedIn: model.signedIn, complete: model.complete } : undefined);
  if (agy?.installed() && await agy.signedIn().catch(() => false)) found.push({ name: "antigravity", complete: agy.complete });
  else void model?.stop();
  for (const name of order) {
    const env = has(name) ? own! : process.env;
    if (!(await probe(name, env)) || !(await signedIn(name, env).catch(() => false))) continue;
    // A long system prompt (the agent's guides) goes on stdin with the message: one argument may not pass 128 KB on Linux.
    const at = found.length;
    if (name === "claude") found.push({ name, complete: ({ system, user }) => Buffer.byteLength(system) > 60_000 ? run("claude", ["-p", "--output-format", "text"], `<instructions>\n${system}\n</instructions>\n\n${user}`, STEP_MS, env) : run("claude", ["-p", "--output-format", "text", "--append-system-prompt", system], user, STEP_MS, env) });
    else found.push({ name, complete: ({ system, user }) => run("codex", ["exec", "--skip-git-repo-check", "-"], system + "\n\n" + user, STEP_MS, env) });
    if (o.warm) {
      // Kept open; a process that can't start, or crashes, runs that request the old way instead.
      const once = found[at].complete, w = name === "claude" ? new WarmClaude(env) : new WarmCodex(env);
      if (at === 0) try { w.warm(); } catch { /* started on first use */ }
      found[at] = { name, complete: (r) => w.complete(r).catch((e) => { if (e instanceof WarmStopped) return once(r); throw e; }) };
    }
  }
  if (!found.length) return undefined;
  // More than one on the server: one that fails (signed out, out of quota) hands the step to the next, and the one that
  // answered is asked first from then on. The first one's reason is what Settings shows when none can answer.
  let first = 0;
  return { name: found[0].name, names: found.map((f) => f.name), complete: async (r) => {
    let reason: unknown;
    for (let k = 0; k < found.length; k++) {
      const i = (first + k) % found.length;
      try { const out = await found[i].complete(r); first = i; return out; }
      catch (e) { reason ??= e; }
    }
    throw reason;
  } };
}
/** Whether a CLI on this server holds a sign-in it can answer with: Claude Code and Codex say so themselves. An API key in
 *  the environment counts too. */
export async function cliSignedInHere(name: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  if (name === "claude") {
    if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN) return true;
    const out = await run("claude", ["auth", "status"], "", 20_000, env).catch((e: Error) => e.message);
    try { return JSON.parse(out).loggedIn === true; } catch { return !/not logged in|"loggedIn":\s*false/i.test(out); }
  }
  if (name === "codex") {
    if (env.OPENAI_API_KEY) return true;
    const out = await run("codex", ["login", "status"], "", 20_000, env).then((o) => o, (e: Error) => "not logged in " + e.message);
    return /logged in/i.test(out) && !/not logged in/i.test(out);
  }
  return true;
}
