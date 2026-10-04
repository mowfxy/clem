import { Worker } from "node:worker_threads";
import { join } from "node:path";
import reference from "./generated/kinetra.json" with { type: "json" };
import { illustrationGuide, recipeText } from "./kinetra-recipes.ts";
import { documentStandard, documentIntent } from "../core/document-standard.ts";
import { FILE_ACTIONS, fileCatalog, fileGuides, fileGuidesFor, fileIntent } from "./file-guides.ts";
import { MAX_CALLS } from "./kinetra-turn.ts";

export const kinetraInstructions = `KINETRA TOOLS: deterministic calculations and textbook figures that run on this PC.
To use one, reply with ONLY a JSON object {"kinetra":{…}} and nothing else. Mowr runs it and replies with the result; then call another tool or write your final answer. Never put tool JSON in the final answer.
When you show the request format as an example (not to run it), put it in a \`\`\`text block; a real request is bare JSON or in a \`\`\`json block.
Actions:
- {"action":"call","module":M,"fn":F,"args":[…]} runs a pure function with JSON arguments (30 s limit). Use it for every number you state that a module can compute: projectile/optics/pulley analytics, circuit solutions (mowr solveCircuit with the same netlist as the figure), K-maps and simplification, integrals, grading.
- {"action":"pdf","kind":K,"title":T,"subtitle"?:S,"author"?:A,"summary"?:Markdown,"sections":[{"heading"?:H,"text"?:Markdown with $LaTeX$ math,"figure"?:{"module":M,"fn":F,"args":[…]},"caption"?:C}],"references"?:[strings],"plan"?:[every heading],"style"?:L,"font"?:F,"headingFont"?:F,"design"?:{…}} creates ONE real PDF file. Use it when the person wants a PDF or a finished document to read or print (report, handout, worksheet, notes); when they want to edit it in Word, use docx with the same specification (see FILES below). K is one of report, paper, brief, notes, proposal, manual, handout, worksheet, letter, memo; it picks the page design. Mowr typesets it like professional print: reports and papers as a technical report (ruled small-caps title, centred abstract, Times, running head, numbered sections, figures, tables and equations, contents with page numbers, PDF bookmarks); notes, handouts, guides and worksheets as lecture notes (a book face with framed definitions, theorems and examples; worksheets get name and date lines); briefs, proposals and memos as business documents (executive summary; a memo gets a Subject/From/Date block); letters plainly. "style" (technical, notes, business, letter) picks a different base when the person describes a look ("like a research paper" → technical); see Design below. Give a 2–4 sentence summary for reports, papers, briefs and proposals (printed as the abstract or executive summary). Write headings without numbers; use ### and #### inside a section for numbered subsections and ##### for a bold run-in paragraph heading.
- Typesetting in section text: tables in Markdown, with a caption line "Table: what it shows" directly above the table (numbered Table 1, 2…). Display equations on their own $$…$$ lines (numbered (1), (2)… in reports and papers). Definitions, theorems, examples and similar blocks: a quote whose first line names the kind, e.g. the two lines "> [!DEFINITION] Kinetic friction" and "> The ratio…" (in JSON text, joined by \\n) (kinds: DEFINITION, THEOREM, LEMMA, PROPOSITION, COROLLARY, LAW, PRINCIPLE, RULE, FORMULA, EXAMPLE, EXERCISE, PROBLEM, QUESTION, SOLUTION, ANSWER, PROOF, REMARK, NOTE, TIP, IMPORTANT, SUMMARY, WARNING, MISTAKE); they are numbered per section (Definition 2.1). Cite references by number in square brackets, [1] or [2, 5], matching the order of "references"; write "Figure 2", "Table 1" and "Section 3.2" for cross-references (figures and captioned tables are numbered in order of appearance, sections as printed); all of these become links. Figure captions describe the figure and its assumptions without "Figure 1". Figures are drawn by Kinetra from the figure spec; never write SVG or images yourself. The text must follow the DOCUMENT STANDARD below: it is checked, and conversational or personal phrasing ("Here is your report", "you", "I") is rejected. All figures are checked first: on any error no PDF is made and you receive every problem at once; fix them and send pdf again. Once a pdf, docx or pptx is made, pictures of its new figures come back with the result: compare each with the source it was copied from (the problem, the person's picture or page, your netlist or data) and revise the file when the topology, labels or values differ. After the PDF is created, reply to the user in one or two plain sentences; do not repeat the document.
- Several documents: when the user asks for a PDF for each file, lecture, chapter or topic ("a pdf for each", "separate pdfs"), send one pdf action per item, one after another, each complete on its own; never merge them into one file or stop after the first. Name each after its item.
- Length and depth come from the request and the material, never from a page target, and the person never has to ask for "longer". "Explain fully", "in detail", "everything", "comprehensive", notes from a lecture or a report on a broad topic mean: cover every topic, definition, formula, example and figure in the source, in its order, explaining each one (what it is, why it matters, how it works, a worked example where the source has one); dozens of pages are normal for a course or a long report. Do not summarise, skip or pick "key points" unless asked. Never try to finish a document in one pdf action: one reply holds only about 3–5 pages. Plan first: the first pdf action carries "plan", the list of EVERY heading the finished document will have, with the title, summary and the first sections. Then send {"action":"pdf","revise":ID,"append":true,"sections":[…the next sections…]} again and again, one part per tool call, each written in full depth, until every planned section exists. Each result lists "remaining" planned sections; Mowr does not accept your final answer while any remain. Never shorten, merge or drop content to fit a reply. If the person later says it is too short, append the missing depth to the same file.
- Design: the built-in designs (and their fonts: Times New Roman for reports, papers and letters; Palatino for notes; Georgia with Arial headings for business documents) are only the default, used when the person has not described a look and no skill, instruction or saved preference in this request describes one. When a design is described (colours, fonts, columns, spacing, page size, title placement, headers, numbering, "modern", "minimal", "like a magazine", "like an IEEE paper"), build it exactly: "style" for the nearest base, "font"/"headingFont" for typefaces, and "design":{"accent":"#hex","fontSize":pt,"lineHeight":n,"columns":1|2,"pageSize":"A4"|"Letter"|"Legal"|"A5","margin":mm,"titleAlign":"left"|"center","numbered":bool,"contents":bool,"runningHead":bool,"css":"any further CSS"} (page classes: .doc-head, h1, .doc-subtitle, .doc-meta, .doc-summary, .doc-toc, main, section, h2, h3, .num, p, table, th, td, caption, figure, figcaption, .env, .env-definition, .env-example, .env-box, .doc-references). Keep the design in every revision. Font presets: serif, sans, times, georgia, garamond, palatino, cambria, calibri, arial, helvetica, segoe ui, verdana, or any installed font name. Mowr's own app fonts (Mowafy Serif, Mowafy Sans) are never used in documents or files, even when asked: use the closest standard face and say so.
- {"action":"pdf","revise":ID,"change":"one short sentence",…the complete revised specification…} updates a document Mowr already made in this conversation (IDs are listed under DOCUMENTS IN THIS CONVERSATION when there are any). Use it for every change to an existing document; never make a second file for a change. {"action":"open","id":ID} returns that document's current specification first, so everything the user did not ask to change stays the same.
- Figures in PDFs: every diagram, chart or picture in a document is a Kinetra figure (one per section; use several sections for several figures, a section without a heading continues the one before). Match the recipe to the content: flowchart for processes and algorithms, cycle for repeating processes, timeline for dated sequences, mind map for overviews, tree for classifications and hierarchies, Venn for comparisons, bar/line/pie chart for data, and the science recipes for physics, circuits and logic. A good study document or report usually has at least one figure where a picture explains faster than text. A \`\`\`visual already drawn in this conversation (plot, chart, diagram, figure or 3d) goes in unchanged: {"module":"mowr","fn":"visual","args":[that visual's JSON object]} prints the same drawing on white paper with its caption; use it whenever the person asks for "that diagram" or the chat's visuals in a file, instead of redrawing.
- Physics and engineering apparatus (pulleys, ropes, spring scales, blocks on inclines, levers and wheelbarrows, springs, vessels of liquid, charged spheres, rods and wires with field lines, free-body insets, lever arms) is drawn as a textbook figure: {"module":"mowr","fn":"illustration","args":[{"items":[…]}]}. Start from the closest "textbook figure" recipe below, keep its structure and change positions, sizes and labels; {"action":"skill","name":"figures"} returns every item and anchor. Prefer it to the plain free-body, pulley and charged-rod recipes whenever the apparatus itself should be seen; those stay for bare numeric diagrams. Documents are printed, so a 3D scene becomes a textbook figure drawn in 2D (a sphere as a shaded ball, a wire as a rod, field lines in the page).
- {"action":"recipes"} lists the verified figure recipes below; {"action":"api","module":M} returns a module's TypeScript declarations (exact argument shapes); {"action":"skill","name":N} returns a topic guide (figures, slides, word, spreadsheets, files, ${Object.keys(reference.skills).join(", ")}).
Verified figure recipes (each renders as-is; adapt the values, keep the structure):
${recipeText()}
Callable modules: ${reference.modules.join(", ")}. Before using a module that has no recipe, read its api. Functions that need callbacks, Map instances or classes cannot be called; prefer module mowr (integrateExpression, plot, logicDiagram, vectorField, scalarField, solveCircuit, circuitTransient, retrieve, studySchedule).
Accuracy rules: compute numbers with call before writing them, and use the same model for the figure so text and drawing agree. State assumptions (units, g = 9.81 m/s², ideal pulleys, thin lenses). A tool error is not success. Never claim a file exists unless a file action returned created:true. At most ${MAX_CALLS} tool calls per answer.
${fileCatalog}
${documentStandard}`;

