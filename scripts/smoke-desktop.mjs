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
  const toolResult=await app.evaluate(async({app})=>{
    const {Worker}=process.getBuiltinModule('worker_threads'),{join}=process.getBuiltinModule('path');
    const root=app.isPackaged?join(app.getAppPath(),'desktop-dist'):app.getAppPath();
    return new Promise((resolve,reject)=>{
      const worker=new Worker(join(root,'kinetra-worker.cjs'),{workerData:{module:'mowr',fn:'integrateExpression',args:['x^2','x',0,1]}});
      const timer=setTimeout(()=>{worker.terminate();reject(Error('worker timeout'));},10000);
      worker.once('message',value=>{clearTimeout(timer);worker.terminate();resolve(value);});worker.once('error',e=>{clearTimeout(timer);reject(e);});
    });
  });
  assert.ok(Math.abs(toolResult.result-1/3)<1e-8,'Packaged Kinetra worker executes');
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
  // Exercise the real Electron popup handler: links in answers open in the browser when they are https (any host, by
  // design), never plain http or https carrying a user name and password.
  for (const url of ["https://auth.openai.com/codex/device", "https://auth.openai.com.evil.example/codex/device", "http://auth.openai.com/codex/device", "https://user:pass@example.com/"]) {
    await app.evaluate(() => { globalThis.__openedUrl = null; });
    await page.evaluate((href) => {
      const link = document.createElement("a");
      link.href = href;
      link.target = "_blank";
      document.body.append(link);
      link.click();
      link.remove();
    }, url);
    await page.waitForTimeout(200);
    assert.equal(await app.evaluate(() => globalThis.__openedUrl), url.startsWith("https://") && !url.includes("@") ? url : null);
  }
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
