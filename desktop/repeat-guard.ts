import { createHash } from "node:crypto";

/** Errors that can pass on their own (a slow window, a stopped answer): the same request may run again after them. */
const PASSING = /took too long|timed out|cancelled/i;

/**
 * File requests that failed, so the same failure is never run twice (desktop/main.ts makeOrReviseNow). A request is
 * its JSON plus, for a document made from a Markdown file, that file's text: once the file is edited, or the request
 * changes, it runs again. The text protocol has its own guard for requests that cannot be read (kinetra-turn.ts lastBroken).
 */
export function failureMemory() {
  const failed = new Map<string, string>();
  const key = (spec: unknown, text?: string) => createHash("sha256").update(JSON.stringify(spec ?? null)).update("\0").update(text ?? "").digest("hex");
  return {
    /** What to answer at once when this exact request already failed; undefined when it should run. */
    repeated(spec: unknown, text?: string) {
      const error = failed.get(key(spec, text));
      if (error === undefined) return undefined;
      const said = /[.!?)]$/.test(error) ? error : error + ".";
      if (text === undefined) return `This request is the same as one that just failed, so it was not run again: ${said} Change what the error names, then send it.`;
      const line = /\bline (\d+)/i.exec(error)?.[1];
      return `The file has not changed since this error: ${said} ${line ? `Fix line ${line}` : "Fix it"} with an edit first, then send the request again.`;
    },
    failed(spec: unknown, text: string | undefined, error: string) {
      if (!PASSING.test(error)) failed.set(key(spec, text), error.trim());
    },
  };
}
