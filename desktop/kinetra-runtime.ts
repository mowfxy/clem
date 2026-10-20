import { Worker } from "node:worker_threads";
import { join } from "node:path";
import reference from "./generated/kinetra.json" with { type: "json" };
import { illustrationGuide, recipeText, recipesFor } from "./kinetra-recipes.ts";
import { documentStandard, documentIntent } from "../core/document-standard.ts";
import { FILE_ACTIONS, fileCatalog, fileGuides, fileGuidesFor, fileIntent } from "./file-guides.ts";
import { MAX_CALLS, MAX_PARALLEL } from "./kinetra-turn.ts";

/** How requests are sent: as {"kinetra":…} replies (every provider can), or as calls to the native tool. */
const TEXT_INTRO = `To use one, reply with ONLY a JSON object {"kinetra":{…}} and nothing else. Clem runs it and replies with the result; then call another tool or write your final answer. Never put tool JSON in the final answer.
Every reply that asks for tools is a full round trip that re-reads the whole conversation, so batch: put every request you already know you need in the SAME reply, one envelope after another (all the crops of the figures, every circuit to solve, every file passage to read, the checks); calculations and reads run side by side, files are made in the order sent. Pictures already attached to the message are seen: look or crop again only for a detail they do not show clearly. Batching changes how many replies the work takes, never how much work is done: still compute, check and write everything the request needs, at full depth.
When you show the request format as an example (not to run it), put it in a \`\`\`text block; a real request is bare JSON or in a \`\`\`json block.`;
const CLI_INTRO = `They are one tool, "kinetra": every request below written as {"kinetra":X} or as an action object is a kinetra tool call with that object as its arguments. Your own tools (reading, searching and writing files in your working folder, web search) work alongside it. Each tool call is a round trip that re-reads the conversation, so make the calls you already know you need together in one turn (parallel calls: every circuit to solve, every crop, the checks), or send them as ONE kinetra call {"action":"batch","requests":[{…},{…}]} (each runs as if sent alone; results come back in order), and never re-read what you already have. That changes how many turns the work takes, never how much work is done.`;
/** How a long document is written: in parts inside tool calls, or once as a Markdown file in the working folder. */
const TEXT_LENGTH = `Never try to finish a document in one pdf action: one reply holds only about 3–5 pages. Plan first: the first pdf action carries "plan", the list of EVERY heading the finished document will have, with the title, summary and the first sections. Then send {"action":"pdf","revise":ID,"append":true,"sections":[…the next sections…]} again and again, one part (several sections, about 3–5 pages) per tool call, each written in full depth, until every planned section exists. Each result lists "remaining" planned sections; Clem does not accept your final answer while any remain. Never shorten, merge or drop content to fit a reply. If the person later says it is too short, append the missing depth to the same file.`;
const CLI_LENGTH = `Write every pdf or docx as a Markdown file in your drafts folder (named in the message) with your own file-writing tool, then make the file with ONE request: {"action":"pdf","markdown":"Drafts/…/name.md","kind":K,"plan":[every heading],"title"?:T,…design fields…} (no "sections": they come from the file). Plan first: before writing, list every heading the finished document will have, taken from the source's structure when there is one (every topic, worked example and exercise, in order), then fill the file to match; send that list as "plan" (required for a document built from the person's files). Clem checks the file against it: a planned section that is missing or only a stub (a placeholder, a line or two) is reported, and the answer waits until it is written. After each worked example or solution, a fenced block whose info string is check holds {"checks":[{"label":"…","expr":"formula","vars":{…},"claimed":the value as written,"unit":"…"}]} with every numeric result it states (circuit values come from a Kinetra call to clem solveCircuit with the same netlist as the figure). Clem recomputes every check before making the file, refuses the file when a stated value differs (naming its line), and leaves the checks out of the printed document. A request that failed is not run again until the file or the request changes: fix the line the error names with an edit first. The file: "# Title" first, then the summary paragraph, then "## Heading" for each section, with Markdown text and $LaTeX$ maths exactly as section text takes it. A figure is a fenced block whose info string is figure, holding the figure object as JSON plus an optional "caption" (a line \`\`\`figure, then {"module":"clem","fn":"illustration","args":[…],"caption":"…","align":"wrap-right"}, then a line \`\`\`); the text after it continues the same section. A "## References" list becomes the numbered references. Being a file changes nothing about length or depth: write everything the document needs, at full depth. Write the whole draft with ONE write call (a reply holds about 25,000 words, more than most documents need); only a document longer than that goes in a few large parts, each as long as a reply allows, never a section or two per step, since every step re-reads the whole conversation. Use your thinking to work things out (what a figure shows, a solution, a check, the outline), not to compose the document's text before writing it: write the text once, straight into the file, then fix it with edits. What you wrote is already in your context: never read the whole file back (read or grep only the lines an error names). Several documents: one file and one request each. To change a document, Edit only the lines that change in its Markdown file and send {"action":"pdf","revise":ID,"markdown":that file,"change":"…"} again (its result, and the list of files in this conversation, name that file); never rewrite the whole file or resend its text for a change. If the person later says it is too short, add the missing depth to the file and revise.`;

