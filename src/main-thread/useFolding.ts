import { useEffect, useRef } from "react";
import type { Chat } from "../../core/types";
import { planFolds, type FoldJob } from "../../core/main-thread/fold";

/** How long Clem waits with nothing answering before it folds the main thread's older messages. */
export const FOLD_IDLE_MS = 20_000;

/**
 * The main thread's rolling summary, kept in the background: once nothing has been answering for FOLD_IDLE_MS, the next
 * fold (core/main-thread/fold.ts) goes to the organizer model, one at a time, never inside a reply. A fold that fails
 * waits for the thread to change before it is tried again.
 */
export function useFolding({ enabled, idle, thread, summarize, apply }: { enabled: boolean; idle: boolean; thread: Chat | undefined; summarize: (job: FoldJob, signal: AbortSignal) => Promise<string>; apply: (job: FoldJob, summary: string) => void }) {
  const live = useRef({ summarize, apply });
  live.current = { summarize, apply };
  const busy = useRef(false);
  const count = thread?.messages.length ?? 0;
  useEffect(() => {
    if (!enabled || !idle || !thread || busy.current) return;
    const job = planFolds(thread.messages)[0];
    if (!job) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      busy.current = true;
      void live.current.summarize(job, controller.signal)
        .then((summary) => { if (!controller.signal.aborted) live.current.apply(job, summary); })
        .catch(() => { /* Tried again when the thread changes. */ })
        .finally(() => { busy.current = false; });
    }, FOLD_IDLE_MS);
    return () => { clearTimeout(timer); if (!busy.current) controller.abort(); };
  }, [enabled, idle, thread?.id, count]);
}
