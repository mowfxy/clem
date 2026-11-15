// The model on the VPS worker (docs/GUC-VPS-ENGINE.md "Model on the VPS"), in order: an API key the person typed for
// the worker (Clem never reads keys from their CLIs), else a CLI Clem installed and signed in to on the VPS from Settings
// (or one they put there themselves: `claude` or `codex`), else none: sweeps run on rules alone and Telegram stays with the desktop.
// Also the headless main-thread agent that answers Telegram on the worker when a model is there.
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { TelegramTurn } from "../host.ts";

export type Complete = (r: { system: string; user: string; model?: string }) => Promise<string>;
export type ModelKey = { provider: "anthropic"; key: string; model?: string };
export const DEFAULT_MODEL = "claude-opus-5-5";

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
/** A CLI that answers one prompt on stdin: Claude Code (`claude -p`), else Codex (`codex exec -`). The one Clem
 *  installed under `data` (and signed in to from Settings) first, else one the person put on the server's PATH. */
export async function cliComplete(o: { data?: string; probe?: (cmd: string, env: NodeJS.ProcessEnv) => Promise<boolean> } = {}): Promise<{ name: string; complete: Complete } | undefined> {
  const probe = o.probe || ((cmd: string, env: NodeJS.ProcessEnv) => run(cmd, ["--version"], "", 10_000, env).then(() => true, () => false));
  const own = o.data ? ownCliEnv(o.data) : undefined;
  const has = (cmd: string) => (own ? existsSync(join(o.data!, "cli", "node_modules", ".bin", cmd)) : false);
  for (const name of ["claude", "codex"] as const) {
    const env = has(name) ? own! : process.env;
    if (!(await probe(name, env))) continue;
    return name === "claude"
      ? { name, complete: ({ system, user }) => run("claude", ["-p", "--output-format", "text", "--append-system-prompt", system], user, 180_000, env) }
      : { name, complete: ({ system, user }) => run("codex", ["exec", "--skip-git-repo-check", "-"], system + "\n\n" + user, 180_000, env) };
  }
  return undefined;
}

/** What the headless agent may call: GUC reads and Telegram's file send (same actions as the window's tools). */
export type HeadlessTools = (tool: Record<string, unknown>) => Promise<unknown>;
const SYSTEM = `You are Clem, the person's study assistant, answering a message from their Telegram while their computer may be off. Keep replies short and plain. You can use tools by replying with ONLY a JSON object {"kinetra":{"action":"…",…}} and nothing else; you will get the result and can answer or call again (at most 4 calls). Then answer normally in Markdown.`;

/** One Telegram turn answered on the worker: the Now card for context, up to four tool calls, then the answer. */
export function headlessConverse(o: { complete: Complete; tools: HeadlessTools; guide: string; context: () => Promise<string> }) {
  return async (turn: TelegramTurn) => {
    if (!("text" in turn)) throw Error("This button needs Clem on your computer.");
    const system = SYSTEM + "\n\n" + o.guide;
    let user = `${await o.context().catch(() => "")}\n\n[From Telegram] ${turn.text}`;
    for (let i = 0; i < 5; i++) {
      const reply = (await o.complete({ system, user })).trim();
      const call = i < 4 && reply.match(/^\{\s*"kinetra"[\s\S]*\}$/);
      if (!call) return { text: reply };
      let result: unknown;
      try { result = await o.tools(JSON.parse(reply).kinetra); } catch (e) { result = { error: (e as Error).message }; }
      user += `\n\nYou called: ${reply}\nResult: ${JSON.stringify(result).slice(0, 12000)}`;
    }
    return { text: "I couldn't finish that here. Open Clem on your computer to carry on." };
  };
}
