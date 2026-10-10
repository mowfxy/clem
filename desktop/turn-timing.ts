/** What one answer's tool loop did: Mowr's steps (each a CLI run or turn), Kinetra calls run, and broken requests sent
 *  back for correction. `cliSteps`/`cliCalls`: the CLI's own model steps that asked for tools and every tool call in
 *  them, its file tools included (desktop/tool-status.ts StepCounter). `continued`: the answer went on the chat's kept
 *  CLI session (desktop/chat-sessions.ts), so the conversation so far was not sent again. */
export type TurnStats = { steps: number; calls: number; broken: number; cliSteps?: number; cliCalls?: number; continued?: boolean };

/**
 * Console timings for one answer, to measure speed work before and after a change. Only the provider, counts and
 * milliseconds are logged: never the prompt, the reply or the account.
 */
export function turnTimer(provider: string) {
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
      console.log(`[mowr timing] ${provider} ${outcome} first-text=${first ? ms(first) : "none"} total=${ms(performance.now())} steps=${stats.steps} calls=${stats.calls} broken=${stats.broken} cli-steps=${stats.cliSteps || 0} cli-calls=${stats.cliCalls || 0}${stats.cliSteps ? ` per-step=${((stats.cliCalls || 0) / stats.cliSteps).toFixed(1)}` : ""} session=${stats.continued ? "continued" : "new"}`);
    },
  };
}
