// The GUC hub's data: answers from the engine (desktop/engine/guc-read.ts) through src/guc/swr.ts, kept per owner in
// memory and in IndexedDB, so a tab draws its last copy on the first frame and refreshes behind it. A finished sync
// (onGuc "done") refreshes everything on screen.
import { useEffect, useSyncExternalStore } from "react";
import { get, set } from "idb-keyval";
import type { DesktopRequest } from "../../desktop/contracts";
import { desktop } from "../desktop/bridge";
import { storageNamespace } from "../store";
import { Swr, type Entry } from "./swr";

export const gucCache = new Swr({ get: (k) => get("guc-cache:" + k), set: (k, v) => set("guc-cache:" + k, v) });
/** The cache key of a request, for this owner: the same request asked twice is one fetch. */
export const gucKey = (request: DesktopRequest) => storageNamespace() + "|" + JSON.stringify(request);
export const gucAsk = <T,>(request: DesktopRequest): Promise<T> => desktop ? desktop.invoke(request) : Promise.reject(Error("GUC works in the Clem desktop app."));
/** Warms a request that is likely next (a hovered course, a file). */
export const gucPrefetch = (request: DesktopRequest, maxAge?: number) => { if (desktop) void gucCache.prefetch(gucKey(request), () => gucAsk(request), maxAge); };
/** Changes every cached answer of one action at once (optimistic edits, such as marking announcements read). */
export function gucPatch<T>(action: DesktopRequest["action"], change: (data: T) => T) {
  const prefix = storageNamespace() + '|{"action":"' + action + '"';
  for (const key of gucCache.keys()) if (key.startsWith(prefix)) gucCache.mutate<T>(key, (d) => (d === undefined ? d : change(d)));
}

let listening = false;
function listen() {
  if (listening || !desktop?.onGuc) return;
  listening = true;
  desktop.onGuc((p) => { if (p.phase === "done") void gucCache.revalidateAll((k) => k.startsWith(storageNamespace() + "|")); });
}

const none = () => () => {};
/** One engine read: the cached answer at once, refreshed in the background. `null` asks for nothing yet.
 *  `placeholder` shows while a new key has nothing cached (another week of the same timetable). */
export function useGuc<T>(request: DesktopRequest | null, o: { maxAge?: number; placeholder?: T } = {}) {
  const key = request && desktop ? gucKey(request) : "";
  const entry = useSyncExternalStore(key ? (fn) => gucCache.subscribe(key, fn) : none, () => (key ? gucCache.get<T>(key) : undefined)) as Entry<T> | undefined;
  useEffect(() => {
    if (!key || !request) return;
    listen();
    void gucCache.hydrate(key);
    void gucCache.revalidate(key, () => gucAsk<T>(request), o.maxAge ?? 0);
  }, [key]);
  const data = entry?.data ?? o.placeholder;
  return { data, error: entry?.error, loading: !!key && (entry?.loading ?? true), stale: entry?.data === undefined && data !== undefined, reload: () => (key ? gucCache.revalidate(key) : Promise.resolve(undefined)) };
}
