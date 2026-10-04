import { unzipSync, strFromU8 } from "fflate";

/**
 * An Office file (a zip of XML parts) opened for viewing. Everything is read here, in the window, from the bytes the person
 * has: no Office program, no upload. Limits match src/office.ts: 30 MB packed, 60 MB expanded, no XML with a DOCTYPE.
 */
export type Rel = { id: string; type: string; target: string; external: boolean };
export type Pkg = {
  files: Record<string, Uint8Array>;
  has(path: string): boolean;
  xml(path: string): Document | undefined;
  rels(part: string): Map<string, Rel>;
  /** An image or other media part as an object URL the page can show; undefined for formats browsers cannot draw (EMF, WMF, TIFF). */
  url(path: string): string | undefined;
  dispose(): void;
};

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp" };
/** A relationship target resolved against the part that holds it ("../media/a.png" from "ppt/slides/slide1.xml"). */
export function resolvePart(from: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = from.split("/").slice(0, -1);
  for (const piece of target.split("/")) { if (piece === "..") parts.pop(); else if (piece !== ".") parts.push(piece); }
  return parts.join("/");
}

export async function openPackage(blob: Blob): Promise<Pkg> {
  if (blob.size > 30_000_000) throw Error("Choose an Office file under 30 MB.");
  let expanded = 0;
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: (entry) => { expanded += entry.originalSize; if (expanded > 60_000_000) throw Error("The expanded document is too large."); return !/\.(bin|emf|wmf|tiff?|xlsx|docx|pptx|vml)$/i.test(entry.name) || /^(word|xl|ppt)\/media\//.test(entry.name); } });
  const docs = new Map<string, Document | undefined>(), urls = new Map<string, string | undefined>();
  const pkg: Pkg = {
    files,
    has: (path) => path in files,
    xml(path) {
      if (docs.has(path)) return docs.get(path);
      const bytes = files[path];
      let doc: Document | undefined;
      if (bytes) {
        doc = new DOMParser().parseFromString(strFromU8(bytes), "application/xml");
        if (doc.querySelector("parsererror") || doc.doctype) throw Error("This Office document contains unsupported XML.");
      }
      docs.set(path, doc);
      return doc;
    },
    rels(part) {
      const out = new Map<string, Rel>();
      const dir = part.split("/").slice(0, -1).join("/");
      const doc = pkg.xml((dir ? dir + "/" : "") + "_rels/" + part.split("/").at(-1) + ".rels");
      for (const rel of Array.from(doc?.getElementsByTagNameNS("*", "Relationship") || [])) {
        const external = rel.getAttribute("TargetMode") === "External", target = rel.getAttribute("Target") || "";
        out.set(rel.getAttribute("Id") || "", { id: rel.getAttribute("Id") || "", type: (rel.getAttribute("Type") || "").split("/").pop() || "", target: external ? target : resolvePart(part, target), external });
      }
      return out;
    },
    url(path) {
      if (urls.has(path)) return urls.get(path);
      const bytes = files[path], type = MIME[path.split(".").pop()!.toLowerCase()];
      const url = bytes && type ? URL.createObjectURL(new Blob([bytes as BlobPart], { type })) : undefined;
      urls.set(path, url);
      return url;
    },
    dispose() { for (const url of urls.values()) if (url) URL.revokeObjectURL(url); urls.clear(); docs.clear(); },
  };
  return pkg;
}

/** The element children of `el` with this local name. */
export const kids = (el: Element | null | undefined, name?: string) => Array.from(el?.children || []).filter((c) => !name || c.localName === name);
export const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0];
/** The first descendant with this local name. */
export const find = (el: Element | Document | null | undefined, name: string) => el?.getElementsByTagNameNS("*", name)[0] as Element | undefined;
export const all = (el: Element | Document | null | undefined, name: string) => Array.from(el?.getElementsByTagNameNS("*", name) || []);
/** The path of child elements from `el`, by local name ("a/b/c"). */
export const path = (el: Element | null | undefined, names: string) => names.split("/").reduce<Element | undefined>((at, name) => (at ? kid(at, name) : undefined), el || undefined);
export const num = (v: string | null | undefined, fallback = 0) => { const n = Number(v); return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : fallback; };
/** An attribute whatever its namespace prefix (r:embed, w:val, a:val…). */
export const attr = (el: Element | null | undefined, name: string) => {
  if (!el) return undefined;
  const direct = el.getAttribute(name);
  if (direct !== null) return direct;
  for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value;
  return undefined;
};
