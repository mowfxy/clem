import { checkBlocks, checkProblems } from "../core/checks.ts";
import { parseVisual } from "../core/visual-spec.ts";
import { parseModelJson } from "../core/model-json.ts";
import reference from "./generated/kinetra.json" with { type: "json" };

/** A result worked through to a number (V/R = 12/4 = 3, ≈ 3.2), or a value given after "=" (I = 3 A). */
const CHAIN = /=[^=\n]*=\s*\$?\s*-?\d|(?:≈|\\approx)\s*\$?\s*-?\d/;
const VALUE = /=\s*\$?\s*-?\d/g;
/** A request that asks for numbers to be worked out, as opposed to explained. */
const CALCULATION = /\b(?:calculat\w*|comput(?:e|es|ing|ation)|solv(?:e|es|ing)|evaluat\w*|determin(?:e|es|ing)|work out|find (?:the|its|their|each|all|x|y)|how (?:much|many|far|fast|long|high|big|heavy)|what (?:is|are|was|were) the (?:value|magnitude|current|voltage|force|speed|velocity|acceleration|resistance|power|energy|tension|torque|area|volume|mass|time|distance|probability|total|answer)s?)\b/i;
/** A quantity with a unit ("a 5 kg block", "12 V", "4 Ω"), as kinetra-runtime.ts reads it. */
const QUANTITY = /\d\s*(?:m\/s²?|km\/h|kg|N|Pa|Hz|V|mA|A|Ω|kΩ|ohms?|µF|uF|nF|mH)(?![\w\/])/;

/** Whether the request asks for numbers to be worked out, so an answer's numbers must come from a tool or a check. */
export function calculationIntent(request: string) {
  return CALCULATION.test(request) || QUANTITY.test(request);
}

/** Each ```visual block of an answer that the chat could not draw, with the reason it would show (core/visual-spec.ts). */
export function visualProblems(answer: string) {
  const problems: string[] = [];
  let n = 0;
  for (const [, body] of answer.matchAll(/^[ \t]*```visual[^\n]*\n([\s\S]*?)\n[ \t]*```/gm)) {
    n++;
    try { parseVisual(body); } catch (error) { problems.push(`Visual ${n}: ${(error as Error).message}`); }
  }
  return problems;
}

/** Each ```kinetra block the chat could not draw for its shape alone: not JSON, no module, fn or args, or a module Kinetra does not have. */
export function figureProblems(answer: string) {
  const problems: string[] = [];
  let n = 0;
  for (const [, body] of answer.matchAll(/^[ \t]*```kinetra[^\n]*\n([\s\S]*?)\n[ \t]*```/gm)) {
    n++;
    let value: any;
    try { value = JSON.parse(body); } catch { problems.push(`Figure ${n} is not strict JSON.`); continue; }
    const figure = value?.figure && typeof value.figure === "object" ? value.figure : value;
    if (typeof figure?.module !== "string" || typeof figure?.fn !== "string" || !Array.isArray(figure?.args)) problems.push(`Figure ${n} needs "module", "fn" and "args" from a Kinetra figure recipe.`);
    else if (!reference.modules.includes(figure.module)) problems.push(`Figure ${n}: Kinetra has no module "${figure.module}" (modules: ${reference.modules.join(", ")}).`);
  }
  return problems;
}

/**
 * What is wrong with a final answer, sent back once before the person relies on it (desktop/kinetra-turn.ts review): a
 * ```visual the chat cannot draw; every ```check recomputed (core/checks.ts); and, for a calculation, results that no
 * Kinetra call worked out and no check verifies. A file made in the answer is left out: its draft's checks ran when it was made.
 */
