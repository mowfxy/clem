// Settings → Connectors → VPS against the real App with fixture answers (no SSH, no server): the guided setup, a key
// made here with its one-line command, the test result with the trusted fingerprint, storage usage, a move in
// progress and done, the background worker's status, and the main-thread cards (moved, and a command waiting for a
// tap), in dark and light.
// Usage: node scripts/verify/vps.mjs [out-dir]   (screenshots are vps-*.png)
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/vps";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const GB = 1024 ** 3, MB = 1024 ** 2;
const PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFzCXE3irfCsLids/Uguf3i3Bq0XyVq8w2xKfJx1uM9r clem-fixture";
const FP = "SHA256:vnI285M7Yzvb1krF1Ty9Q6LisO9mWIszzruC4nx3lTY";

/** The main process's VPS answers, as a small state machine. */
function fakeMain() {
  const s = { config: undefined, test: undefined, mode: "device", move: undefined, worker: false, ticks: 0 };
  const storage = () => s.mode === "vps" ? { mode: "vps", device: 1.4 * GB, vps: 6.2 * GB, cache: 1.4 * GB, cap: 2 * GB, pinned: 120 * MB, files: { device: 3, vps: 412 } } : { mode: "device", device: 6.3 * GB, vps: 0, cache: 0, cap: 2 * GB, pinned: 0, files: { device: 415, vps: 0 } };
  const status = () => ({
    connected: !!s.config, ...(s.config ? { config: { ...s.config, publicKey: PUB, ...(s.test ? { fingerprint: FP } : {}) }, online: !!s.test } : {}), ...(s.test ? { lastTest: s.test } : {}),
    storage: storage(), ...(s.move ? { migration: s.move } : {}),
    worker: s.worker ? { enabled: true, installed: true, kind: "docker", runner: "worker", heartbeat: Date.now() - 40_000, model: "cli" } : { enabled: false, installed: false, runner: "desktop", model: "none" },
    passwordAllowed: false,
  });
  return {
    s, status,
    vpsStatus: () => {
      // A move in progress advances each time the window looks.
      if (s.move?.status === "running" && ++s.ticks > 3) { s.move = { ...s.move, status: "done", done: s.move.total, bytesDone: s.move.bytesTotal, finishedAt: Date.now() }; s.mode = "vps"; }
      return status();
    },
    vpsGenerateKey: () => ({ publicKey: PUB }),
    vpsSetup: (r) => { s.config = { host: r.host, port: r.port, user: r.user, auth: r.auth }; return status(); },
    vpsTest: () => (s.test = { ok: true, ms: 38, os: "Ubuntu 24.04.1 LTS", diskFree: 61.5 * GB, diskTotal: 80 * GB, docker: true, systemd: true, node: "v22.11.0", fingerprint: FP, firstTime: true }),
    vpsMove: (r) => { s.move = { direction: r.direction, status: "running", total: 415, done: 168, failed: 0, bytesTotal: 6.3 * GB, bytesDone: 2.5 * GB, startedAt: Date.now() }; s.ticks = 0; return s.move; },
    vpsAbortMove: () => s.move,
    vpsCap: () => status(),
    vpsPinned: () => ["file-notes"],
    vpsPin: () => ({ ok: true }),
    vpsWorker: (r) => { s.worker = r.on; return status(); },
    vpsConfirm: () => ({ exitCode: 0, output: "Removed 3 old log files." }),
    vpsCancel: () => ({ ok: true }),
  };
}

