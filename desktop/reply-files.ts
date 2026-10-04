import { FILE_ACTIONS, partsKey, sameFormat } from "./file-guides.ts";
import type { Made } from "./file-maker.ts";

/** What one Telegram reply may carry: Telegram's bot upload limit is 50 MB a file and 10 MB for a photo; Mowr stays under both. */
export const REPLY_LIMITS = { files: 10, file: 20_000_000, total: 60_000_000, photo: 10_000_000 };
export type ReplyFile = { name: string; mime: string; bytes: Uint8Array; /** Sent as a picture (a viewable photo) rather than a document. */ photo: boolean };

/** Whether Telegram will show these bytes as a photo: a PNG or JPEG within its size and shape limits (it refuses width + height over 10000 or a ratio over 20). */
export function photoFit(mime: string, bytes: Uint8Array) {
  if (bytes.length > REPLY_LIMITS.photo) return false;
  let width = 0, height = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png" && bytes.length > 24 && view.getUint32(12) === 0x49484452) { width = view.getUint32(16); height = view.getUint32(20); }
  else if (mime === "image/jpeg") {
    // The size is in the first start-of-frame marker.
    for (let i = 2; i + 9 < bytes.length;) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { height = view.getUint16(i + 5); width = view.getUint16(i + 7); break; }
      i += 2 + view.getUint16(i + 2);
    }
  } else return false;
  return width > 0 && height > 0 && width + height <= 10000 && Math.max(width, height) / Math.min(width, height) <= 20;
}

/**
 * The files one Telegram reply makes. Each file action adds a file (up to the limits); `revise` with the id from the result
 * changes a file made earlier in the same reply, in place, so a corrected draft is one file and not two; `append` continues
 * a long file in parts. Pictures go as photos, everything else as documents, in the order they were first made.
 */
export class ReplyFiles {
  private files = new Map<string, { action: string; spec: any; made: Made }>();
  private next = 1;
  private make: (action: string, spec: any) => Promise<Made>;
  /** The planned parts a file still lacks (desktop/pdf-document.ts unwritten), so a planned document is finished before the reply. */
  private missing: (spec: any) => string[];
  // file-maker (which opens Chromium and the Office builders) is loaded only when a real file is made.
  constructor(make: (action: string, spec: any) => Promise<Made> = async (action, spec) => (await import("./file-maker.ts")).makeFile(action, spec), missing: (spec: any) => string[] = () => []) { this.make = make; this.missing = missing; }
  get size() { return this.files.size; }
  async handle(request: any, cancelled: () => boolean = () => false) {
    const action = FILE_ACTIONS.has(String(request?.action)) ? String(request.action) : "pdf";
    const { revise: given, append, change: _change, action: _action, ...rest } = request || {};
    // "revise": null or "" is the same as leaving it out.
    const revise = given === null || given === "" ? undefined : given;
    const earlier = typeof revise === "string" ? this.files.get(revise) : undefined;
    if (revise !== undefined && !earlier) throw Error(`No file with id "${revise}" was made in this reply. Use an id from an earlier result, or leave out "revise" to make a new file.`);
    if (earlier && !sameFormat(action, earlier.made.name)) throw Error(`"${earlier.made.name}" is a .${earlier.made.name.split(".").pop()} file: revise it with the action that made it, or leave out "revise".`);
    if (!earlier && this.files.size >= REPLY_LIMITS.files) throw Error(`A Telegram reply carries at most ${REPLY_LIMITS.files} files. Put the rest in one of them, or tell the person what is left.`);
    let spec = rest;
    const key = partsKey[action];
    if (append) {
      if (!earlier) throw Error('"append" needs "revise": the id of a file made in this reply.');
      if (!key) throw Error('"append" works for pdf, docx, pptx and xlsx files; send the complete file instead.');
      if (!Array.isArray(rest[key]) || !rest[key].length) throw Error(`"append" needs the new "${key}" to add.`);
      spec = { ...earlier.spec, ...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== key)), [key]: [...(earlier.spec[key] || []), ...rest[key]] };
      // References accumulate across parts, as in the desktop chat (desktop/main.ts).
      if (key === "sections") {
        spec.references = [...new Set([...(earlier.spec.references || []), ...(rest.references || [])])];
        if (!spec.references.length) delete spec.references;
      }
    }
    const made = await this.make(action, spec);
    if (cancelled()) throw Error("Request cancelled");
    if (made.bytes.length > REPLY_LIMITS.file) throw Error(`The file is ${(made.bytes.length / 1e6).toFixed(1)} MB; Telegram replies carry files up to ${REPLY_LIMITS.file / 1e6} MB. Make it smaller or split it into several files.`);
    const others = [...this.files].filter(([id]) => id !== revise).reduce((n, [, f]) => n + f.made.bytes.length, 0);
    if (others + made.bytes.length > REPLY_LIMITS.total) throw Error(`This reply's files would total over ${REPLY_LIMITS.total / 1e6} MB. Make them smaller or send fewer.`);
    const id: string = earlier ? revise : "f" + this.next++;
    this.files.set(id, { action, spec, made });
    return { created: true, id, name: made.name, ...(earlier ? { revised: true } : {}), ...made.info, files: this.files.size, note: `This file is sent with the reply (${this.files.size} of at most ${REPLY_LIMITS.files}). To change it, send {"action":"${action}","revise":"${id}",…}${key ? `; to continue it, add "append":true with the next "${key}"` : ""}.` };
  }
  /** What a file made in this reply still lacks from its own plan, as an instruction for the tool loop (undefined when all are finished). */
  unfinished() {
    const open = [...this.files].map(([id, f]) => {
      const key = partsKey[f.action];
      if ((key !== "sections" && key !== "slides") || !Array.isArray(f.spec?.plan)) return "";
      const missing = this.missing(key === "slides" ? { plan: f.spec.plan, sections: (f.spec.slides || []).map((s: any) => ({ heading: s?.title || "" })) } : f.spec);
      return missing.length ? `"${f.made.name}" (id ${id}) still lacks ${missing.length} planned ${key === "slides" ? "slide" : "section"}${missing.length === 1 ? "" : "s"}: ${missing.slice(0, 12).join("; ")}. Add them with {"action":"${f.action}","revise":"${id}","append":true,"${key}":[…]}.` : "";
    }).filter(Boolean);
    return open.length ? open.join(" ") + " Answer only when every planned part is written." : undefined;
  }
  /** The finished files, in the order they were first made. */
  list(): ReplyFile[] {
    return [...this.files.values()].map(({ made }) => ({ name: made.name, mime: made.type, bytes: made.bytes, photo: photoFit(made.type, made.bytes) }));
  }
}
