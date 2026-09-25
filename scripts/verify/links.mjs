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
    const { LinkifiedText } = await import("/src/chat/Links.tsx");
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    createRoot(host).render(
      (React.createElement || React.default.createElement)(LinkifiedText, {
        text: "Watch https://youtu.be/abcdefghijk?t=90 and read https://github.com/openai/codex/blob/main/docs/getting-started.md",
      }),
    );
  });
  // Links read as chips with a short label; the video waits for Play before loading anything.
  await page.getByRole("button", { name: "Play video" }).waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  assert.equal(await page.locator(".link-chip").nth(1).innerText(), "github.com/openai/codex/…/getting-started.md");
  assert.equal(await page.getByRole("link", { name: /Watch on/ }).getAttribute("href"), "https://www.youtube.com/watch?v=abcdefghijk&t=90");
  await page.getByRole("button", { name: "Play video" }).click();
  await page.locator("iframe").waitFor();
  assert.match(await page.locator("iframe").getAttribute("src"), /embed\/abcdefghijk\?autoplay=1&start=90/);
  console.log(
    "Links passed: chips with short labels, YouTube plays in place from its timestamp only after Play. Player response mocked.",
  );
} finally {
  await browser.close();
  await server.close();
}
