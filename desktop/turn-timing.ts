/** What one answer's tool loop did: Clem's steps (each a CLI run or turn), Kinetra calls run, and broken requests sent
 *  back for correction. `cliSteps`/`cliCalls`: the CLI's own model steps that asked for tools and every tool call in
 *  them, its file tools included (desktop/tool-status.ts StepCounter). `continued`: the answer went on the chat's kept
 *  CLI session (desktop/chat-sessions.ts), so the conversation so far was not sent again. */
export type TurnStats = { steps: number; calls: number; broken: number; cliSteps?: number; cliCalls?: number; continued?: boolean; compacted?: boolean; tokens?: TokenTally };
/** The tokens one answer's model steps read and wrote, as the CLI reported them: fresh input, prompt-cache reads and
 *  writes, and output (thinking included). Grok's come from its own usage.json, read once the answer ends. */
export type TokenTally = { input: number; cacheRead: number; cacheWrite: number; output: number };
const count = (value: unknown) => Math.max(0, Number(value) || 0);
/** Adds one step's (or one CLI run's) tokens to the answer's tally. */
export function addTokens(stats: TurnStats, t: Partial<TokenTally>) {
  const now = stats.tokens ??= { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  now.input += count(t.input); now.cacheRead += count(t.cacheRead); now.cacheWrite += count(t.cacheWrite); now.output += count(t.output);
}
/** One answer as the ledger keeps it (desktop/answer-ledger.ts): counts and milliseconds only. */
export type AnswerEntry = { at: number; provider: string; model?: string; outcome: "ok" | "failed"; firstTextMs?: number; totalMs: number } & TurnStats;

/**
 * Console timings for one answer, to measure speed work before and after a change. Only the provider, counts and
 * milliseconds are logged: never the prompt, the reply or the account.
 */
export function turnTimer(provider: string, { model, record }: { model?: string; record?: (entry: AnswerEntry) => void } = {}) {
  const started = performance.now();
  let first = 0, ended = false;
  const stats: TurnStats = { steps: 0, calls: 0, broken: 0 };
  const ms = (at: number) => Math.round(at - started) + "ms";
  return {
    stats,
    /** Wraps an answer's events so the first text that reaches the screen is timed. */
    watch: <E extends { type?: string; text?: string }>(emit: (event: E) => void) => (event: E) => {
      if (!first && event?.type === "delta" && event.text) first = performance.now();
      emit(event);
    },
    end(outcome: "ok" | "failed" = "ok") {
      if (ended) return;
      ended = true;
      const total = Math.round(performance.now() - started);
      try { record?.({ at: Date.now(), provider, ...(model ? { model } : {}), outcome, ...(first ? { firstTextMs: Math.round(first - started) } : {}), totalMs: total, ...stats }); } catch { /* the ledger never costs an answer */ }
      const t = stats.tokens;
      console.log(`[clem timing] ${provider} ${outcome} first-text=${first ? ms(first) : "none"} total=${ms(performance.now())} steps=${stats.steps} calls=${stats.calls} broken=${stats.broken} cli-steps=${stats.cliSteps || 0} cli-calls=${stats.cliCalls || 0}${stats.cliSteps ? ` per-step=${((stats.cliCalls || 0) / stats.cliSteps).toFixed(1)}` : ""} session=${stats.continued ? "continued" : "new"}${t ? ` tokens in=${t.input} cache-read=${t.cacheRead} cache-write=${t.cacheWrite} out=${t.output}` : ""}`);
    },
  };
}
