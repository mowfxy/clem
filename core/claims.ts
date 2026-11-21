// What an answer says it did, checked against what its tools did (desktop/kinetra-turn.ts). A model that writes "I've
// updated your Coming up section" without the action, or after the action failed, is sent back once to do it or to
// say plainly that nothing changed. Pure, so the window, Telegram and the VPS worker hold the same line.

import { gucAction } from "./guc/ai-tools.ts";
import { clemAction } from "./proactivity/tools.ts";

type Step = { request: any; result: any };
/** The action a request named, read through the aliases a model may use ("guc.fix" is guc.correct). */
const actionOf = (r: any) => { const a = String(r?.action || ""); return gucAction(a) || clemAction(a) || a; };
const ok = (r: unknown) => r !== undefined && r !== null && !(typeof r === "object" && "error" in (r as object));
const did = (history: Step[], actions: RegExp) => history.some((h) => actions.test(actionOf(h.request)) && ok(h.result));

const CLAIMS: { said: RegExp; backed: RegExp; what: string; how: string }[] = [
  {
    // "I've updated your Coming up section", "added ELCT 301 Quiz 2 to Coming up", "Coming up now shows…"
    said: /\b(?:updated|added|moved|changed|removed|deleted|corrected|set|put|scheduled|marked)\b[^.\n]{0,90}\bcoming[ -]up\b|\bcoming[ -]up\b[^.\n]{0,60}\b(?:updated|now (?:shows|has|says|lists)|is now|has been)\b/i,
    backed: /^guc\.(?:correct|uncorrect|learn|resync|reread|rebuild)$/,
    what: "Coming up",
    how: 'Read {"kinetra":{"action":"guc.deadlines","range":"all"}}, then send guc.correct ("edit" for an item that is there, "add" for one that isn\'t)',
  },
  {
    // "I've set reminders for…", "reminder set for 8 pm"
    said: /\b(?:i(?:'ve| have)?|i'll)\s+(?:set|added|scheduled|created|made)\b[^.\n]{0,50}\breminders?\b|\breminders?\b[^.\n]{0,20}\b(?:is|are|has been|have been) set\b/i,
    backed: /^clem\.(?:remind|study|routine)$/,
    what: "a reminder",
    how: 'Send {"kinetra":{"action":"clem.remind",…}}',
  },
];

/** What the answer claims without a tool having done it, as the note it goes back with; undefined when it holds. */
export function unbackedClaim(answer: string, history: Step[]): string | undefined {
  for (const c of CLAIMS) {
    if (!c.said.test(answer) || did(history, c.backed)) continue;
    const failed = history.some((h) => c.backed.test(actionOf(h.request)) && !ok(h.result));
    return `Your answer says you changed ${c.what}, but ${failed ? "the action failed, so" : "no action did it in this answer, so"} nothing changed yet. ${c.how} now and answer from its result; if it can't be done, say plainly that it wasn't changed and why. Never say something changed unless a result says so.`;
  }
  return undefined;
}
