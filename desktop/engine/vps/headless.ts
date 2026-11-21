// The model on the VPS worker (docs/GUC-VPS-ENGINE.md "Model on the VPS"), in order: an API key the person typed for
// the worker (Clem never reads keys from their CLIs), else a CLI Clem installed and signed in to on the VPS from Settings
// (or one they put there themselves: `claude`, `codex` or `gemini`), else none: sweeps run on rules alone and Telegram stays with the desktop.
// The agent that answers with it is desktop/engine/vps/agent.ts (the window's loop, actions and workspace).
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

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
  // A CLI says why it failed on stderr or, like Claude Code and Gemini in print mode, on stdout: either is kept, so
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
/** Google refusing Gemini CLI for the person's plan (free Gemini Code Assist for individuals, since November 2026):
 *  signing in again can't fix it, so Clem sets up Claude or ChatGPT on the VPS instead. */
export const geminiRefused = (message: string) => /UNSUPPORTED_CLIENT|no longer supported for Gemini Code Assist|^Google no longer lets Gemini CLI/i.test(String(message || ""));
export const GEMINI_REFUSED = "Google no longer lets Gemini CLI use your Gemini plan on a server. Set up Claude or ChatGPT on your VPS instead.";
/** A model failure as one short line for Settings: the CLI's last meaningful line (stack frames and colour codes left out). */
export function aiReason(message: string): string {
  if (geminiRefused(message)) return GEMINI_REFUSED;
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
/** How the worker runs Gemini headless: no browser, and its working folder trusted (see cliComplete). */
export const geminiEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ ...env, NO_BROWSER: "true", GEMINI_CLI_TRUST_WORKSPACE: "true" });
/** A CLI that answers one prompt on stdin: Claude Code (`claude -p`), Codex (`codex exec -`) or Gemini (`gemini -p`). The one Clem
 *  installed under `data` (and signed in to from Settings) first, else one the person put on the server's PATH. */
export async function cliComplete(o: { data?: string; probe?: (cmd: string, env: NodeJS.ProcessEnv) => Promise<boolean>; signedIn?: (cmd: string, env: NodeJS.ProcessEnv) => Promise<boolean> } = {}): Promise<{ name: string; names: string[]; complete: Complete } | undefined> {
  const probe = o.probe || ((cmd: string, env: NodeJS.ProcessEnv) => run(cmd, ["--version"], "", 10_000, env).then(() => true, () => false));
  // Installed is not enough: a CLI that isn't signed in answers every prompt with "Not logged in", after which the
  // next one is tried, so each step pays for it and Settings shows a reason that isn't the real one.
  const signedIn = o.signedIn || (o.probe ? async () => true : cliSignedInHere);
  const own = o.data ? ownCliEnv(o.data) : undefined;
  const has = (cmd: string) => (own ? existsSync(join(o.data!, "cli", "node_modules", ".bin", cmd)) : false);
  // The one Clem signed in on this server comes first (only that one has a sign-in under `data`), then one on PATH.
  const order = (["claude", "codex", "gemini"] as const).slice().sort((a, b) => Number(has(b)) - Number(has(a)));
  const found: { name: string; complete: Complete }[] = [];
  for (const name of order) {
    const env = has(name) ? own! : process.env;
    if (!(await probe(name, env)) || !(await signedIn(name, env).catch(() => false))) continue;
    // Gemini CLI: the prompt comes on stdin (it reads stdin, then the -p text); answers in plain text, no tools asked.
    // Headless, it refuses to run in a folder no one trusted (exit 55, "not running in a trusted directory"), and the
    // worker's folder never is: trusting it by the environment works on every version (older ones ignore it; the
    // --skip-trust flag would fail on them).
    if (name === "gemini") found.push({ name, complete: ({ system, user }) => run("gemini", ["--output-format", "text", "-p", "Answer the request above."], `<instructions>\n${system}\n</instructions>\n\n${user}`, STEP_MS, geminiEnv(env)) });
    // A long system prompt (the agent's guides) goes on stdin with the message: one argument may not pass 128 KB on Linux.
    else if (name === "claude") found.push({ name, complete: ({ system, user }) => Buffer.byteLength(system) > 60_000 ? run("claude", ["-p", "--output-format", "text"], `<instructions>\n${system}\n</instructions>\n\n${user}`, STEP_MS, env) : run("claude", ["-p", "--output-format", "text", "--append-system-prompt", system], user, STEP_MS, env) });
    else found.push({ name, complete: ({ system, user }) => run("codex", ["exec", "--skip-git-repo-check", "-"], system + "\n\n" + user, STEP_MS, env) });
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
/** Whether a CLI on this server holds a sign-in it can answer with: Claude Code and Codex say so themselves; Gemini
 *  keeps Google's sign-in in ~/.gemini/oauth_creds.json. An API key in the environment counts too. */
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
  if (name === "gemini") return !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY) || existsSync(join(env.HOME || "", ".gemini", "oauth_creds.json"));
  return true;
}
