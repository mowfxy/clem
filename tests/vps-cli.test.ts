// Claude Code / Codex installed and signed in on the VPS by Clem (desktop/engine/vps/cli.ts), on a fake server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode, claudeSignIn, cliSignedIn, codexSignIn, geminiCode, geminiSignIn, inWorker, installCli } from "../desktop/engine/vps/cli.ts";
import { GEMINI_REFUSED, aiReason, cliComplete, geminiEnv, geminiRefused, ownCliEnv, watchedComplete } from "../desktop/engine/vps/headless.ts";
import type { LiveCommand } from "../desktop/engine/vps/link.ts";
import { FakeVps } from "./vps-fake.ts";

/** A server whose interactive commands print `lines` and end with `exit` once `wait` is typed (or at once). */
class Server extends FakeVps {
  typed: string[] = []; lines: string[] = []; wait?: RegExp; ptys: boolean[] = []; status = "";
  override async exec(cmd: string, o: { cap?: number } = {}) {
    if (/auth status|login status|oauth_creds/.test(cmd)) { this.commands.push(cmd); return { code: this.status ? 0 : 1, stdout: this.status, stderr: "" }; }
    return super.exec(cmd, o);
  }
  async interactive(cmd: string, o: { pty?: boolean } = {}): Promise<LiveCommand> {
    this.commands.push(cmd); this.ptys.push(!!o.pty);
    const listeners: ((s: string) => void)[] = [];
    let end!: (n: number) => void; const done = new Promise<number>((r) => { end = r; });
    setTimeout(() => { for (const l of this.lines) for (const f of listeners) f(l); if (!this.wait) end(0); }, 5);
    return { onData: (f) => listeners.push(f), write: (t) => { this.typed.push(t); if (this.wait?.test(t)) end(0); }, done, close: () => end(-1) };
  }
}

