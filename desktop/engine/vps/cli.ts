// The AI on the VPS without the laptop (docs/GUC-VPS-ENGINE.md "Model on the VPS"): Clem installs Claude Code, Codex
// or Gemini (Google's Antigravity agent, unmodified, as on this PC: ./antigravity.ts) inside its worker on the server
// and signs it in there, once, with the person's own account in a window on this PC. It is a sign-in of its own (its
// folders live under the worker's state/), never a copy of this PC's tokens or the server user's ~/.claude or ~/.codex.
import { q, type VpsLink } from "./link.ts";
import { workerDir } from "./install.ts";

export type ServerCli = "claude" | "codex" | "antigravity";
export type WorkerKind = "docker" | "systemd";
const PACKAGE: Record<"claude" | "codex", string> = { claude: "@anthropic-ai/claude-code", codex: "@openai/codex" };
/** What the person reads for each one. */
export const CLI_NAME: Record<ServerCli, string> = { claude: "Claude Code", codex: "Codex", antigravity: "Gemini" };
/** The worker's own program run as a command (`node index.cjs agy …`, ./antigravity.ts agyCommand), with its data folder. */
const AGY = 'CLEM_DATA="$D" node "$W" agy';
// $D is the worker's data folder: /data in its container, state/ beside it with systemd (headless.ts ownCliEnv).
const PRELUDE = 'export HOME="$D/home" CLAUDE_CONFIG_DIR="$D/claude" CODEX_HOME="$D/codex" npm_config_cache="$D/tmp/npm" npm_config_update_notifier=false PATH="$D/cli/node_modules/.bin:$PATH"; mkdir -p "$HOME" "$CLAUDE_CONFIG_DIR" "$CODEX_HOME" "$D/cli" "$D/tmp"; ';

/** A shell command run where the worker runs (inside its container with Docker), with the CLIs' own folders. */
export function inWorker(kind: WorkerKind, owner: string, script: string, o: { tty?: boolean } = {}) {
  const dir = workerDir(owner);
  return kind === "docker"
    ? `cd ~/${dir} && docker compose exec${o.tty ? "" : " -T"} worker sh -c ${q("D=/data; W=/app/index.cjs; " + PRELUDE + script)}`
    : `cd ~/${dir} && D="$PWD/state" W="$PWD/index.cjs" sh -c ${q(PRELUDE + script)}`;
}

/** Installs the official npm package into the worker's data folder (kept across worker refreshes), unless it is there;
 *  for Gemini, Google's own Linux build of the Antigravity agent, checked against the registry's sha256. */
export async function installCli(link: VpsLink, kind: WorkerKind, owner: string, cli: ServerCli) {
  if (cli === "antigravity") {
    const a = await link.exec(inWorker(kind, owner, `${AGY} install 2>&1 | tail -3`), { timeout: 1_800_000 });
    if (a.code !== 0 || !/installed \d/.test(a.stdout)) throw Error("Gemini didn't install on your VPS: " + (a.stdout + a.stderr).trim().split("\n").slice(-2).join(" ").slice(0, 300));
    return;
  }
  const r = await link.exec(inWorker(kind, owner, `[ -x "$D/cli/node_modules/.bin/${cli}" ] || npm install --no-audit --no-fund --prefix "$D/cli" ${PACKAGE[cli]}@latest 2>&1 | tail -5; ${cli} --version`), { timeout: 900_000 });
  if (r.code !== 0) throw Error(`${CLI_NAME[cli]} didn't install on your VPS: ` + (r.stdout + r.stderr).trim().split("\n").slice(-2).join(" ").slice(0, 300));
}

/** Whether the CLI on the server is signed in to a subscription. */
export async function cliSignedIn(link: VpsLink, kind: WorkerKind, owner: string, cli: ServerCli) {
  // Gemini: the agent starts and asks for no Google page (its first start unpacks itself, which takes a while).
  const r = await link.exec(inWorker(kind, owner, cli === "claude" ? "claude auth status" : cli === "codex" ? "codex login status" : `${AGY} status`), { timeout: cli === "antigravity" ? 400_000 : 30_000 }).catch(() => null);
  if (!r || r.code !== 0) return false;
  if (cli === "antigravity") return /^signed-in$/m.test(r.stdout);
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

/** The address Google's page went back to: the agent's own loopback address on the server, with the sign-in's code. */
export function agyLanding(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && u.hostname === "127.0.0.1" && /^\d{4,5}$/.test(u.port) && u.pathname === "/" && u.searchParams.get("code") && u.searchParams.get("state") ? u.href : null;
  } catch { return null; }
}

/** Gemini: Google's Antigravity agent on the server asks for the person's Google sign-in (their Google AI plan) as it does
 *  on this PC. Its Google page opens in a sign-in window here; Google sends the browser back to the agent's loopback
 *  address, which only exists on the server, so Clem hands that address to the server, where the agent takes it. Done
 *  once the agent says it is signed in (its sign-in is kept in the worker's own data folder). */
export async function antigravitySignIn(link: VpsLink, kind: WorkerKind, owner: string, open: (url: string, landed: (url: string) => void) => () => void) {
  if (!link.interactive) throw Error("This connection can't sign in on the server.");
  const live = await link.interactive(inWorker(kind, owner, `${AGY} login`));
  let out = "", sent = false, closePage = () => {};
  const result = new Promise<boolean>((resolve) => {
    live.onData((t) => { out = (out + clean(t)).slice(-16_000); const m = /CLEM_AGY_DONE (\S+)/.exec(out); if (m) resolve(m[1] === "ok"); });
    void live.done.then(() => resolve(/CLEM_AGY_DONE ok/.test(out)));
  });
  // Its first start unpacks the agent on the server, which can take a few minutes on a small VPS.
  let slow: ReturnType<typeof setTimeout> | undefined;
  const url = await Promise.race([
    new Promise<string>((resolve) => { const check = () => { const m = /CLEM_AGY_SIGNIN (\S+)/.exec(out); if (m) resolve(m[1]); }; live.onData(check); check(); }),
    result.then((ok) => ok ? "" : Promise.reject(Error("Gemini on your VPS stopped before Google's sign-in: " + (/CLEM_AGY_DONE failed (.*)/.exec(out)?.[1] || out.trim().split("\n").slice(-1)[0] || "").slice(0, 200)))),
    new Promise<string>((_, reject) => { slow = setTimeout(() => reject(Error("Gemini on your VPS didn't give a sign-in page. Try again.")), 400_000); }),
  ]).catch((e) => { live.close(); throw e; }).finally(() => clearTimeout(slow));
  // Already signed in: nothing to open.
  if (!url) return { url: "", paste: () => {}, done: Promise.resolve(true) };
  const paste = (landed: string) => {
    const back = agyLanding(landed.trim());
    if (!back || sent) return;
    sent = true;
    void link.exec(inWorker(kind, owner, `${AGY} fetch ${q(back)}`), { timeout: 60_000 }).catch(() => {});
  };
  closePage = open(url, paste);
  const timeout = setTimeout(() => live.close(), 16 * 60_000);
  const done = result.then((ok) => { clearTimeout(timeout); closePage(); live.close(); return ok; });
  return { url, paste, done };
}