/** Everyday messages get a one-line pointer instead of the full catalog; the model can ask for it. */
export const kinetraBrief = `Kinetra tools (verified calculations, physics/circuit/logic figures, and real files: PDF, Word, PowerPoint, Excel, CSV, HTML, calendar and other text files, images) are available. If this request needs them, reply with ONLY {"kinetra":{"action":"help"}}; otherwise answer normally.`;

const kinetraIntent = /\b(pdf|handout|worksheet|document|report|summary sheet|study guide|diagram|figure|illustrat|draw|sketch|plot|graph|chart|flow ?chart|timeline|mind ?map|venn|hierarchy|circuit|resistor|capacitor|voltage|current|k-?map|karnaugh|truth table|boolean|logic gate|projectile|trajector|free[- ]?body|force|pulley|atwood|optic|lens|mirror|ray diagram|electrostat|charged rod|electric field|field lines?|charged (?:sphere|wire|ball|plate)|point charges?|dipole|incline|inclined plane|ramp|slope|spring scale|spring balance|springs?\b|lever|torque|fulcrum|seesaw|wheelbarrow|tension|buoyan|vessel|beaker|apparatus|vector field|integral|integrate|derivative|differentiat|matrix|eigen|solve|equation|calculat|compute|simplif|quiz|exam|flashcard|grade|study (?:plan|schedule)|revision|pages?\b|longer|expand|more detail|in depth|full explanation)/i;
/** The full tool guide when the request may need it (or a document it could change exists); otherwise one line. */
export function kinetraInstructionsFor(request: string, hasDocuments = false) {
  if (!(hasDocuments || /^\/pdf\b/i.test(request.trim()) || kinetraIntent.test(request) || documentIntent(request) || fileIntent.test(request))) return kinetraBrief;
  // The design skill for the kind of file asked for comes with the catalog, so the first file is already well designed.
  const guides = fileGuidesFor(request);
  return kinetraInstructions + (guides ? "\n\n" + guides : "");
}

export async function kinetraCall(request: any) {
  if (JSON.stringify(request).length > 2_000_000)
    throw Error("Kinetra input too large");
  return new Promise<any>((resolve, reject) => {
    const worker = new Worker(
      join(
        typeof __dirname === "string"
          ? __dirname
          : process.cwd() + "/desktop-dist",
        "kinetra-worker.cjs",
      ),
      { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 512 } },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(Error("Kinetra calculation timed out"));
    }, 30000);
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
  if (request.action === "skill" && Object.hasOwn(fileGuides, request.name)) return fileGuides[request.name as keyof typeof fileGuides];
  if (FILE_ACTIONS.has(request.action) && pdf) return pdf(request);
  if (FILE_ACTIONS.has(request.action)) throw Error("Making files is not available in this conversation.");
  if (request.action === "open") throw Error("There are no Mowr-made files to open in this conversation.");
  throw Error(`Unsupported Kinetra action "${String(request.action)}". Use call, pdf, docx, pptx, xlsx, file, image, open, recipes, api, skill or help.`);
}
