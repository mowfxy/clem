// The AI on the VPS without the laptop (docs/GUC-VPS-ENGINE.md "Model on the VPS"): Clem installs Claude Code or
// Codex inside its worker on the server and signs it in there, once, with the person's own account in a window on
// this PC. It is a sign-in of its own (its folders live under the worker's state/), never a copy of this PC's CLI
// tokens or the server user's ~/.claude or ~/.codex.
import { q, type VpsLink } from "./link.ts";
import { workerDir } from "./install.ts";

export type ServerCli = "claude" | "codex" | "gemini";
export type WorkerKind = "docker" | "systemd";
const PACKAGE: Record<ServerCli, string> = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex", gemini: "@google/gemini-cli" };
/** What the person reads for each CLI. */
export const CLI_NAME: Record<ServerCli, string> = { claude: "Claude Code", codex: "Codex", gemini: "Gemini" };
// $D is the worker's data folder: /data in its container, state/ beside it with systemd (headless.ts ownCliEnv).
const PRELUDE = 'export HOME="$D/home" CLAUDE_CONFIG_DIR="$D/claude" CODEX_HOME="$D/codex" npm_config_cache="$D/tmp/npm" npm_config_update_notifier=false PATH="$D/cli/node_modules/.bin:$PATH"; mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$CODEX_HOME" "$D/cli" "$D/tmp"; ';

/** A shell command run where the worker runs (inside its container with Docker), with the CLIs' own folders. */
export function inWorker(kind: WorkerKind, owner: string, script: string, o: { tty?: boolean } = {}) {
  const dir = workerDir(owner);
  return kind === "docker"
    ? `cd ~/${dir} && docker compose exec${o.tty ? "" : " -T"} worker sh -c ${q("D=/data; " + PRELUDE + script)}`
    : `cd ~/${dir} && D="$PWD/state" sh -c ${q(PRELUDE + script)}`;
}

/** Installs the official npm package into the worker's data folder (kept across worker refreshes), unless it is there. */
export async function installCli(link: VpsLink, kind: WorkerKind, owner: string, cli: ServerCli) {
  const r = await link.exec(inWorker(kind, owner, `[ -x "$D/cli/node_modules/.bin/${cli}" ] || npm install --no-audit --no-fund --prefix "$D/cli" ${PACKAGE[cli]}@latest 2>&1 | tail -5; ${cli} --version`), { timeout: 900_000 });
  if (r.code !== 0) throw Error(`${CLI_NAME[cli]} didn't install on your VPS: ` + (r.stdout + r.stderr).trim().split("\n").slice(-2).join(" ").slice(0, 300));
}

/** Whether the CLI on the server is signed in to a subscription. */
export async function cliSignedIn(link: VpsLink, kind: WorkerKind, owner: string, cli: ServerCli) {
  // Gemini keeps its Google sign-in in ~/.gemini/oauth_creds.json ($HOME is the worker's own home folder).
  const r = await link.exec(inWorker(kind, owner, cli === "claude" ? "claude auth status" : cli === "codex" ? "codex login status" : '[ -s "$HOME/.gemini/oauth_creds.json" ] && echo signed-in'), { timeout: 30_000 }).catch(() => null);
  if (!r || r.code !== 0) return false;
  if (cli === "gemini") return /signed-in/.test(r.stdout);
  if (cli === "codex") return /logged in/i.test(r.stdout + r.stderr) && !/not logged in/i.test(r.stdout + r.stderr);
  try { return JSON.parse(r.stdout).loggedIn === true; } catch { return false; }
}

/** Restarts the worker so it picks up the newly signed-in CLI (it chooses its model when it starts). */
export async function restartWorker(link: VpsLink, kind: WorkerKind, owner: string) {
  await link.exec(kind === "docker" ? `cd ~/${workerDir(owner)} && docker compose restart worker` : "systemctl --user restart clem-worker", { timeout: 180_000 });
}

const clean = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\r/g, "");

/** Codex: a device code. The person opens the link and types the code; the command ends once they have. */
export async function codexSignIn(link: VpsLink, kind: WorkerKind, owner: string) {
  if (!link.interactive) throw Error("This connection can't sign in on the server.");
  const live = await link.interactive(inWorker(kind, owner, "codex login --device-auth"));
  let out = "";
  const challenge = await new Promise<{ url: string; code: string }>((resolve, reject) => {
    const timer = setTimeout(() => { live.close(); reject(Error("Codex didn't give a sign-in code. Try again.")); }, 60_000);
    live.onData((t) => {
      out = (out + clean(t)).slice(-16_000);
      const url = out.match(/https:\/\/auth\.openai\.com\/\S+/)?.[0], code = out.match(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}\b/)?.[0];
      if (url && code) { clearTimeout(timer); resolve({ url, code }); }
    });
    void live.done.then(() => { clearTimeout(timer); reject(Error("Codex stopped before giving a sign-in code: " + out.trim().split("\n").slice(-2).join(" ").slice(0, 200))); });
  });
  const timeout = setTimeout(() => live.close(), 15 * 60_000);
  return { ...challenge, done: live.done.then((code) => { clearTimeout(timeout); return code === 0; }) };
}

/** The address a sign-in page landed on, if it carries Claude's authorization code. */
export function claudeCode(url: string): { code: string; state: string; local: boolean } | null {
  try {
    const u = new URL(url), code = u.searchParams.get("code"), state = u.searchParams.get("state");
    if (!code || !state) return null;
    const local = u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname);
    if (!local && !/(^|\.)(claude\.ai|claude\.com|anthropic\.com)$/.test(u.hostname)) return null;
    return { code, state, local };
  } catch { return null; }
}

