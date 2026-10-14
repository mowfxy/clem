import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";

/** What one paste may bring in: as many files as the attach button takes, each as large as an upload may be. */
const MAX_FILES = 20, MAX_FILE = 300_000_000, MAX_TOTAL = 600_000_000;

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", heic: "image/heic", heif: "image/heif",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", json: "application/json", html: "text/html", htm: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", doc: "application/msword", ppt: "application/vnd.ms-powerpoint", xls: "application/vnd.ms-excel",
  zip: "application/zip", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", mov: "video/quicktime",
};
export const fileType = (name: string) => TYPES[extname(name).slice(1).toLowerCase()] || "application/octet-stream";

/** The paths of the files on the clipboard (Windows' file drop list, which is what Copy in File Explorer puts there). */
export function clipboardPaths(): Promise<string[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Format FileDropList | ForEach-Object { $_.FullName }"],
      { windowsHide: true, timeout: 10_000, encoding: "utf8", maxBuffer: 1_000_000 },
      (error, out) => resolve(error ? [] : String(out).split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
  });
}

/**
 * The files copied in File Explorer, read so a Ctrl+V in the chat attaches them as the attach button would. Folders
 * and anything too large are left out; nothing is read but what the person copied.
 */
export async function clipboardFiles() {
  const files: { name: string; type: string; bytes: Uint8Array }[] = [];
  let total = 0;
  for (const path of (await clipboardPaths()).slice(0, MAX_FILES)) {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size > MAX_FILE || total + info.size > MAX_TOTAL) continue;
    const bytes = await readFile(path).catch(() => null);
    if (!bytes) continue;
    total += bytes.byteLength;
    files.push({ name: basename(path), type: fileType(path), bytes: new Uint8Array(bytes) });
  }
  return files;
}
