import { checkBlocks, checkProblems } from "../core/checks.ts";
import { parseVisual } from "../core/visual-spec.ts";

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

/**
 * What is wrong with a final answer, sent back once before the person relies on it (desktop/kinetra-turn.ts review): a
 * ```visual the chat cannot draw; every ```check recomputed (core/checks.ts); and, for a calculation, results that no
 * Kinetra call worked out and no check verifies. A file made in the answer is left out: its draft's checks ran when it was made.
 */
export function answerReview(answer: string, history: { request: any; result: any }[], { calculation }: { calculation: boolean }) {
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
