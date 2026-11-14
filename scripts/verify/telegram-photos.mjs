// Telegram photos (src/telegram/figures.ts): an answer's visuals drawn as PNGs in the browser, as they are sent to
// Telegram; a block that can't be read is skipped. Usage: node scripts/verify/telegram-photos.mjs [out-dir]
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdir, writeFile } from "node:fs/promises";
const out = process.argv[2] || "test-results/telegram-photos";
await mkdir(out, { recursive: true });
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
const server = await createServer({ server: { host: "127.0.0.1", port: 5237, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5237/");
  const chart = { kind: "chart", title: "Savings", chart: { type: "bar", labels: ["Y1", "Y2", "Y3"], series: [{ name: "Balance", values: [100, 105, 110] }] } };
  const diagram = { kind: "diagram", title: "Water cycle", nodes: [{ id: "sea", label: "Ocean" }, { id: "cloud", label: "Clouds" }], edges: [{ from: "sea", to: "cloud", label: "evaporation" }] };
  const answer = "Here you go.\n\n```visual\n" + JSON.stringify(chart) + "\n```\n\nAnd:\n```visual\n" + JSON.stringify(diagram) + "\n```\n\n```visual\n{broken\n```";
  const photos = await page.evaluate(async (answer) => { const m = await import("/src/telegram/figures.ts"); return m.figurePhotos(answer); }, answer);
  check(photos.map((p) => p.name).join("|") === "Savings.png|Water cycle.png", `each readable visual becomes a photo, the broken one is skipped (${photos.map((p) => p.name).join(", ")})`);
  check(photos.every((p) => Buffer.from(p.data, "base64").subarray(1, 4).toString() === "PNG" && p.data.length > 20000), "each is a real PNG, not a blank");
  for (const [i, p] of photos.entries()) await writeFile(`${out}/tg-photo-${i}.png`, Buffer.from(p.data, "base64"));
} finally { await browser.close(); await server.close(); }
process.exit(failed ? 1 : 0);
