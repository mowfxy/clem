// Exactly one engine runs Clem's jobs (docs/GUC-VPS-ENGINE.md "Single runner"). The lease lives in the worker's
// database; each side steps it about once a minute. The worker is preferred: a desktop holding the lease hands it back
// once the worker is seen alive, and takes it over only when the worker's heartbeat is older than STALE_MS. Pure.

export const STALE_MS = 10 * 60_000;
export const BEAT_MS = 60_000;
export type Runner = "desktop" | "worker";
export type Lease = { holder: Runner | null; epoch: number; renewed: number; seen: Partial<Record<Runner, number>> };
export const emptyLease = (): Lease => ({ holder: null, epoch: 0, renewed: 0, seen: {} });

/** One heartbeat from `who`: the new lease and whether `who` runs jobs until its next beat. */
export function step(lease: Lease | null, who: Runner, now: number): { lease: Lease; run: boolean } {
  const l: Lease = { ...(lease || emptyLease()), seen: { ...(lease?.seen || {}), [who]: now } };
  const take = (): { lease: Lease; run: boolean } => ({ lease: { ...l, holder: who, epoch: l.epoch + 1, renewed: now }, run: true });
  const stale = now - l.renewed > STALE_MS;
  if (who === "worker") {
    if (l.holder === "worker") return { lease: { ...l, renewed: now }, run: true };
    // The desktop holds it and is alive: it hands back on its next beat, since it now sees the worker.
    if (l.holder === "desktop" && !stale) return { lease: l, run: false };
    return take();
  }
  const workerAlive = now - (l.seen.worker || 0) <= STALE_MS;
  if (l.holder === "desktop") return workerAlive ? { lease: { ...l, holder: "worker", epoch: l.epoch + 1, renewed: l.seen.worker! }, run: false } : { lease: { ...l, renewed: now }, run: true };
  if (l.holder === "worker") return stale ? take() : { lease: l, run: false };
  return workerAlive ? { lease: l, run: false } : take();
}

/** The desktop can't reach the worker: it runs jobs itself once the last heartbeat it saw is stale. */
export const desktopRunsOffline = (lastRenewed: number, now: number) => now - lastRenewed > STALE_MS;
