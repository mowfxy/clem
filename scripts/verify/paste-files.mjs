// Checks Ctrl+V into the chat against the real App: a pasted screenshot becomes an image attachment with a dated name,
// pasted text stays text, and files copied in File Explorer (no files in the paste, only on the desktop clipboard)
// are fetched from the desktop app and attached.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || "test-results/paste-files";
await mkdir(out, { recursive: true });
// The desktop bridge answers clipboardFiles with two files, as File Explorer's copy would give.
const explorer = () => {
  let bridge;
  Object.defineProperty(window, "mowrDesktop", {
    configurable: true,
    get: () => bridge,
    set(value) {
      const invoke = value.invoke;
      value.invoke = async (r) => {
        if (r.action !== "clipboardFiles") return invoke(r);
        window.clipboardAsked = (window.clipboardAsked || 0) + 1;
        const bytes = (text) => new TextEncoder().encode(text);
        return { files: [{ name: "Lecture notes.md", type: "text/markdown", bytes: bytes("# Notes\nOhm's law.") }, { name: "Results.csv", type: "text/csv", bytes: bytes("a,b\n1,2") }] };
      };
      bridge = value;
    },
  });
};
const browser = await chromium.launch();
const fixture = await openFixture(browser, { initScripts: [explorer] });
const { page, errors } = fixture;
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
try {
  const box = page.locator(".composer textarea");
  await box.click();
  // A screenshot on the clipboard: Chromium hands it over as one file called image.png.
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 40; canvas.height = 30;
    const g = canvas.getContext("2d"); g.fillStyle = "#c33"; g.fillRect(0, 0, 40, 30);
    const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
    const data = new DataTransfer(); data.items.add(new File([blob], "image.png", { type: "image/png" }));
    document.querySelector(".composer textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  const chip = page.locator(".attachment-chips .image-chip");
  await chip.first().waitFor({ timeout: 8000 });
  check(/^Pasted image \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.png/.test((await chip.first().innerText()).trim()), "a pasted screenshot is attached with a dated name");
  check((await box.inputValue()) === "", "the picture is not pasted as text");
  // Text pastes as text, and does not ask the desktop app for files.
  await page.evaluate(() => {
    const data = new DataTransfer(); data.setData("text/plain", "hello there");
    document.querySelector(".composer textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  check(!(await page.evaluate(() => window.clipboardAsked)), "a text paste does not read files");
  // File Explorer's copy: nothing in the paste itself.
  await page.evaluate(() => document.querySelector(".composer textarea").dispatchEvent(new ClipboardEvent("paste", { clipboardData: new DataTransfer(), bubbles: true, cancelable: true })));
  await page.locator(".attachment-chips button", { hasText: "Results.csv" }).waitFor({ timeout: 8000 });
  check(await page.locator(".attachment-chips button", { hasText: "Lecture notes.md" }).isVisible(), "files copied in File Explorer are attached");
  await page.screenshot({ path: out + "/pasted.png" });
  check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
} finally {
  await fixture.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
