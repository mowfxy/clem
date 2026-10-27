// The chat's files button and card, and Kinetra figures drawn inline in an answer, against the real App with a scripted
// desktop bridge. Figures are drawn by the real Kinetra worker (desktop-dist/kinetra-worker.cjs, `npm run build:desktop`).
// node --experimental-strip-types scripts/verify/chat-files-popup.mjs [out]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { openFixture, saved } from "./local-power-fixture.mjs";
import { kinetraCall } from "../../desktop/kinetra-runtime.ts";
import { composeRecipes } from "../../desktop/kinetra-recipes.ts";

const out = process.argv[2] || "test-results/chat-files-popup";
await mkdir(out, { recursive: true });
const divider = { elements: [
  { kind: "voltage-source", from: "0", to: "1", label: "V_s", value: 15, unit: "V" },
  { kind: "resistor", from: "1", to: "a", label: "R_1", value: 10, unit: "Ω" },
  { kind: "resistor", from: "a", to: "0", label: "R_2", value: 10, unit: "Ω" },
  { kind: "resistor", from: "a", to: "b", label: "R_3", value: 5, unit: "Ω" },
] };
const thevenin = { elements: [
  { kind: "voltage-source", from: "0", to: "1", label: "V_{th}", value: 7.5, unit: "V" },
  { kind: "resistor", from: "1", to: "b", label: "R_{th}", value: 10, unit: "Ω" },
] };
const block = (title, caption, args) => "```kinetra\n" + JSON.stringify({ title, caption, module: "diagram/circuit_schematic", fn: "renderCircuit", args: [args] }) + "\n```";
// A composed engineering figure (clem compose), as the model writes one from a "composed:" recipe.
const mohr = composeRecipes.find((r) => r.name === "composed: Mohr's circle").figure;
const composed = "```kinetra\n" + JSON.stringify({ title: "Mohr's circle", caption: "Plane stress; checks verified by Kinetra.", ...mohr }) + "\n```";
const reply = `Start from the circuit as drawn: the source sees $R_1$ in series with $R_2$, and $R_3$ only leads to terminal b.

${block("The left sub-circuit", "Ideal source; terminals a and b open.", divider)}

With b open, no current flows in $R_3$, so $V_{th}$ is the divider voltage $15 \\cdot \\tfrac{10}{20} = 7.5\\,\\text{V}$. Killing the source, $R_{th} = (10 \\parallel 10) + 5 = 10\\,\\Omega$.

${block("Its Thévenin equivalent", "Same behaviour at terminal b for any load.", thevenin)}

The same toolkit composes engineering figures no recipe covers, such as the stress state below.

${composed}

\`\`\`memory
{"remember":[{"text":"In this course, Thévenin resistance is found by turning off independent sources, never dependent ones.","about":"space"}]}
\`\`\``;
// Answers kinetraFigure as desktop/main.ts does: the real worker draws the netlist.
const kinetraBridge = () => {
  let bridge;
  Object.defineProperty(window, "clemDesktop", { configurable: true, get: () => bridge, set(value) {
    const invoke = value.invoke;
    value.invoke = async (r) => r.action === "kinetraFigure" ? { svg: await window.__kinetra(r.figure) } : invoke(r);
    bridge = value;
  } });
};
const browser = await chromium.launch();
const { page, context, close, errors } = await openFixture(browser, { port: 5195, replies: [reply], initScripts: [kinetraBridge], deviceScaleFactor: 2 });
await page.exposeFunction("__kinetra", async (json) => { const f = JSON.parse(json); return kinetraCall({ action: "call", module: f.module, fn: f.fn, args: f.args }); });
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
try {
  // An explanation with two circuit figures, with a lecture file attached.
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: "Circuits lecture 4.txt", mimeType: "text/plain", buffer: Buffer.from("Thevenin and Norton equivalents.") });
  await page.locator(".composer").getByText("Circuits lecture 4.txt").waitFor();
  await page.getByLabel("Your message").fill("Explain how the left sub-circuit reduces to a Thévenin branch, and remember the rule for dependent sources");
  await page.getByLabel("Your message").press("Enter");
  await page.locator(".kinetra-figure .visual-figure svg").nth(2).waitFor({ timeout: 30000 });

  check(await page.locator(".kinetra-figure").count() === 3, "both circuit figures and the composed figure drawn inline");
  check(await page.locator(".kinetra-figure", { hasText: "Technical figure" }).count() === 1, "the composed figure is labelled a technical figure");
  check(await page.locator(".memory-note", { hasText: "Thévenin resistance" }).isVisible(), "memory block shows as a note");
  // Then a PDF made in the same chat.
  await page.getByLabel("Your message").fill("Make a worksheet PDF on this");
  await page.getByLabel("Your message").press("Enter");
  await page.getByText("I saved it as a PDF.").last().waitFor();
  await saved(page);
  await page.waitForTimeout(600);
  await page.locator(".kinetra-figure").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/figures.png` });
  await page.locator(".kinetra-figure").nth(1).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/figures-2.png` });
  await page.locator(".kinetra-figure").nth(2).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/figures-composed.png` });
  // The files button and its card.
  const button = page.getByRole("button", { name: /Files in this chat/ });
  check((await button.textContent())?.includes("2"), "button counts the sent and the made file");
  await button.click();
  const card = page.getByRole("dialog", { name: "Files in this chat" });
  await card.waitFor();
  await page.waitForTimeout(450);
  check(await card.getByText("Made by Clem").isVisible() && await card.getByText("Week 3 worksheet.pdf").isVisible(), "made file listed");
  check(await card.getByText("Sent by you").isVisible() && await card.getByText("Circuits lecture 4.txt").isVisible(), "sent file listed");
  await page.screenshot({ path: `${out}/popup.png` });
  await page.screenshot({ path: `${out}/popup-close.png`, clip: { x: 900, y: 0, width: 540, height: 420 } });
  await page.keyboard.press("Escape");
  check(!(await card.isVisible()), "Escape closes the card");
  check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
} catch (error) { await page.screenshot({ path: `${out}/failure.png` }).catch(() => {}); console.log(await page.locator(".block-error").allTextContents().catch(() => [])); throw error;
} finally {
  await close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
