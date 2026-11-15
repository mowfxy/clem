// Every large pop-up's surface against the small confirm's: flat even glass, a quiet 1px border, no corner light
// (no --glass-sheen gradient, no bright top/left rim), in dark and light. Opens Settings, the VPS pop-up, the
// shortcuts sheet, the command palette, search everything and a confirm, and screenshots each.
// Usage: node scripts/verify/popup-surfaces.mjs [out-dir]   (screenshots are surface-*.png)
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

const out = process.argv[2] || process.env.CLEM_SHOTS || "test-results/popup-surfaces";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };

/** A surface has no corner light when its background has no gradient and no inset shadow is brighter on top/left. */
const surface = (el) => {
  const s = getComputedStyle(el);
  return { bg: s.backgroundImage, shadow: s.boxShadow, border: s.borderTopWidth + " " + s.borderTopStyle };
};
// Lit: a gradient on the surface, or an inset light that sits off-centre (a brighter top or left edge).
const lit = (x) => /gradient/.test(x.bg) || x.shadow.split(/,(?![^(]*\))/).some((p) => p.includes("inset") && /rgba?\(255, 255, 255/.test(p) && !/\) 0px 0px 0px 1px inset/.test(p));

const STATUS = { connected: true, config: { host: "203.0.113.5", port: 22, user: "clem", auth: "key", fingerprint: "SHA256:x" }, online: true, lastTest: { ok: true, ms: 38, os: "Ubuntu 24.04.1 LTS", diskFree: 6e10, diskTotal: 8e10, docker: true, systemd: true },
  storage: { mode: "device", device: 6e9, vps: 0, cache: 0, cap: 2e9, pinned: 0, files: { device: 415, vps: 0 } }, worker: { enabled: false, installed: false, runner: "desktop", model: "none" }, passwordAllowed: false };

try {
  for (const theme of ["dark", "light"]) {
    const fx = await openFixture(browser, {
      port: 5249, viewport: { width: 1360, height: 900 },
      initScripts: [`try{localStorage.setItem("clem-theme",${JSON.stringify(theme)})}catch{}`],
      guc: async (r) => r.action === "vpsStatus" ? STATUS : r.action === "vpsPinned" ? [] : null,
    });
    const { page } = fx;
    const shot = async (name, el) => { await page.waitForTimeout(450); await page.locator(el).last().screenshot({ path: `${out}/surface-${name}-${theme}.png` }); };
    const look = async (name, sel) => { const x = await page.locator(sel).last().evaluate(surface); check(!lit(x), `${theme}: ${name} is flat, no corner light (${x.bg.slice(0, 40)} | ${x.shadow.slice(0, 80)})`); return x; };
    try {
      await page.locator(".greeting-row").waitFor();
      // Settings window.
      await page.keyboard.press("Control+,");
      await page.locator(".st-dialog").waitFor();
      await look("Settings", ".st"); await shot("settings", ".st");
      // VPS pop-up over it.
      await page.locator(".st-nav button", { hasText: "Connectors" }).click();
      // Google Drive's pop-up (the first Manage), then the VPS one.
      await page.getByRole("button", { name: "Manage" }).first().click();
      await page.locator(".app-modal[open]").waitFor();
      await look("Drive pop-up", ".app-modal"); await shot("drive", ".app-modal");
      await page.keyboard.press("Escape");
      await page.locator(".app-modal[open]").waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
      await page.locator("*", { hasText: /^Files on this PC$/ }).last().locator("xpath=ancestor::*[.//button[normalize-space()='Manage']][1]").getByRole("button", { name: "Manage" }).click();
      const vps = page.locator(".app-modal:has(.vps-manage)");
      await vps.waitFor();
      await look("VPS pop-up", ".app-modal"); await shot("vps", ".app-modal");
      // The small confirm, which stays as it was.
      await vps.getByRole("button", { name: "Forget this server" }).click();
      await page.locator(".app-confirm").waitFor();
      const small = await page.locator(".app-confirm").evaluate(surface);
      console.log(`     ${theme}: confirm surface ${small.bg.slice(0, 60)} | ${small.shadow.slice(0, 120)}`);
      await shot("confirm", ".app-confirm");
      await page.locator(".app-confirm-cancel").click();
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
      await page.locator(".st-dialog").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
      // The shortcuts sheet, the palette and search everything.
      for (const [name, keys, sel] of [["shortcuts", "Control+/", "dialog.shortcuts-sheet"], ["palette", "Control+k", "dialog.command-palette"], ["search", "Control+Shift+F", "dialog.search-everything"]]) {
        await page.keyboard.press(keys);
        const open = await page.locator(sel + "[open]").waitFor({ timeout: 3000 }).then(() => true, () => false);
        if (!open) { console.log(`     ${theme}: ${name} did not open, skipped`); continue; }
        await look(name, sel); await shot(name, sel);
        await page.keyboard.press("Escape"); await page.waitForTimeout(250);
      }
    } catch (e) { check(false, `${theme}: ${e.message.split("\n")[0]}`); await page.screenshot({ path: `${out}/surface-failure-${theme}.png` }).catch(() => {}); }
    finally { await fx.close(); }
  }
} finally { await browser.close(); }
console.log(failed ? "Pop-up surfaces check failed." : "Pop-up surfaces verified; screenshots in " + out);
process.exit(failed ? 1 : 0);
