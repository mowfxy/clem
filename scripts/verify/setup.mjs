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
      entitlement: { active: true, reason: "free" },
    };
    window.clemDesktop = {
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
        if (r.action === "checkout") throw Error("Clem is free; setup must never open checkout.");
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
  await page.getByRole("radio", { name: /Start fresh/ }).check();
  await page.getByRole("progressbar", { name: "Step 3 of 4" }).waitFor();
  assert.equal(await page.getByText("$2").count(), 0, "no plan step");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.equal(await page.getByRole("radio", { name: /Remember/ }).isChecked(), false);
  assert.ok(await page.getByRole("radio", { name: /Start fresh/ }).isChecked());
  // The last step connects an AI; the workspace opens only once one is connected.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("progressbar", { name: "Step 4 of 4" }).waitFor();
  const finish = page.locator(".setup-finish");
  assert.ok(await finish.isDisabled(), "needs a connected AI first");
  assert.equal(await finish.isVisible(), false, "stays out of sight until an AI is connected");
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
    "Setup UI verified with mocked account: four free steps (the last connects an AI), no plan or checkout, saved choice, Back, narrow layout and reduced motion.",
  );
} finally {
  await browser.close();
  await server.close();
}
