import { watch, type FSWatcher } from "node:fs";
import { basename, extname } from "node:path";
import { safeName, supportedText, type Folder, type IndexedFile } from "./folders.ts";

import type { FolderDelta, FolderEvent } from "./contracts.ts";
export type { FolderDelta, FolderEvent };

/** Compares two indexes by content hash; a touched file with identical text is not a change. */
export function diffIndex(before: IndexedFile[], after: IndexedFile[]): FolderDelta {
  const old = new Map(before.map((f) => [f.path, f.hash])), now = new Map(after.map((f) => [f.path, f.hash]));
  const added: string[] = [], changed: string[] = [], removed: string[] = [];
  for (const [path, hash] of now) { const was = old.get(path); if (was === undefined) added.push(path); else if (was !== hash) changed.push(path); }
  for (const path of old.keys()) if (!now.has(path)) removed.push(path);
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

/** Whether a path reported by the file system could affect the index at all. */
export function relevant(relativePath: string) {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => !safeName(p))) return false;
  const ext = extname(parts[parts.length - 1]).toLowerCase();
  // Directory events (no extension) may hide deletions of indexed files beneath them.
  return !ext || supportedText.has(ext);
}

const QUIET = 1500;
/** A watched folder's index is used without walking the folder again for this long after it was last read. */
const SETTLED_MS = 10 * 60_000;
type Entry = { folder: Folder; watcher?: FSWatcher; timer?: NodeJS.Timeout; baseline?: IndexedFile[]; at?: number; checking?: boolean; silent?: boolean; running?: Promise<void> };

/**
 * Watches linked folders and reports text files that changed outside Clem.
 * Each folder keeps its own baseline, so chat retrieval refreshing the shared index cache
 * never hides a change from the watcher. Changes Clem applies itself are absorbed silently.
 */
export class FolderWatcher {
  private live = new Map<string, Entry>();
  private index: (folder: Folder, previous: IndexedFile[]) => Promise<IndexedFile[]>;
  private emit: (event: FolderEvent) => void;
  private open: (path: string, listener: (event: string, name: string | null) => void) => FSWatcher;
  constructor(
    index: (folder: Folder, previous: IndexedFile[]) => Promise<IndexedFile[]>,
    emit: (event: FolderEvent) => void,
    open: (path: string, listener: (event: string, name: string | null) => void) => FSWatcher = (path, listener) => watch(path, { recursive: true }, listener),
  ) { this.index = index; this.emit = emit; this.open = open; }

  /** Starts watching folders that are new, and stops watching ones that were unlinked. */
  sync(folders: Folder[]) {
    const wanted = new Map(folders.map((f) => [f.id, f]));
    for (const [id, entry] of this.live) if (!wanted.has(id) || wanted.get(id)!.path !== entry.folder.path) this.close(id);
    for (const folder of folders) if (!this.live.has(folder.id)) this.start(folder);
  }

  watching() { return [...this.live.keys()]; }

  /** The index of a watched folder when no change is waiting to be read and it is recent, so a request can use it
   *  instead of walking the folder again; undefined otherwise. */
  settled(folderId: string, path: string) {
    const entry = this.live.get(folderId);
    return entry && entry.folder.path === path && entry.baseline && !entry.timer && !entry.checking && Date.now() - (entry.at || 0) < SETTLED_MS ? entry.baseline : undefined;
  }

  /** A request walked a watched folder itself: an unchanged index keeps the baseline current, a changed one is
   *  left to a check so the watcher still reports it. */
  refresh(folderId: string, path: string, files: IndexedFile[]) {
    const entry = this.live.get(folderId);
    if (!entry || entry.folder.path !== path || entry.timer || entry.checking) return;
    if (!entry.baseline) { entry.baseline = files; entry.at = Date.now(); return; }
    const delta = diffIndex(entry.baseline, files);
    if (delta.added.length + delta.changed.length + delta.removed.length) this.schedule(folderId);
    else entry.at = Date.now();
  }

  private start(folder: Folder) {
    const entry: Entry = { folder };
    this.live.set(folder.id, entry);
    // A failed first read leaves no baseline: the next successful one is adopted without a notice.
    entry.running = this.index(folder, []).then((files) => { entry.baseline = files; entry.at = Date.now(); }).catch(() => {});
    try {
      entry.watcher = this.open(folder.path, (_event, name) => {
        if (name && !relevant(name)) return;
        this.schedule(folder.id);
      });
      entry.watcher.on("error", () => this.close(folder.id));
    } catch {
      // A folder that moved or became unreadable simply is not watched; chat retrieval reports it.
      this.live.delete(folder.id);
    }
  }

  private schedule(id: string, delay = QUIET) {
    const entry = this.live.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => { entry.timer = undefined; void this.check(id); }, delay);
  }

  /** Re-reads the folder after Clem writes to it, updating the baseline without a notice. */
  absorb(folderId: string) {
    const entry = this.live.get(folderId);
    if (!entry) return;
    entry.silent = true;
    this.schedule(folderId, 400);
  }

  async check(id: string) {
    const entry = this.live.get(id);
    if (!entry) return;
    entry.checking = true;
    await entry.running;
    const run = (async () => {
      let next: IndexedFile[];
      try { next = await this.index(entry.folder, entry.baseline || []); } catch { entry.at = 0; return; } finally { entry.checking = false; }
      if (this.live.get(id) !== entry) return;
      if (!entry.baseline) { entry.baseline = next; entry.at = Date.now(); entry.silent = false; return; }
      const delta = diffIndex(entry.baseline, next);
      entry.baseline = next;
      entry.at = Date.now();
      const silent = entry.silent;
      entry.silent = false;
      if (silent || !(delta.added.length + delta.changed.length + delta.removed.length)) return;
      this.emit({ folderId: id, scope: entry.folder.scope, folder: basename(entry.folder.path), added: delta.added.slice(0, 50), changed: delta.changed.slice(0, 50), removed: delta.removed.slice(0, 50) });
    })();
    entry.running = run;
    await run;
  }

  private close(id: string) {
    const entry = this.live.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    try { entry.watcher?.close(); } catch { /* already closed */ }
    this.live.delete(id);
  }

  stop() { for (const id of [...this.live.keys()]) this.close(id); }
}
