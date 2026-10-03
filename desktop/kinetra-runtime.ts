import { Worker } from "node:worker_threads";
import { join } from "node:path";
import reference from "./generated/kinetra.json" with { type: "json" };
import { illustrationGuide, recipeText } from "./kinetra-recipes.ts";
import { documentStandard, documentIntent } from "../core/document-standard.ts";

export const kinetraInstructions = `KINETRA TOOLS: deterministic calculations and textbook figures that run on this PC.
To use one, reply with ONLY a JSON object {"kinetra":{…}} and nothing else. Mowr runs it and replies with the result; then call another tool or write your final answer. Never put tool JSON in the final answer.
Actions:
- {"action":"call","module":M,"fn":F,"args":[…]} runs a pure function with JSON arguments (5 s limit). Use it for every number you state that a module can compute: projectile/optics/pulley analytics, circuit solutions, K-maps and simplification, integrals, grading.
- {"action":"pdf","kind":K,"title":T,"subtitle"?:S,"summary"?:Markdown,"sections":[{"heading"?:H,"text"?:Markdown with $LaTeX$ math,"figure"?:{"module":M,"fn":F,"args":[…]},"caption"?:C}],"references"?:[strings],"font"?:F,"headingFont"?:F} creates ONE real PDF attachment. Only when the user asked for a PDF, report, handout, worksheet or other document file. K is one of report, paper, brief, notes, proposal, manual, handout, worksheet, letter, memo. Mowr typesets it professionally: title block with date, a summary box (give a 2–4 sentence summary for reports, papers, briefs and proposals), numbered sections and figures, contents for longer documents, professional tables, page numbers. Write headings without numbers; use ### inside a section for subsections; tables in Markdown; figure captions describe the figure and its assumptions without "Figure 1". Figures are drawn by Kinetra from the figure spec; never write SVG or images yourself. The text must follow the DOCUMENT STANDARD below: it is checked, and conversational or personal phrasing ("Here is your report", "you", "I") is rejected. All figures are checked first: on any error no PDF is made and you receive every problem at once; fix them and send pdf again. After the PDF is created, reply to the user in one or two plain sentences; do not repeat the document.
- Several documents: when the user asks for a PDF for each file, lecture, chapter or topic ("a pdf for each", "separate pdfs"), send one pdf action per item, one after another, each complete on its own; never merge them into one file or stop after the first. Name each after its item.
- Length and depth come from the request and the material, never from a page target. "Explain fully", "in detail", "everything", "comprehensive" or study notes from a lecture mean: cover every topic, definition, formula, example and figure in the source, in its order, explaining each one (what it is, why it matters, how it works, a worked example where the source has one); several pages per lecture is normal. Do not summarise, skip or pick "key points" unless asked. One reply has an output limit, so a single pdf action holds only about 3–5 pages: write any long or complete document in parts. Send the title and first sections, then add the rest with {"action":"pdf","revise":ID,"append":true,"sections":[…the next sections…]} (same file, sections added at the end), one part per tool call, until every topic is covered; only then answer. Never shorten, merge or drop content to fit one reply. Each pdf result reports the pages and words so far; when the user says the document is too short, append the missing depth to the same file.
- Fonts: Mowr typesets in standard document fonts (Cambria body, Calibri headings). When the user names a typeface or style, set "font" (a preset: classic, serif, sans, times, georgia, garamond, cambria, calibri, arial, helvetica, segoe ui, verdana, mowafy; or any installed font name), and "headingFont" only if they want headings different. Keep the user's font choice in every revision.
- {"action":"pdf","revise":ID,"change":"one short sentence",…the complete revised specification…} updates a document Mowr already made in this conversation (IDs are listed under DOCUMENTS IN THIS CONVERSATION when there are any). Use it for every change to an existing document; never make a second file for a change. {"action":"open","id":ID} returns that document's current specification first, so everything the user did not ask to change stays the same.
- Figures in PDFs: every diagram, chart or picture in a document is a Kinetra figure (one per section; use several sections for several figures). Match the recipe to the content: flowchart for processes and algorithms, cycle for repeating processes, timeline for dated sequences, mind map for overviews, tree for classifications and hierarchies, Venn for comparisons, bar/line/pie chart for data, and the science recipes for physics, circuits and logic. A good study document or report usually has at least one figure where a picture explains faster than text.
- Physics and engineering apparatus (pulleys, ropes, spring scales, blocks on inclines, levers and wheelbarrows, springs, vessels of liquid, charged spheres, rods and wires with field lines, free-body insets, lever arms) is drawn as a textbook figure: {"module":"mowr","fn":"illustration","args":[{"items":[…]}]}. Start from the closest "textbook figure" recipe below, keep its structure and change positions, sizes and labels; {"action":"skill","name":"figures"} returns every item and anchor. Prefer it to the plain free-body, pulley and charged-rod recipes whenever the apparatus itself should be seen; those stay for bare numeric diagrams. Documents are printed, so a 3D scene becomes a textbook figure drawn in 2D (a sphere as a shaded ball, a wire as a rod, field lines in the page).
- {"action":"recipes"} lists the verified figure recipes below; {"action":"api","module":M} returns a module's TypeScript declarations (exact argument shapes); {"action":"skill","name":N} returns a topic guide (figures, ${Object.keys(reference.skills).join(", ")}).
Verified figure recipes (each renders as-is; adapt the values, keep the structure):
${recipeText()}
Callable modules: ${reference.modules.join(", ")}. Before using a module that has no recipe, read its api. Functions that need callbacks, Map instances or classes cannot be called; prefer module mowr (integrateExpression, plot, logicDiagram, vectorField, scalarField, retrieve, studySchedule).
Accuracy rules: compute numbers with call before writing them, and use the same model for the figure so text and drawing agree. State assumptions (units, g = 9.81 m/s², ideal pulleys, thin lenses). A tool error is not success. Never claim a file exists unless pdf returned created:true. At most 150 tool calls per answer.
${documentStandard}`;

