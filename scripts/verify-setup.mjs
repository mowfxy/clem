import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 720 },
  });
  await page.addInitScript(() => {
    let state = {
      configured: true,
      user: { id: "fixture", email: "fixture@example.test", name: "" },
      setup: { step: 0, username: "", displayName: "", memory: true },
      entitlement: { active: false, reason: "preview" },
    };
    window.mowrDesktop = {
      onAuth: () => () => {},
      onChat: () => () => {},
      onAttachment: () => () => {},
      invoke: async (r) => {
        if (r.action === "status") return structuredClone(state);
        if (r.action === "username") return { valid: true, available: true };
        if (r.action === "setup") {
          state.setup = { ...r };
          return state;
        }
        if (r.action === "checkout") throw Error("Checkout is not configured.");
      },
    };
  });
  await page.goto("http://127.0.0.1:5198/");
  const art=page.locator('.setup-idle-art svg');
  assert.equal(await page.getByRole("button",{name:/illustration/i}).count(),0);
  const before=await art.innerHTML();await page.waitForTimeout(900);assert.notEqual(await art.innerHTML(),before);
  await page.getByLabel("Username", { exact: true }).fill("test_name");
  await page.getByText("Available", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Display name").fill("Test Person");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Enable memory").uncheck();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Subscribe", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Checkout is not configured." })
    .waitFor();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  assert.equal(await page.getByLabel("Enable memory").isChecked(), false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await page
      .locator(".setup-card")
      .evaluate((e) => getComputedStyle(e).animationName),
    "none",
  );
  await page.setViewportSize({ width: 420, height: 680 });
  await page.screenshot({path:"artifacts/setup-idle-updated.png"});
  const bounds = await page.locator(".setup-card").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 420);
  console.log(
    "Setup UI verified with mocked account: progression, saved choice, checkout error, Back, narrow layout and reduced motion.",
  );
} finally {
  await browser.close();
  await server.close();
}
