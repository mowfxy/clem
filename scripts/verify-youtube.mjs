import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5198/");
  await page.route("https://www.youtube-nocookie.com/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<title>Player fixture</title>",
    }),
  );
  await page.evaluate(async () => {
    const React = await import("/node_modules/.vite/deps/react.js");
    const ReactDOM = await import(
      "/node_modules/.vite/deps/react-dom_client.js"
    );
    const createRoot = ReactDOM.createRoot || ReactDOM.default.createRoot;
    const { YouTubeReferences } = await import("/src/YouTubeReferences.tsx");
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    createRoot(host).render(
      (React.createElement || React.default.createElement)(YouTubeReferences, {
        text: "Watch https://youtu.be/abcdefghijk?t=90",
      }),
    );
  });
  await page
    .getByRole("button", { name: "Load YouTube video player" })
    .waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  await page.getByRole("button", { name: "Load YouTube video player" }).click();
  await page.locator("iframe").waitFor();
  assert.match(
    await page.locator("iframe").getAttribute("src"),
    /embed\/abcdefghijk\?start=90/,
  );
  assert.equal(
    await page
      .getByRole("link", { name: "Watch on YouTube" })
      .getAttribute("href"),
    "https://www.youtube.com/watch?v=abcdefghijk&t=90",
  );
  await page.getByRole("button", { name: "Close player" }).click();
  assert.equal(await page.locator("iframe").count(), 0);
  console.log(
    "YouTube component passed: click-to-load, timestamp, fallback and unload. Player response mocked; real streaming not asserted.",
  );
} finally {
  await browser.close();
  await server.close();
}
