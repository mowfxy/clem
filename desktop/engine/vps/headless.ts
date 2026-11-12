// The model on the VPS worker (docs/GUC-VPS-ENGINE.md "Model on the VPS"), in order: an API key the person typed for
// the worker (Clem never reads keys from their CLIs), else a CLI they installed and signed in to on the VPS themselves
// (`claude` or `codex`), else none: sweeps run on rules alone and Telegram stays with the desktop.
// Also the headless main-thread agent that answers Telegram on the worker when a model is there.
import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
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

const run = (cmd: string, args: string[], input: string, timeout = 180_000) => new Promise<string>((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
  let out = "", err = "";
  const t = setTimeout(() => { p.kill(); reject(Error("The model took too long.")); }, timeout);
  p.stdout.on("data", (b) => { out += b; }); p.stderr.on("data", (b) => { err += b; });
  p.on("error", (e) => { clearTimeout(t); reject(e); });
  p.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(out.trim()) : reject(Error(err.trim().slice(0, 300) || "The model CLI failed.")); });
  p.stdin.end(input);
});
/** A CLI on the VPS's PATH that answers one prompt on stdin: Claude Code (`claude -p`), else Codex (`codex exec -`). */
export async function cliComplete(probe = (cmd: string) => run(cmd, ["--version"], "", 10_000).then(() => true, () => false)): Promise<{ name: string; complete: Complete } | undefined> {
  if (await probe("claude")) return { name: "claude", complete: ({ system, user }) => run("claude", ["-p", "--output-format", "text", "--append-system-prompt", system], user) };
  if (await probe("codex")) return { name: "codex", complete: ({ system, user }) => run("codex", ["exec", "--skip-git-repo-check", "-"], system + "\n\n" + user) };
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
