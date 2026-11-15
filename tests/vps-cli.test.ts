// Claude Code / Codex installed and signed in on the VPS by Clem (desktop/engine/vps/cli.ts), on a fake server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCode, claudeSignIn, cliSignedIn, codexSignIn, inWorker, installCli } from "../desktop/engine/vps/cli.ts";
import { cliComplete, ownCliEnv } from "../desktop/engine/vps/headless.ts";
import type { LiveCommand } from "../desktop/engine/vps/link.ts";
import { FakeVps } from "./vps-fake.ts";

/** A server whose interactive commands print `lines` and end with `exit` once `wait` is typed (or at once). */
class Server extends FakeVps {
  typed: string[] = []; lines: string[] = []; wait?: RegExp; ptys: boolean[] = []; status = "";
  override async exec(cmd: string, o: { cap?: number } = {}) {
    if (/auth status|login status/.test(cmd)) { this.commands.push(cmd); return { code: this.status ? 0 : 1, stdout: this.status, stderr: "" }; }
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
