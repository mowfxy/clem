// Claude Code, Codex and Gemini (Google's Antigravity agent) installed and signed in on the VPS by Clem (desktop/engine/vps/cli.ts), on a fake server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agyLanding, antigravitySignIn, claudeCode, claudeSignIn, cliSignedIn, codexSignIn, inWorker, installCli } from "../desktop/engine/vps/cli.ts";
import { aiReason, cliComplete, ownCliEnv, watchedComplete } from "../desktop/engine/vps/headless.ts";
import type { LiveCommand } from "../desktop/engine/vps/link.ts";
import { FakeVps } from "./vps-fake.ts";

/** A server whose interactive commands print `lines` and end with `exit` once `wait` is typed (or at once). */
class Server extends FakeVps {
  typed: string[] = []; lines: string[] = []; wait?: RegExp; ptys: boolean[] = []; status = ""; listeners: ((s: string) => void)[] = [];
  /** A line printed later by the running interactive command. */
  say(line: string) { for (const f of this.listeners) f(line); }
  override async exec(cmd: string, o: { cap?: number } = {}) {
    if (/auth status|login status|agy status/.test(cmd)) { this.commands.push(cmd); return { code: this.status ? 0 : 1, stdout: this.status, stderr: "" }; }
    if (/agy install/.test(cmd)) { this.commands.push(cmd); return { code: 0, stdout: "installed 1.5.2\n", stderr: "" }; }
    return super.exec(cmd, o);
  }
  async interactive(cmd: string, o: { pty?: boolean } = {}): Promise<LiveCommand> {
    this.commands.push(cmd); this.ptys.push(!!o.pty);
    const listeners = this.listeners = [] as ((s: string) => void)[];
    let end!: (n: number) => void; const done = new Promise<number>((r) => { end = r; });
    setTimeout(() => { for (const l of this.lines) for (const f of listeners) f(l); if (!this.wait) end(0); }, 5);
    return { onData: (f) => listeners.push(f), write: (t) => { this.typed.push(t); if (this.wait?.test(t)) end(0); }, done, close: () => end(-1) };
  }
}

