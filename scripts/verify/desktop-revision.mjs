import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const listeners = new Set();
    window.fixtureRequests = [];
    window.mowrDesktop = {
      invoke: async (request) => {
        window.fixtureRequests.push(request);
        if (request.action === "chat")
          setTimeout(() => {
            for (const listener of listeners) {
              listener({
                id: request.id,
                type: "delta",
                text: "Revised text.",
              });
              listener({ id: request.id, type: "done" });
            }
          }, 0);
        return { started: true };
      },
      onChat: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  });
  await page.route("**/revision-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Desktop revision fixture</title>",
    }),
  );
  await page.goto("http://127.0.0.1:5198/revision-fixture");
  const result = await page.evaluate(async () => {
    const { reviseSelection } = await import("/src/document-revision.ts");
    const text = await reviseSelection(
      "openai",
      "Original text",
      "Make clearer",
      new AbortController().signal,
      () => {},
      "project:fixture",
    );
    return { text, request: window.fixtureRequests[0] };
  });
  assert.equal(result.text, "Revised text.");
  assert.equal(result.request.action, "chat");
  assert.equal(result.request.scope, "project:fixture");
  assert.match(result.request.messages[1].content, /Original text/);
  console.log("Desktop document revision uses the scoped IPC chat bridge.");
} finally {
  await browser.close();
  await server.close();
}
