/**
 * Makes one sample of every file type Mowr's file tools produce, in Electron (figures and equations are drawn by
 * Chromium), so they can be opened in Word, PowerPoint and Excel. Run with: node scripts/verify/office-files.mjs <out dir>
 */
import { app } from "electron";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { makeFile } from "../../desktop/file-maker.ts";
import { themes } from "../../desktop/pptx-deck.ts";
import { kinetraRecipes } from "../../desktop/kinetra-recipes.ts";
import { deckSamples } from "./deck-samples.ts";

const out = process.argv.at(-1)!;
const circuit = kinetraRecipes.find((r) => r.name === "circuit schematic")!.figure;
const flow = { module: "mowr", fn: "flowchart", args: [{ title: "Design process", direction: "down", nodes: [{ id: "s", label: "Brief", shape: "start" }, { id: "b", label: "Research" }, { id: "d", label: "Meets goals?", shape: "decision" }, { id: "p", label: "Ship", shape: "end" }], edges: [{ from: "s", to: "b" }, { from: "b", to: "d" }, { from: "d", to: "p", label: "Yes" }, { from: "d", to: "b", label: "No" }] }] };

const doc = {
  kind: "report", title: "Voltage Division in Series Resistor Networks", subtitle: "A worked analysis", author: "Mowr", summary: "This report derives the voltage divider relation, verifies it on a 12 V network and discusses loading effects.",
  plan: ["Introduction", "Theory", "Worked example", "Discussion"],
  sections: [
    { heading: "Introduction", text: "Series resistors share the source voltage in proportion to their resistance [1]. The circuit in Figure 1 is analysed throughout.\n\n- Ohm's law applies to each resistor.\n- Kirchhoff's voltage law closes the loop.\n  - Nested point one.\n\n1. Measure the source.\n2. Compute the current.", figure: circuit, caption: "A 12 V source driving $R_1$ and $R_2$ in series." },
    { heading: "Theory", text: "The current is $I = \\frac{V}{R_1 + R_2}$, so the voltage across $R_2$ is\n\n$$V_2 = V \\frac{R_2}{R_1 + R_2}$$\n\n> [!DEFINITION] Voltage divider\n> A network of series impedances whose output is a fixed fraction of its input.\n\n### Energy view\nThe power is $P = \\sum_{k=1}^{n} I^2 R_k$ and the matrix form is\n\n$$\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$$\n\nTable: Measured and predicted voltages\n\n| Resistor | Predicted (V) | Measured (V) |\n|---|---:|---:|\n| R1 | 4.00 | 3.98 |\n| R2 | 8.00 | 8.01 |\n\nA footnote appears here.[^1]\n\n[^1]: Measurements used a 4½-digit meter." },
    { heading: "Worked example", text: "Charging a capacitor stores energy, much as $$6CO_2 + 6H_2O \\xrightarrow{\\text{light}} C_6H_{12}O_6 + 6O_2$$ stores it in sugar; inline, water is $H_2O$ and the vector is $\\overrightarrow{AB}$.\n\nWith $V = 12\\,\\mathrm{V}$, $R_1 = 100\\,\\Omega$ and $R_2 = 200\\,\\Omega$: $I = 40\\,\\mathrm{mA}$ and $V_2 = 8\\,\\mathrm{V}$.", figure: flow, caption: "Analysis procedure." },
    { heading: "Discussion", text: "> [!WARNING] Loading\n> A load in parallel with $R_2$ lowers $V_2$.\n\n**Conclusion.** The divider is exact for an unloaded output." },
  ],
  references: ["Horowitz, P. and Hill, W. *The Art of Electronics*, 3rd ed., 2015."],
};