/** Claude Code: `claude auth login` on the server in a terminal. Its link opens in a sign-in window on this PC
 *  (`open`); when the page hands back the code, Clem passes it to the server, so nothing is copied by hand. `paste`
 *  takes a code the person copied from the page, should the window not hand it over. */
export async function claudeSignIn(link: VpsLink, kind: WorkerKind, owner: string, open: (url: string, landed: (url: string) => void) => () => void) {
  if (!link.interactive) throw Error("This connection can't sign in on the server.");
  const live = await link.interactive(inWorker(kind, owner, "BROWSER=true claude auth login", { tty: true }), { pty: true });
  let out = "", picked = false, sent = false, closePage = () => {};
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { live.close(); reject(Error("Claude Code didn't give a sign-in link. Try again.")); }, 60_000);
    live.onData((t) => {
      out = (out + clean(t)).slice(-16_000);
      // Asked which account: a Claude subscription is the first choice.
      if (!picked && /subscription|select login method/i.test(out)) { picked = true; live.write("\r"); }
      const found = out.match(/https:\/\/(?:[a-z0-9-]+\.)*(?:claude\.ai|claude\.com|anthropic\.com)\/\S*oauth\S+/)?.[0];
      if (found) { clearTimeout(timer); resolve(found); }
    });
    void live.done.then(() => { clearTimeout(timer); reject(Error("Claude Code stopped before giving a sign-in link: " + out.trim().split("\n").slice(-2).join(" ").slice(0, 200))); });
  });
  const paste = (code: string) => { if (sent) return; sent = true; live.write(code.trim() + "\r"); };
  closePage = open(url, (landed) => {
    const c = claudeCode(landed);
    if (!c || sent) return;
    if (c.local) { sent = true; void link.exec(inWorker(kind, owner, `node -e "fetch(process.argv[1]).catch(()=>{})" ${q(landed)}`), { timeout: 30_000 }).catch(() => {}); }
    else paste(`${c.code}#${c.state}`);
  });
  const timeout = setTimeout(() => live.close(), 15 * 60_000);
  const done = live.done.then((code) => { clearTimeout(timeout); closePage(); return code === 0 || /login successful|logged in/i.test(out); });
  return { url, paste, done };
}

/** The address Google's page landed on after the person allowed Gemini, if it carries the authorization code. */
export function geminiCode(url: string): string | null {
  try {
    const u = new URL(url), code = u.searchParams.get("code");
    return u.protocol === "https:" && u.hostname === "codeassist.google.com" && u.pathname.startsWith("/authcode") && code ? code : null;
  } catch { return null; }
}

/** Gemini: Google's own Gemini CLI signs in with the person's Google account (their Google AI plan) in a terminal on the
 *  server. Without a browser there it prints Google's sign-in link and asks for the code Google's page shows; the link
 *  opens in a sign-in window on this PC and Clem passes the code back, so nothing is copied by hand (`paste` takes one
 *  the person copied, should the window not hand it over). Done once the sign-in is saved on the server. */
export async function geminiSignIn(link: VpsLink, kind: WorkerKind, owner: string, open: (url: string, landed: (url: string) => void) => () => void) {
  if (!link.interactive) throw Error("This connection can't sign in on the server.");
  // "Sign in with Google" chosen up front, so the CLI goes straight to Google's page.
  const settings = JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } });
  await link.exec(inWorker(kind, owner, `mkdir -p "$HOME/.gemini" && { [ -s "$HOME/.gemini/settings.json" ] || printf '%s' ${q(settings)} > "$HOME/.gemini/settings.json"; }`), { timeout: 30_000 });
  const live = await link.interactive(inWorker(kind, owner, `cd "$HOME" && NO_BROWSER=true gemini`, { tty: true }), { pty: true });
  let out = "", sent = false, closePage = () => {};
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { live.close(); reject(Error("Gemini didn't give a sign-in link. Try again.")); }, 90_000);
    live.onData((t) => {
      out = (out + clean(t)).slice(-16_000);
      // The link may wrap across the terminal's lines: everything between the two prompts, without spaces.
      const m = /authorize the application:([\s\S]*?)Enter the authorization code/.exec(out);
      const found = m?.[1].replace(/\s+/g, "");
      if (found && /^https:\/\/accounts\.google\.com\//.test(found)) { clearTimeout(timer); resolve(found); }
    });
    void live.done.then(() => { clearTimeout(timer); reject(Error("Gemini stopped before giving a sign-in link: " + out.trim().split("\n").slice(-2).join(" ").slice(0, 200))); });
  });
  const paste = (code: string) => { if (sent) return; sent = true; live.write(code.trim() + "\r"); };
  closePage = open(url, (landed) => { const c = geminiCode(landed); if (c) paste(c); });
  // The CLI carries on into its chat once signed in: Clem watches for the saved sign-in, then closes it.
  const done = new Promise<boolean>((resolve) => {
    let finished = false;
    const finish = (ok: boolean) => { if (finished) return; finished = true; clearInterval(poll); clearTimeout(timeout); closePage(); live.close(); resolve(ok); };
    const poll = setInterval(() => { if (sent) void cliSignedIn(link, kind, owner, "gemini").then((ok) => { if (ok) finish(true); }); }, 3000);
    const timeout = setTimeout(() => finish(false), 15 * 60_000);
    void live.done.then(() => cliSignedIn(link, kind, owner, "gemini").then(finish, () => finish(false)));
  });
  return { url, paste, done };
}
