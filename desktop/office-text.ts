import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

/**
 * The text of a Word, PowerPoint or Excel file, read here so every AI can read and search it from its working folder
 * (desktop/ai-workspace.ts _text/). No CLI here opens Office files itself; the window reads them the same way
 * (src/office.ts) for the files of a conversation, but the working folder holds all of the person's files.
 */
const MAX_CHARS = 4_000_000;
const MAX_UNZIPPED = 300_000_000;

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : entities[e.toLowerCase()]);

/** Paragraphs of WordprocessingML or DrawingML, one per line: runs joined, tabs and breaks kept. */
function paragraphs(xml: string, tag: "w" | "a") {
  const out: string[] = [];
  for (const p of xml.split(new RegExp(`</${tag}:p>`))) {
    let line = "";
    for (const m of p.matchAll(new RegExp(`<${tag}:t(?:\\s[^>]*)?>([^<]*)</${tag}:t>|<${tag}:(tab|br)\\b[^>]*/>`, "g"))) line += m[1] !== undefined ? decode(m[1]) : m[2] === "tab" ? "\t" : "\n";
    if (line.trim()) out.push(line.trimEnd());
  }
  return out.join("\n");
}

const numbered = (files: Record<string, Uint8Array>, pattern: RegExp) =>
  Object.keys(files).filter((k) => pattern.test(k)).sort((a, b) => Number(pattern.exec(a)![1]) - Number(pattern.exec(b)![1]));

function docx(files: Record<string, Uint8Array>, name: string) {
  const body = files["word/document.xml"];
  if (!body) throw Error("not a Word document");
  const parts = [paragraphs(strFromU8(body), "w")];
  for (const key of ["word/footnotes.xml", "word/endnotes.xml"]) if (files[key]) { const notes = paragraphs(strFromU8(files[key]), "w"); if (notes.trim()) parts.push(`[${name}, ${key.includes("foot") ? "footnotes" : "endnotes"}]\n${notes}`); }
  return parts.join("\n\n");
}

function pptx(files: Record<string, Uint8Array>, name: string) {
  const slides = numbered(files, /^ppt\/slides\/slide(\d+)\.xml$/);
  if (!slides.length) throw Error("not a PowerPoint deck");
  return slides.map((key, i) => {
    const n = /(\d+)\.xml$/.exec(key)![1];
    const notes = files[`ppt/notesSlides/notesSlide${n}.xml`];
    const noteText = notes ? paragraphs(strFromU8(notes), "a").split("\n").filter((l) => !/^\d+$/.test(l.trim())).join("\n") : "";
    return `[${name}, slide ${i + 1}]\n${paragraphs(strFromU8(files[key]), "a")}${noteText.trim() ? `\nSpeaker notes: ${noteText}` : ""}`;
  }).join("\n\n");
}

function xlsx(files: Record<string, Uint8Array>, name: string) {
  const sheets = numbered(files, /^xl\/worksheets\/sheet(\d+)\.xml$/);
  if (!sheets.length) throw Error("not an Excel workbook");
  const shared = files["xl/sharedStrings.xml"] ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([^]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decode(t[1])).join("")) : [];
  const names = files["xl/workbook.xml"] ? [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decode(m[1])) : [];
  return sheets.map((key, i) => {
    const rows: string[] = [];
    for (const row of strFromU8(files[key]).matchAll(/<row\b[^>]*>([^]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([^]*?)<\/c>)/g)) {
        const ref = /\br="([A-Z]+)\d+"/.exec(c[1])?.[1];
        const type = /\bt="(\w+)"/.exec(c[1])?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(c[2] || "")?.[1];
        const text = type === "s" && v !== undefined ? shared[Number(v)] ?? "" : type === "inlineStr" ? [...(c[2] || "").matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decode(t[1])).join("") : v !== undefined ? decode(v) : "";
        // Cells keep their column, so a row with gaps still lines up with its header.
        if (ref) { const col = [...ref].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1; while (cells.length < col) cells.push(""); }
        cells.push(text.replace(/[\t\r\n]+/g, " "));
      }
      if (cells.some((c) => c.trim())) rows.push(cells.join("\t").trimEnd());
    }
    return `[${name}, sheet "${names[i] || `Sheet ${i + 1}`}"]\n${rows.join("\n")}`;
  }).join("\n\n");
}

/** The readable text of an Office file on disk; a short note instead when it has none or cannot be read. */
export async function officeText(path: string, name: string) {
  const kind = /\.(docx|pptx|xlsx)$/i.exec(name)?.[1].toLowerCase();
  if (!kind) return "";
  try {
    let total = 0;
    const files = unzipSync(new Uint8Array(await readFile(path)), {
      filter: (f) => {
        const wanted = kind === "docx" ? /^word\/(document|footnotes|endnotes)\.xml$/ : kind === "pptx" ? /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/ : /^xl\/(worksheets\/sheet\d+|sharedStrings|workbook)\.xml$/;
        if (!wanted.test(f.name)) return false;
        total += f.originalSize;
        if (total > MAX_UNZIPPED) throw Error("too large to read");
        return true;
      },
    });
    const text = kind === "docx" ? docx(files, name) : kind === "pptx" ? pptx(files, name) : xlsx(files, name);
    if (!text.trim()) return `[${name}: no text could be read from this file.]`;
    return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + `\n[${name}: the text continues past ${MAX_CHARS.toLocaleString("en")} characters and is cut here.]` : text;
  } catch (error) {
    return `[${name}: its text could not be read (${(error as Error).message}).]`;
  }
}
