// Screenshots sign-in and each first-run step on a scripted desktop bridge. Nothing here signs in to anything.
//   node scripts/glass-setup.mjs [out] [dark|light]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";

const out = process.argv[2] || "test-results/glass-setup", theme = process.argv[3] || "dark";
await mkdir(out, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 5197, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__status = { configured: true, user: null, setup: { step: 0, username: "sam", displayName: "Sam", memory: true }, entitlement: { active: false, reason: "" } };
  window.clemDesktop = { onAuth: () => () => {}, onChat: () => () => {}, onAttachment: () => () => {}, onCapture: () => () => {}, invoke: async (r) => {
    if (r.action === "status") return window.__status;
    if (r.action === "username") return { valid: true, available: true };
    if (r.action === "claudeStatus") return { installed: true };
    return {};
  } };
});
await page.route("**/fixture", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><div id="root"></div>' }));
await page.route("**/api/**", (r) => r.fulfill({ json: {} }));
await page.goto("http://127.0.0.1:5197/fixture");
await page.evaluate(async (theme) => {
  document.documentElement.dataset.theme = theme;
  const { default: RefreshRuntime } = await import("/@react-refresh");
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (t) => t; window.__vite_plugin_react_preamble_installed__ = true;
  for (const sheet of ["type", "style", "revamp", "marketing", "production", "popups"]) await import(`/src/${sheet}.css`);
  await import("/src/App.tsx"); // Its stylesheets, in their real order.
  const { default: React } = await import("/node_modules/.vite/deps/react.js");
  const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
  const { default: DesktopRoot } = await import("/src/desktop/DesktopRoot.tsx");
  window.__root = ReactDOM.createRoot(document.getElementById("root"));
  window.__root.render(React.createElement(DesktopRoot));
}, theme);
const shot = async (name) => { await page.waitForTimeout(1500); await page.screenshot({ path: `${out}/${name}-${theme}.png` }); };
try {
  await shot("welcome");
  for (const step of [0, 1, 2, 3]) {
    await page.evaluate((step) => { window.__status = { ...window.__status, user: { id: "u", email: "sam@example.com", name: "Sam" }, setup: { ...window.__status.setup, step }, entitlement: { active: true, reason: "" } }; window.dispatchEvent(new Event("focus")); }, step);
    await shot("step-" + step);
  }
  console.log(errors.length ? "page errors: " + errors.join("; ") : "no page errors");
} finally {
  await browser.close();
  await server.close();
}
