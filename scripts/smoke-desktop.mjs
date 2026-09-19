import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const userData = await mkdtemp(join(tmpdir(), "mowr-desktop-smoke-"));
const app = await electron.launch({
  ...(process.env.MOWR_SMOKE_PACKAGED
    ? {
        executablePath: resolve("release/win-unpacked/Mowr.exe"),
        args: ["--user-data-dir=" + userData],
      }
    : {
        args: [resolve("desktop-dist/main.cjs"), "--user-data-dir=" + userData],
      }),
  timeout: 30000,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("heading", { name: "Welcome to Mowr." }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(
    await page.evaluate(() => typeof window.mowrDesktop?.invoke),
    "function",
  );
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
  assert.equal(await page.getByLabel("Email", { exact: true }).count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Sign in with browser" }).count(),
    1,
  );
  assert.equal(
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()),
    null,
  );
  const diagram = await page.evaluate(async () => {
    const r = await fetch("/api/diagram?angle=45&speed=15");
    return r.json();
  });
  assert.ok(Math.abs(diagram.range - 225 / 9.81) < 1e-8);
  assert.ok(
    await page.evaluate(() =>
      window.mowrDesktop.invoke({ action: "shell", command: "whoami" }).then(
        () => false,
        () => true,
      ),
    ),
  );
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      globalThis.__openedUrl = url;
    };
  });
  await page.getByRole("button", { name: "Sign in with browser" }).click();
  await page.getByRole("button", { name: "Open browser again" }).waitFor();
  const opened = await app.evaluate(() => globalThis.__openedUrl);
  assert.ok(opened.startsWith("https://mowrai.com/#/desktop-signin?callback="));
  const titlebar = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return { menu: w.isMenuBarVisible() };
  });
  assert.equal(titlebar.menu, false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir("artifacts/desktop", { recursive: true });
  await page.screenshot({
    path: "artifacts/desktop/onboarding.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Desktop smoke passed: local renderer, isolated bridge, no renderer auth storage, browser-only sign-in, reduced-motion render.",
  );
} finally {
  await app.close();
}