/** The tool guide with the given figure recipes (all of them, or the ones for the topic at hand). The recipes change
 *  with the topic, so they come last: the rest is the same every time and stays in the provider's prompt cache. */
/** `native`: requests are calls to the kinetra tool rather than JSON replies. `files`: the AI works in a folder of files
 *  (desktop/ai-workspace.ts) and writes documents there as Markdown. */
const buildInstructions = (recipes: string, notes = "", { native = false, files = false }: { native?: boolean; files?: boolean } = {}) => `KINETRA TOOLS: deterministic calculations and textbook figures that run on this PC.
${native ? CLI_INTRO : TEXT_INTRO}
Actions:
- {"action":"call","module":M,"fn":F,"args":[…]} runs a pure function with JSON arguments (30 s limit). Use it for every number you state that a module can compute: projectile/optics/pulley analytics, circuit solutions (clem solveCircuit with the same netlist as the figure), K-maps and simplification, integrals, grading.
- {"action":"pdf","kind":K,"title":T,"subtitle"?:S,"author"?:A,"summary"?:Markdown,"sections":[{"heading"?:H,"text"?:Markdown with $LaTeX$ math,"figure"?:{"module":M,"fn":F,"args":[…]},"caption"?:C}],"references"?:[strings],"plan"?:[every heading],"style"?:L,"font"?:F,"headingFont"?:F,"design"?:{…}} creates ONE real PDF file. Use it when the person wants a PDF or a finished document to read or print (report, handout, worksheet, notes); when they want to edit it in Word, use docx with the same specification (see FILES below). K is one of report, paper, brief, notes, proposal, manual, handout, worksheet, letter, memo; it picks the page design. Pick K from what the person asked for, never from how serious or technical the subject is: report or paper only when they ask for a report, paper or write-up (Clem prints any other report or paper as notes); explaining lectures, a study guide, revision or course notes → notes; a cheat sheet → handout; a sheet of questions for them to answer → worksheet. Clem typesets it like professional print: reports and papers as a technical report (ruled small-caps title, centred abstract, Times, running head, numbered sections, figures, tables and equations, contents with page numbers, PDF bookmarks); notes, handouts, guides and worksheets as lecture notes (a book face with framed definitions, theorems and examples; worksheets get name and date lines); briefs, proposals and memos as business documents (executive summary; a memo gets a Subject/From/Date block); letters plainly. "style" (technical, notes, business, letter) picks a different base when the person describes a look ("like a research paper" → technical); see Design below. Give a 2–4 sentence summary for reports, papers, briefs and proposals (printed as the abstract or executive summary). Write headings without numbers; use ### and #### inside a section for numbered subsections and ##### for a bold run-in paragraph heading.
- Typesetting in section text: tables in Markdown, with a caption line "Table: what it shows" directly above the table (numbered Table 1, 2…). Display equations on their own $$…$$ lines (numbered (1), (2)… in reports and papers). Definitions, theorems, examples and similar blocks: a quote whose first line names the kind, e.g. the two lines "> [!DEFINITION] Kinetic friction" and "> The ratio…" (in JSON text, joined by \\n) (kinds: DEFINITION, THEOREM, LEMMA, PROPOSITION, COROLLARY, LAW, PRINCIPLE, RULE, FORMULA, EXAMPLE, EXERCISE, PROBLEM, QUESTION, SOLUTION, ANSWER, PROOF, REMARK, NOTE, TIP, IMPORTANT, SUMMARY, WARNING, MISTAKE); they are numbered per section (Definition 2.1). Cite references by number in square brackets, [1] or [2, 5], matching the order of "references"; write "Figure 2", "Table 1" and "Section 3.2" for cross-references (figures and captioned tables are numbered in order of appearance, sections as printed); all of these become links. Figure captions describe the figure and its assumptions without "Figure 1". Figures are drawn by Kinetra from the figure spec; never write SVG or images yourself. The text must follow the DOCUMENT STANDARD below: it is checked, and conversational or personal phrasing ("Here is your report", "you", "I") is rejected. All figures are checked first: on any error no PDF is made and you receive every problem at once; fix them and send pdf again. Once a pdf, docx or pptx is made, pictures of its new figures come back with the result: compare each with the source it was copied from (the problem, the person's picture or page, your netlist or data) and revise the file when the topology, labels or values differ. After the PDF is created, reply to the user in one or two plain sentences; do not repeat the document.
- Several documents: when the user asks for a PDF for each file, lecture, chapter or topic ("a pdf for each", "separate pdfs"), send one pdf action per item, one after another, each complete on its own; never merge them into one file or stop after the first. Name each after its item.
- Length and depth come from the request and the material, never from a page target, and the person never has to ask for "longer". "Explain fully", "in detail", "everything", "comprehensive", notes from a lecture or a report on a broad topic mean: cover every topic, definition, formula, example and figure in the source, in its order, explaining each one (what it is, why it matters, how it works, a worked example where the source has one); dozens of pages are normal for a course or a long report. Do not summarise, skip or pick "key points" unless asked. ${files ? CLI_LENGTH : TEXT_LENGTH}
- Design: every document gets its own design, worked out by rules, never one fixed template. When the person has not described a look and no skill, instruction or saved preference in this request describes one, leave "font", "headingFont" and "design" out: Clem designs the document from the document itself (typefaces paired for the genre and the reader; an accent colour from the subject, deep enough to read as text and used sparingly; a title block and section headings that suit the genre; type size and leading from the length; margins for a comfortable line) and returns that design with the result, kept with the file so every revision looks the same. When a look is described (colours, fonts, columns, spacing, page size, title placement, headers, numbering, "modern", "minimal", "like a magazine", "like an IEEE paper"), build it exactly: "style" for the nearest base, "font"/"headingFont" for typefaces, and "design":{"accent":"#hex","fontSize":pt,"lineHeight":n,"columns":1|2,"pageSize":"A4"|"Letter"|"Legal"|"A5","margin":side margins in mm,"titleAlign":"left"|"center","titleStyle":"ruled"|"center"|"left" (technical) or "rule"|"bar"|"band"|"plain"|"center" (notes, business),"headingStyle":"plain"|"rule"|"accent"|"smallcaps"|"bar","textAlign":"justify"|"left","numbered":bool,"contents":bool,"runningHead":bool,"css":"any further CSS"} (page classes: .doc-head, h1, .doc-subtitle, .doc-meta, .doc-summary, .doc-toc, main, section, h2, h3, .num, p, table, th, td, caption, figure, figcaption, .env, .env-definition, .env-example, .env-box, .doc-references); anything not described stays as Clem works it out. Rules for any design you set: at most two typefaces (a text face for reading at length, a heading face that contrasts in weight or class); one accent colour, two at most, on headings, rules or links, never on body text; body text 9.5–12 pt (larger for children), about 65–95 characters a line (wider margins or two columns otherwise); hierarchy by size, weight and space before colour; text near-black on white and every colour readable (contrast at least 4.5:1). Keep the design in every revision. Font presets: serif, sans, times, georgia, garamond, palatino, cambria, calibri, arial, helvetica, segoe ui, verdana, or any installed font name. Clem's own app fonts (Mowafy Serif, Mowafy Sans) are never used in documents or files, even when asked: use the closest standard face and say so.
- {"action":"pdf","revise":ID,"change":"one short sentence",…the complete revised specification…} updates a document Clem already made in this conversation (IDs are listed under DOCUMENTS IN THIS CONVERSATION when there are any). Use it for every change to an existing document; never make a second file for a change. {"action":"open","id":ID} returns that document's current specification first, so everything the user did not ask to change stays the same. A change to a few sections (a figure's place or size, one paragraph, a corrected table) is sent as {"action":"pdf","revise":ID,"change":…,"patch":[{"at":N,…only the changed fields…}]}: the rest of the document is kept as it is, without sending it again.
- Figures in PDFs: every diagram, chart or picture in a document is a Kinetra figure (one per section; use several sections for several figures, a section without a heading continues the one before). Match the recipe to the content: flowchart for processes and algorithms, cycle for repeating processes, timeline for dated sequences, mind map for overviews, tree for classifications and hierarchies, Venn for comparisons, bar/line/pie chart for data, the maths recipes for anything drawn on axes, and the science recipes for physics, circuits and logic. Wherever the text explains something a reader would sketch, draw it: a study document has a figure for each such idea (often several per lecture), not one token figure. Maths and science are graphs first: a function and its asymptotes, a domain shaded in the plane with its excluded boundary dashed, level curves and a contour map labelled by level, a surface z = f(x, y) with its traces, polar curves and regions, the paths along which a limit is tested, a tangent line, an area under a curve, a vector field. Draw them with {"module":"clem","fn":"visual","args":[a visual spec]}, the same language as the chat's \`\`\`visual: kind "plot" with x/y ranges and layers (function, implicit with "levels" for level curves and boundaries, area between two curves, polygon with fill for regions, polar, parametric, point, segment, text) or kind "3d" with a surface (printed as a still from the camera you set). Never describe a picture in words in place of drawing it ("the contour sketches are described rather than redrawn" is not acceptable): when the source shows a graph, a contour map or a sketch to match, crop it from the source or redraw it with these, and when an exercise asks the reader to sketch, the solution shows the sketch. A \`\`\`visual already drawn in this conversation (plot, chart, diagram, figure or 3d) goes in unchanged: {"module":"clem","fn":"visual","args":[that visual's JSON object]} prints the same drawing on white paper with its caption; use it whenever the person asks for "that diagram" or the chat's visuals in a file, instead of redrawing. A figure from the person's own PDF or picture goes in as the crop itself, never redrawn: crop it, then use {"asset":"crop-…","source"?:"where it is from" or true} as the figure in pdf and docx sections and in pptx figure or image slides (sharp vectors in PDFs, full resolution in Word and PowerPoint); "source" adds "Source: …" to the caption (true: the file and page), and the original's caption is used when you give none. Placement is a layout decision, made for how the page looks: give the figure to the section (or to a section without a heading that splits the text) where it is first discussed, and refer to it as "Figure N". By default ("align":"auto") a small figure in a section with enough text goes beside the text, which wraps round it, and anything larger sits in the column with its drawing centred as the eye sees it; a crop keeps its source size (small ones enlarged towards half the column). Choose differently whenever the page calls for it, for crops and Kinetra figures alike: "align":"wrap-right"|"wrap-left" (beside the text), "center", "box" (the picture box centred, as it is), "left"|"right" (flush in the column), and "width" (0.2–1 of the column). Pictures of the pages the figures printed on (and of the page before, when a figure starts a page) come back with the result: judge each page as a designer would and revise until every figure sits well.
- Physics and engineering apparatus (pulleys, ropes, spring scales, blocks on inclines, levers and wheelbarrows, springs, vessels of liquid, charged spheres, rods and wires with field lines, free-body insets, lever arms) is drawn as a textbook figure: {"module":"clem","fn":"illustration","args":[{"items":[…]}]}. Start from the closest "textbook figure" recipe below, keep its structure and change positions, sizes and labels; {"action":"skill","name":"figures"} returns every item and anchor. Prefer it to the plain free-body, pulley and charged-rod recipes whenever the apparatus itself should be seen; those stay for bare numeric diagrams. Documents are printed, so a 3D scene becomes a textbook figure drawn in 2D (a sphere as a shaded ball, a wire as a rod, field lines in the page).
- {"action":"recipes"} lists the verified figure recipes below; {"action":"api","module":M} returns a module's TypeScript declarations (exact argument shapes); {"action":"skill","name":N} returns a topic guide (figures, slides, word, spreadsheets, files, ${Object.keys(reference.skills).join(", ")}).
Callable modules: ${reference.modules.join(", ")}. Before using a module that has no recipe, read its api. Functions that need callbacks, Map instances or classes cannot be called; prefer module clem (integrateExpression, plot, logicDiagram, vectorField, scalarField, solveCircuit, circuitTransient, retrieve, studySchedule).
Accuracy rules: compute numbers with call before writing them, and use the same model for the figure so text and drawing agree. When an answer states computed results, end it with one \`\`\`check block of the key ones: Clem recomputes every check, and sends an answer back when a check does not hold, or when a calculation's results came from neither a call nor a check. State assumptions (units, g = 9.81 m/s², ideal pulleys, thin lenses). A tool error is not success. Never claim a file exists unless a file action returned created:true. At most ${MAX_CALLS} tool calls per answer.
${fileCatalog}
${documentStandard}${notes}
Verified figure recipes (each renders as-is; adapt the values, keep the structure):
${recipes}`;

