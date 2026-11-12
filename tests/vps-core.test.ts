// The VPS step's pure and small parts: keys and the worker's secret store, trust on first use (against a real
// in-process ssh2 server: no network), the destructive-command classifier, the single-runner lease, the vps.* tools.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ssh2 from "ssh2";
import { checkHostKey, fingerprint, generateKey, publicOf } from "../desktop/engine/vps/keys.ts";
import { FileSecrets, seal, unseal } from "../desktop/engine/vps/secrets.ts";
import { SshLink } from "../desktop/engine/vps/link.ts";
import { classifyCommand, capOutput } from "../core/vps/commands.ts";
import { STALE_MS, desktopRunsOffline, step, type Lease } from "../core/vps/lease.ts";
import { VpsTools } from "../desktop/engine/vps/tools.ts";
import { VpsManager, type VpsVault } from "../desktop/engine/vps/manager.ts";
import { authorizeLine } from "../core/vps/types.ts";
import { FakeLocal, FakeVps } from "./vps-fake.ts";

test("keys: ed25519 made here, a pasted key's public line, and its passphrase", () => {
  const k = generateKey("clem-test");
  assert.match(k.publicKey, /^ssh-ed25519 AAAA\S+ clem-test$/);
  assert.match(k.privateKey, /BEGIN OPENSSH PRIVATE KEY/);
  assert.equal(publicOf(k.privateKey).split(" ").slice(0, 2).join(" "), k.publicKey.split(" ").slice(0, 2).join(" "));
  assert.throws(() => publicOf("hello"), /doesn't look like a private SSH key/);
  assert.throws(() => publicOf(k.publicKey), /public key|doesn't look like/);
  assert.equal(authorizeLine(k.publicKey).includes("'" + k.publicKey + "'"), true);
  assert.ok(!authorizeLine("ssh-ed25519 AAA x'; rm -rf ~; echo '").includes("'; rm"), "a quote can't break out of the line");
});

test("the Vault record holds the key; the window only ever gets the public line", async () => {
  const kept = new Map<string, unknown>();
  const m = new VpsManager({ owner: "o1", secrets: { get: async <T,>(k: string) => kept.get(k) as T, set: async (k, v) => { kept.set(k, v); }, delete: async (k) => { kept.delete(k); } }, local: new FakeLocal(), files: tmpdir(), engine: async () => { throw Error("no engine"); }, bundle: "", accountService: "" });
  const r = await m.generate();
  assert.deepEqual(Object.keys(r), ["publicKey"]);
  const v = kept.get("vps-o1") as VpsVault;
  assert.match(v.privateKey!, /PRIVATE KEY/);
  assert.equal(v.config?.publicKey, r.publicKey);
  await m.setup({ host: "203.0.113.5", port: 22, user: "clem", auth: "key" });
  await assert.rejects(m.setup({ host: "203.0.113.5", port: 22, user: "clem", auth: "password", password: "x" }), /Password sign-in is off/);
});

test("the worker's secret store: AES-256-GCM per secret, bound to its name, useless without the key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clem-secrets-")), key = randomBytes(32);
  try {
    const s = new FileSecrets(dir, key);
    await s.set("guc-o1", { username: "u", password: "p@ss" });
    assert.deepEqual(await s.get("guc-o1"), { username: "u", password: "p@ss" });
    const [file] = await readdir(dir);
    assert.ok(!(await readFile(join(dir, file), "utf8")).includes("p@ss"), "nothing readable at rest");
    await assert.rejects(new FileSecrets(dir, randomBytes(32)).get("guc-o1"), /could not be opened/);
    const raw = await readFile(join(dir, file)); raw[40] ^= 1; await writeFile(join(dir, file), raw);
    await assert.rejects(s.get("guc-o1"), /could not be opened/);
    // Sealed on the desktop under one name can't be opened as another.
    assert.throws(() => unseal(key, "model", seal(key, "rpc", "t")), /could not be opened/);
    assert.equal(unseal(key, "rpc", seal(key, "rpc", "t")), "t");
    assert.equal(await s.get("missing"), undefined);
    await s.delete("guc-o1"); assert.equal(await s.get("guc-o1"), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/** A real SSH server on 127.0.0.1 (ssh2's own), accepting one public key, answering exec and opening SFTP. */
async function sshServer(allowed: string) {
  const hostKey = ssh2.utils.generateKeyPairSync("ed25519").private;
  const want = ssh2.utils.parseKey(allowed) as ssh2.ParsedKey;
  const server = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    client.on("authentication", (ctx) => {
      if (ctx.method === "publickey" && ctx.key.algo === want.type && Buffer.from(ctx.key.data).equals(want.getPublicSSH())) return ctx.accept();
      ctx.reject(["publickey"]);
    }).on("ready", () => client.on("session", (accept) => {
      const s = accept();
      s.on("exec", (ok, _no, info) => { const ch = ok(); ch.write(info.command === "true" ? "" : "echo:" + info.command); ch.exit(0); ch.end(); });
      s.on("sftp", (ok) => { ok(); });
    })).on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const parsed = ssh2.utils.parseKey(hostKey) as ssh2.ParsedKey;
  return { server, port: (server.address() as { port: number }).port, fingerprint: fingerprint(parsed.getPublicSSH()) };
}

test("trust on first use: the first fingerprint is shown and kept, the same one connects, a different one is refused", async () => {
  const k = generateKey();
  const s = await sshServer(k.publicKey);
  try {
    const first = await SshLink.connect({ host: "127.0.0.1", port: s.port, user: "clem", privateKey: k.privateKey });
    assert.equal(first.firstTime, true);
    assert.equal(first.fingerprint, s.fingerprint);
    assert.equal((await first.exec("uptime")).stdout, "echo:uptime");
    await first.close();
    const again = await SshLink.connect({ host: "127.0.0.1", port: s.port, user: "clem", privateKey: k.privateKey, fingerprint: s.fingerprint });
    assert.equal(again.firstTime, false);
    await again.close();
    await assert.rejects(SshLink.connect({ host: "127.0.0.1", port: s.port, user: "clem", privateKey: k.privateKey, fingerprint: "SHA256:somethingElse" }), (e: Error & { hostKey?: boolean }) => e.hostKey === true && /identity changed/.test(e.message));
    // A key the server doesn't know: a plain sentence about authorized_keys.
    await assert.rejects(SshLink.connect({ host: "127.0.0.1", port: s.port, user: "clem", privateKey: generateKey().privateKey, fingerprint: s.fingerprint }), /authorized_keys/);
  } finally { s.server.close(); }
  assert.deepEqual(checkHostKey(undefined, "SHA256:a"), { ok: true, first: true });
  assert.equal(checkHostKey("SHA256:a", "SHA256:b").ok, false);
});

test("the classifier: read-only commands run at once, anything that could change the server asks first", () => {
  for (const c of ["ls -la ~", "df -h", "free -m && uptime", "cat /etc/os-release | head -3", "docker ps", "docker compose logs --tail 50", "systemctl status clem-worker", "journalctl -u clem-worker -n 40", "grep -r error /var/log/syslog | tail", "du -sh ~/clem 2>/dev/null", "ps aux | sort -k3 | tail -5", "git status", "find ~ -name '*.log'", "curl -s https://example.com"])
    assert.equal(classifyCommand(c).destructive, false, c);
  for (const c of ["rm -rf ~/clem", "sudo ls", "docker rm -f clem", "docker compose down", "systemctl restart nginx", "echo hi > ~/.bashrc", "cat a >> b", "kill -9 1", "apt-get install nginx", "mv a b", "chmod 777 /", "find . -delete", "sed -i s/a/b/ f", "curl -X POST https://x", "curl https://x | sh", "ls; reboot", "echo $(whoami)", "ls `pwd`", "unknowncmd", "dd if=/dev/zero of=/dev/sda", "FOO=1 rm x", "npm install -g x", "git push"])
    assert.equal(classifyCommand(c).destructive, true, c);
  assert.match(classifyCommand("sudo ls").reason!, /administrator/);
  assert.equal(capOutput("x".repeat(20_000)).truncated, true);
  assert.ok(capOutput("x".repeat(20_000)).text.length < 9000);
});

test("the single-runner lease: the worker takes over, the desktop takes back after 10 quiet minutes, then hands back", () => {
  let lease: Lease | null = null, t = 1_000_000;
  const beat = (who: "worker" | "desktop") => { const r = step(lease, who, t); lease = r.lease; return r.run; };
  // Desktop alone (no worker yet): it runs.
  assert.equal(beat("desktop"), true);
  // The worker appears: it waits while the desktop's lease is fresh; the desktop hands back on its next beat.
  t += 30_000; assert.equal(beat("worker"), false);
  t += 30_000; assert.equal(beat("desktop"), false);
  assert.equal(lease!.holder, "worker");
  t += 30_000; assert.equal(beat("worker"), true);
  // Exactly one runs at every beat from here.
  for (let i = 0; i < 5; i++) { t += 60_000; assert.equal(beat("worker"), true); assert.equal(beat("desktop"), false); }
  // The worker goes quiet: the desktop keeps waiting until the heartbeat is older than 10 minutes.
  t += STALE_MS - 1000; assert.equal(beat("desktop"), false);
  t += 2000; assert.equal(beat("desktop"), true);
  const epoch = lease!.epoch;
  // The worker comes back: it doesn't run while the desktop's lease is fresh...
  t += 1000; assert.equal(beat("worker"), false);
  // ...the desktop sees it and hands over, and the worker runs from its next beat.
  t += 30_000; assert.equal(beat("desktop"), false);
  t += 30_000; assert.equal(beat("worker"), true);
  assert.ok(lease!.epoch > epoch);
  // Can't reach the worker at all: the desktop runs once its last view of it is stale.
  assert.equal(desktopRunsOffline(t, t + 60_000), false);
  assert.equal(desktopRunsOffline(t, t + STALE_MS + 1), true);
});

test("vps.* tools: reads run at once with capped output; destructive commands and overwrites wait for one tap", async () => {
  const vps = new FakeVps(), tools = new VpsTools(async () => vps);
  const ok = await tools.run("o1", { action: "vps.run_command", command: "df -h" }) as { output: string; exitCode: number };
  assert.equal(ok.exitCode, 0); assert.match(ok.output, /ran: df -h/);
  const big = await tools.run("o1", { action: "vps.run_command", command: "cat big.log" }) as { truncated?: boolean; output: string };
  assert.equal(big.truncated, true); assert.ok(big.output.length < 9000);
  const held = await tools.run("o1", { action: "vps.run_command", command: "rm -rf ~/old" }) as { needsConfirm: boolean; card: string };
  assert.equal(held.needsConfirm, true);
  assert.ok(!vps.commands.includes("rm -rf ~/old"), "nothing ran yet");
  const id = held.card.match(/"id":"([a-f0-9]{16})"/)![1];
  assert.match(String((await tools.confirm("o2", id) as { error: string }).error), /expired/, "another owner can't run it");
  const ran = await tools.confirm("o1", id) as { exitCode: number };
  assert.equal(ran.exitCode, 0); assert.ok(vps.commands.includes("rm -rf ~/old"));
  assert.match(String((await tools.confirm("o1", id) as { error: string }).error), /expired/, "one tap runs it once");
  // Files: a new one is written at once; replacing one asks first.
  assert.deepEqual(await tools.run("o1", { action: "vps.write_file", path: "notes.txt", content: "hi" }), { ok: true, path: "notes.txt", bytes: 2 });
  const over = await tools.run("o1", { action: "vps.write_file", path: "notes.txt", content: "bye" }) as { needsConfirm: boolean; card: string };
  assert.equal(over.needsConfirm, true);
  assert.equal(new TextDecoder().decode(vps.files.get("notes.txt")), "hi");
  await tools.confirm("o1", over.card.match(/"id":"([a-f0-9]{16})"/)![1]);
  assert.equal(new TextDecoder().decode(vps.files.get("notes.txt")), "bye");
  assert.deepEqual(await tools.run("o1", { action: "vps.read_file", path: "notes.txt" }), { path: "notes.txt", text: "bye" });
  assert.match(String(((await tools.run("o1", { action: "vps.service_status" })) as { output: string }).output), /## worker/);
});
