/**
 * Exports a Markdown answer the way the Export → Word / PowerPoint buttons do (the documentExport action in desktop/main.ts), in
 * Electron, so the files can be opened in Word and PowerPoint. Run with: node scripts/verify/export-answer.mjs <out dir> [answer.md]
 */
import { app } from "electron";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { wordDocument } from "../../desktop/docx-document.ts";
import { powerpointDeck } from "../../desktop/pptx-deck.ts";
import { markdownDocument } from "../../desktop/pdf-document.ts";
import { markdownDeck } from "../../desktop/markdown-deck.ts";

const visual = (spec: object) => "```visual\n" + JSON.stringify(spec) + "\n```";
export const sampleAnswer = `# How a Voltage Divider Works

A voltage divider turns a larger voltage into a smaller one using two resistors in series.

## Why it matters

Sensors, volume controls and level shifters all depend on the same ratio, so understanding it once pays off many times. Engineers reach for it first whenever a signal has to be scaled before it reaches a microcontroller input or an amplifier stage.

## The equation

The output voltage across the second resistor is

$$V_{out} = V_{in}\\frac{R_2}{R_1+R_2}$$

- The same current flows through both resistors
- Each drop follows Ohm's law $V = IR$
- The drops add up to the source voltage

## Numbers for a 12 V example

- **8 V** across R2
- **40 mA** loop current
- **0.48 W** total power

## Design steps

1. Choose the ratio from the input and target output
2. Pick a resistance scale low enough to ignore the load
3. Check the power rating of each resistor
4. Measure the output under load

## Where dividers appear

- **Sensors**: thermistors and light sensors turn resistance into a voltage
- **Level shifting**: 5 V logic is scaled down to 3.3 V inputs
- **Volume controls**: a potentiometer is a variable divider

## Predicted against measured

| Resistor | Predicted (V) | Measured (V) |
|---|---:|---:|
| R1 | 4.00 | 3.98 |
| R2 | 8.00 | 8.01 |

## Output against R2

${visual({ kind: "chart", title: "Output voltage rises with R2", chart: { type: "line", labels: ["50", "100", "200", "400", "800"], series: [{ name: "Vout (V)", values: [4, 6, 8, 9.6, 10.7] }] } })}

## Conclusion

- A divider is exact only while the output is unloaded
- Buffer the output with an op-amp when a load must be driven
`;

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const out = process.argv[2];
  const source = process.argv.find((a, i) => i > 1 && a.endsWith(".md"));
  const markdown = source ? await readFile(source, "utf8") : sampleAnswer;
  await mkdir(out, { recursive: true });
  const title = "How a Voltage Divider Works";
  const deck = markdownDeck(markdown, title);
  await writeFile(join(out, "deck-spec.json"), JSON.stringify(deck, (k, v) => (k === "args" ? "[figure spec]" : v), 2));
  console.log("deck:", deck.slides.map((s) => s.layout).join(", "), "| theme", deck.theme?.preset);
  try { const made = await powerpointDeck(deck); await writeFile(join(out, "answer.pptx"), made.bytes); console.log("ok answer.pptx", made.bytes.length, "slides", made.slides, made.review.length ? made.review : ""); } catch (e) { console.log("FAIL pptx", (e as Error).message); }
  try { const bytes = await wordDocument(markdownDocument(markdown, title)); await writeFile(join(out, "answer.docx"), bytes); console.log("ok answer.docx", bytes.length); } catch (e) { console.log("FAIL docx", (e as Error).message); }
  app.quit();
});
