// The drawing page on the VPS worker (desktop/draw-page.ts): a headless Chromium, driven over its DevTools pipe
// (--remote-debugging-pipe: no port is opened). One browser process serves every page and closes after two idle
// minutes. Where Chromium is: CLEM_CHROMIUM, a browser on the PATH, the one in Clem's Docker image, or one Clem
// installed by itself under the worker's data folder on first use (desktop/engine/vps/chromium-install.ts).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { NoPages, type DrawPage, type PageKind, type PageOpener } from "./draw-page.ts";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };
/** A served page: a request for one of these URLs gets these bytes; every other request fails (no network). */
export type Served = (url: string) => { body: Uint8Array | string; type: string } | undefined;

const NAMES = process.platform === "win32" ? ["chrome.exe", "msedge.exe"] : ["chromium", "chromium-browser", "chrome-headless-shell", "headless_shell", "google-chrome", "google-chrome-stable"];
const KNOWN = process.platform === "win32"
  ? [join(process.env["ProgramFiles"] || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"), join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe")]
  : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/chrome-headless-shell", "/usr/lib/chromium/chromium", "/snap/bin/chromium", "/usr/bin/google-chrome"];

/** A Chromium on this machine, or undefined. `extra`: paths to try first (one Clem installed). */
export function findChromium(extra: string[] = [], env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.CLEM_CHROMIUM) return existsSync(env.CLEM_CHROMIUM) ? env.CLEM_CHROMIUM : undefined;
  for (const p of extra) if (existsSync(p)) return p;
  for (const dir of (env.PATH || "").split(delimiter).filter(Boolean)) for (const n of NAMES) if (existsSync(join(dir, n))) return join(dir, n);
  return KNOWN.find((p) => existsSync(p));
}

class Browser {
  private proc: ChildProcess;
  private id = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(m: any) => void>();
  private buf = Buffer.alloc(0);
  closed = false;
  constructor(proc: ChildProcess) {
    this.proc = proc;
    const out = proc.stdio[4] as NodeJS.ReadableStream;
    out.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      for (let end = this.buf.indexOf(0); end >= 0; end = this.buf.indexOf(0)) {
        const text = this.buf.subarray(0, end).toString("utf8");
        this.buf = this.buf.subarray(end + 1);
        let m: any;
        try { m = JSON.parse(text); } catch { continue; }
        if (m.id && this.pending.has(m.id)) {
          const p = this.pending.get(m.id)!;
          this.pending.delete(m.id);
          m.error ? p.reject(Error(m.error.message || "Chromium error")) : p.resolve(m.result);
        } else for (const l of this.listeners) l(m);
      }
    });
    proc.on("exit", () => { this.closed = true; for (const p of this.pending.values()) p.reject(Error("Chromium stopped.")); this.pending.clear(); });
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeout = 120_000): Promise<any> {
    if (this.closed) return Promise.reject(Error("Chromium stopped."));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(Error(`Chromium didn't answer (${method}).`)); }, timeout);
      t.unref?.();
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      (this.proc.stdio[3] as NodeJS.WritableStream).write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }
  on(l: (m: any) => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
  kill() { this.closed = true; try { this.proc.kill(); } catch {} }
}