try {
  for (const theme of ["dark", "light"]) {
    const m = fakeMain();
    const card = (c) => "```clem-card\n" + JSON.stringify(c) + "\n```";
    const main = { id: "main-fixture", kind: "main", title: "Clem", titled: true, renamed: true, pinned: true, spaceId: null, updated: Date.now() - 60e3, messages: [
      { id: "u0", role: "user", content: "Clean up the old logs on my server", at: Date.now() - 120e3 },
      { id: "a0", role: "assistant", content: "That deletes files, so tap Run it if it looks right.\n\n" + card({ type: "vps_confirm", id: "0123456789abcdef", action: "run", command: "rm ~/clem/logs/*.old", reason: '"rm" can change the server' }), at: Date.now() - 110e3 },
      { id: "a1", role: "assistant", content: card({ type: "vps_moved", direction: "up", files: 415, bytes: 6.3 * GB }), at: Date.now() - 60e3 },
    ] };
    const fx = await openFixture(browser, {
      port: 5247, viewport: { width: 1360, height: 900 },
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)})}catch{}`],
      extraChats: [main],
      guc: async (r) => { const fn = m[r.action]; return fn ? fn(r) : null; },
    });
    const { page, errors } = fx;
    const shot = async (name, el) => { await page.waitForTimeout(400); await (el ? page.locator(el).last() : page).screenshot({ path: `${out}/vps-${name}-${theme}.png` }); };
    const dialog = page.locator(".app-modal:has(.vps-manage)");
    try {
      check(await page.locator("html").getAttribute("data-theme") === theme, `${theme}: theme applied`);
      // Settings → Connectors: the VPS row, then its guided setup.
      await page.keyboard.press("Control+,");
      await page.locator(".st-dialog").waitFor();
      await page.locator(".st-nav button", { hasText: "Connectors" }).click();
      await page.getByRole("button", { name: "Set up" }).waitFor({ timeout: 4000 });
      check(/Your own server/.test(await page.locator(".st-dialog").textContent()), `${theme}: the VPS row says what it is`);
      await shot("row", ".st-dialog");
      await page.getByRole("button", { name: "Set up" }).click();
      await dialog.waitFor({ timeout: 4000 });
      check((await dialog.locator("h3").textContent()) === "Connect your VPS" && await dialog.locator(".vps-port input").inputValue() === "22", `${theme}: the setup asks for the server, port 22 by default`);
      await shot("setup", ".app-modal");
      await dialog.getByRole("button", { name: "Generate a key for me" }).click();
      await dialog.locator(".vps-code").first().waitFor();
      check((await dialog.locator(".vps-code").first().textContent()).includes(">> ~/.ssh/authorized_keys"), `${theme}: the one-line command to add the key`);
      check(await dialog.getByRole("button", { name: "Copy the command" }).count() === 1 && await dialog.getByRole("button", { name: "Copy the public key" }).count() === 1, `${theme}: Copy buttons`);
      await dialog.getByLabel("Address").fill("203.0.113.5");
      await dialog.getByLabel("User").fill("clem");
      await shot("key", ".app-modal");
      await dialog.getByRole("button", { name: "Save and test" }).click();
      await dialog.locator("h3", { hasText: /^Your VPS$/ }).waitFor({ timeout: 5000 });
      const text = await dialog.textContent();
      check(/Connected in 38 ms/.test(text) && /Ubuntu 24\.04/.test(text) && /Docker is ready/.test(text) && /free of/.test(text), `${theme}: the test shows latency, OS, disk and Docker`);
      check(text.includes(FP) && /First time here/.test(text), `${theme}: the fingerprint, trusted on first use`);
      check(await dialog.locator(".vps-dot.is-on").count() >= 1, `${theme}: a live status dot`);
      await shot("tested", ".app-modal");
      // Storage: usage, then Move everything with its progress, then done.
      check(/This PC/.test(text) && /6\.3 GB/.test(text), `${theme}: storage usage on this PC`);
      await dialog.getByRole("button", { name: "Move everything to my VPS" }).click();
      await dialog.locator(".vps-moving").waitFor({ timeout: 4000 });
      check(/168 of 415 files/.test(await dialog.locator(".vps-moving").textContent()), `${theme}: the move's progress`);
      await dialog.locator(".vps-moving").scrollIntoViewIfNeeded();
      await shot("moving", ".app-modal");
      for (let i = 0; i < 4; i++) { await dialog.getByRole("button", { name: "Test connection" }).click(); await page.waitForTimeout(150); }
      await dialog.getByRole("button", { name: "Move back to this PC" }).waitFor({ timeout: 5000 });
      const after = await dialog.textContent();
      check(/415 files moved to your VPS/.test(after) && /Your VPS6\.2 GB/.test(after.replace(/\s/g, "")) || /6\.2 GB/.test(after), `${theme}: done, usage split between this PC and the VPS`);
      check(await dialog.getByLabel("Cache limit").count() === 1 && /Pinned to this PC/.test(after), `${theme}: the cache limit and pinned files`);
      await dialog.locator(".vps-usage").scrollIntoViewIfNeeded();
      await shot("stored", ".app-modal");
      // The worker.
      await dialog.locator(".vps-section .mw-switch").last().click();
      await dialog.locator(".vps-facts").waitFor({ timeout: 4000 });
      const facts = await dialog.locator(".vps-facts").textContent();
      check(/Your VPS/.test(facts) && /Docker, with Postgres/.test(facts) && /min ago|just now/.test(facts) && /CLI signed in/.test(facts), `${theme}: the worker runs on the VPS, its heartbeat and model`);
      await dialog.locator(".vps-facts").scrollIntoViewIfNeeded();
      await shot("worker", ".app-modal");
      check(!m.s.config?.privateKey && !JSON.stringify(await page.evaluate(() => window.requests)).includes("PRIVATE KEY"), `${theme}: no private key crosses to the window`);
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
      await page.locator(".st-dialog").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
      // The main thread's cards.
      await page.locator(".nav-item", { hasText: "Clem" }).click();
      await page.locator(".chat-view.main-thread").waitFor({ timeout: 4000 });
      const moved = page.locator(".clem-card", { hasText: "Your files are on your VPS" }).last();
      await moved.waitFor({ timeout: 4000 });
      check(/415 files · 6\.3 GB/.test(await moved.textContent()), `${theme}: the moved card says how much`);
      await moved.scrollIntoViewIfNeeded();
      await shot("card-moved", ".chat-view.main-thread");
      const ask = page.locator(".clem-card", { hasText: "rm ~/clem/logs" }).last();
      check(/Run this on your VPS?/.test(await ask.textContent()), `${theme}: the card asks first`);
      check(/rm ~\/clem\/logs/.test(await ask.textContent()), `${theme}: the command waits for a tap`);
      await ask.getByRole("button", { name: "Run it" }).click();
      await ask.getByText("Removed 3 old log files.").waitFor({ timeout: 8000 });
      check(/Ran on your VPS/.test(await ask.textContent()), `${theme}: the card says it ran`);
      check(true, `${theme}: Run it runs it and shows the output`);
      await ask.scrollIntoViewIfNeeded();
      await shot("card-confirm", ".chat-view.main-thread");
      check(!errors.length, `${theme}: no page errors` + (errors.length ? ": " + errors.join("; ") : ""));
    } catch (e) { check(false, `${theme}: ${e.message.split("\n")[0]}`); await shot("failure").catch(() => {}); }
    finally { await fx.close(); }
  }
} finally { await browser.close(); }
console.log(failed ? "VPS check failed." : "VPS verified; screenshots in " + out);
process.exit(failed ? 1 : 0);
