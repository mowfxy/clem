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
  await page.goto("http://127.0.0.1:5198/");
  const result = await page.evaluate(async () => {
    const { docxBlob, slidesBlob } = await import("/src/document-export.ts");
    const { unzipSync, strFromU8 } = await import(
      "/node_modules/.vite/deps/fflate.js"
    );
    const source =
      "# Test\nA **bold** paragraph.\n- Item\n1. First\n| Name | Value |\n| --- | --- |\n| Alpha | 42 |";
    const doc = unzipSync(
      new Uint8Array(await (await docxBlob(source, "Test")).arrayBuffer()),
    );
    const ppt = unzipSync(
      new Uint8Array(
        await (
          await slidesBlob(
            "# Heading\n" +
              Array.from({ length: 80 }, (_, i) => "Line " + i).join("\n"),
            "Test",
          )
        ).arrayBuffer(),
      ),
    );
    const xml = strFromU8(doc["word/document.xml"]);
    const slides = Object.keys(ppt).filter((k) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(k),
    );
    const slideText = slides.map((k) => strFromU8(ppt[k])).join("");
    const { openWorkflow } = await import("/src/workflow-state.ts");
    const { draftPlan } = await import("/core/orchestration.ts");
    const plan = draftPlan("Test", "a"),
      flow = await openWorkflow("test-owner", plan, "source");
    flow.plan.tasks[0] = {
      ...flow.plan.tasks[0],
      status: "complete",
      result: "durable",
    };
    await flow.save(flow.plan);
    const restored = await openWorkflow("test-owner", plan, "source"),
      isolated = await openWorkflow("other-owner", plan, "source");
    const { saveEdits, loadEdits } = await import("/src/document-state.ts");
    const file = { id: crypto.randomUUID(), name: "sample.txt" };
    const writes = await Promise.allSettled([
      saveEdits(file, 0, { text: "a" }),
      saveEdits(file, 0, { text: "b" }),
    ]);
    return {
      table: xml.includes("<w:tbl>"),
      bold: xml.includes("<w:b/>"),
      numbered: xml.includes("<w:numPr>"),
      slides: slides.length,
      last: slideText.includes("Line 79"),
      restored: restored.plan.tasks[0].result,
      isolated: isolated.plan.tasks[0].status,
      writes: writes.map((r) => r.status),
      revision: (await loadEdits(file)).revision,
    };
  });
  assert.ok(result.table && result.bold && result.numbered && result.last);
  assert.ok(result.slides >= 6);
  assert.equal(result.restored, "durable");
  assert.equal(result.isolated, "pending");
  assert.equal(result.writes.filter((x) => x === "fulfilled").length, 1);
  assert.equal(result.revision, 1);
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
  await server.close();
}