export function answerReview(answer: string, history: { request: any; result: any }[], { calculation }: { calculation: boolean }) {
  const figures = figureProblems(answer);
  if (figures.length) return `Some of your figures cannot be drawn: ${figures.join(" ")} Write your whole answer again with every \`\`\`kinetra block as strict JSON {"title","caption","module","fn","args"} copied from a Kinetra figure recipe's structure ({"action":"recipes"} lists them). The person sees only the new answer.`;
  const broken = visualProblems(answer);
  if (broken.length) return `Some of your visuals cannot be drawn: ${broken.join(" ")} Write your whole answer again with every \`\`\`visual block complete and in the VISUALS schema (every required field present, numbers as numbers, every 3D atom with "el", "x", "y" and "z", every edge joining node ids that exist). The person sees only the new answer.`;
  const blocks = checkBlocks(answer);
  const wrong = checkProblems(blocks, { lines: false });
  if (wrong.length) return `Your answer's numbers do not all hold: ${wrong.join(" ")} Work each one out again (with a Kinetra call where a module computes it), then write your whole answer again with the corrected values and a corrected check block. The person sees only the new answer.`;
  if (!calculation || blocks.length) return undefined;
  if (history.some((h) => h.result?.created || (h.request?.action === "call" && h.result != null && !h.result.error))) return undefined;
  // Code is not a calculation ("x = y = 0" in a fix for a bug): only the prose and the maths count.
  const prose = answer.replace(/(```+|~~~+)[^\n]*\n[\s\S]*?(?:\n\s*\1\s*(?:\n|$)|$)/g, "\n").replace(/`[^`\n]*`/g, "");
  if (!CHAIN.test(prose) && (prose.match(VALUE) || []).length < 3) return undefined;
  return `Your answer states computed results that no Kinetra call worked out and no check verifies. Verify them now: compute each with {"action":"call",…} where a module does (circuits: clem solveCircuit with the circuit's netlist), then write your whole answer again, ending with one \`\`\`check block of strict JSON {"checks":[{"label":…,"expr":…,"vars":{…},"claimed":…,"unit":…}]} for the key results. The person sees only the new answer.`;
}

/**
 * Each well-formed ```kinetra figure drawn before the person sees it (`draw`: the Kinetra worker), so one that fails (a
 * composition whose checks or overlap gate fail, arguments a recipe does not take) goes back to the model with Kinetra's
 * own errors instead of reaching the person as "could not be drawn". Returns what to send back, or undefined.
 */
export async function figureDrawReview(answer: string, draw: (figure: { module: string; fn: string; args: unknown[] }) => Promise<unknown>) {
  const figures: { n: number; module: string; fn: string; args: unknown[] }[] = [];
  let n = 0;
  for (const [, body] of answer.matchAll(/^[ \t]*```kinetra[^\n]*\n([\s\S]*?)\n[ \t]*```/gm)) {
    n++;
    let value: any;
    try { value = parseModelJson(body); } catch { continue; }
    const figure = value?.figure && typeof value.figure === "object" ? value.figure : value;
    if (typeof figure?.module === "string" && typeof figure?.fn === "string" && Array.isArray(figure?.args)) figures.push({ n, module: figure.module, fn: figure.fn, args: figure.args });
  }
  const failed = (await Promise.all(figures.slice(0, 16).map(async (f) => {
    try {
      const svg = await draw(f);
      return typeof svg === "string" && svg.includes("<svg") ? "" : `Figure ${f.n} (${f.module} ${f.fn}) returned data, not a drawing.`;
    } catch (e) {
      return `Figure ${f.n} (${f.module} ${f.fn}): ${String((e as Error)?.message || e).slice(0, 1500)}`;
    }
  }))).filter(Boolean);
  if (!failed.length) return undefined;
  return `Some of your figures did not draw: ${failed.join(" ")} Fix exactly what each error reports (for clem compose: the elements, values and checks it names; never hide an overlap or loosen a check), test the corrected figure with {"action":"call",…} if you can, then write your whole answer again with every \`\`\`kinetra block corrected. The person sees only the new answer.`;
}

/**
 * Each ```edit block of an answer that the person could not apply, checked against the live files (`problem`:
 * desktop/folder-edits.ts changeProblem) before they see it, so a change copied wrongly goes back to the model instead
 * of reaching the person as an error. Returns what to send back, or undefined.
 */
export async function editReview(answer: string, problem: (edit: { path: string; find?: string; replace?: string; content?: string }) => Promise<string | undefined>) {
  const problems: string[] = [];
  let n = 0;
  for (const [, body] of answer.matchAll(/^[ \t]*```edit[^\n]*\n([\s\S]*?)\n[ \t]*```/gm)) {
    n++;
    let edit: any;
    try { edit = parseModelJson(body); } catch { problems.push(`Change ${n} is not strict JSON.`); continue; }
    if (typeof edit?.path !== "string" || !edit.path.trim()) { problems.push(`Change ${n} has no "path".`); continue; }
    if (typeof edit.content !== "string" && typeof edit.find !== "string") { problems.push(`Change ${n} (${edit.path}) needs "find" and "replace", or "content" with the whole new file.`); continue; }
    const why = await problem({ path: edit.path, find: edit.find, replace: typeof edit.replace === "string" ? edit.replace : undefined, content: typeof edit.content === "string" ? edit.content : undefined });
    if (why) problems.push(`Change ${n} (${edit.path}): ${why}`);
  }
  if (!problems.length) return undefined;
  return `Some of your file changes cannot be applied: ${problems.join(" ")} Read each of those files again as it is now (with your file tool, or {"kinetra":{"action":"read","file":"the path"}}), copy every "find" from that text exactly, with enough surrounding lines to occur only once, or send "content" with the whole new file for a small one. Then write your whole answer again with every \`\`\`edit block corrected. The person sees only the new answer.`;
}

/** What the chat says while an answer that was sent back (desktop/kinetra-turn.ts SentBack) is written again. */
export function retractedStatus(why: "review" | "unfinished") {
  return why === "review" ? "Double-checking the answer…" : "Finishing the document…";
}