test("commands run inside the worker's container with Clem's own CLI folders, or beside it with systemd", () => {
  const d = inWorker("docker", "u1", "claude --version");
  assert.match(d, /^cd ~\/clem\/u1\/worker && docker compose exec -T worker sh -c '/);
  assert.match(d, /D=\/data; W=\/app\/index.cjs; export HOME="\$D\/home" CLAUDE_CONFIG_DIR="\$D\/claude" CODEX_HOME="\$D\/codex"/);
  assert.match(inWorker("docker", "u1", "x", { tty: true }), /docker compose exec worker sh/);
  assert.match(inWorker("systemd", "u1", "x"), /^cd ~\/clem\/u1\/worker && D="\$PWD\/state" W="\$PWD\/index.cjs" sh -c '/);
  assert.match(d, /D=\/data; W=\/app\/index.cjs;/, "the worker's own program, for Gemini's agent");
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

test("Gemini is Google's Antigravity agent on the server: installed by the worker, signed in through Google's page here", async () => {
  const s = new Server();
  await installCli(s, "docker", "u1", "antigravity");
  assert.match(s.commands.at(-1)!, /CLEM_DATA="\$D" node "\$W" agy install/);
  assert.doesNotMatch(s.commands.join("\n"), /gemini-cli|npm install/, "never Gemini CLI");
  s.status = "signed-in\n";
  assert.equal(await cliSignedIn(s, "docker", "u1", "antigravity"), true);
  s.status = "";
  assert.equal(await cliSignedIn(s, "docker", "u1", "antigravity"), false);

  assert.equal(agyLanding("http://127.0.0.1:41234/?state=s&code=4%2F0Abc&scope=x"), "http://127.0.0.1:41234/?state=s&code=4%2F0Abc&scope=x");
  assert.equal(agyLanding("http://127.0.0.1:41234/?state=s"), null);
  assert.equal(agyLanding("https://evil.example/?state=s&code=a"), null);
  assert.equal(agyLanding("http://localhost.evil.example:41234/?state=s&code=a"), null);

  const page = "https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2F&state=s";
  s.lines = ["CLEM_AGY_SIGNIN " + page + "\n"]; s.wait = /never/;
  let landed!: (url: string) => void, opened = "", closed = false;
  const c = await antigravitySignIn(s, "docker", "u1", (url, l) => { opened = url; landed = l; return () => { closed = true; }; });
  assert.equal(c.url, page);
  assert.equal(opened, page);
  assert.ok(s.commands.some((x) => /node "\$W" agy login/.test(x)));
  landed("http://127.0.0.1:41234/?state=s&code=C0DE");
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(s.commands.some((x) => /agy fetch .*http:\/\/127\.0\.0\.1:41234\/\?state=s&code=C0DE/.test(x)), "the page's return address goes to the agent on the server");
  s.say("CLEM_AGY_DONE ok\n");
  assert.equal(await c.done, true);
  assert.equal(closed, true);
});

test("Gemini signed in already: no page opens", async () => {
  const s = new Server();
  s.lines = ["CLEM_AGY_DONE ok\n"];
  let opened = false;
  const c = await antigravitySignIn(s, "docker", "u1", () => { opened = true; return () => {}; });
  assert.equal(c.url, "");
  assert.equal(await c.done, true);
  assert.equal(opened, false);
});

test("the worker answers with Gemini's agent first when Clem set it up on the server, then any signed-in CLI", async () => {
  const data = await mkdtemp(join(tmpdir(), "clem-cli-"));
  try {
    await mkdir(join(data, "cli", "node_modules", ".bin"), { recursive: true });
    await writeFile(join(data, "cli", "node_modules", ".bin", "claude"), "");
    const agy = { installed: () => true, signedIn: async () => true, complete: async () => "from gemini" };
    const c = await cliComplete({ data, probe: async () => true, signedIn: async () => true, agy });
    assert.equal(c?.name, "antigravity");
    assert.deepEqual(c?.names, ["antigravity", "claude", "codex"]);
    assert.equal(await c!.complete({ system: "s", user: "u" }), "from gemini");
    // Installed but signed out: the next one answers.
    const out = await cliComplete({ data, probe: async () => true, signedIn: async () => true, agy: { ...agy, signedIn: async () => false } });
    assert.deepEqual(out?.names, ["claude", "codex"]);
  } finally { await rm(data, { recursive: true, force: true }); }
});

test("a failing AI is told in one short line, whichever CLI it is", () => {
  const failed = "Error authenticating: FatalAuthenticationError: Manual authorization is required but the current session is non-interactive.\n    at initOauthClient (file:///x.js:1:1)\n{\n  exitCode: 41\n}";
  assert.match(aiReason(failed), /^Error authenticating: .*Manual authorization is required/);
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

test("the worker answers only with a CLI that is signed in", async () => {
  const data = await mkdtemp(join(tmpdir(), "clem-cli-"));
  try {
    await mkdir(join(data, "cli", "node_modules", ".bin"), { recursive: true });
    for (const n of ["claude", "codex"]) await writeFile(join(data, "cli", "node_modules", ".bin", n), "");
    // Both installed; Claude Code was never signed in on the server (the real VPS, 2026-11-21): Codex alone answers.
    const none = { installed: () => false, signedIn: async () => false, complete: async () => "" };
    const c = await cliComplete({ data, probe: async () => true, signedIn: async (cmd) => cmd === "codex", agy: none });
    assert.equal(c?.name, "codex");
    assert.deepEqual(c?.names, ["codex"]);
    assert.equal(await cliComplete({ data, probe: async () => true, signedIn: async () => false, agy: none }), undefined, "none signed in: no AI, so Settings offers the sign-in");
  } finally { await rm(data, { recursive: true, force: true }); }
  assert.equal(aiReason("Not logged in · Please run /login"), "Claude Code on your VPS is signed out.");
});
