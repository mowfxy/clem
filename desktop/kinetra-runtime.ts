import { Worker } from "node:worker_threads";
import { join } from "node:path";
import reference from "./generated/kinetra.json" with { type: "json" };
import { composeIndex, illustrationGuide, recipeText, recipesFor, recipesNamed } from "./kinetra-recipes.ts";
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
- {"action":"pdf","kind":K,"title":T,"subtitle"?:S,"author"?:A,"summary"?:Markdown,"sections":[{"heading"?:H,"text"?:Markdown with $LaTeX$ math,"figure"?:{"module":M,"fn":F,"args":[…]},"caption"?:C}],"references"?:[strings],"plan"?:[every heading],"style"?:L,"font"?:F,"headingFont"?:F,"design"?:{…}} creates ONE real PDF file. Use it when the person wants a PDF or a finished document to read or print (report, handout, worksheet, notes); when they want to edit it in Word, use docx with the same specification (see FILES below). K is one of report, paper, brief, notes, proposal, manual, handout, worksheet, letter, memo; it picks the page design. Pick K from what the person asked for, never from how serious or technical the subject is: report or paper only when the message came with /report ("Make this as a technical report"): the technical report layout is reserved for that command, and Clem prints any other report or paper as a plain document or notes, so a report asked for in words is "document"; explaining lectures, a study guide, revision or course notes → notes; a cheat sheet → handout; a sheet of questions for them to answer → worksheet. Clem typesets it like professional print: reports and papers as a technical report (ruled small-caps title, centred abstract, Times, running head, numbered sections, figures, tables and equations, contents with page numbers, PDF bookmarks); notes, handouts, guides and worksheets as lecture notes (a book face with framed definitions, theorems and examples; worksheets get name and date lines); briefs, proposals and memos as business documents (executive summary; a memo gets a Subject/From/Date block); letters plainly. "style" (technical, notes, business, letter) picks a different base when the person describes a look ("like a research paper" → technical); see Design below. Give a 2–4 sentence summary for reports, papers, briefs and proposals (printed as the abstract or executive summary). Write headings without numbers; use ### and #### inside a section for numbered subsections and ##### for a bold run-in paragraph heading.
- Typesetting in section text: tables in Markdown, with a caption line "Table: what it shows" directly above the table (numbered Table 1, 2…). Display equations on their own $$…$$ lines (numbered (1), (2)… in reports and papers). Definitions, theorems, examples and similar blocks: a quote whose first line names the kind, e.g. the two lines "> [!DEFINITION] Kinetic friction" and "> The ratio…" (in JSON text, joined by \\n) (kinds: DEFINITION, THEOREM, LEMMA, PROPOSITION, COROLLARY, LAW, PRINCIPLE, RULE, FORMULA, EXAMPLE, EXERCISE, PROBLEM, QUESTION, SOLUTION, ANSWER, PROOF, REMARK, NOTE, TIP, IMPORTANT, SUMMARY, WARNING, MISTAKE); they are numbered per section (Definition 2.1). Cite references by number in square brackets, [1] or [2, 5], matching the order of "references"; write "Figure 2", "Table 1" and "Section 3.2" for cross-references (figures and captioned tables are numbered in order of appearance, sections as printed); all of these become links. Figure captions describe the figure and its assumptions without "Figure 1". Figures are drawn by Kinetra from the figure spec; never write SVG or images yourself. The text must follow the DOCUMENT STANDARD below: it is checked, and conversational or personal phrasing ("Here is your report", "you", "I") is rejected. All figures are checked first: on any error no PDF is made and you receive every problem at once; fix them and send pdf again. Once a pdf, docx or pptx is made, pictures of its new figures come back with the result: compare each with the source it was copied from (the problem, the person's picture or page, your netlist or data) and revise the file when the topology, labels or values differ. After the PDF is created, reply to the user in one or two plain sentences; do not repeat the document.
- Several documents: when the user asks for a PDF for each file, lecture, chapter or topic ("a pdf for each", "separate pdfs"), send one pdf action per item, one after another, each complete on its own; never merge them into one file or stop after the first. Name each after its item.
- Length and depth come from the request and the material, never from a page target, and the person never has to ask for "longer". "Explain fully", "in detail", "everything", "comprehensive", notes from a lecture or a report on a broad topic mean: cover every topic, definition, formula, example and figure in the source, in its order, explaining each one (what it is, why it matters, how it works, a worked example where the source has one); dozens of pages are normal for a course or a long report. Do not summarise, skip or pick "key points" unless asked. ${files ? CLI_LENGTH : TEXT_LENGTH}
- Design: leave "font", "headingFont" and "design" out unless a look is described (by the person, a skill, an instruction or a saved preference): Clem designs each document from the document itself and keeps that design in every revision. When a look is described, build it exactly with the DESIGN SKILL ({"action":"skill","name":"design"}; it comes with a request that describes one).
- {"action":"pdf","revise":ID,"change":"one short sentence",…the complete revised specification…} updates a document Clem already made in this conversation (IDs are listed under DOCUMENTS IN THIS CONVERSATION when there are any). Use it for every change to an existing document; never make a second file for a change. {"action":"open","id":ID} returns that document's current specification first, so everything the user did not ask to change stays the same. A change to a few sections (a figure's place or size, one paragraph, a corrected table) is sent as {"action":"pdf","revise":ID,"change":…,"patch":[{"at":N,…only the changed fields…}]}: the rest of the document is kept as it is, without sending it again.
- Figures in PDFs: every diagram, chart or picture is a Kinetra figure, one per section (a section without a heading continues the one before, so several sections give several figures). Draw whatever a reader would sketch: a study document has a figure for each such idea, never one token figure, and never a picture described in words instead (redraw or crop the source's graph; a "sketch" exercise's solution shows the sketch). Match the recipe: flowchart, cycle, timeline, mind map, tree, Venn, charts; anything on axes (functions and asymptotes, shaded domains with dashed excluded boundaries, level curves, surfaces, polar curves, tangents, areas, vector fields) as {"module":"clem","fn":"visual","args":[a \`\`\`visual plot or 3d spec]}; physics, circuits and logic with their recipes; any other technical figure (beams, trusses, Mohr's circle, P–V, Bode, block diagrams, state machines, datapaths, phasors, op-amps…) with clem compose (read {"action":"skill","name":"kinetra-compose"} and composeParts first). A \`\`\`visual already in the chat goes in unchanged as {"module":"clem","fn":"visual","args":[its JSON]}. A figure from the person's PDF or picture goes in as the crop itself, never redrawn: {"asset":"crop-…","source"?:"where it is from" or true} in pdf and docx sections and pptx figure or image slides ("source" adds "Source: …" to the caption). Placement: give each figure to the section where it is first discussed and cite it as "Figure N"; "align":"auto" wraps a small figure beside the text and centres a larger one; or choose "wrap-right"|"wrap-left"|"center"|"box"|"left"|"right" and "width" (0.2–1 of the column). Pictures of the printed pages come back with the result: judge them as a designer would and revise until every figure sits well.
- A document made from the person's files carries their pictures: crop every figure, graph and circuit it discusses (regions, then crops, each in one batch) and place each with "source":true; Clem holds back such a document with almost no figures unless "noFigures":"why" says the sources have none. Files reach the person only through Kinetra file actions, never ones you make with your own tools (Python, LaTeX, shell).
- Physics and engineering apparatus (pulleys, ropes, spring scales, blocks on inclines, levers and wheelbarrows, springs, vessels of liquid, charged spheres, rods and wires with field lines, free-body insets, lever arms) is drawn as a textbook figure: {"module":"clem","fn":"illustration","args":[{"items":[…]}]}. Start from the closest "textbook figure" recipe below, keep its structure and change positions, sizes and labels; {"action":"skill","name":"figures"} returns every item and anchor. Prefer it to the plain free-body, pulley and charged-rod recipes whenever the apparatus itself should be seen; those stay for bare numeric diagrams. Documents are printed, so a 3D scene becomes a textbook figure drawn in 2D (a sphere as a shaded ball, a wire as a rod, field lines in the page).
- Chat figures: a fenced kinetra block {"title","caption","module","fn","args"} draws any recipe's figure inline in the answer (any other technical figure: clem compose); one per idea or stage, never as a file, and never a \`\`\`visual for what Kinetra draws.
- {"action":"recipes"} lists the verified figure recipes below; {"action":"api","module":M} returns a module's TypeScript declarations (exact argument shapes); {"action":"skill","name":N} returns a topic guide (figures, design, slides, word, spreadsheets, files, ${Object.keys(reference.skills).join(", ")}).
Callable modules: ${reference.modules.join(", ")}. Before using a module that has no recipe, read its api. Functions that need callbacks, Map instances or classes cannot be called; prefer module clem (compose, composeParts, integrateExpression, plot, logicDiagram, vectorField, scalarField, solveCircuit, circuitTransient, retrieve, studySchedule).
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
  // Engineering figures the composition toolkit draws (clem compose)
  String.raw`\bshear (?:force|diagram)s?\b|\bbending moments?\b|\btruss(?:es)?\b|\bcantilever\b|\bsimply supported\b|\bmohr'?s? circle\b|\bprincipal stress(?:es)?\b|\bstress[- –]strain\b|\bcarnot\b|\bp[- –]v diagrams?\b|\bheat engines?\b|\bventuri\b|\bbernoulli\b|\bsnell'?s law\b|\btotal internal reflection\b|\bstanding waves?\b`,
  String.raw`\bbode\b|\broot locus\b|\bstep response\b|\bblock diagrams?\b|\bfeedback (?:loop|control)\b|\btransfer functions?\b|\bstate machines?\b|\bfsm\b|\bfinite[- ]state\b|\bstate diagrams?\b|\bdatapath\b|\bphasors?\b|\bthree[- ]phase\b|\bop[- ]?amps?\b|\boperational amplifiers?\b|\bwheatstone\b|\bminkowski\b|\bspacetime diagrams?\b|\benergy level diagrams?\b`,
  // Maths
  String.raw`\bintegrals?\b|\bintegrat\w*\b(?=[^.?!\n]{0,40}(?:\bd[a-z]\b|\bfrom\b|respect to|by parts|[\^=+*/]|\b(?:sin|cos|tan|exp|ln|log|sqrt|x|y|t)\b))`,
  String.raw`\bderivatives?\b(?! (?:trading|market|contract))|\bdifferentiat\w*\b(?! between)(?=[^.?!\n]{0,40}(?:[\^=+*/(]|respect to|\b(?:sin|cos|tan|exp|ln|log|sqrt|x|y|t)\b))`,
  String.raw`\bmatri(?:x|ces)\b|\beigen|\bdeterminants?\b|\bsolv(?:e|es|ing)\b|\bequations?\b|\bcalculat(?:e|es|ing|ion|ions)\b|\bcomput(?:e|es|ing|ation)\b|\bslopes?\b`,
  String.raw`\bsimplif\w*\b(?=[^.?!\n]{0,40}(?:expression|equation|fraction|function|boolean|logic|circuit|[\^=+*/]|\b[xyz]\b))`,
  // Study tools
  String.raw`\bquiz(?:zes)?\b|\bflash[ -]?cards?\b|\bplan (?:my|the|our) (?:week|revision|study|studying|exam prep)\b`,
  // A picture asked for in other words ("show me … as a picture")
  String.raw`\bas an? (?:picture|image|figure|diagram|drawing)\b|\bshow me\b[^.?!\n]{0,40}\b(?:pictures?|images?|visuals?|figures?)\b`,
  String.raw`\b(?:mock|practice|sample) (?:exams?|tests?)\b|\bexam (?:papers?|questions?)\b|\b(?:make|create|generate|write|build|give me)\b[^.?!\n]{0,30}\b(?:exam|test)\b|\bgrad(?:e|ing) (?:this|these|my|the following)\b|\bgrading\b|\brubrics?\b|\bstudy (?:plan|schedule)s?\b|\brevision (?:plan|schedule|timetable|notes)\b`,
].join("|"), "i");
/** A quantity with a unit ("a 5 kg block", "20 m/s", "12 V", "4 Ω"): case matters, so "2 a day" is not one. */
const quantity = /\d\s*(?:m\/s²?|km\/h|kg|N|Pa|Hz|V|mA|A|Ω|kΩ|ohms?|µF|uF|nF|mH)(?![\w\/])/;
/** Whether a request may use the tools: a figure, a calculation, a file, or a change to a document made earlier. */
export function needsKinetra(request: string, hasDocuments = false) {
  return hasDocuments || /^\/pdf\b/i.test(request.trim()) || kinetraIntent.test(request) || quantity.test(request) || documentIntent(request) || fileIntent.test(request);
}
/** The figure recipes for the topic in the request and its context (every one with pictures attached), noting any left out. */
function topicalRecipes(request: string, context: string, pictures: boolean) {
  const { recipes, omitted, composed } = recipesFor(request + "\n" + context, { pictures });
  if (!omitted && !composed) return allRecipes;
  return recipeText(recipes) + (omitted ? `\n(Recipes for ${omitted} other science figures — mechanics, optics, electrostatics, circuits, logic, fluids or oscillations not mentioned here — are left out: {"action":"recipes"} returns every recipe.)` : "");
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
 * The system prompt's tool note for an AI in a working folder, in place of kinetraCli or kinetraFiles. Those were in
 * every system prompt on the promise of the CLI's prompt cache, but Gemini never read them from it (0 cached tokens in
 * every answer logged) and Grok barely did, so "hey" carried ~6k tokens of tool guide and waited 8–14 s for its first
 * word. The guide now goes in the message of a request that may need it (needsKinetra), once per kept session; one the
 * regex misses asks for it with help. The note is the same every time, so the pre-opened session still matches it.
 */
const workBrief = (native: boolean) => `Kinetra tools (verified calculations, physics/circuit/logic figures, and real files: PDF, Word, PowerPoint, Excel, CSV, HTML, calendar and other text files, images) are available${native ? " as your kinetra tool" : ""}. Their full guide (KINETRA TOOLS) comes with any message that may need them. If a request needs them and that guide is not in this conversation, first ${native ? 'call kinetra with {"action":"help"}' : 'reply with ONLY {"kinetra":{"action":"help"}}'} to get it; otherwise answer normally.`;
export const kinetraCliBrief = workBrief(true);
export const kinetraFilesBrief = workBrief(false);
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
/**
 * Clem's kinetra-compose skill: the upstream SKILL.md's rules and quick reference, said the way Clem runs them (a clem
 * call, never an import or npm script), plus the rules.md cheat-sheet bundled by scripts/build-kinetra.mjs. Each part's
 * options come from composeParts on demand, so the guide stays small.
 */
export const composeGuide = `KINETRA COMPOSE: custom engineering and physics figures built from toolkit parts, for anything no recipe draws (shear and moment diagrams, trusses, Mohr's circle, stress–strain, P–V cycles, Bode and root-locus plots, step responses, block diagrams, state machines, datapaths, phasors, op-amp and bridge circuits, Venturi meters, refraction, standing waves, Minkowski diagrams, energy levels). A recipe that fits (circuit schematic, logic circuit, textbook figure, plot, flowchart) comes first.
How to call it:
- {"action":"call","module":"clem","fn":"composeParts","args":[["beam","pinSupport","pointLoad"]]} returns just those parts (or a category: basic, general, mechanics, fields, fluids, circuits, logic, plots) with options, anchors and an example; with no args it lists every part type. Ask only for the parts you will use.
- {"action":"call","module":"clem","fn":"compose","args":[model]} returns the SVG, or an error listing every problem as code [elements]: message, measured values, Fix: what to change. composeCheck with the same args returns each declared check (expected, actual, pass) without the drawing.
- The figure in a pdf, docx or pptx section, or a chat \`\`\`kinetra block, is {"module":"clem","fn":"compose","args":[model]}. The "composed:" recipes ({"action":"recipes"}) are checked models to start from: keep their structure, change the values.
Rules:
1. Work out the engineering first: the governing equations and their solution (reactions, member forces, node voltages, poles, states).
2. Every quantity-bearing number is a formula with units in "vars" or on the element ("m*g*sin(theta)", "P*(L - a)/L"), never a number worked out elsewhere; hand-typed coordinates are for layout only.
3. Position by relationships: anchors ("beam.top(0.5)"), {"attach":"bottom","to":"ramp.surface(0.55)"}, tangentTo, along, alignedWith, rightOf, {"ref":"M.left","dx":0.2}.
4. Declare a check for every law the figure claims: equilibrium (vectorSum, momentSum), conservation (equal), KCL (kcl) and KVL (equal), points on curves (onCurve), plot-to-plot consistency, inequalities. Each check must be able to fail.
5. On errors, change exactly what is reported and call again. Never hide the gate: no mayTouch over a real overlap, no wider tolerance, no deleted check.
6. Say what was verified (the checks that passed, no overlaps) and what was assumed (the model, the inputs, idealisations), never more than the checks show.
Quick reference: model {"canvas":{"width","height","world":{"xMin","xMax","yMin","yMax"},"worldUnit"?},"title"?,"caption"?,"vars","scales"?,"elements","checks"}; world +y is up. Points: {"x","y"}, "id", "id.anchor", "id.anchor(arg)", {"ref":"id.anchor","dx","dy"}. Checks read vars, part refs (F.magnitude, s.area, p.dataY, V.re) and anchor coordinates (T.surface.y). Let the placer choose label positions; labels take F_N, V_{CC}, x^2, \\theta as real scripts; titles and captions are plain text (Unicode T₁, x²). The spring part is coilSpring. Units include kN, MPa, litre, eV and nm.

${reference.composeRules}`;
export async function kinetraTool(
  request: any,
  pdf?: (spec: any) => Promise<any>,
) {
  if (!request || typeof request !== "object")
    throw Error("Invalid Kinetra request");
  if (typeof request.action !== "string")
    throw Error(`The request has no "action", so nothing ran. Send it again with "action" set to call, pdf, docx, pptx, xlsx, file, image, open, recipes, api, skill or help (and its other fields).`);
  if (request.action === "help") return kinetraInstructions;
  if (request.action === "recipes" && typeof request.name === "string" && request.name.trim()) {
    const named = recipesNamed(request.name);
    return named.length ? recipeText(named) : `No recipe is named "${request.name}". ${composeIndex()} {"action":"recipes"} lists the others.`;
  }
  if (request.action === "recipes") return recipeText() + "\n" + composeIndex();
  if (request.action === "skill" && request.name === "figures") return illustrationGuide;
  if (request.action === "skill" && ["kinetra-compose", "compose"].includes(request.name)) return composeGuide;
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
