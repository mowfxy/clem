import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const userData = await mkdtemp(join(tmpdir(), "mowr-desktop-smoke-"));
const app = await electron.launch({
  ...(process.env.MOWR_SMOKE_PACKAGED?{executablePath:resolve('release/win-unpacked/Mowr.exe'),args:['--user-data-dir='+userData]}:{args: [resolve("desktop-dist/main.cjs"), "--user-data-dir=" + userData]}),
  timeout: 30000,
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("heading", { name: "Your next thought starts here." })
    .waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(
    await page.evaluate(() => typeof window.mowrDesktop?.invoke),
    "function",
  );
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
  assert.equal(await page.getByLabel("Email", { exact: true }).count(), 1);
  const diagram=await page.evaluate(async()=>{const r=await fetch('/api/diagram?angle=45&speed=15');return r.json();});
  assert.ok(Math.abs(diagram.range-225/9.81)<1e-8);
  assert.ok(await page.evaluate(()=>window.mowrDesktop.invoke({action:'shell',command:'whoami'}).then(()=>false,()=>true)));
  await page
    .getByRole("button", { name: "New here? Create an account" })
    .click();
  await page.getByRole("heading", { name: "Make yourself at home." }).waitFor();
  await page
    .getByRole("button", { name: "Already have an account? Sign in" })
    .click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mkdir("artifacts/desktop", { recursive: true });
  await page.screenshot({
    path: "artifacts/desktop/onboarding.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Desktop smoke passed: local renderer, isolated bridge, no renderer auth storage, sign-in/signup, reduced-motion render.",
  );
} finally {
  await app.close();
}
