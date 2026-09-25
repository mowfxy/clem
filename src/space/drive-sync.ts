/** Keeping a subject or project in step with a Google Drive folder: list what is there (including
 *  subfolders), fetch what is new or changed, and send Mowr-made files back. */

export type DriveEntry = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string };
const FOLDER = "application/vnd.google-apps.folder";
const GOOGLE_DOCS = new Set(["application/vnd.google-apps.document", "application/vnd.google-apps.spreadsheet", "application/vnd.google-apps.presentation"]);
const READABLE = /\.(pdf|docx|pptx|xlsx|txt|md|csv|json|tex|png|jpe?g|webp)$/i;

export const isFolder = (f: DriveEntry) => f.mimeType === FOLDER;
/** Documents Mowr can read: PDFs, Office files, Google Docs/Sheets/Slides, text and pictures. */
export const syncable = (f: DriveEntry) => !isFolder(f) && (GOOGLE_DOCS.has(f.mimeType) || READABLE.test(f.name) || f.mimeType === "application/pdf") && Number(f.size || 0) <= 30_000_000;

async function json<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(body.error || "Google Drive is unavailable.");
  return body as T;
}

/** Every syncable file in the folder and its subfolders (up to three levels, 300 files). */
export async function listFolder(folderId: string, depth = 0, out: DriveEntry[] = []): Promise<DriveEntry[]> {
  let page: string | undefined;
  do {
    const data = await json<{ files: DriveEntry[]; nextPageToken?: string }>(`/api/drive/files?folder=${encodeURIComponent(folderId)}${page ? "&page=" + encodeURIComponent(page) : ""}`);
    for (const f of data.files) {
      if (out.length >= 300) return out;
      if (isFolder(f)) { if (depth < 2) await listFolder(f.id, depth + 1, out); }
      else if (syncable(f)) out.push(f);
    }
    page = data.nextPageToken;
  } while (page && out.length < 300);
  return out;
}

export async function downloadEntry(f: DriveEntry): Promise<File> {
  const r = await fetch(`/api/drive/file/${f.id}`);
  if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || `Could not download ${f.name}.`);
  const blob = await r.blob();
  return new File([blob], decodeURIComponent(r.headers.get("X-Mowr-File-Name") || encodeURIComponent(f.name)), { type: blob.type });
}

/** Saves a file into the linked Drive folder (Mowr only ever creates new files there). */
export async function uploadToFolder(folderId: string, blob: Blob, name: string) {
  const r = await fetch(`/api/drive/upload?folder=${encodeURIComponent(folderId)}&name=${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(body.error || "Could not save to Google Drive.");
  return body as { id: string };
}

/** Which entries are new or changed since the last sync. */
export function changes(entries: DriveEntry[], known: Record<string, { fileId: string; modified: string }>) {
  const added: DriveEntry[] = [], updated: DriveEntry[] = [];
  for (const e of entries) {
    const seen = known[e.id];
    if (!seen) added.push(e);
    else if (e.modifiedTime && seen.modified !== e.modifiedTime) updated.push(e);
  }
  return { added, updated };
}
