// Stopping an answer, or sending over one, leaves no "Stopped" or "Interrupted" line and no note under the box.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/quiet-stop";
await mkdir(out, { recursive: true });
// The first chat request never writes; the second writes a little and hangs; later ones are answered.
const hanging = () => {
  let bridge;
  Object.defineProperty(window, "clemDesktop", {
    configurable: true,
    get: () => bridge,
    set(value) {
      const listeners = new Set(), listen = value.onChat, invoke = value.invoke;
      value.onChat = (fn) => { listeners.add(fn); const stop = listen(fn); return () => { listeners.delete(fn); stop(); }; };
      let n = 0;
      value.invoke = async (r) => {
        if (r.action !== "chat" || n >= 2) return invoke(r);
        window.requests.push(r);
        if (n++ === 1) setTimeout(() => { for (const fn of listeners) fn({ id: r.id, type: "delta", text: "Half an answer so far." }); }, 200);
        return { started: true };
      };
      bridge = value;
    },
  });
};
const browser = await chromium.launch();
const fixture = await openFixture(browser, { initScripts: [hanging], replies: ["All of it."] });
const { page, errors } = fixture;
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const box = page.locator(".composer textarea");
const say = async (text) => { await box.fill(text); await box.press("Enter"); };
const noNotes = async () => check(!/Stopped\.|Interrupted|request is saved|closed unexpectedly|Make room for doubt/.test(await page.locator("body").innerText()), "no notes on the page");
try {
  await say("First question");
  await page.locator(".thinking").waitFor({ timeout: 8000 });
  await page.waitForFunction(() => window.requests.filter((r) => r.action === "chat").length === 1);
  await page.getByRole("button", { name: /stop/i }).first().click();
  await page.locator(".thinking").waitFor({ state: "detached" });
  check(await page.locator(".message.assistant").count() === 0, "a stopped answer with nothing written is gone");
  check(await page.getByText("First question").first().isVisible(), "the question stays");
  await noNotes();
  await page.screenshot({ path: out + "/stopped.png" });
  await say("Second question");
  await page.getByText("Half an answer so far.").waitFor({ timeout: 8000 });
  await say("Third question");
  await page.getByText("All of it.").waitFor({ timeout: 8000 });
  check(await page.getByText("Half an answer so far.").isVisible(), "the part already written stays");
  await noNotes();
  await page.screenshot({ path: out + "/sent-over.png" });
  check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
} finally {
  await fixture.close();
  await browser.close();
}
if (failed) process.exit(1);
