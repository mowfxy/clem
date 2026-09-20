import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  });
  await page.goto("http://127.0.0.1:5198/#/check");
  await page.getByRole("heading", { name: /Does it carry/ }).waitFor();
  const bytes = await page.evaluate(async () => {
    const { markContent } = await import("/core/provenance.ts");
    return Array.from(
      new Uint8Array(
        await (
          await markContent(new Blob(["A Mowr document"]), "work.md")
        ).arrayBuffer(),
      ),
    );
  });
  const uploads = [];
  page.on("request", (r) => {
    if (r.method() === "POST" || r.method() === "PUT") uploads.push(r.url());
  });
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "work.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(bytes),
    });
  await page
    .getByRole("status")
    .filter({ hasText: "Mowr marker found" })
    .waitFor();
  assert.equal(uploads.length, 0);
  await page.screenshot({ path: "artifacts/checker.png" });
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "plain.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("An unmarked document"),
    });
  await page
    .getByRole("status")
    .filter({ hasText: "No Mowr marker found" })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  console.log("PASS checker marker detection, no uploads and narrow layout");
} finally {
  await browser.close();
  await server.close();
}