const deck = (preset: string) => ({
  title: "Voltage dividers in practice", subtitle: "From Ohm's law to sensor circuits", author: "Mowr", theme: { preset },
  slides: [
    { layout: "title", kicker: "Electronics 101" },
    { layout: "agenda", title: "Agenda", items: ["Why dividers matter", "The divider equation", "Worked example", "Loading effects", "Applications"] },
    { layout: "section", title: "The divider equation", subtitle: "Two resistors, one ratio" },
    { layout: "bullets", title: "Series resistors share the source voltage in proportion to resistance", bullets: ["Same current flows through every resistor", { text: "Each drop follows **Ohm's law** $V = IR$", sub: ["Larger resistance, larger share"] }, "Drops add up to the source (KVL)"], takeaway: "Output is a fixed fraction of the input", notes: "Start from the loop and remind students of KVL." },
    { layout: "equation", title: "The output is a ratio of resistances", math: "V_{out} = V_{in}\\,\\frac{R_2}{R_1 + R_2}", bullets: ["Independent of the absolute scale", "Only valid without a load"] },
    { layout: "figure", title: "A 12 V divider", figure: circuit, caption: "R1 = 100 Ω, R2 = 200 Ω", bullets: ["I = 40 mA", "V2 = 8 V"] },
    { layout: "stats", title: "The example in numbers", stats: [{ value: "40 mA", label: "Loop current", detail: "12 V across 300 Ω" }, { value: "8 V", label: "Across R2", detail: "Two thirds of the source" }, { value: "0.48 W", label: "Total power" }], takeaway: "Most of the power is dissipated in the larger resistor." },
    { layout: "chart", title: "Output voltage rises with R2", chart: { type: "line", labels: ["50", "100", "200", "400", "800"], series: [{ name: "Vout (V)", values: [4, 6, 8, 9.6, 10.7] }], unit: "Volts" }, takeaway: "Diminishing returns past R2 ≈ 4·R1", source: "Computed with Kinetra" },
    { layout: "chart", title: "Where the power goes", chart: { type: "doughnut", labels: ["R1", "R2"], series: [{ name: "Power", values: [0.16, 0.32] }] } },
    { layout: "table", title: "Predicted against measured", table: { header: ["Resistor", "Predicted (V)", "Measured (V)", "Error"], rows: [["R1", 4.0, 3.98, "0.5%"], ["R2", 8.0, 8.01, "0.1%"]] } },
    { layout: "comparison", title: "Unloaded against loaded output", columns: [{ heading: "Unloaded", points: ["Exact ratio", "No current drawn"] }, { heading: "Loaded", points: ["Ratio falls", "Use a buffer amplifier"] }] },
    { layout: "cards", title: "Where dividers appear", items: [{ title: "Sensors", text: "Thermistors and LDRs turn resistance into voltage." }, { title: "Level shifting", text: "5 V logic down to 3.3 V inputs." }, { title: "Biasing", text: "Setting transistor operating points." }, { title: "Volume", text: "A potentiometer is a variable divider." }] },
    { layout: "process", title: "Designing a divider", steps: [{ title: "Choose ratio", text: "From the input and target output." }, { title: "Pick scale", text: "Low enough to ignore the load current." }, { title: "Check power", text: "Stay within resistor ratings." }, { title: "Verify", text: "Measure under load." }] },
    { layout: "timeline", title: "From Ohm to op-amps", steps: [{ label: "1827", title: "Ohm's law", text: "Published by Georg Ohm." }, { label: "1845", title: "Kirchhoff", text: "Circuit laws." }, { label: "1947", title: "Transistor", text: "Bell Labs." }, { label: "1968", title: "741 op-amp", text: "Buffers made easy." }] },
    { layout: "two-column", title: "Rules of thumb", left: { heading: "Do", bullets: ["Keep the load ten times R2", "Use 1% resistors"] }, right: { heading: "Avoid", bullets: ["Powering loads from a divider", "Very high resistances near noise"] } },
    { layout: "quote", quote: "Measure what is measurable, and make measurable what is not.", by: "Galileo Galilei" },
    { layout: "closing", title: "Questions?", subtitle: "Thank you" },
  ],
});

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  const jobs: [string, string, any][] = [["docx", "report.docx", doc], ["pdf", "report.pdf", doc], ["docx", "notes.docx", { ...doc, kind: "notes" }], ["docx", "brief.docx", { ...doc, kind: "brief", design: { accent: "#0B5CAD" } }], ...Object.keys(themes).map((p) => ["pptx", `deck-${p}.pptx`, deck(p)] as [string, string, any]), ...Object.entries(deckSamples).map(([name, spec]) => ["pptx", `context-${name}.pptx`, spec] as [string, string, any]), ["image", "circuit.png", { name: "circuit", figure: circuit }], ["file", "data.csv", { name: "data.csv", content: "a,b\n1,2\n" }]];
  // MOWR_ONLY=<regex> makes only the matching files (e.g. MOWR_ONLY=context- for the context decks).
  const only = process.env.MOWR_ONLY ? new RegExp(process.env.MOWR_ONLY) : null;
  for (const [action, name, spec] of jobs) {
    if (only && !only.test(name)) continue;
    try {
      const made = await makeFile(action, spec, { preview: action === "pptx" || /^report\.(pdf|docx)$/.test(name) });
      await writeFile(join(out, name), made.bytes);
      // The contact sheets the model is shown, saved beside the deck.
      for (const [k, sheet] of (made.previews || []).entries()) await writeFile(join(out, `${name}.sheet${k + 1}.${sheet.image[0] === 0x89 ? "png" : "jpg"}`), sheet.image);
      console.log("ok", name, made.bytes.length, made.info ? JSON.stringify(made.info) : "");
    } catch (error) {
      console.log("FAIL", name, (error as Error).message);
    }
  }
  app.quit();
});