/** Everyday messages get a one-line pointer instead of the full catalog; the model can ask for it. */
export const kinetraBrief = `Kinetra tools (verified calculations, physics/circuit/logic figures, illustrated PDF documents) are available. If this request needs them, reply with ONLY {"kinetra":{"action":"help"}}; otherwise answer normally.`;

const kinetraIntent = /\b(pdf|handout|worksheet|document|report|summary sheet|study guide|diagram|figure|illustrat|draw|sketch|plot|graph|chart|flow ?chart|timeline|mind ?map|venn|hierarchy|circuit|resistor|capacitor|voltage|current|k-?map|karnaugh|truth table|boolean|logic gate|projectile|trajector|free[- ]?body|force|pulley|atwood|optic|lens|mirror|ray diagram|electrostat|charged rod|electric field|field lines?|charged (?:sphere|wire|ball|plate)|point charges?|dipole|incline|inclined plane|ramp|slope|spring scale|spring balance|springs?|lever|torque|fulcrum|seesaw|wheelbarrow|tension|buoyan|vessel|beaker|apparatus|vector field|integral|integrate|derivative|differentiat|matrix|eigen|solve|equation|calculat|compute|simplif|quiz|exam|flashcard|grade|study (?:plan|schedule)|revision|pages?|longer|expand|more detail|in depth|full explanation)/i;
/** The full tool guide when the request may need it (or a document it could change exists); otherwise one line. */
export function kinetraInstructionsFor(request: string, hasDocuments = false) {
  return hasDocuments || /^\/pdf\b/i.test(request.trim()) || kinetraIntent.test(request) || documentIntent(request) ? kinetraInstructions : kinetraBrief;
}

export async function kinetraCall(request: any) {
  if (JSON.stringify(request).length > 100000)
    throw Error("Kinetra input too large");
  return new Promise<any>((resolve, reject) => {
    const worker = new Worker(
      join(
        typeof __dirname === "string"
          ? __dirname
          : process.cwd() + "/desktop-dist",
        "kinetra-worker.cjs",
      ),
      { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 96 } },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(Error("Kinetra calculation timed out"));
    }, 5000);
    worker.once("message", (message) => {
      clearTimeout(timer);
      void worker.terminate();
      message.error ? reject(Error(message.error)) : resolve(message.result);
    });
    worker.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      reject(Error("Kinetra worker stopped without a result"));
    });
  });
}
const skillNote = `[Mowr note: in Mowr, run the functions in this guide with {"kinetra":{"action":"call","module":"diagram/projectile","fn":"renderProjectile","args":[model]}} (module path without core/src and .js). Import paths, npm scripts and CLI commands below are not available here.]\n\n`;
export async function kinetraTool(
  request: any,
  pdf?: (spec: any) => Promise<any>,
) {
  if (!request || typeof request !== "object")
    throw Error("Invalid Kinetra request");
  if (request.action === "help") return kinetraInstructions;
  if (request.action === "recipes") return recipeText();
  if (request.action === "skill" && request.name === "figures") return illustrationGuide;
  if (
    request.action === "skill" &&
    Object.hasOwn(reference.skills, request.name)
  )
    return skillNote + (reference.skills as Record<string, string>)[request.name];
  if (request.action === "api" && Object.hasOwn(reference.api, request.module))
    return (reference.api as Record<string, string>)[request.module];
  if (request.action === "call") return kinetraCall(request);
  if (request.action === "pdf" && pdf) return pdf(request);
  if (request.action === "pdf") throw Error("PDF creation is not available in this conversation.");
  if (request.action === "open") throw Error("There are no Mowr-made documents to open in this conversation.");
  throw Error(`Unsupported Kinetra action "${String(request.action)}". Use call, pdf, open, recipes, api, skill or help.`);
}
