// A tiny stale-while-revalidate cache for the GUC hub: what was last seen shows at once (from memory, else from a saved
// copy), a fetch refreshes it in the background, and two asks for the same key share one fetch. No React, no storage
// of its own: src/guc/useGuc.ts gives it idb-keyval per owner. Tested in tests/guc-hub.test.ts.

export type Persist = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
export type Entry<T> = { data?: T; at: number; error?: string; loading: boolean };

export class Swr {
  private entries = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();
  private fetchers = new Map<string, () => Promise<unknown>>();
  private listeners = new Map<string, Set<() => void>>();
  private hydrating = new Map<string, Promise<void>>();
  private persist?: Persist;
  private now: () => number;
  constructor(persist?: Persist, now = () => Date.now()) { this.persist = persist; this.now = now; }

  get<T>(key: string) { return this.entries.get(key) as Entry<T> | undefined; }
  subscribe(key: string, fn: () => void) {
    const set = this.listeners.get(key) || new Set();
    set.add(fn); this.listeners.set(key, set);
    return () => { set.delete(fn); if (!set.size) this.listeners.delete(key); };
  }
  private put(key: string, next: Partial<Entry<unknown>>) {
    this.entries.set(key, { at: 0, loading: false, ...this.entries.get(key), ...next });
    this.listeners.get(key)?.forEach((fn) => fn());
  }

  /** Brings the saved copy into memory once; memory that is already newer wins. */
  hydrate(key: string) {
    if (!this.persist || this.entries.get(key)?.data !== undefined) return Promise.resolve();
    let job = this.hydrating.get(key);
    if (!job) {
      job = this.persist.get(key).then((saved) => {
        const s = saved as { data: unknown; at: number } | undefined;
        if (s && s.data !== undefined && (this.entries.get(key)?.at || 0) < s.at) this.put(key, { data: s.data, at: s.at });
      }, () => {});
      this.hydrating.set(key, job);
    }
    return job;
  }

  /** Fetches now unless the same key is already being fetched, or (with `maxAge`) what is here is newer than that.
   *  A failed fetch keeps the old data and records the error. */
  revalidate<T>(key: string, fetcher?: () => Promise<T>, maxAge = 0): Promise<T | undefined> {
    if (fetcher) this.fetchers.set(key, fetcher);
    const run = this.fetchers.get(key) as (() => Promise<T>) | undefined;
    if (!run) return Promise.resolve(this.get<T>(key)?.data);
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const have = this.get<T>(key);
    if (maxAge && have?.data !== undefined && !have.error && this.now() - have.at < maxAge) return Promise.resolve(have.data);
    this.put(key, { loading: true });
    const job = run().then(
      (data) => { const at = this.now(); this.put(key, { data, at, error: undefined, loading: false }); void this.persist?.set(key, { data, at }).catch(() => {}); return data; },
      (e) => { this.put(key, { error: String((e as Error)?.message || e), loading: false }); return this.get<T>(key)?.data; },
    ).finally(() => this.inflight.delete(key));
    this.inflight.set(key, job);
    return job;
  }

  /** Changes what is shown now (optimistic), and keeps it. */
  mutate<T>(key: string, change: (data: T | undefined) => T | undefined) {
    const data = change(this.get<T>(key)?.data);
    const at = this.now();
    this.put(key, { data, at });
    void this.persist?.set(key, { data, at }).catch(() => {});
  }

  /** Refreshes every key on screen, or those `keep` picks (after a sync, or after an edit that touches several). */
  revalidateAll(keep: (key: string) => boolean = () => true) {
    return Promise.all([...this.listeners.keys()].filter(keep).map((key) => this.revalidate(key)));
  }

  /** Warms a key that is likely next (a hovered course): the saved copy, then a fetch unless fresh. */
  async prefetch<T>(key: string, fetcher: () => Promise<T>, maxAge = 60_000) { await this.hydrate(key); return this.revalidate(key, fetcher, maxAge); }

  keys() { return [...this.entries.keys()]; }
  clear() { this.entries.clear(); this.fetchers.clear(); this.hydrating.clear(); }
}
