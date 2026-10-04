/** What one answer's tool loop did: model steps, tool calls run, and broken requests sent back for correction. */
export type TurnStats = { steps: number; calls: number; broken: number };

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
      console.log(`[mowr timing] ${provider} ${outcome} first-text=${first ? ms(first) : "none"} total=${ms(performance.now())} steps=${stats.steps} calls=${stats.calls} broken=${stats.broken}`);
    },
  };
}