/** The full guide, with every recipe: what {"action":"help"} returns. */
const allRecipes = recipeText();
export const kinetraInstructions = buildInstructions(allRecipes);

/** Everyday messages get a one-line pointer instead of the full catalog; the model can ask for it. */
export const kinetraBrief = `Kinetra tools (verified calculations, physics/circuit/logic figures, and real files: PDF, Word, PowerPoint, Excel, CSV, HTML, calendar and other text files, images) are available. If this request needs them, reply with ONLY {"kinetra":{"action":"help"}}; otherwise answer normally.`;

/**
 * Requests that need the full tool guide. Whole words only, and an everyday word that is also a science term counts only
 * with the context that makes it one: "the current through R2" but not "the current news", "the force on the block" but
 * not "air force", "simplify x^2 + 2x" but not "simplify this paragraph". Document requests ("write a report") are
 * found by documentIntent and file requests by fileIntent; a document already made in the chat brings the guide anyway.
 */
const kinetraIntent = new RegExp([
  // Documents and figures
  String.raw`\bpdfs?\b|\bhandouts?\b|\bworksheets?\b|\bsummary sheets?\b|\bstudy guides?\b|\b(?<!(?:news|weather|police|credit|traffic|book) )reports?\b`,
  String.raw`\bdiagrams?\b|\bfigures?\b(?! out| skat)|\billustrations?\b|\bdraw(?:s|ing|n)?\b|\bsketch(?:es|ing)?\b|\bplot(?:s|ting|ted)?\b(?=[^.?!\n]{0,40}(?:[=^+*/(]|\b(?:x|y|data|function|curve|points?|values|against|versus|vs|over time|axis|axes)\b))|\bplot (?:it|this|that|them)\b`,
  String.raw`\bgraph(?:s|ing)?\b|\bcharts?\b|\bflow ?charts?\b|\btimelines?\b|\bmind ?maps?\b|\bvenn\b|\bhierarch(?:y|ies)\b`,
  // Circuits and logic
  String.raw`\bcircuits?\b(?! training| breaker)|\bresistors?\b|\bcapacitors?\b|\binductors?\b|\bvoltages?\b|\bohm'?s law\b|\b(?:electric|alternating|direct|induced|load|branch|mesh|loop|short[- ]circuit|peak|rms) currents?\b|\bcurrents? (?:through|in (?:the|a|each)|flow|source|divider|density)\b`,
  String.raw`\bk-?maps?\b|\bkarnaugh\b|\btruth tables?\b|\bboolean\b|\blogic gates?\b`,
  // Mechanics, optics, fields, fluids
  String.raw`\bprojectiles?\b|\btrajector(?:y|ies)\b|\bfree[- ]?body\b|\bpulleys?\b|\batwood\b|\boptics\b|\bray diagrams?\b|\b(?:concave|convex|plane|spherical|curved) mirrors?\b|\b(?:convex|concave|converging|diverging|thin|biconvex|biconcave) lens(?:es)?\b|\blens (?:equation|formula)\b|\bfocal length\b`,
  String.raw`\b(?<!(?:air|brute|task|police|labou?r|sales|driving|life|work|special|armed|naval) )forces?\b(?! quit)|\bfriction\b|\btorques?\b|\bfulcrum\b|\bseesaw\b|\bwheelbarrow\b|\blevers?\b|\btension (?:in|of|on)\b|\b(?:rope|string|cable) tension\b`,
  String.raw`\belectrostatic|\bcharged (?:rod|sphere|wire|ball|plate)s?\b|\belectric fields?\b|\bfield lines?\b|\bpoint charges?\b|\bdipoles?\b|\bvector fields?\b`,
  String.raw`\bincline\b|\binclined plane\b|\bspring (?:constant|scale|balance|force|stiffness|system|mass)\b|\bmass[- ](?:on[- ]a[- ])?spring\b|\bhooke'?s law\b|\bsprings? in (?:series|parallel)\b|\bbuoyan|\bbeakers?\b|\bapparatus\b|\b(?<!blood )vessels?\b`,
  // Maths
  String.raw`\bintegrals?\b|\bintegrat\w*\b(?=[^.?!\n]{0,40}(?:\bd[a-z]\b|\bfrom\b|respect to|by parts|[\^=+*/]|\b(?:sin|cos|tan|exp|ln|log|sqrt|x|y|t)\b))`,
  String.raw`\bderivatives?\b(?! (?:trading|market|contract))|\bdifferentiat\w*\b(?! between)(?=[^.?!\n]{0,40}(?:[\^=+*/(]|respect to|\b(?:sin|cos|tan|exp|ln|log|sqrt|x|y|t)\b))`,
  String.raw`\bmatri(?:x|ces)\b|\beigen|\bdeterminants?\b|\bsolv(?:e|es|ing)\b|\bequations?\b|\bcalculat(?:e|es|ing|ion|ions)\b|\bcomput(?:e|es|ing|ation)\b|\bslopes?\b`,
  String.raw`\bsimplif\w*\b(?=[^.?!\n]{0,40}(?:expression|equation|fraction|function|boolean|logic|circuit|[\^=+*/]|\b[xyz]\b))`,
  // Study tools
  String.raw`\bquiz(?:zes)?\b|\bflashcards?\b|\b(?:mock|practice|sample) (?:exams?|tests?)\b|\bexam (?:papers?|questions?)\b|\b(?:make|create|generate|write|build|give me)\b[^.?!\n]{0,30}\b(?:exam|test)\b|\bgrad(?:e|ing) (?:this|these|my|the following)\b|\bgrading\b|\brubrics?\b|\bstudy (?:plan|schedule)s?\b|\brevision (?:plan|schedule|timetable|notes)\b`,
].join("|"), "i");
/** A quantity with a unit ("a 5 kg block", "20 m/s", "12 V", "4 Ω"): case matters, so "2 a day" is not one. */
const quantity = /\d\s*(?:m\/s²?|km\/h|kg|N|Pa|Hz|V|mA|A|Ω|kΩ|ohms?|µF|uF|nF|mH)(?![\w\/])/;
/** Whether a request may use the tools: a figure, a calculation, a file, or a change to a document made earlier. */
export function needsKinetra(request: string, hasDocuments = false) {
  return hasDocuments || /^\/pdf\b/i.test(request.trim()) || kinetraIntent.test(request) || quantity.test(request) || documentIntent(request) || fileIntent.test(request);
}
/** The figure recipes for the topic in the request and its context (every one with pictures attached), noting any left out. */
function topicalRecipes(request: string, context: string, pictures: boolean) {
  const { recipes, omitted } = recipesFor(request + "\n" + context, { pictures });
  return omitted
    ? recipeText(recipes) + `\n(Recipes for ${omitted} other science figures — mechanics, optics, electrostatics, circuits, logic, fluids or oscillations not mentioned here — are left out: {"action":"recipes"} returns every recipe.)`
    : allRecipes;
}
/**
 * Claude's and Grok's tool guide, in every system prompt: every action, the file catalog and the document standard,
 * without the recipe list. With a regex choosing between the full guide and kinetraBrief, a request it missed ("make me
 * a cheat sheet") left the model guessing whether tools exist, or spending a round trip on "help". Measured on Grok,
 * this guide added no noticeable time to a plain chat reply (+3.6k input tokens, within run-to-run noise); the full one
 * added about a second. It is the same for every request, so the CLI's cache keeps it.
 */
