// Real files on the VPS worker (docs/GUC-VPS-ENGINE.md "Files on the VPS"): PDF, Word, PowerPoint, Excel, text files
// and pictures made by the window's own makers (desktop/file-maker.ts makeFile), drawn in headless Chromium here
// (desktop/chromium-page.ts); looking at, finding figures in, cropping and editing PDF pages with the window's page code
// (worker/page-tasks.ts); Kinetra calls and guides. What it makes is saved in the VPS store under the storage limit,
// added to the workspace copy (so the desktop gets it after it syncs) and sent with the answer (Telegram).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeFile, MIME, FILE_ACTIONS, partsKey, patchParts, sameFormat, type Made as MadeFile } from "../../file-maker.ts";
import { kinetraTool } from "../../kinetra-runtime.ts";
import { CropAssets, cropTools, readAsset, type AssetIo } from "../../pdf-assets.ts";
import { typesetBlock } from "../../text-block.ts";
import { NoPages } from "../../draw-page.ts";
import type { EditHelpers } from "../../pdf-edit-tools.ts";
import type { StoredFile } from "../../../core/types.ts";
import type { PageTasks, TaskFile } from "./page-tasks.ts";
import { NO_CHROMIUM } from "./chromium-install.ts";

export type FileBlob = { sha256: string; ext: string; size: number };
/** A workspace file as the worker keeps it: `blob` where its bytes are on the VPS, `inline` (base64) for one made past
 *  the storage limit, waiting for the PC. `spec` the source the worker made it from (a revision continues from it). */
export type WorkerFile = StoredFile & { blob?: FileBlob; inline?: string };
export type Made = { name: string; type: string; bytes: Uint8Array; photo?: boolean };
export type Picture = { name: string; data: string };
/** One answer's state: where it is (a subject or the main thread), what it made, the files it may read. */
export type FileTurn = { scope: string | null; chat: string; made: Made[]; files: () => Promise<WorkerFile[]>; madeIds: Set<string> };

export type FileDeps = {
  /** The worker's data folder (crop assets, document sources, kept originals). */
  data: string;
  bytes: (f: WorkerFile) => Promise<Uint8Array>;
  save: (bytes: Uint8Array, ext: string) => Promise<FileBlob | { waiting: string }>;
  onWaiting?: (item: string, name: string, bytes: number, said: string) => Promise<void>;
  /** Puts a made or revised file into the workspace copy. */
  put: (file: WorkerFile) => Promise<void>;
  pages?: PageTasks;
  /** The model sees pictures (an API key); a CLI on the server gets the result's words only. */
  vision?: boolean;
  clock?: () => number;
};

const ID = /^[0-9a-f-]{36}$/i;
function diskIo(dir: string): AssetIo {
  const at = (k: string) => { if (!/^[\w.-]{1,120}$/.test(k)) throw Error("Invalid key"); return join(dir, k); };
  return {
    read: async (k) => readFile(at(k)).then((b) => new Uint8Array(b), () => null),
    write: async (k, b) => { await mkdir(dir, { recursive: true }); await writeFile(at(k), b); },
    remove: async (k) => { await rm(at(k), { force: true }); },
  };
}
const extOf = (name: string) => (name.match(/\.([a-z0-9]{1,5})$/i)?.[1] || "").toLowerCase();
const isPdf = (f: StoredFile) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

export class WorkerFiles {
  private d: FileDeps;
  private io: AssetIo;
  private specs: string;
  constructor(d: FileDeps) { this.d = d; this.io = diskIo(join(d.data, "crops")); this.specs = join(d.data, "specs"); }
  private now() { return (this.d.clock || Date.now)(); }
  private async spec(id: string): Promise<any | undefined> { if (!ID.test(id)) return undefined; try { return JSON.parse(await readFile(join(this.specs, id + ".json"), "utf8")); } catch { return undefined; } }
  private async keepSpec(id: string, spec: unknown) { await mkdir(this.specs, { recursive: true }); await writeFile(join(this.specs, id + ".json"), JSON.stringify(spec)); }
  /** A file's source goes with it when it's deleted (Part 5: delete here, delete there). */
  async forget(id: string) { if (ID.test(id)) await rm(join(this.specs, id + ".json"), { force: true }).catch(() => {}); }

  /** The files a page task may open, by name: the answer's readable files, with their bytes read on demand. */
  private async taskFiles(t: FileTurn): Promise<TaskFile[]> {
    return (await t.files()).filter((f) => !f.remote && (f.blob || f.inline || f.id.startsWith("guc_"))).map((f) => ({ ...f, bytes: () => this.d.bytes(f) }));
  }
  private needPages() { if (!this.d.pages) throw new NoPages(NO_CHROMIUM); return this.d.pages; }
  private say(e: unknown) { return e instanceof NoPages ? NO_CHROMIUM : (e as Error).message; }

