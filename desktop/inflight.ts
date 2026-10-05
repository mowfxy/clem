/**
 * Work an answer started that may still be running when the answer stops. A stopped answer waits for it (`stop`) before
 * undoing what the answer did, and from then on every job sees `stopped`, so a file finishing late can neither
 * overwrite the restored file nor be left behind.
 */
export function inflight() {
  const running = new Set<Promise<unknown>>();
  let stopped = false;
  return {
    get stopped() { return stopped; },
    /** Runs `job`, which is told (through its `cancelled` check) once the answer stops. */
    run<T>(job: (cancelled: () => boolean) => Promise<T>, cancelled: () => boolean = () => false): Promise<T> {
      const promise = job(() => stopped || cancelled());
      running.add(promise);
      void promise.catch(() => {}).finally(() => running.delete(promise));
      return promise;
    },
    /** Marks the answer stopped and waits until every job it started has settled. */
    async stop() {
      stopped = true;
      while (running.size) await Promise.allSettled([...running]);
    },
  };
}

/**
 * Chats answering now, and which of them the person stopped. A Stop counts only for an answer that is running (one
 * pressed after it ended is ignored), and `end` forgets both, so neither set outlives its answers.
 */
export function stoppedRuns() {
  const running = new Set<string>(), stopped = new Set<string>();
  return {
    start(id: string) { running.add(id); },
    /** Marks a running answer stopped; false when no such answer is running. */
    add(id: string) { if (!running.has(id)) return false; stopped.add(id); return true; },
    has(id: string) { return stopped.has(id); },
    end(id: string) { running.delete(id); stopped.delete(id); },
    get size() { return running.size + stopped.size; },
  };
}