export const kinetraCompact = buildInstructions('Not listed here: {"action":"recipes"} returns every recipe, and a request that needs figures carries the ones for its topic after this guide.');
/** kinetraCompact for an AI that runs as its own CLI in a working folder (desktop/ai-workspace.ts): the tool is native,
 *  and a document is written once as a Markdown file and made with one call. */
export const kinetraCli = buildInstructions('Not listed here: {"action":"recipes"} returns every recipe, and a request that needs figures carries the ones for its topic after this guide.', "", { native: true, files: true });
/** The same for an AI in a working folder that sends Kinetra requests as {"kinetra":…} replies (Grok). */
export const kinetraFiles = buildInstructions('Not listed here: {"action":"recipes"} returns every recipe, and a request that needs figures carries the ones for its topic after this guide.', "", { files: true });
/**
 * What a request adds after kinetraCompact, in the message: the recipes for its topic when it may need tools, and the
 * design guide for the kind of file asked for. `context` and `pictures` choose the recipes as in kinetraInstructionsFor.
 */
export function kinetraExtrasFor(request: string, hasDocuments = false, { context = "", pictures = false }: { context?: string; pictures?: boolean } = {}) {
  const guides = fileGuidesFor(request);
  const recipes = needsKinetra(request, hasDocuments) ? `KINETRA FIGURE RECIPES (verified; each renders as-is; adapt the values, keep the structure):\n${topicalRecipes(request, context, pictures)}` : "";
  return [recipes, guides].filter(Boolean).join("\n\n");
}
/**
 * The tool guide when the request may need it (or a document it could change exists); otherwise one line. The guide
 * carries the concept diagrams and the science recipes for the topic at hand, found in the request and in `context`
 * (the conversation and its sources, so "notes on this lecture" finds the lecture's circuits); with `pictures` attached,
 * whose subject only the pictures show, it carries every recipe. Recipes left out stay one {"action":"recipes"} away.
 * `notes` are about this conversation (the files it made, the files it can read): they go after the parts that never
 * change and before the parts chosen for this message, so the provider's prompt cache keeps as much as it can.
 */