/** A page opener on headless Chromium. `binary` finds the browser (installing it when that is how it's had). */
export function chromiumPages(o: { binary: () => Promise<string | undefined>; idleMs?: number; log?: (m: string) => void }) {
  let browser: Promise<Browser> | undefined, open = 0, idle: ReturnType<typeof setTimeout> | undefined, profile: string | undefined;
  const start = async () => {
    const bin = await o.binary();
    if (!bin) throw new NoPages("This server has no browser engine for drawing pages, and Clem couldn't install one.");
    profile = await mkdtemp(join(tmpdir(), "clem-chromium-"));
    const args = ["--headless", "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions", "--disable-background-networking", "--disable-sync", "--mute-audio", "--hide-scrollbars", "--font-render-hinting=none", `--user-data-dir=${profile}`,
      // In a container (or as root) Chromium's own sandbox can't start; the pages allow no network and no scripts anyway.
      ...(process.platform === "linux" ? ["--no-sandbox"] : []), "about:blank"];
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
    let err = "";
    proc.stderr?.on("data", (b) => { err = (err + b).slice(-2000); });
    const b = new Browser(proc);
    await new Promise<void>((resolve, reject) => { proc.once("error", reject); proc.once("spawn", () => resolve()); });
    try { await b.send("Browser.getVersion", {}, undefined, 30_000); } catch (e) {
      b.kill();
      throw new NoPages("Chromium couldn't start on this server" + (err.trim() ? ": " + err.trim().split("\n").slice(-1)[0].slice(0, 200) : "."));
    }
    proc.on("exit", () => { browser = undefined; });
    return b;
  };
  const get = () => {
    if (idle) { clearTimeout(idle); idle = undefined; }
    if (!browser) { browser = start(); browser.catch(() => { browser = undefined; }); }
    return browser;
  };
  const release = () => {
    if (--open > 0) return;
    idle = setTimeout(() => void shutdown(), o.idleMs ?? 120_000);
    idle.unref?.();
  };
  const shutdown = async () => {
    const b = await browser?.catch(() => undefined);
    browser = undefined;
    b?.kill();
    if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  const opener = async (kind: PageKind & { serve?: Served }): Promise<DrawPage> => {
    const b = await get();
    open++;
    let sessionId = "", targetId = "";
    try {
      targetId = (await b.send("Target.createTarget", { url: "about:blank" })).targetId;
      sessionId = (await b.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    } catch (e) { release(); throw e; }
    const s = (method: string, params: Record<string, unknown> = {}) => b.send(method, params, sessionId);
    let width = kind.width ?? 800, height = kind.height ?? 600;
    await s("Page.enable");
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    if (!kind.script) await s("Emulation.setScriptExecutionDisabled", { value: true });
    if (kind.transparent) await s("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    const off: (() => void)[] = [];
    // A script page's warnings and errors go to the worker's log (a figure that couldn't be drawn says why).
    if (kind.script && o.log) {
      await s("Runtime.enable");
      off.push(b.on((m) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "warning" || m.params.type === "error")) o.log!("[page] " + m.params.args.map((a: any) => a.value ?? a.description ?? "").join(" ").slice(0, 500));
        if (m.method === "Runtime.exceptionThrown") o.log!("[page] " + String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).slice(0, 500));
      }));
    }
    if (kind.serve) {
      await s("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      off.push(b.on((m) => {
        if (m.sessionId !== sessionId || m.method !== "Fetch.requestPaused") return;
        const got = kind.serve!(m.params.request.url);
        if (!got) { void s("Fetch.failRequest", { requestId: m.params.requestId, errorReason: "BlockedByClient" }).catch(() => {}); return; }
        const body = typeof got.body === "string" ? Buffer.from(got.body, "utf8") : Buffer.from(got.body);
        void s("Fetch.fulfillRequest", { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: got.type }, { name: "Access-Control-Allow-Origin", value: "*" }], body: body.toString("base64") }).catch(() => {});
      }));
    }
    const loaded = () => new Promise<void>((resolve) => {
      const stop = b.on((m) => { if (m.sessionId === sessionId && m.method === "Page.loadEventFired") { stop(); resolve(); } });
      const t = setTimeout(() => { stop(); resolve(); }, 60_000); t.unref?.();
    });
    const clip = (r: { x: number; y: number; width: number; height: number }) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.ceil(r.width)), height: Math.max(1, Math.ceil(r.height)), scale: 1 });
    let closed = false;
    return {
      async size(w, h) { width = Math.max(1, Math.ceil(w)); height = Math.max(1, Math.ceil(h)); await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }); },
      async load(file) {
        const done = loaded();
        await s("Page.navigate", { url: /^[a-z]+:\/\//i.test(file) ? file : pathToFileURL(file).href });
        await done;
        // Fonts and layout settle before a capture or a print.
        if (kind.script) await s("Runtime.evaluate", { expression: "document.fonts.ready.then(()=>true)", awaitPromise: true }).catch(() => {});
      },
      async png(r) { return new Uint8Array(Buffer.from((await s("Page.captureScreenshot", { format: "png", clip: clip(r), captureBeyondViewport: true })).data, "base64")); },
      async jpeg(r, quality) { return new Uint8Array(Buffer.from((await s("Page.captureScreenshot", { format: "jpeg", quality, clip: clip(r), captureBeyondViewport: true })).data, "base64")); },
      async pdf(p) {
        const r = await s("Page.printToPDF", { printBackground: !!p.background, preferCSSPageSize: true, displayHeaderFooter: false, ...(p.tagged !== undefined ? { generateTaggedPDF: p.tagged } : {}), ...(p.outline ? { generateDocumentOutline: true } : {}), ...(p.noMargins ? { marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 } : {}) });
        return new Uint8Array(Buffer.from(r.data, "base64"));
      },
      async run<T>(expression: string) {
        const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw Error(String(r.exceptionDetails.exception?.description?.split("\n")[0] || r.exceptionDetails.text || "Script failed").replace(/^\w*Error: /, ""));
        return r.result?.value as T;
      },
      close() {
        if (closed) return;
        closed = true;
        for (const f of off) f();
        void b.send("Target.closeTarget", { targetId }).catch(() => {});
        release();
      },
    };
  };
  return { open: opener as PageOpener & ((kind: PageKind & { serve?: Served }) => Promise<DrawPage>), shutdown };
}
