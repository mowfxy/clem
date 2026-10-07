// Checks the usage-limit notice against the real App with a scripted desktop bridge: an answer stopped by the plan's
// limit shows the notice (no file card), auto-continue can be turned on, and "Continue now" sends the continuation.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/limit-notice";
await mkdir(out, { recursive: true });
// The first chat request writes a little, then ends the way the main process ends one the plan refused.
const limited = () => {
  let bridge;
  Object.defineProperty(window, "mowrDesktop", {
    configurable: true,
    get: () => bridge,
    set(value) {
      const listeners = new Set(), listen = value.onChat, invoke = value.invoke;
      value.onChat = (fn) => { listeners.add(fn); const stop = listen(fn); return () => { listeners.delete(fn); stop(); }; };
      let first = true;
      value.invoke = async (r) => {
        if (r.action !== "chat" || !first) return invoke(r);
        first = false;
        window.requests.push(r);
        setTimeout(() => { for (const fn of listeners) fn({ id: r.id, type: "delta", text: "I'll start with the outline, then write each chapter into the PDF." }); }, 300);
        setTimeout(() => { for (const fn of listeners) fn({ id: r.id, type: "error", error: "Claude subscription usage is unavailable right now.", limit: { resetsAt: Date.now() + 2 * 3600_000 } }); }, 700);
        return { started: true };
      };
      bridge = value;
    },
  });
};
const browser = await chromium.launch();
const fixture = await openFixture(browser, { initScripts: [limited], replies: ["All chapters are written."] });
const { page, errors } = fixture;
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
try {
  await page.locator(".composer textarea").fill("Write the full revision guide as a PDF");
  await page.locator(".composer textarea").press("Enter");
  const notice = page.locator(".limit-notice");
  await notice.waitFor({ timeout: 8000 });
  check(await notice.getByText("usage limit reached").isVisible(), "notice says the limit was reached");
  check(/files it was working on were not sent/.test(await notice.innerText()), "notice says the files were held back");
  check(await page.locator(".message.assistant .document-card, .message.assistant .file-card").count() === 0, "no file card on the stopped answer");
  check(!(await page.locator(".closed-note").count()), "no 'closed unexpectedly' note");
  await notice.getByRole("checkbox").check();
  await notice.getByText("Mowr will continue").waitFor();
  check(true, "auto-continue turned on shows when it continues");
  await page.screenshot({ path: out + "/notice.png" });
  await notice.getByRole("button", { name: "Continue now" }).click();
  await page.getByText("All chapters are written.").waitFor({ timeout: 8000 });
  const sent = await page.evaluate(() => window.requests.filter((r) => r.action === "chat").map((r) => r.messages.at(-1)?.content || ""));
  check(sent.length === 2 && /Continue the task from where you stopped/.test(sent[1]), "Continue now sends the continuation in the same chat");
  check(await page.getByText("Continued below.").isVisible(), "notice marks the task as continued");
  await page.screenshot({ path: out + "/continued.png" });
  check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
} finally {
  await fixture.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
