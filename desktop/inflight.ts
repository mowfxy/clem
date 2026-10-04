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