  /** The actions this handles; anything else is undefined (the agent goes on). */
  async tool(tool: Record<string, any>, t: FileTurn): Promise<unknown> {
    const action = String(tool?.action || "");
    try {
      if (FILE_ACTIONS.has(action)) return await this.make(tool, t);
      if (action === "open") return await this.open(tool);
      if (action === "look") return await this.look(tool, t);
      if (action === "regions" || action === "crop") {
        const crops = new CropAssets(this.io, t.chat.replace(/[^\w-]/g, "").slice(0, 80) || "main");
        const pages = this.needPages(), files = await this.taskFiles(t);
        const outcome = await cropTools((op, args) => pages.run(op, files, args), crops)(tool);
        return outcome && (outcome.pictures.length && this.d.vision ? { ...outcome.result, attachPictures: outcome.pictures } : outcome.result);
      }
      if (["call", "recipes", "api", "skill"].includes(action)) return await kinetraTool(tool);
    } catch (e) { return { error: this.say(e) }; }
    return undefined;
  }

  /** The source of a file the worker made, to change it ({"action":"open","id":…}). */
  private async open(tool: Record<string, any>) {
    const spec = typeof tool.id === "string" ? await this.spec(tool.id) : undefined;
    if (!spec) return { error: "That file's source isn't on the server (only files Clem made here can be opened this way)." };
    const { action, ...specification } = spec;
    return { id: tool.id, action, specification };
  }