export function kinetraInstructionsFor(request: string, hasDocuments = false, { context = "", pictures = false, notes = "" }: { context?: string; pictures?: boolean; notes?: string } = {}) {
  if (!needsKinetra(request, hasDocuments)) return kinetraBrief + notes;
  const recipes = topicalRecipes(request, context, pictures);
  const guide = recipes === allRecipes && !notes ? kinetraInstructions : buildInstructions(recipes, notes);
  // The design skill for the kind of file asked for comes with the catalog, so the first file is already well designed.
  const guides = fileGuidesFor(request);
  return guide + (guides ? "\n\n" + guides : "");
}

/**
 * Warm workers for Kinetra calls. Starting a worker loads the whole 1.2 MB bundle, which took longer than most
 * calls themselves (about 40 ms each, so a document with many figures spent seconds just starting workers). Up to
 * MAX_PARALLEL stay loaded and take one call at a time; more wait for a free one. Each keeps the 512 MB memory limit,
 * and one that times out, crashes or runs out of memory is thrown away, so the next call gets a fresh one. An idle
 * worker never keeps the app running and is closed after a few minutes.
 */
type PoolWorker = { worker: Worker; busy: boolean; idle?: ReturnType<typeof setTimeout> };
const pool: PoolWorker[] = [];
const waiting: { request: any; resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
const IDLE_MS = 5 * 60_000;
/** Test seam: the time limit for one call, and the workers now loaded. */
export const kinetraPool = { callMs: 30_000, workers: () => pool.map((w) => w.worker) };
let callId = 0;
function startWorker() {
  const worker = new Worker(join(typeof __dirname === "string" ? __dirname : process.cwd() + "/desktop-dist", "kinetra-worker.cjs"), { resourceLimits: { maxOldGenerationSizeMb: 512 } });
  const entry: PoolWorker = { worker, busy: false };
  // Errors are handled by the call that is running; one while idle only ends the worker, which leaves the pool.
  worker.on("error", () => {});
  worker.on("exit", () => drop(entry));
  worker.unref();
  pool.push(entry);
  return entry;
}
function drop(entry: PoolWorker) {
  clearTimeout(entry.idle);
  const at = pool.indexOf(entry);
  if (at >= 0) pool.splice(at, 1);
  void entry.worker.terminate();
}
function runOn(entry: PoolWorker, request: any) {
  const { worker } = entry;
  entry.busy = true;
  clearTimeout(entry.idle);
  worker.ref();
  return new Promise<any>((resolve, reject) => {
    const id = ++callId;
    const end = (failed: boolean) => {
      clearTimeout(timer);
      worker.off("message", message);
      worker.off("error", error);
      worker.off("exit", exit);
      if (failed) return drop(entry);
      entry.busy = false;
      worker.unref();
      entry.idle = setTimeout(() => drop(entry), IDLE_MS);
      entry.idle.unref?.();
    };
    const message = (reply: any) => {
      if (reply?.id !== id) return;
      end(false);
      reply.error ? reject(Error(reply.error)) : resolve(reply.result);
    };
    const error = (e: Error) => { end(true); reject(e); };
    const exit = () => { end(true); reject(Error("Kinetra worker stopped without a result")); };
    // A call that never returns cannot be interrupted inside the worker, so the worker itself is replaced.
    const timer = setTimeout(() => { end(true); reject(Error("Kinetra calculation timed out")); }, kinetraPool.callMs);
    worker.on("message", message);
    worker.on("error", error);
    worker.on("exit", exit);
    worker.postMessage({ id, request });
  });
}
function nextCall() {
  while (waiting.length) {
    const entry = pool.find((w) => !w.busy) ?? (pool.length < MAX_PARALLEL ? startWorker() : undefined);
    if (!entry) return;
    const call = waiting.shift()!;
    runOn(entry, call.request).then(call.resolve, call.reject).finally(nextCall);
  }
}
export async function kinetraCall(request: any) {
  if (JSON.stringify(request).length > 2_000_000)
    throw Error("Kinetra input too large");
  return new Promise<any>((resolve, reject) => {
    waiting.push({ request, resolve, reject });
    nextCall();
  });
}
const skillNote = `[Clem note: in Clem, run the functions in this guide with {"kinetra":{"action":"call","module":"diagram/projectile","fn":"renderProjectile","args":[model]}} (module path without core/src and .js). Import paths, npm scripts and CLI commands below are not available here.]\n\n`;
export async function kinetraTool(
  request: any,
  pdf?: (spec: any) => Promise<any>,
) {
  if (!request || typeof request !== "object")
    throw Error("Invalid Kinetra request");
  if (typeof request.action !== "string")
    throw Error(`The request has no "action", so nothing ran. Send it again with "action" set to call, pdf, docx, pptx, xlsx, file, image, open, recipes, api, skill or help (and its other fields).`);
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
  if (request.action === "open") throw Error("There are no Clem-made files to open in this conversation.");
  throw Error(`Unsupported Kinetra action "${String(request.action)}". Use call, pdf, docx, pptx, xlsx, file, image, open, recipes, api, skill or help.`);
}
