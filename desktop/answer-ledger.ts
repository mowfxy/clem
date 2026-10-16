import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnswerEntry } from "./turn-timing.ts";

/**
 * A local record of what every answer cost: provider, model, steps, tool calls, broken requests, whether it went on
 * the chat's kept session, timings and the tokens the CLI reported. Counts only, never a prompt, a reply, a file name or
 * an account. The CLIs' own transcripts are deleted once an answer ends, so this is what efficiency work is measured
 * against afterwards (scripts/answer-ledger.mjs prints it), and what shows a change that made answers dearer.
 */
export const LEDGER_FILE = "answers.jsonl";
/** The ledger is cut back to its newer half past this size, so it never grows without end. */
export const LEDGER_MAX_BYTES = 2_000_000;

export function answerLedger(dir: string) {
  const file = join(dir, LEDGER_FILE);
  let queue = Promise.resolve();
  return {
    file,
    /** Appends one answer; writes are queued, and a failure is only logged. */
    record(entry: AnswerEntry) {
      queue = queue.then(async () => {
        await mkdir(dir, { recursive: true });
        await appendFile(file, JSON.stringify(entry) + "\n");
        if ((await stat(file)).size > LEDGER_MAX_BYTES) {
          const lines = (await readFile(file, "utf8")).split("\n").filter(Boolean);
          await writeFile(file, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
        }
      }).catch((error) => console.warn("[ledger] could not record an answer:", (error as Error).message));
      return queue;
    },
  };
}

/** The ledger's lines as entries; a damaged line is skipped. */
export function readLedger(text: string): AnswerEntry[] {
  return text.split("\n").flatMap((line) => { try { const e = JSON.parse(line); return e && typeof e === "object" && typeof e.provider === "string" ? [e] : []; } catch { return []; } });
}

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/** Per provider: answers, failures, medians of time, steps and calls, the share on a kept session, and tokens per answer. */
export function summarizeLedger(entries: AnswerEntry[]) {
  const by = new Map<string, AnswerEntry[]>();
  for (const e of entries) by.set(e.provider, [...(by.get(e.provider) || []), e]);
  return [...by].map(([provider, list]) => {
    const priced = list.filter((e) => e.tokens);
    // Prompt-cache reads cost about a tenth of fresh input and writes about a quarter more: a rough "input-price" total.
    const units = priced.map((e) => Math.round(e.tokens!.input + e.tokens!.cacheWrite * 1.25 + e.tokens!.cacheRead * 0.1));
    return {
      provider,
      answers: list.length,
      failed: list.filter((e) => e.outcome === "failed").length,
      medianMs: median(list.map((e) => e.totalMs)),
      medianFirstTextMs: median(list.flatMap((e) => (e.firstTextMs ? [e.firstTextMs] : []))),
      medianSteps: median(list.map((e) => e.steps)),
      medianCalls: median(list.map((e) => e.calls)),
      broken: list.reduce((n, e) => n + (e.broken || 0), 0),
      continuedShare: list.length ? Math.round((100 * list.filter((e) => e.continued).length) / list.length) : 0,
      medianInputUnits: median(units),
      medianOutput: median(priced.map((e) => e.tokens!.output)),
    };
  });
}
