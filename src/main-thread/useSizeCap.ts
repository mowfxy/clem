import { useEffect, useRef } from "react";
import type { Chat, StoredFile } from "../../core/types";
import { planTrim, type TrimPlan } from "../../core/main-thread/trim";

/** How long the workspace has to be quiet (no change, nothing answering) before the main thread's size is checked. */
export const SIZE_CHECK_MS = 15_000;

/**
 * The main thread's size cap (core/main-thread/trim.ts), checked in the background: on start, and after changes once the
 * workspace has been quiet for SIZE_CHECK_MS with nothing answering. Over the cap, `trim` gets the plan to apply.
 */
export function useSizeCap({ enabled, idle, read, trim }: { enabled: boolean; idle: boolean; read: () => { chats: Chat[]; files: StoredFile[] } & Record<string, unknown>; trim: (plan: TrimPlan) => void; }, deps: unknown[]) {
  const live = useRef({ read, trim });
  live.current = { read, trim };
  const started = useRef(false);
  useEffect(() => {
    if (!enabled || !idle) return;
    const first = !started.current;
    const timer = setTimeout(() => {
      started.current = true;
      const plan = planTrim(live.current.read());
      if (plan) live.current.trim(plan);
    }, first ? 2_000 : SIZE_CHECK_MS);
    return () => clearTimeout(timer);
  }, [enabled, idle, ...deps]);
}
