/** File-type marks: a tile tinted with the colour Drive users know for each kind, with the kind drawn in the app's line. */
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

// Drawn like the app's icons: an ivory line with round ends on a tile tinted with the kind's colour.
const W = "#f3f2ec";
const line = { fill: "none", stroke: W, strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const soft = { fill: W, fillOpacity: 0.28 };
function Glyph({ kind }: { kind: DriveKind }) {
  switch (kind) {
    case "folder": return <g {...line}><path d="M5 8.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.5h6.5A1.5 1.5 0 0 1 19 10v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 16Z" {...soft} /><path d="M5 11h14" /></g>;
    case "gdoc": case "word": case "text": return <g {...line}><path d="M7.5 5.5h6l3 3v10h-9Z" {...soft} /><path d="M9.5 12h5M9.5 15h3.5" /></g>;
    case "gsheet": case "excel": return <g {...line}><rect x="6" y="6.5" width="12" height="11" rx="1.5" {...soft} /><path d="M6 10.5h12M6 14h12M10.5 6.5v11" /></g>;
    case "gslides": case "powerpoint": return <g {...line}><rect x="5.5" y="6.5" width="13" height="9" rx="1.5" {...soft} /><path d="M12 15.5v3M9.5 18.5h5" /></g>;
    case "gform": return <g {...line}><circle cx="8.5" cy="8.5" r="1.2" {...soft} /><circle cx="8.5" cy="12" r="1.2" {...soft} /><circle cx="8.5" cy="15.5" r="1.2" {...soft} /><path d="M11.5 8.5h5M11.5 12h5M11.5 15.5h3.5" /></g>;
    case "gdraw": return <g {...line}><path d="M7 17l.8-3.2 7-7a1.6 1.6 0 0 1 2.4 2.4l-7 7Z" {...soft} /><path d="M13.5 8l2.5 2.5" /></g>;
    case "pdf": return <g><path d="M7.5 5.5h6l3 3v10h-9Z" {...line} {...soft} /><text x="12" y="15.6" textAnchor="middle" fontFamily="'Mowafy Sans',Arial,sans-serif" fontWeight="800" fontSize="5" fill={W}>PDF</text></g>;
    case "image": return <g {...line}><rect x="5.5" y="6.5" width="13" height="11" rx="2" /><circle cx="9.5" cy="10" r="1.3" {...soft} /><path d="M6 16.5l3.8-3.5 2.4 2 2.2-2 3.6 3.5" /></g>;
    case "video": return <g {...line}><circle cx="12" cy="12" r="6.5" /><path d="M10.5 9.5l4 2.5-4 2.5Z" {...soft} /></g>;
    case "audio": return <g {...line}><path d="M10 16V7.5l7-1.5V14" /><circle cx="8.3" cy="16" r="1.8" {...soft} /><circle cx="15.3" cy="14" r="1.8" {...soft} /></g>;
    case "archive": return <g {...line}><rect x="6.5" y="5.5" width="11" height="13" rx="1.5" {...soft} /><path d="M12 5.5v2M12 9.5v1.5M11 13h2v2.5h-2Z" /></g>;
    case "code": return <g {...line}><path d="M9.5 8.5L6 12l3.5 3.5M14.5 8.5L18 12l-3.5 3.5" /></g>;
    default: return <g {...line}><path d="M7.5 5.5h6l3 3v10h-9Z" {...soft} /><path d="M13.5 5.5v3h3" /></g>;
  }
}

/** The badge a file type carries: W, X and P for Office so they read apart from Google's own formats. */
const LETTER: Partial<Record<DriveKind, string>> = { word: "W", excel: "X", powerpoint: "P" };

export function DriveIcon({ mime, name = "", size = 28 }: { mime: string; name?: string; size?: number }) {
  const kind = driveKindOf(mime, name), letter = LETTER[kind];
  return <svg className={"gd-icon gd-" + kind} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill={TILE[kind]} fillOpacity=".24" stroke={TILE[kind]} strokeOpacity=".55" strokeWidth="1" />
    {letter ? <text x="12" y="16.2" textAnchor="middle" fontFamily="'Mowafy Sans',Arial,sans-serif" fontWeight="800" fontSize="11" fill={W}>{letter}</text> : <Glyph kind={kind} />}
  </svg>;
}

export const kindName = (mime: string, name = "") => ({
  folder: "Folder", gdoc: "Google Doc", gsheet: "Google Sheet", gslides: "Google Slides", gform: "Google Form", gdraw: "Google Drawing", pdf: "PDF",
  word: "Word document", excel: "Spreadsheet", powerpoint: "Presentation", image: "Image", video: "Video", audio: "Audio", archive: "Archive", code: "Code", text: "Text", file: "File",
} as Record<DriveKind, string>)[driveKindOf(mime, name)];
