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
  p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out.trim()) : reject(Error(err.trim().slice(0, 300) || "The model CLI failed.")); });
  p.stdin.end(input);
});
/** The environment of the CLIs Clem installed and signed in to on the server itself (desktop/engine/vps/cli.ts):
 *  under the worker's data folder, with their own sign-in folders, never the server user's own ~/.claude or ~/.codex. */
export function ownCliEnv(data: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, HOME: join(data, "home"), CLAUDE_CONFIG_DIR: join(data, "claude"), CODEX_HOME: join(data, "codex"), PATH: join(data, "cli", "node_modules", ".bin") + delimiter + (base.PATH || "") };
}
/** A CLI that answers one prompt on stdin: Claude Code (`claude -p`), Codex (`codex exec -`) or Gemini (`gemini -p`). The one Clem
 *  installed under `data` (and signed in to from Settings) first, else one the person put on the server's PATH. */
export async function cliComplete(o: { data?: string; probe?: (cmd: string, env: NodeJS.ProcessEnv) => Promise<boolean> } = {}): Promise<{ name: string; complete: Complete } | undefined> {
  const probe = o.probe || ((cmd: string, env: NodeJS.ProcessEnv) => run(cmd, ["--version"], "", 10_000, env).then(() => true, () => false));
  const own = o.data ? ownCliEnv(o.data) : undefined;
  const has = (cmd: string) => (own ? existsSync(join(o.data!, "cli", "node_modules", ".bin", cmd)) : false);
  // The one Clem signed in on this server comes first (only that one has a sign-in under `data`), then one on PATH.
  const order = (["claude", "codex", "gemini"] as const).slice().sort((a, b) => Number(has(b)) - Number(has(a)));
  for (const name of order) {
    const env = has(name) ? own! : process.env;
    if (!(await probe(name, env))) continue;
    // Gemini CLI: the prompt comes on stdin (it reads stdin, then the -p text); answers in plain text, no tools asked.
    if (name === "gemini") return { name, complete: ({ system, user }) => run("gemini", ["--output-format", "text", "-p", "Answer the request above."], `<instructions>\n${system}\n</instructions>\n\n${user}`, STEP_MS, { ...env, NO_BROWSER: "true" }) };
    return name === "claude"
      // A long system prompt (the agent's guides) goes on stdin with the message: one argument may not pass 128 KB on Linux.
      ? { name, complete: ({ system, user }) => system.length > 60_000 ? run("claude", ["-p", "--output-format", "text"], `<instructions>\n${system}\n</instructions>\n\n${user}`, STEP_MS, env) : run("claude", ["-p", "--output-format", "text", "--append-system-prompt", system], user, STEP_MS, env) }
      : { name, complete: ({ system, user }) => run("codex", ["exec", "--skip-git-repo-check", "-"], system + "\n\n" + user, STEP_MS, env) };
  }
  return undefined;
}
