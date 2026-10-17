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

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
/** A part's relationships (its `_rels/*.rels`): each id and the part it points to, as a path in the package. */
function related(files: Record<string, Uint8Array>, part: string) {
  const dir = part.slice(0, part.lastIndexOf("/") + 1), out = new Map<string, string>();
  const rels = files[`${dir}_rels/${part.slice(dir.length)}.rels`];
  if (!rels) return out;
  for (const [tag] of strFromU8(rels).matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(tag, "Id"), target = attr(tag, "Target");
    if (!id || !target || attr(tag, "TargetMode") === "External") continue;
    const path: string[] = [];
    for (const seg of (target.startsWith("/") ? decode(target).slice(1) : dir + decode(target)).split("/")) { if (seg === "..") path.pop(); else if (seg && seg !== ".") path.push(seg); }
    out.set(id, path.join("/"));
  }
  return out;
}
/** The parts a list in `part` names through relationship ids (`r:id`), in its order: a deck's slides, a workbook's sheets. */
function listed(files: Record<string, Uint8Array>, part: string, tag: RegExp) {
  const rels = related(files, part);
  if (!files[part] || !rels.size) return [];
  return [...strFromU8(files[part]).matchAll(tag)].map(([t]) => ({ key: rels.get(/\s[\w-]+:id="([^"]*)"/.exec(t)?.[1] || "") || "", tag: t })).filter((p) => files[p.key]);
}

function docx(files: Record<string, Uint8Array>, name: string) {
  const body = files["word/document.xml"];
  if (!body) throw Error("not a Word document");
  const parts = [paragraphs(strFromU8(body), "w")];
  for (const key of ["word/footnotes.xml", "word/endnotes.xml"]) if (files[key]) { const notes = paragraphs(strFromU8(files[key]), "w"); if (notes.trim()) parts.push(`[${name}, ${key.includes("foot") ? "footnotes" : "endnotes"}]\n${notes}`); }
  return parts.join("\n\n");
}

function pptx(files: Record<string, Uint8Array>, name: string) {
  // In the deck's own order (presentation.xml), which need not follow the slides' file numbers.
  const ordered = listed(files, "ppt/presentation.xml", /<(?:\w+:)?sldId\b[^>]*>/g).map((p) => p.key);
  const slides = ordered.length ? ordered : numbered(files, /^ppt\/slides\/slide(\d+)\.xml$/);
  if (!slides.length) throw Error("not a PowerPoint deck");
  return slides.map((key, i) => {
    const own = related(files, key);
    const notes = files[own.size ? [...own.values()].find((t) => t.startsWith("ppt/notesSlides/")) || "" : `ppt/notesSlides/notesSlide${/(\d+)\.xml$/.exec(key)?.[1]}.xml`];
    const noteText = notes ? paragraphs(strFromU8(notes), "a").split("\n").filter((l) => !/^\d+$/.test(l.trim())).join("\n") : "";
    return `[${name}, slide ${i + 1}]\n${paragraphs(strFromU8(files[key]), "a")}${noteText.trim() ? `\nSpeaker notes: ${noteText}` : ""}`;
  }).join("\n\n");
}

function xlsx(files: Record<string, Uint8Array>, name: string) {
  // In the workbook's order and with its names (workbook.xml through its relationships), not by file number.
  const ordered = listed(files, "xl/workbook.xml", /<(?:\w+:)?sheet\b[^>]*>/g).map((p) => ({ key: p.key, name: decode(attr(p.tag, "name") || "") }));
  const sheets = ordered.length ? ordered.map((p) => p.key) : numbered(files, /^xl\/worksheets\/sheet(\d+)\.xml$/);
  if (!sheets.length) throw Error("not an Excel workbook");
  const shared = files["xl/sharedStrings.xml"] ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([^]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => decode(t[1])).join("")) : [];
  const names = ordered.length ? ordered.map((p) => p.name) : files["xl/workbook.xml"] ? [...strFromU8(files["xl/workbook.xml"]).matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decode(m[1])) : [];
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
        const wanted = kind === "docx" ? /^word\/(document|footnotes|endnotes)\.xml$/ : kind === "pptx" ? /^ppt\/((slides|notesSlides)\/[^/]+\.xml|presentation\.xml|(_rels\/presentation|slides\/_rels\/[^/]+)\.xml\.rels)$/ : /^xl\/(worksheets\/[^/]+\.xml|sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels)$/;
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