test("commands run inside the worker's container with Clem's own CLI folders, or beside it with systemd", () => {
  const d = inWorker("docker", "u1", "claude --version");
  assert.match(d, /^cd ~\/clem\/u1\/worker && docker compose exec -T worker sh -c '/);
  assert.match(d, /D=\/data; export HOME="\$D\/home" CLAUDE_CONFIG_DIR="\$D\/claude" CODEX_HOME="\$D\/codex"/);
  assert.match(inWorker("docker", "u1", "x", { tty: true }), /docker compose exec worker sh/);
  assert.match(inWorker("systemd", "u1", "x"), /^cd ~\/clem\/u1\/worker && D="\$PWD\/state" sh -c '/);
});

test("install uses the official npm package once, and sign-in status reads each CLI's own answer", async () => {
  const s = new Server();
  await installCli(s, "docker", "u1", "claude");
  assert.match(s.commands.at(-1)!, /npm install --no-audit --no-fund --prefix "\$D\/cli" @anthropic-ai\/claude-code@latest/);
  assert.match(s.commands.at(-1)!, /\[ -x "\$D\/cli\/node_modules\/.bin\/claude" \] \|\|/);
  await installCli(s, "systemd", "u1", "codex");
  assert.match(s.commands.at(-1)!, /@openai\/codex@latest/);
  assert.equal(await cliSignedIn(s, "docker", "u1", "claude"), false);
  s.status = JSON.stringify({ loggedIn: true, authMethod: "claude.ai" });
  assert.equal(await cliSignedIn(s, "docker", "u1", "claude"), true);
  s.status = "Logged in using ChatGPT";
  assert.equal(await cliSignedIn(s, "docker", "u1", "codex"), true);
});

test("Codex signs in with a device code shown in Clem", async () => {
  const s = new Server();
  s.lines = ["\x1b[1mWelcome\x1b[0m\nOpen https://auth.openai.com/codex/device in your browser\n", "Enter code: ABCD-12345\n"];
  const c = await codexSignIn(s, "docker", "u1");
  assert.equal(c.url, "https://auth.openai.com/codex/device");
  assert.equal(c.code, "ABCD-12345");
  assert.equal(await c.done, true);
  assert.match(s.commands.at(-1)!, /codex login --device-auth/);
});

test("Claude signs in through a window here: the code the page lands on goes to the server by itself", async () => {
  const s = new Server();
  const link = "https://claude.ai/oauth/authorize?code=true&client_id=x&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=st";
  s.lines = ["Select login method:\n 1. Claude account with subscription\n", `Browser didn't open? Use the url below to sign in:\n\n${link}\n\nPaste code here if prompted >`];
  s.wait = /#st\r$/;
  let opened = "", closed = false;
  const c = await claudeSignIn(s, "docker", "u1", (url, landed) => {
    opened = url;
    setTimeout(() => { landed("https://claude.ai/login"); landed("https://platform.claude.com/oauth/code/callback?code=AUTHCODE&state=st"); }, 5);
    return () => { closed = true; };
  });
  assert.equal(opened, link);
  assert.equal(await c.done, true);
  assert.deepEqual(s.typed, ["\r", "AUTHCODE#st\r"]);
  assert.ok(closed);
  assert.deepEqual(s.ptys, [true]);
  assert.match(s.commands.at(-1)!, /docker compose exec worker sh -c '.*BROWSER=true claude auth login/);
});

test("the code is read only from Claude's pages or the server's own callback", () => {
  assert.deepEqual(claudeCode("https://platform.claude.com/oauth/code/callback?code=a&state=b"), { code: "a", state: "b", local: false });
  assert.deepEqual(claudeCode("http://localhost:54545/callback?code=a&state=b"), { code: "a", state: "b", local: true });
  assert.equal(claudeCode("https://evil.example/cb?code=a&state=b"), null);
  assert.equal(claudeCode("https://claude.ai/login"), null);
});

test("the worker prefers the CLI Clem installed, with its own sign-in folders", async () => {
  const data = await mkdtemp(join(tmpdir(), "clem-cli-"));
  try {
    const seen: { cmd: string; env: NodeJS.ProcessEnv }[] = [];
    const probe = async (cmd: string, env: NodeJS.ProcessEnv) => { seen.push({ cmd, env }); return cmd === "codex"; };
    assert.equal((await cliComplete({ data, probe }))?.name, "codex");
    assert.equal(seen[0].env.CLAUDE_CONFIG_DIR, process.env.CLAUDE_CONFIG_DIR); // nothing of Clem's yet: the server's PATH
    await mkdir(join(data, "cli", "node_modules", ".bin"), { recursive: true });
    await writeFile(join(data, "cli", "node_modules", ".bin", "claude"), "");
    seen.length = 0;
    const probe2 = async (cmd: string, env: NodeJS.ProcessEnv) => { seen.push({ cmd, env }); return cmd === "claude"; };
    assert.equal((await cliComplete({ data, probe: probe2 }))?.name, "claude");
    assert.equal(seen[0].env.CLAUDE_CONFIG_DIR, ownCliEnv(data).CLAUDE_CONFIG_DIR);
    assert.equal(seen[0].env.HOME, join(data, "home"));
  } finally { await rm(data, { recursive: true, force: true }); }
});

test("Gemini installs from Google's package and signs in through a window here: the page's code goes to the server", async () => {
  const s = new Server();
  await installCli(s, "docker", "u1", "gemini");
  assert.match(s.commands.at(-1)!, /@google\/gemini-cli@latest/);
  assert.equal(geminiCode("https://codeassist.google.com/authcode?code=4%2F0Abc&state=x"), "4/0Abc");
  assert.equal(geminiCode("https://evil.example/authcode?code=a"), null);
  assert.equal(geminiCode("https://accounts.google.com/o/oauth2/v2/auth?code=a"), null);
  // The link wraps across the terminal's lines; Clem joins it.
  s.lines = ["Please visit the following URL to authorize the application:\n\nhttps://accounts.google.com/o/oauth2/v2/auth?redirect_uri=x&\nstate=abc\n\n", "Enter the authorization code: "];
  s.wait = /CODE123/;
  let landed!: (url: string) => void, closed = false;
  const c = await geminiSignIn(s, "docker", "u1", (_url, l) => { landed = l; return () => { closed = true; }; });
  assert.equal(c.url, "https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=x&state=abc");
  assert.ok(s.commands.some((x) => /NO_BROWSER=true gemini/.test(x)));
  assert.ok(s.commands.some((x) => /oauth-personal/.test(x)), "Sign in with Google is chosen up front");
  landed("https://codeassist.google.com/authcode?code=CODE123&state=abc");
  assert.deepEqual(s.typed, ["CODE123\r"]);
  assert.equal(await c.done, false); // the fake server never saved a sign-in
  assert.equal(closed, true);
});

test("the worker answers with Gemini when that is the CLI Clem signed in on the server", async () => {
  const data = await mkdtemp(join(tmpdir(), "clem-cli-"));
  try {
    await mkdir(join(data, "cli", "node_modules", ".bin"), { recursive: true });
    await writeFile(join(data, "cli", "node_modules", ".bin", "gemini"), "");
    const seen: string[] = [];
    const probe = async (cmd: string) => { seen.push(cmd); return true; };
    assert.equal((await cliComplete({ data, probe }))?.name, "gemini");
    assert.equal(seen[0], "gemini", "Clem's own sign-in comes before a CLI on the server's PATH");
  } finally { await rm(data, { recursive: true, force: true }); }
});

test("a failing AI is told in one short line, whichever CLI it is", () => {
  const gemini = "Error authenticating: FatalAuthenticationError: Manual authorization is required but the current session is non-interactive.\n    at initOauthClient (file:///x.js:1:1)\n{\n  exitCode: 41\n}";
  assert.match(aiReason(gemini), /^Error authenticating: .*Manual authorization is required/);
  assert.equal(aiReason("Invalid API key · Fix external API key"), "Invalid API key · Fix external API key");
  assert.match(aiReason("ERROR: Reconnecting... 1/5\nERROR: unexpected status 401 Unauthorized"), /^ERROR/);
  assert.equal(aiReason(""), "it failed without saying why");
  assert.ok(aiReason("x".repeat(500)).length <= 180);
});

test("the worker keeps its AI's last failure until an answer works again (shown instead of \"AI signed in\")", async () => {
  let fail = true;
  const w = watchedComplete(async () => { if (fail) throw Error("Invalid API key · Fix external API key"); return "ok"; });
  assert.equal(w.error(), undefined);
  await assert.rejects(w.complete({ system: "s", user: "u" }));
  assert.equal(w.error(), "Invalid API key · Fix external API key");
  fail = false;
  assert.equal(await w.complete({ system: "s", user: "u" }), "ok");
  assert.equal(w.error(), undefined);
});

test("Gemini runs headless in the worker's folder: trusted, no browser (else it stops with exit 55 on every answer)", () => {
  const env = geminiEnv({ HOME: "/data/home", PATH: "/bin" });
  assert.equal(env.GEMINI_CLI_TRUST_WORKSPACE, "true");
  assert.equal(env.NO_BROWSER, "true");
  assert.equal(env.HOME, "/data/home");
});

test("the worker answers only with a CLI that is signed in, and says plainly when Google refuses Gemini", async () => {
  const data = await mkdtemp(join(tmpdir(), "clem-cli-"));
  try {
    await mkdir(join(data, "cli", "node_modules", ".bin"), { recursive: true });
    for (const n of ["claude", "gemini"]) await writeFile(join(data, "cli", "node_modules", ".bin", n), "");
    // Both installed; Claude Code was never signed in on the server (the real VPS, 2026-11-21): Gemini alone answers.
    const c = await cliComplete({ data, probe: async () => true, signedIn: async (cmd) => cmd === "gemini" });
    assert.equal(c?.name, "gemini");
    assert.deepEqual(c?.names, ["gemini"]);
    assert.equal(await cliComplete({ data, probe: async () => true, signedIn: async () => false }), undefined, "none signed in: no AI, so Settings offers the sign-in");
  } finally { await rm(data, { recursive: true, force: true }); }
  const refused = "Error: {\n ineligibleTiers: [ { reasonCode: 'UNSUPPORTED_CLIENT', reasonMessage: 'This client is no longer supported for Gemini Code Assist for individuals.' } ]\n    at throwIneligibleOrProjectIdError (file:///x.js:1:1)";
  assert.ok(geminiRefused(refused));
  assert.equal(aiReason(refused), GEMINI_REFUSED);
  assert.equal(aiReason("Not logged in · Please run /login"), "Claude Code on your VPS is signed out.");
});
