import { PDFDocument, PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFRef } from "pdf-lib";

/**
 * Page order, page count and named destinations of a PDF Chromium printed, read straight from its objects.
 * pdf-lib parses every object first, which takes over 20 s for a tagged 300-page document (its structure tree has
 * over 100,000 objects); these reads need three or four objects. Chromium writes plain (uncompressed) objects, so
 * this works for its output; anything else falls back to pdf-lib.
 */
class Objects {
  private text: string;
  private offsets = new Map<number, number>();
  constructor(bytes: Uint8Array) {
    this.text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
    for (const m of this.text.matchAll(/(?:^|[\r\n])(\d+) 0 obj\b/g)) this.offsets.set(Number(m[1]), m.index! + m[0].length);
  }
  get(n: number) {
    const at = this.offsets.get(n);
    if (at === undefined) return undefined;
    const end = this.text.indexOf("endobj", at);
    return this.text.slice(at, end < 0 ? undefined : end);
  }
  root() {
    const roots = [...this.text.matchAll(/\/Root\s+(\d+)\s+0\s+R/g)];
    return roots.length ? this.get(Number(roots[roots.length - 1][1])) : undefined;
  }
  /** Page object numbers in reading order, from the page tree. */
  pages() {
    const root = /\/Pages\s+(\d+)\s+0\s+R/.exec(this.root() || "");
    if (!root) return [];
    const order: number[] = [];
    const walk = (n: number, depth: number) => {
      const node = this.get(n);
      if (!node || depth > 32) return;
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(node);
      if (/\/Type\s*\/Pages\b/.test(node) && kids) for (const k of kids[1].matchAll(/(\d+)\s+0\s+R/g)) walk(Number(k[1]), depth + 1);
      else if (/\/Type\s*\/Page\b/.test(node)) order.push(n);
    };
    walk(Number(root[1]), 0);
    return order;
  }
}

/** The page (1-based) each named destination points to. Chromium writes one for every in-document link target. */
export async function destinationPages(bytes: Uint8Array) {
  const objects = new Objects(bytes);
  const order = objects.pages();
  const dests = /\/Dests\s+(\d+)\s+0\s+R/.exec(objects.root() || "");
  const table = dests ? objects.get(Number(dests[1])) : undefined;
  if (order.length && table) {
    const index = new Map(order.map((n, i) => [n, i + 1]));
    const pages = new Map<string, number>();
    for (const m of table.matchAll(/\/([^\s/[\]<>()]+)\s*\[\s*(\d+)\s+0\s+R/g)) {
      const page = index.get(Number(m[2]));
      if (page) pages.set(m[1].replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), page);
    }
    if (pages.size) return pages;
  }
  // Not Chromium's plain layout (or no links): read it properly.
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const index = new Map(doc.getPages().map((page, i) => [page.ref.toString(), i + 1]));
  const pages = new Map<string, number>();
  for (const [name, value] of doc.catalog.lookupMaybe(PDFName.of("Dests"), PDFDict)?.entries() || []) {
    const target = doc.context.lookup(value);
    const ref = target instanceof PDFArray ? target.get(0) : target instanceof PDFDict ? doc.context.lookup(target.get(PDFName.of("D")), PDFArray)?.get(0) : undefined;
    const page = ref instanceof PDFRef ? index.get(ref.toString()) : undefined;
    if (page) pages.set(name.decodeText(), page);
  }
  return pages;
}

/** How many pages a PDF has, without parsing the whole file when it can be avoided. */
export async function pageCount(bytes: Uint8Array) {
  const objects = new Objects(bytes);
  const root = /\/Pages\s+(\d+)\s+0\s+R/.exec(objects.root() || "");
  const count = root ? /\/Count\s+(\d+)/.exec(objects.get(Number(root[1])) || "") : null;
  if (count) return Number(count[1]);
  return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
}

export type OutlineEntry = { title: string; id: string; level: 2 | 3 };
/** The contents entries of a printed page (desktop/pdf-document.ts writes them as links to the section ids). */
export function outlineEntries(html: string): OutlineEntry[] {
  const nav = /<nav class="doc-toc[^"]*">([\s\S]*?)<\/nav>/.exec(html);
  if (!nav) return [];
  const text = (s: string) => s.replace(/<annotation[\s\S]*?<\/annotation>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  return [...nav[1].matchAll(/<a class="toc-row toc-l([23])" href="#([^"]+)"><span class="toc-num">([\s\S]*?)<\/span><span class="toc-text">([\s\S]*?)<\/span><span class="toc-fill">/g)]
    .map((m) => ({ level: Number(m[1]) as 2 | 3, id: m[2], title: [text(m[3]), text(m[4])].filter(Boolean).join("  ") }));
}

/** Adds bookmarks (a PDF outline) that open the named destinations of `entries`. Chromium writes an outline only
 *  for tagged PDFs, and very long documents are printed untagged. */
export async function addOutline(bytes: Uint8Array, entries: OutlineEntry[]) {
  if (!entries.length) return bytes;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const context = doc.context;
  const root = context.obj({ Type: "Outlines" }) as PDFDict;
  const rootRef = context.register(root);
  type Node = { dict: PDFDict; ref: PDFRef; children: Node[] };
  const top: Node[] = [];
  for (const entry of entries) {
    const dict = context.obj({ Title: PDFHexString.fromText(entry.title), Dest: PDFName.of(entry.id) }) as PDFDict;
    const node = { dict, ref: context.register(dict), children: [] as Node[] };
    if (entry.level === 3 && top.length) top[top.length - 1].children.push(node);
    else top.push(node);
  }
  const link = (parent: PDFDict, parentRef: PDFRef, nodes: Node[]) => {
    nodes.forEach((node, i) => {
      node.dict.set(PDFName.of("Parent"), parentRef);
      if (i > 0) node.dict.set(PDFName.of("Prev"), nodes[i - 1].ref);
      if (i < nodes.length - 1) node.dict.set(PDFName.of("Next"), nodes[i + 1].ref);
      if (node.children.length) {
        link(node.dict, node.ref, node.children);
        // A negative count: chapters start closed, as in a long book.
        node.dict.set(PDFName.of("Count"), PDFNumber.of(-node.children.length));
      }
    });
    parent.set(PDFName.of("First"), nodes[0].ref);
    parent.set(PDFName.of("Last"), nodes[nodes.length - 1].ref);
  };
  link(root, rootRef, top);
  root.set(PDFName.of("Count"), PDFNumber.of(top.length));
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}
