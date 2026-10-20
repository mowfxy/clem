import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { arch, freemem, homedir, release, totalmem, uptime } from "node:os";
import { join } from "node:path";
import { format } from "node:util";

/**
 * Clem's own log on this PC (logs/main.log): the main process's warnings and errors, answer timings, crashes of the
 * window or its helpers. It is what a bug report attaches when the person leaves "Include diagnostic logs" on, so a
 * report says what happened even after Clem was restarted. Never a prompt, a reply or a file's contents.
 */
export const MAIN_LOG = "main.log";
const MAIN_LOG_MAX = 1_000_000;
/** The most a report carries; the newest lines are kept. */
export const DIAGNOSTICS_MAX = 60_000;

let logFile: string | undefined;
export function startMainLog(dir: string) {
  if (logFile) return;
  try { mkdirSync(dir, { recursive: true }); } catch { return; }
  logFile = join(dir, MAIN_LOG);
  const keep = (level: string, args: unknown[]) => {
    try {
      appendFileSync(logFile!, `${new Date().toISOString()} ${level} ${redact(format(...args)).slice(0, 4000)}\n`);
      if (statSync(logFile!).size > MAIN_LOG_MAX) {
        const lines = readFileSync(logFile!, "utf8").split("\n");
        writeFileSync(logFile!, lines.slice(Math.floor(lines.length / 2)).join("\n"));
      }
    } catch { /* the log never costs the app */ }
  };
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => { keep(level, args); original(...args); };
  }
  // Only Clem's own tagged lines (answer timings and the like), not every library's chatter.
  const log = console.log.bind(console);
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^\[clem/.test(args[0])) keep("info", args); log(...args); };
  // Observed only: Electron's own handling of an uncaught error is unchanged.
  process.on("uncaughtExceptionMonitor", (error) => keep("fatal", ["uncaught:", error?.stack || error]));
  process.on("unhandledRejection", (reason) => keep("error", ["unhandled rejection:", (reason as Error)?.stack || reason]));
}
export function noteEvent(...args: unknown[]) { console.warn("[clem event]", ...args); }

/** Sign-in tokens, keys and this PC's user folder are taken out of anything a report carries. */
export function redact(text: string) {
  const home = homedir();
  let out = text;
  if (home) out = out.split(home).join("~").split(home.replace(/\\/g, "/")).join("~").split(home.replace(/\\/g, "\\\\")).join("~");
  return out
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[token]")
    .replace(/\b(?:sk|sbp|xai|pk|rk|ghp|gho|github_pat)[-_][\w-]{12,}/gi, "[key]")
    .replace(/((?:key|token|secret|password|authorization|bearer|cookie|rt)[\w-]*["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi, "$1[redacted]");
}

async function tail(file: string, bytes: number) {
  try {
    const size = (await stat(file)).size, start = Math.max(0, size - bytes);
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(size - start);
      await handle.read(buffer, 0, buffer.length, start);
      const text = buffer.toString("utf8");
      return start ? text.slice(text.indexOf("\n") + 1) : text;
    } finally { await handle.close(); }
  } catch { return ""; }
}

/** Grok's own warnings and errors of the last two days, with sign-in details left out. */
async function grokLog(home: string) {
  const since = Date.now() - 2 * 86_400_000, out: string[] = [];
  for (const line of (await tail(join(home, "logs", "unified.jsonl"), 3_000_000)).split("\n")) {
    let entry: any; try { entry = JSON.parse(line); } catch { continue; }
    if (!/warn|error/i.test(String(entry?.lvl)) || !(Date.parse(entry.ts) >= since)) continue;
    if (/auth|oidc|token|key/i.test(String(entry.msg))) continue;
    const ctx = Object.fromEntries(Object.entries(entry.ctx || {}).filter(([k]) => !/key|token|secret|auth|rt_|email|user/i.test(k)));
    out.push(`${entry.ts} pid=${entry.pid} ${entry.lvl} ${entry.msg} ${JSON.stringify(ctx)}`);
  }
  return out.slice(-80).join("\n");
}

export async function collectDiagnostics({ version, electron, logDir, grokHomes = [] }: { version: string; electron: string; logDir: string; grokHomes?: string[] }) {
  const parts = [
    `Clem ${version} · Electron ${electron} · Windows ${release()} ${arch()} · memory ${Math.round(freemem() / 1e9)}/${Math.round(totalmem() / 1e9)} GB free · PC up ${Math.round(uptime() / 3600)} h · app up ${Math.round(process.uptime() / 60)} min`,
  ];
  const main = await tail(join(logDir, MAIN_LOG), 40_000);
  if (main.trim()) parts.push("Clem log (newest last):\n" + main.trim());
  const answers = (await readFile(join(logDir, "answers.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).slice(-40);
  if (answers.length) parts.push("Recent answers (timings only):\n" + answers.map((line) => { try { const e = JSON.parse(line); return `${new Date(e.at).toISOString()} ${e.provider} ${e.model || ""} ${e.outcome} total=${e.totalMs}ms first-text=${e.firstTextMs ?? "none"} steps=${e.steps ?? ""} calls=${e.calls ?? ""} cli=${e.cliSteps ?? ""}/${e.cliCalls ?? ""}`; } catch { return ""; } }).filter(Boolean).join("\n"));
  for (const home of [...new Set(grokHomes)]) {
    const grok = await grokLog(home);
    if (grok) parts.push("Grok warnings and errors:\n" + grok);
  }
  const text = redact(parts.join("\n\n"));
  return text.length > DIAGNOSTICS_MAX ? text.slice(0, 600) + "\n…\n" + text.slice(-(DIAGNOSTICS_MAX - 600)) : text;
}
