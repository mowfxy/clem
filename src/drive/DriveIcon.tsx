/** File-type marks in the style Drive users know: a coloured tile with a clear white glyph for each kind. */
export type DriveKind = "folder" | "gdoc" | "gsheet" | "gslides" | "gform" | "gdraw" | "pdf" | "word" | "excel" | "powerpoint" | "image" | "video" | "audio" | "archive" | "code" | "text" | "file";

export function driveKindOf(mime: string, name = ""): DriveKind {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (mime === "application/vnd.google-apps.folder") return "folder";
  if (mime === "application/vnd.google-apps.document") return "gdoc";
  if (mime === "application/vnd.google-apps.spreadsheet") return "gsheet";
  if (mime === "application/vnd.google-apps.presentation") return "gslides";
  if (mime === "application/vnd.google-apps.form") return "gform";
  if (mime === "application/vnd.google-apps.drawing") return "gdraw";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (/wordprocessing|msword|opendocument\.text/.test(mime) || /^(docx?|odt|rtf)$/.test(ext)) return "word";
  if (/spreadsheet|ms-excel|csv/.test(mime) || /^(xlsx?|ods|csv|tsv)$/.test(ext)) return "excel";
  if (/presentation|powerpoint/.test(mime) || /^(pptx?|odp|key)$/.test(ext)) return "powerpoint";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (/zip|compressed|x-7z|x-rar|tar|gzip/.test(mime) || /^(zip|rar|7z|tar|gz)$/.test(ext)) return "archive";
  if (/json|javascript|typescript|x-python|x-sh|xml|html|css/.test(mime) || /^(js|ts|tsx|py|java|c|cpp|cs|go|rs|rb|php|html|css|json|xml|yml|yaml|sh|ipynb)$/.test(ext)) return "code";
  if (mime.startsWith("text/") || /^(txt|md|tex|log)$/.test(ext)) return "text";
  return "file";
}

const TILE: Record<DriveKind, string> = {
  folder: "#8a8f98", gdoc: "#4285f4", gsheet: "#0f9d58", gslides: "#f4b400", gform: "#7248b9", gdraw: "#db4437",
  pdf: "#e53935", word: "#2b5fd9", excel: "#1d8a4e", powerpoint: "#d24726", image: "#d93a7a", video: "#e0452f",
  audio: "#8e44c9", archive: "#6d6a63", code: "#3b7c8c", text: "#6f7680", file: "#6f7680",
};

const W = "#fff";
function Glyph({ kind }: { kind: DriveKind }) {
  switch (kind) {
    case "folder": return <path d="M4.5 7.2c0-.9.7-1.6 1.6-1.6h3.6l1.5 1.6h6.7c.9 0 1.6.7 1.6 1.6v7.1c0 .9-.7 1.6-1.6 1.6H6.1c-.9 0-1.6-.7-1.6-1.6z" fill={W} />;
    case "gdoc": case "word": case "text": return <g fill={W}><rect x="7" y="7" width="10" height="1.7" rx=".6" /><rect x="7" y="10.3" width="10" height="1.7" rx=".6" /><rect x="7" y="13.6" width="6.5" height="1.7" rx=".6" /></g>;
    case "gsheet": case "excel": return <g fill="none" stroke={W} strokeWidth="1.6"><rect x="6.5" y="6.5" width="11" height="11" rx="1.2" /><path d="M6.5 10.2h11M6.5 13.8h11M10.5 6.5v11" /></g>;
    case "gslides": case "powerpoint": return <g><rect x="6" y="7.4" width="12" height="9.2" rx="1.3" fill="none" stroke={W} strokeWidth="1.6" /><rect x="8.6" y="10" width="6.8" height="4" rx=".6" fill={W} /></g>;
    case "gform": return <g fill={W}><circle cx="8.4" cy="8.6" r="1.1" /><circle cx="8.4" cy="12" r="1.1" /><circle cx="8.4" cy="15.4" r="1.1" /><rect x="10.6" y="7.9" width="6" height="1.5" rx=".6" /><rect x="10.6" y="11.3" width="6" height="1.5" rx=".6" /><rect x="10.6" y="14.7" width="6" height="1.5" rx=".6" /></g>;
    case "gdraw": return <path d="M7 16.5l1-3.4 6.8-6.8a1.7 1.7 0 012.4 2.4l-6.8 6.8z" fill={W} />;
    case "pdf": return <text x="12" y="14.8" textAnchor="middle" fontFamily="'Segoe UI',Arial,sans-serif" fontWeight="800" fontSize="7.4" fill={W} letterSpacing=".2">PDF</text>;
    case "image": return <g><rect x="6" y="6.6" width="12" height="10.8" rx="1.6" fill="none" stroke={W} strokeWidth="1.6" /><circle cx="9.6" cy="10" r="1.3" fill={W} /><path d="M6.8 16.2l3.6-3.6 2.3 2.2 1.9-1.9 3 3.3z" fill={W} /></g>;
    case "video": return <path d="M9.4 7.6v8.8l7.2-4.4z" fill={W} />;
    case "audio": return <path d="M14.8 6.2v7.6a2.3 2.3 0 11-1.6-2.2V8.3l-4 1v5.9a2.3 2.3 0 11-1.6-2.2V8.1z" fill={W} />;
    case "archive": return <g fill={W}><rect x="11" y="5.5" width="2" height="1.6" /><rect x="11" y="8.3" width="2" height="1.6" /><rect x="11" y="11.1" width="2" height="1.6" /><rect x="10.3" y="13.6" width="3.4" height="4" rx=".8" /></g>;
    case "code": return <path d="M9.6 8.3L6.4 12l3.2 3.7M14.4 8.3l3.2 3.7-3.2 3.7" fill="none" stroke={W} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />;
    default: return <path d="M8 5.8h5.4L17 9.4v8.8H8z" fill="none" stroke={W} strokeWidth="1.6" strokeLinejoin="round" />;
  }
}

/** The badge a file type carries: W, X and P for Office so they read apart from Google's own formats. */
const LETTER: Partial<Record<DriveKind, string>> = { word: "W", excel: "X", powerpoint: "P" };

export function DriveIcon({ mime, name = "", size = 28 }: { mime: string; name?: string; size?: number }) {
  const kind = driveKindOf(mime, name), letter = LETTER[kind];
  return <svg className={"gd-icon gd-" + kind} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill={TILE[kind]} />
    <rect x="1.5" y="1.5" width="21" height="10.5" rx="6" fill="#fff" opacity=".09" />
    {letter ? <text x="12" y="16.4" textAnchor="middle" fontFamily="'Segoe UI',Arial,sans-serif" fontWeight="800" fontSize="11.5" fill={W}>{letter}</text> : <Glyph kind={kind} />}
  </svg>;
}

export const kindName = (mime: string, name = "") => ({
  folder: "Folder", gdoc: "Google Doc", gsheet: "Google Sheet", gslides: "Google Slides", gform: "Google Form", gdraw: "Google Drawing", pdf: "PDF",
  word: "Word document", excel: "Spreadsheet", powerpoint: "Presentation", image: "Image", video: "Video", audio: "Audio", archive: "Archive", code: "Code", text: "Text", file: "File",
} as Record<DriveKind, string>)[driveKindOf(mime, name)];
