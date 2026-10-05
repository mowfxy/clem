import { lstat, readFile, realpath, rename, rm, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, extname, isAbsolute, join, normalize, sep } from "node:path";
import { ignoredIn, inside, safeName, supportedText, type Folder } from "./folders.ts";
import { applyEdit, diffStats, lineDiff } from "../core/diff.ts";

/** Approved changes to files inside linked folders, with a local undo history.
 *  Paths are always relative to a folder the person linked for this scope. */
export type Change = { id: string; scope: string; folderId: string; path: string; before: string | null; after: string; afterHash: string; at: number; summary: string; added: number; removed: number; undone?: boolean };
const LIMIT = 256_000;
export const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function cleanRelative(path: string) {
  const trimmed = path.trim().replace(/^(?:\.[\\/])+/, "");
  if (!trimmed || isAbsolute(path) || /^[a-z]:/i.test(path)) throw Error("Use a path inside a linked folder.");
  const parts = normalize(trimmed).split(/[\\/]+/).filter(Boolean);
  if (!parts.length || parts.some((p) => p === ".." || !safeName(p))) throw Error("This path is outside what Mowr may change.");
  if (!supportedText.has(extname(parts[parts.length - 1]).toLowerCase())) throw Error("Mowr only changes text and code files it can index.");
  return parts;
}

/** The real location of the nearest folder on the way to `path` that already exists, so a new file never lands
 *  outside the linked folder through a symbolic link or junction inside it. */
async function existingAncestor(path: string): Promise<string> {
  for (let at = path; ; at = dirname(at)) {
    const real = await realpath(at).catch(() => null);
    if (real) return real;
    if (dirname(at) === at) return at;
  }
}

/** Finds the one linked folder that holds `path`. New files are allowed only when a single folder is linked.
 *  Files the folder's .gitignore or .mowrignore leave out of the index are out of reach here too. */
export async function locate(folders: Folder[], path: string, create = false) {
  const parts = cleanRelative(path);
  const matches: { folder: Folder; absolute: string; exists: boolean }[] = [];
  for (const folder of folders) {
    const root = await realpath(folder.path).catch(() => null);
    if (!root || root !== folder.path) continue;
    // Models sometimes start the path with the folder's own name ("project/src/a.ts" in the folder "project"). The path
    // as written comes first, so a subfolder with the folder's name ("src/src/…") is never skipped over.
    const base = root.split(sep).pop()!.toLowerCase();
    const readings = parts.length > 1 && parts[0].toLowerCase() === base ? [parts, parts.slice(1)] : [parts];
    let found: { absolute: string; exists: boolean } | undefined;
    for (const rel of readings) {
      const absolute = join(root, ...rel);
      if (!inside(root, absolute) || await ignoredIn(root, rel)) continue;
      const stat = await lstat(absolute).catch(() => null);
      if (stat) {
        if (stat.isSymbolicLink() || !stat.isFile() || !inside(root, await realpath(absolute))) continue;
        found = { absolute, exists: true };
        break;
      }
    }
    if (!found && create) {
      // A new file goes where the path as written leads when its first folder exists there, else under the folder itself.
      const rel = readings.length > 1 && !(await lstat(join(root, parts[0])).catch(() => null))?.isDirectory() ? readings[1] : readings[0];
      const absolute = join(root, ...rel);
      if (inside(root, absolute) && !(await ignoredIn(root, rel)) && inside(root, await existingAncestor(dirname(absolute)))) found = { absolute, exists: false };
    }
    if (found) matches.push({ folder, ...found });
  }
  const existing = matches.filter((m) => m.exists);
  if (existing.length === 1) return existing[0];
  if (existing.length > 1) throw Error("Two linked folders contain this path. Unlink one or name the folder.");
  const fresh = matches.filter((m) => !m.exists);
  if (create && fresh.length === 1) return fresh[0];
  throw Error(create && fresh.length > 1 ? "Several folders are linked. Name the folder for a new file." : "That file is not in a linked folder for this conversation.");
}

export async function readText(absolute: string) {
  const stat = await lstat(absolute);
  if (stat.size > LIMIT) throw Error("This file is too large to change here (256 KB maximum).");
  const text = await readFile(absolute, "utf8");
  if (text.includes("\0")) throw Error("This file is not plain text.");
  return text;
}

async function writeAtomic(absolute: string, text: string) {
  if (Buffer.byteLength(text) > LIMIT) throw Error("The changed file would exceed 256 KB.");
  await mkdir(dirname(absolute), { recursive: true });
  const temp = absolute + ".mowr-" + randomUUID().slice(0, 8) + ".tmp";
  await writeFile(temp, text, { encoding: "utf8", flag: "wx" });
  try { await rename(temp, absolute); } catch (e) { await rm(temp, { force: true }); throw e; }
}

/** `base`: the SHA-256 of the file as the person reviewed the change (null: it did not exist yet). When given, the change
 *  is refused if the file is different now, so an approval never overwrites work the person did not see in the diff. */
export async function applyChange(folders: Folder[], scope: string, edit: { path: string; find?: string; replace?: string; content?: string; summary?: string; base?: string | null }): Promise<Change> {
  const target = await locate(folders, edit.path, edit.content !== undefined);
  const before = target.exists ? await readText(target.absolute) : null;
  if (edit.base !== undefined && (before === null ? null : sha(before)) !== edit.base) throw Error("The file changed since this change was shown, so it was not applied. Review the updated change and apply it again.");
  const after = applyEdit(before ?? "", edit);
  if (after === before) throw Error("This change would not alter the file.");
  await writeAtomic(target.absolute, after);
  const stats = diffStats(lineDiff(before ?? "", after));
  return { id: randomUUID(), scope, folderId: target.folder.id, path: edit.path, before, after, afterHash: sha(after), at: Date.now(), summary: (edit.summary || "").slice(0, 200), ...stats };
}

/** Restores the previous content, refusing if the file changed after Mowr wrote it. */
export async function undoChange(folders: Folder[], change: Change) {
  if (change.undone) throw Error("This change was already undone.");
  const folder = folders.find((f) => f.id === change.folderId);
  if (!folder) throw Error("The folder for this change is no longer linked.");
  const target = await locate([folder], change.path, true);
  const current = target.exists ? await readText(target.absolute) : null;
  if (current === null || sha(current) !== change.afterHash) throw Error("The file changed after this edit. Undo would overwrite newer work, so it was not applied.");
  if (change.before === null) await rm(target.absolute);
  else await writeAtomic(target.absolute, change.before);
}