  /** Pictures of PDF pages: for the model when it can see them, and sent to the person with the answer. */
  private async look(tool: Record<string, any>, t: FileTurn) {
    const pages = (Array.isArray(tool.pages) ? tool.pages : [tool.page]).map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 8);
    if (typeof tool.file !== "string" || !tool.file.trim() || !pages.length) return { error: '"look" needs "file" (a file name) and "pages": [page numbers], up to 8 at a time.' };
    const files = await this.taskFiles(t), want = tool.file.trim().toLowerCase();
    const f = files.find((x) => x.name.toLowerCase() === want) || files.find((x) => x.name.toLowerCase().includes(want));
    if (!f) return { error: `No file named "${tool.file}" here.` };
    if (!isPdf(f)) return { error: `${f.name} is not a PDF.` };
    const r = await this.needPages().run("render", [], { bytes: await f.bytes(), pages, name: f.name });
    for (const i of r.images) t.made.push({ name: i.name.replace(/[\\/:*?"<>|]/g, "-") + ".jpg", type: "image/jpeg", bytes: new Uint8Array(Buffer.from(i.data, "base64")), photo: true });
    return { pictures: r.images.map((i) => i.name), note: "The pages are sent to the person as photos with your answer.", ...(this.d.vision ? { attachPictures: r.images } : {}) };
  }

  /** pdf, docx, pptx, xlsx, file, image and editpdf, made or revised as the window makes them. */
  private async make(raw: Record<string, any>, t: FileTurn) {
    let spec: any = raw;
    const action = String(spec.action);
    const revise = typeof spec.revise === "string" ? spec.revise : undefined;
    const files = await t.files();
    const earlier = revise ? files.find((f) => f.id === revise) : undefined;
    if (revise && !earlier) return { error: `No file with id "${revise}". Leave out "revise" to make a new file.` };
    if (earlier && !sameFormat(action, earlier.name)) return { error: `"${earlier.name}" is a .${extOf(earlier.name)} file: revise it with the action that made it.` };
    const { revise: _r, change: _c, action: _a, append, patch, noFigures: _n, ...rest } = spec;
    let clean: any = rest;
    const key = partsKey[action];
    if (append || patch !== undefined) {
      if (!revise) return { error: `"${append ? "append" : "patch"}" needs "revise": the id of the file to change.` };
      const stored = await this.spec(revise);
      if (!stored || !key) return { error: "That file's source isn't on the server, so it can't be changed in parts: send the complete file." };
      const { action: _made, ...base } = stored;
      const parts = patch === undefined ? [...(base[key] || [])] : patchParts(base[key] || [], patch, key);
      if (append && (!Array.isArray(rest[key]) || !rest[key].length)) return { error: `"append" needs the new "${key}" to add.` };
      clean = { ...base, ...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== key)), [key]: append ? [...parts, ...rest[key]] : parts };
    }
    if (action === "editpdf" && revise && !clean.file && !clean.source) { const stored = await this.spec(revise); if (stored?.action === "editpdf") clean = { source: stored.source, name: stored.name, ...clean }; }
    const pages = this.d.pages;
    const sources = new Map<string, string>();
    const edit: EditHelpers = {
      load: async (ref) => {
        if (/^src-[0-9a-f-]{36}$/.test(ref)) {
          const bytes = await readFile(join(this.d.data, "sources", ref)).catch(() => null);
          if (!bytes) throw Error("The original this edit was made from is missing.");
          return { bytes: new Uint8Array(bytes), source: ref };
        }
        const wanted = ref.trim().toLowerCase();
        const f = files.find((x) => x.id === ref) || files.find((x) => x.name.toLowerCase() === wanted) || files.find((x) => x.name.toLowerCase().includes(wanted));
        if (!f) throw Error(`No PDF named "${ref}" here.`);
        if (!isPdf(f)) throw Error(`${f.name} is not a PDF.`);
        const bytes = await this.d.bytes(f);
        let source = sources.get(f.id);
        if (!source) { source = "src-" + randomUUID(); await mkdir(join(this.d.data, "sources"), { recursive: true }); await writeFile(join(this.d.data, "sources", source), bytes); sources.set(f.id, source); }
        return { bytes, source, name: f.name };
      },
      words: async (bytes, page) => (await this.needPages().run("words", [], { bytes, page })).data.items,
      crop: (id) => readAsset(this.io, id),
      raster: async (bytes, page, boxes, fill) => { const r = await this.needPages().run("raster", [], { bytes, page, boxes, fill, dpi: 200 }); if (!r.files[0]) throw Error("The page could not be drawn."); return r.files[0]; },
      typeset: typesetBlock,
    };
    const render = pages ? async (bytes: Uint8Array, list: number[], name?: string, size?: number) => (await pages.run("render", [], { bytes, pages: list, name, size })).images.map((i) => ({ name: i.name, image: new Uint8Array(Buffer.from(i.data, "base64")) })) : undefined;
    let made: MadeFile;
    try {
      made = await makeFile(action, clean, { preview: !!this.d.vision, assets: (id) => readAsset(this.io, id), edit, render });
    } catch (e) { return { error: this.say(e) }; }
    const id = earlier?.id || randomUUID();
    const ext = extOf(made.name) || action;
    const saved = await this.d.save(made.bytes, ext);
    const now = this.now();
    const base: WorkerFile = earlier
      ? { ...earlier, name: made.name, size: made.bytes.length, type: made.type || MIME[ext] || "application/octet-stream", updated: now, made: true }
      : { id, name: made.name, size: made.bytes.length, type: made.type || MIME[ext] || "application/octet-stream", created: now, spaceId: t.scope, made: true, ...(t.chat && t.chat !== "main" ? { chatId: t.chat } : {}) };
    delete base.blob; delete base.inline;
    let file: WorkerFile;
    if ("waiting" in saved) {
      if (made.bytes.length > 12_000_000) return { error: "Your VPS is at Clem's storage limit and this file is too large to hold for your PC. Free space on the VPS (or say so and Clem will send waiting files to your PC) and ask again." };
      file = { ...base, inline: Buffer.from(made.bytes).toString("base64") };
      await this.d.onWaiting?.("ws:" + id, made.name, made.bytes.length, `“${made.name}” waits for your PC: your VPS is at Clem's storage limit, so it's saved on your PC when Clem opens there.`).catch(() => {});
    } else file = { ...base, blob: saved };
    await this.d.put(file);
    await this.keepSpec(id, { action, ...(made.spec ?? clean) });
    t.madeIds.add(id);
    // A file made again in the same answer replaces the copy that goes to the person.
    const at = t.made.findIndex((m) => m.name === (earlier?.name ?? made.name));
    const out: Made = { name: made.name, type: file.type, bytes: made.bytes };
    if (at >= 0) t.made[at] = out; else t.made.push(out);
    const look = made.previews?.length && this.d.vision ? { attachPictures: made.previews.map((p) => ({ name: p.name, data: Buffer.from(p.image).toString("base64") })), pictures: made.previews.map((p) => p.name) } : {};
    return {
      created: !earlier, ...(earlier ? { revised: true } : {}), file: { id, name: made.name, size: made.bytes.length }, ...made.info, ...look,
      note: `Saved in ${t.scope ? "the subject" : "the workspace"} and sent with your answer${"waiting" in saved ? " (kept for the person's PC: the VPS is at its storage limit)" : ""}. To change it, send {"action":"${action}","revise":"${id}",…}${key ? `; to continue it, {"action":"${action}","revise":"${id}","append":true,"${key}":[…]}` : ""}.`,
    };
  }
}
