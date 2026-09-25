/** Saving a Mowr-made file back into the Google Drive folder linked to a subject or project. Mowr only ever creates
 *  new files there; reading the folder is live (see src/drive/drive.ts), nothing is downloaded. */
export async function uploadToFolder(folderId: string, blob: Blob, name: string) {
  const r = await fetch(`/api/drive/upload?folder=${encodeURIComponent(folderId)}&name=${encodeURIComponent(name)}`, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Error(body.error || "Could not save to Google Drive.");
  return body as { id: string };
}
