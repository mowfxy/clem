// Gemini on the VPS through Google's Antigravity agent (desktop/engine/vps/antigravity.ts): the Linux build from the
// registry, checked and unpacked in the worker's data folder, signed in through Google's page, answering over ACP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { agyCommand, agyEnv, antigravityComplete, installAgy, installedAgy, linuxRelease, openAgy, SignedOutAgy } from "../desktop/engine/vps/antigravity.ts";
import { ANTIGRAVITY_REGISTRY } from "../desktop/antigravity-engine.ts";

const fixture = join(import.meta.dirname, "fixtures", "fake-antigravity.mjs");
const manifest = (sha256: string, version = "1.5.2") => ({ id: "antigravity-acp", version, distribution: { binary: {
  "linux-x86_64": { archive: `https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-${version}-linux-x86_64.zip`, cmd: "./agy_acp_server.par", args: ["--uid="], sha256 },
  "linux-aarch64": { archive: `https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-${version}-linux-arm64.zip`, cmd: "./agy_acp_server.par", args: ["--uid="], sha256 },
} } });

test("only Google's own Linux download of the listed version, with its sha256, is taken", () => {
  const sha = "a".repeat(64);
  assert.deepEqual(linuxRelease(manifest(sha), "x64"), { version: "1.5.2", url: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.5.2-linux-x86_64.zip", sha256: sha, cmd: "agy_acp_server.par", args: ["--uid="] });
  assert.equal(linuxRelease(manifest(sha), "arm64")?.url, "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-1.5.2-linux-arm64.zip");
  const moved = manifest(sha); moved.distribution.binary["linux-x86_64"].archive = "https://evil.example/agy.zip";
  assert.equal(linuxRelease(moved, "x64"), null);
  assert.equal(linuxRelease(manifest("nope"), "x64"), null);
  const escape = manifest(sha); escape.distribution.binary["linux-x86_64"].cmd = "../../bin/sh";
  assert.equal(linuxRelease(escape, "x64"), null);
  assert.equal(linuxRelease({ ...manifest(sha), id: "other" }, "x64"), null);
  assert.equal(linuxRelease(manifest(sha), "ia32"), null);
});

test("install downloads, checks the sha256, unpacks both programs and keeps only the newest copy", async () => {
  const data = await mkdtemp(join(tmpdir(), "clem-agy-"));
  try {
    const zip = zipSync({ "agy_acp_server.par": new TextEncoder().encode("#!/bin/sh\necho agent\n"), "localharness_external": new TextEncoder().encode("harness") });
    const sha = createHash("sha256").update(zip).digest("hex");
    let listed = manifest(sha), asked: string[] = [];
    const fetch = (async (url: string) => {
      asked.push(url);
      if (url === ANTIGRAVITY_REGISTRY) return new Response(JSON.stringify(listed));
      const r = new Response(zip); Object.defineProperty(r, "url", { value: url }); return r;
    }) as unknown as typeof globalThis.fetch;
    const got = await installAgy(data, { fetch, arch: "x64" });
    assert.equal(got.version, "1.5.2");
    assert.equal(await readFile(join(got.dir, "agy_acp_server.par"), "utf8"), "#!/bin/sh\necho agent\n");
    assert.ok(existsSync(join(got.dir, "localharness_external")));
    assert.deepEqual(installedAgy(data)?.args, ["--uid="]);
    // The same version again: nothing downloaded.
    asked = [];
    await installAgy(data, { fetch, arch: "x64" });
    assert.deepEqual(asked, [ANTIGRAVITY_REGISTRY]);
    // A download that isn't the listed file is refused and the installed copy stays.
    listed = manifest("b".repeat(64), "1.6.0");
    await assert.rejects(installAgy(data, { fetch, arch: "x64" }), /isn't the one Google lists/);
    assert.equal(installedAgy(data)?.version, "1.5.2");
  } finally { await rm(data, { recursive: true, force: true }); }
});

/** A worker data folder with the fake agent "installed" (run through node, as tests/antigravity.test.ts does). */
async function fakeInstall() {
  const data = await mkdtemp(join(tmpdir(), "clem-agy-"));
  const dir = join(data, "cli", "antigravity", "1.5.2");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "agy_acp_server.par"), "");
  await writeFile(join(dir, "localharness_external"), "");
  await writeFile(join(dir, "clem-install.json"), JSON.stringify({ cmd: "agy_acp_server.par", args: ["--uid="] }));
  return data;
}
const running: { kill: () => void; exitCode: number | null; signalCode: string | null; once: (e: string, f: () => void) => void }[] = [];
const fake = (mode = "ok", seen: string[][] = []) => (_cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) => { seen.push(args); const c = spawn(process.execPath, [fixture], { cwd, env: { ...env, FAKE_AGY: mode }, stdio: "pipe" }); running.push(c as any); return c as any; };
/** Every fake agent stopped (Windows keeps a running process's folder), then the folder removed. */
async function cleanup(data: string) {
  await Promise.all(running.splice(0).map((c) => c.exitCode !== null || c.signalCode !== null ? null : new Promise<void>((r) => { c.once("exit", () => r()); c.kill(); })));
  await rm(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

test("the agent runs with only its own folders and Google's sign-in, never a key from the server's environment", () => {
  const env = agyEnv("/data", { PATH: "/bin", GEMINI_API_KEY: "k", GOOGLE_APPLICATION_CREDENTIALS: "/x", HOME: "/root" }, "/data/cli/antigravity/1.5.2/localharness_external");
  assert.equal(env.GEMINI_API_KEY, undefined);
  assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(env.HOME, join("/data", "home"));
  assert.equal(env.GEMINI_HOME, join("/data", "antigravity"));
  assert.equal(env.AGY_ACP_FORCE_FILE_STORAGE, "1");
  assert.equal(env.ANTIGRAVITY_HARNESS_PATH, "/data/cli/antigravity/1.5.2/localharness_external");
  assert.match(env.BROWSER || "", /__CLEM_ANTIGRAVITY_URL__/);
});

test("the worker answers through the agent: the rules as its system prompt, the message as the prompt, no tools", async () => {
  const data = await fakeInstall(), seen: string[][] = [];
  try {
    const complete = antigravityComplete(data, { start: fake("ok", seen) });
    const out = await complete({ system: "You are Clem.", user: "What's due tomorrow?" });
    assert.ok(out.length > 0);
    assert.deepEqual(seen[0], ["--uid="], "the registry's arguments");
    // A second answer reuses the running agent.
    await complete({ system: "You are Clem.", user: "And Friday?" });
    assert.equal(seen.length, 1);
  } finally { await cleanup(data); }
});

test("signed out, the worker never waits on a sign-in; `agy login` prints Google's page for the PC instead", async () => {
  const data = await fakeInstall();
  try {
    await assert.rejects(openAgy(data, undefined, fake("signed-out")), SignedOutAgy);
    const lines: string[] = [];
    let page = "";
    const opening = openAgy(data, (url) => { page = url; }, fake("signed-out")).catch((e) => e);
    for (let i = 0; i < 100 && !page; i++) await new Promise((r) => setTimeout(r, 50));
    assert.match(page, /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
    assert.match(new URL(page).searchParams.get("redirect_uri") || "", /^http:\/\/127\.0\.0\.1:\d+\/$/);
    void opening;
    assert.equal(await agyCommand(["fetch", "https://evil.example/?code=x"], data, (l) => lines.push(l)), 2, "only the agent's loopback address is fetched");
  } finally { await cleanup(data); }
});
