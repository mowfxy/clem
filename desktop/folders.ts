import { opendir, lstat, readFile, realpath } from "node:fs/promises";
import { relative, resolve, join, extname, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import ignore, { type Ignore } from "ignore";

const ignored = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  "windows",
  "program files",
  "appdata",
]);
export const supportedText = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".ts",
  ".tsx",
  ".js",
  ".py",
  ".css",
  ".html",
]);
export function inside(root: string, path: string) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
export function safeName(name: string) {
  return (
    !name.startsWith(".") &&
    !ignored.has(name.toLowerCase()) &&
    !/(secret|credential|password|token|private.?key|\.pem$|\.key$)/i.test(name)
  );
}
export type Folder = { id: string; scope: string; path: string };
/** Whether the .gitignore and .mowrignore files on the way to `parts` (a path inside `root`) leave it out, as indexing
 *  does: a file left out of the index is never read for or changed by an edit either. */
export async function ignoredIn(root: string, parts: string[]) {
  for (let depth = 0; depth < parts.length; depth++) {
    const dir = join(root, ...parts.slice(0, depth));
    for (const filename of [".gitignore", ".mowrignore"]) {
      const file = join(dir, filename);
      const stat = await lstat(file).catch(() => null);
      if (!stat || stat.isSymbolicLink() || stat.size >= 64000) continue;
      const rules = ignore().add(await readFile(file, "utf8"));
      // Every folder on the way counts as well as the file itself ("build/" leaves out all of build).
      for (let k = depth + 1; k <= parts.length; k++) {
        const rel = parts.slice(depth, k).join("/") + (k < parts.length ? "/" : "");
        if (rules.ignores(rel)) return true;
      }
    }
  }
  return false;
}
export type IndexedFile = {
  path: string;
  mtime: number;
  size: number;
  hash: string;
  text: string;
};
export async function link(path: string, scope: string): Promise<Folder> {
  const canonical = await realpath(path);
  if ((await lstat(path)).isSymbolicLink())
    throw Error("Link the actual folder, not a shortcut or symbolic link.");
  return { id: randomUUID(), scope, path: canonical };
}
/** Whether two indexes list the same files at the same versions, so an unchanged index is not written again. */
export function sameIndex(a: IndexedFile[], b: IndexedFile[]) {
  return a.length === b.length && a.every((f, i) => f.path === b[i].path && f.hash === b[i].hash && f.mtime === b[i].mtime && f.size === b[i].size);
}
/** Full bounded traversal discovers deletions; unchanged file content is reused. */
export async function indexFolder(
  folder: Folder,
  previous: IndexedFile[] = [],
  signal?: AbortSignal,
) {
  const root = await realpath(folder.path);
  if (root !== folder.path)
    throw Error("Folder location changed. Link it again.");
  const old = new Map(previous.map((file) => [file.path, file])),
    files: IndexedFile[] = [];
  let visited = 0,
    total = 0;
  async function walk(
    dir: string,
    depth: number,
    inherited: { base: string; rules: Ignore }[] = [],
  ) {
    const rules = [...inherited];
    for (const filename of [".gitignore", ".mowrignore"]) {
      try {
        const file = join(dir, filename),
          stat = await lstat(file);
        if (!stat.isSymbolicLink() && stat.size < 64000)
          rules.push({
            base: dir,
            rules: ignore().add(await readFile(file, "utf8")),
          });
      } catch {
        // Missing, or unreadable (permissions, a file locked by another program): the folder is indexed without it.
      }
    }
    if (depth > 12) throw Error("Folder nesting exceeds the indexing limit.");
    for await (const entry of await opendir(dir)) {
      signal?.throwIfAborted();
      if (++visited > 10000)
        throw Error("Choose a smaller folder (10,000 entries maximum).");
      if (!safeName(entry.name) || entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name),
        canonical = await realpath(path);
      if (
        rules.some((rule) =>
          rule.rules.ignores(
            relative(rule.base, path).replaceAll("\\", "/") +
              (entry.isDirectory() ? "/" : ""),
          ),
        )
      )
        continue;
      if (!inside(root, canonical)) continue;
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(path, depth + 1, rules);
        continue;
      }
      if (
        !stat.isFile() ||
        !supportedText.has(extname(path).toLowerCase()) ||
        stat.size > 256000
      )
        continue;
      total += stat.size;
      if (total > 8_000_000)
        throw Error("Choose a smaller folder (8 MB of indexed text maximum).");
      const name = relative(root, path),
        cached = old.get(name);
      if (
        cached &&
        cached.mtime === stat.mtimeMs &&
        cached.size === stat.size &&
        Date.now() - stat.mtimeMs > 2000
      ) {
        files.push(cached);
        continue;
      }
      const text = await readFile(path, "utf8");
      if (text.includes("\0")) continue;
      files.push({
        path: name,
        mtime: stat.mtimeMs,
        size: stat.size,
        hash: createHash("sha256").update(text).digest("hex"),
        text,
      });
    }
  }
  await walk(root, 0);
  return files;
}
export function retrieveFiles(
  files: IndexedFile[],
  query: string,
  budget = 16000,
) {
  const terms = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []),
  ];
  const ranked = files
    .map((file) => ({
      file,
      score: terms.reduce(
        (n, t) =>
          n +
          (file.path.toLowerCase().includes(t) ? 4 : 0) +
          (file.text.toLowerCase().includes(t) ? 1 : 0),
        0,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  let used = 0;
  const hashes = new Set<string>();
  return ranked.flatMap(({ file }) => {
    if (hashes.has(file.hash) || used >= budget) return [];
    hashes.add(file.hash);
    const text = file.text.slice(0, Math.min(4000, budget - used));
    used += text.length;
    return [{ source: file.path, sha256: file.hash, text }];
  });
}
