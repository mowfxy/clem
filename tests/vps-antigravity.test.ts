// Gemini on the VPS through Google's Antigravity agent (desktop/engine/vps/antigravity.ts): the Linux build from the
// registry, checked and unpacked in the worker's data folder, signed in through Google's page, answering over ACP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { agyCommand, agyEnv, antigravityComplete, antigravityModel, caBundle, installAgy, installedAgy, linuxRelease, openAgy, SignedOutAgy } from "../desktop/engine/vps/antigravity.ts";
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

test("the agent always has certificates to check Google's servers, even in an image without a system bundle", async () => {
  const data = await mkdtemp(join(tmpdir(), "clem-agy-"));
  try {
    // node:22-slim has no /etc/ssl/certs: Node's own roots are written to the worker's data folder.
    const written = await caBundle(data, [join(data, "missing.crt")]);
    assert.equal(written, join(data, "certs", "roots.pem"));
    assert.match(await readFile(written, "utf8"), /^-----BEGIN CERTIFICATE-----/);
    // A server's own bundle is used as it is.
    const system = join(data, "system.crt");
    await writeFile(system, "x");
    assert.equal(await caBundle(data, [join(data, "missing.crt"), system]), system);
    assert.equal(agyEnv("/data", { PATH: "/bin" }, undefined, written).SSL_CERT_FILE, written);
    assert.equal(agyEnv("/data", { PATH: "/bin", SSL_CERT_FILE: "/own.pem" }, undefined, written).SSL_CERT_FILE, "/own.pem", "a bundle the server sets stays");
  } finally { await rm(data, { recursive: true, force: true }); }
});

test("the worker answers through the agent: the rules as its system prompt, the message as the prompt, no tools", async () => {
  const data = await fakeInstall(), seen: string[][] = [];
  try {
    const complete = antigravityComplete(data, { start: fake("ok", seen) });
    const out = await complete({ system: "You are Clem.", user: "What's due tomorrow?" });
    assert.ok(out.length > 0);
    assert.deepEqual(seen[0], ["--uid="], "the registry's arguments");
    // Each answer is an agent of its own, ended with its helper once the answer is in (the agent can't close a
    // conversation, and every conversation keeps a helper of about 150 MB).
    assert.equal(running[0].exitCode !== null || running[0].signalCode !== null, true, "the answer's agent ended");
    await complete({ system: "You are Clem.", user: "And Friday?" });
    assert.equal(seen.length, 2);
    assert.deepEqual(await readdir(join(data, "tmp", "agy")), [], "each agent's temporary folder goes with it");
  } finally { await cleanup(data); }
});

test("the worker keeps one signed-in agent ready: it is the sign-in check, an answer takes it and the next one starts", async () => {
  const data = await fakeInstall(), seen: string[][] = [];
  const ended = (i: number) => running[i].exitCode !== null || running[i].signalCode !== null;
  try {
    const model = antigravityModel(data, { start: fake("ok", seen), keep: true, free: () => 0 });
    assert.equal(await model.signedIn(), true);
    assert.equal(seen.length, 1, "the check is the agent kept for the next answer, not a second one");
    assert.match(await model.complete({ system: "s", user: "u" }), /^Hello from/);
    for (let i = 0; i < 100 && seen.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(seen.length, 2, "the next agent started once the answer was in");
    assert.ok(ended(0), "the answer's agent ended");
    for (let i = 0; i < 100 && ended(1); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(!ended(1), "the next one waits");
    await model.complete({ system: "s", user: "u" });
    for (let i = 0; i < 100 && seen.length < 3; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(seen.length, 3);
    await model.stop();
    for (let i = 0; i < 100 && !ended(2); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(ended(2), "stopped, nothing keeps running");
    // Signed out: the check says so and no agent is left waiting.
    const out = antigravityModel(data, { start: fake("signed-out"), keep: true });
    assert.equal(await out.signedIn(), false);
    for (let i = 0; i < 100 && !ended(3); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(ended(3));
  } finally { await cleanup(data); }
});

test("with memory to spare, the next agent gets ready while an answer runs, so a reply's next step doesn't wait", async () => {
  const data = await fakeInstall(), seen: string[][] = [];
  try {
    const model = antigravityModel(data, { start: fake("ok", seen), keep: true, free: () => 8 * 1024 ** 3 });
    assert.equal(await model.signedIn(), true);
    let during = 0;
    const answering = model.complete({ system: "s", user: "u" });
    for (let i = 0; i < 100 && seen.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
    during = seen.length;
    await answering;
    assert.equal(during, 2, "the next agent started while the answer ran");
    await model.complete({ system: "s", user: "u" });
    assert.ok(seen.length <= 4, "never more than one waiting");
    await model.stop();
  } finally { await cleanup(data); }
});

test("a turn Google ends with a message of its own (no usage left) is an error, never an answer", async () => {
  const data = await fakeInstall();
  try {
    const complete = antigravityComplete(data, { start: fake("limit") });
    await assert.rejects(complete({ system: "s", user: "u" }), /^Error: Your Google AI plan has no Gemini usage left right now\.$/);
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
