import { chromium } from "@playwright/test";
import { browserLogin } from "../desktop/browser-login.ts";
import assert from "node:assert/strict";
const flow = await browserLogin(
  async (tokens) => assert.equal(tokens.access_token, "fixture-access"),
  () => {},
);
const callback = new URLSearchParams(new URL(flow.url).hash.split("?")[1]).get(
  "callback",
);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route("https://mowrai.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Handoff test</title>",
    }),
  );
  await page.goto("https://mowrai.com/");
  let origin;
  page.on("request", (r) => {
    if (r.url() === callback) origin = r.headers().origin;
  });
  await page.evaluate((callback) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = callback;
    for (const [name, value] of Object.entries({
      state: new URL(callback).pathname.split("/").at(-1),
      access_token: "fixture-access",
      refresh_token: "fixture-refresh",
    })) {
      const input = document.createElement("input");
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
  }, callback);
  await page.waitForURL(callback);
  await page.getByText("You’re signed in.").waitFor();
  console.log(JSON.stringify({ origin, success: true }));
} finally {
  flow.stop();
  await browser.close();
}
