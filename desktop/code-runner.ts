import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Runs a chat code block on this computer when the person presses Run (src/chat/code-run.ts sends it here): Java, C,
 * C++, C#, Go, Rust, TypeScript, JavaScript that reads input, and the scripting languages the computer has installed.
 * Each run gets its own temporary folder, compiles there if the language needs it, then runs with its standard input
 * open, so lines the person types in the run's input box reach the program. Stop ends the whole process tree.
 *
 * The compiler or runtime is the one already installed when there is one. Java, C/C++ and Go are set up once when they
 * are missing: an official portable build (Eclipse Temurin, Zig's C/C++ compiler, Go) is downloaded over HTTPS into
 * Clem's own folder, checked against its published SHA-256, and unpacked there; nothing is installed system-wide.
 * TypeScript and JavaScript run on the Node.js inside Clem itself.
 */

export type CodeEvent = { id: string; type: "out" | "err" | "status" | "started" | "done"; text?: string; ok?: boolean };
export type CodeRequest = { op: "start"; id: string; lang: string; code: string } | { op: "input"; id: string; text: string | null } | { op: "stop"; id: string };

const windows = process.platform === "win32";
const exe = (name: string) => (windows ? name + ".exe" : name);
/** Output past this is cut off and the run stopped, so a runaway loop cannot flood the chat. */
const OUTPUT_LIMIT = 2_000_000;
const COMPILE_MS = 180_000;

/** The first of `names` found on PATH or in `extra` folders. */
function which(names: string[], extra: string[] = []) {
  const dirs = [...(process.env.PATH || "").split(delimiter), ...extra].filter(Boolean);
  const suffixes = windows ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const name of names) for (const dir of dirs) for (const suffix of suffixes) {
    const path = join(dir, name + suffix);
    // The Microsoft Store's stand-ins (WindowsApps) open the Store instead of running anything.
    if (existsSync(path) && !/\\WindowsApps\\/i.test(path)) return path;
  }
  return undefined;
}
/** Subfolders of each folder that match `pattern`, newest-looking last, each with `tail` appended. */
function under(roots: string[], pattern: RegExp, tail: string) {
  const out: string[] = [];
  for (const root of roots) { try { for (const name of readdirSync(root).filter((n) => pattern.test(n)).sort()) out.push(join(root, name, tail)); } catch { /* not there */ } }
  return out.reverse();
}
const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs")].filter((p): p is string => !!p);

type Download = { name: string; url: string; sha256?: string; size?: number };
type Portable = { title: string; folder: string; latest: () => Promise<Download>; find: (dir: string) => string | undefined };
const arch = process.arch === "arm64" ? "arm64" : "x64";
const json = async (url: string) => { const response = await fetch(url, { headers: { "user-agent": "Clem" } }); if (!response.ok) throw Error(`${url} answered ${response.status}`); return response.json() as Promise<any>; };
/** The single folder an archive unpacked into (jdk-21.0.5+11, zig-windows-x86_64-0.15.1, go), joined with `tail`. */
const inside = (dir: string, tail: string) => { try { for (const name of readdirSync(dir)) { const path = join(dir, name, tail); if (existsSync(path)) return path; } } catch { /* empty */ } return undefined; };
const portables: Record<"java" | "zig" | "go", Portable> = {
  java: {
    title: "Java", folder: "jdk",
    async latest() {
      const [asset] = await json(`https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=${arch === "arm64" ? "aarch64" : "x64"}&image_type=jdk&os=windows&vendor=eclipse`);
      const pkg = asset?.binary?.package;
      if (!pkg?.link) throw Error("No Java build was listed for this computer.");
      return { name: pkg.name, url: pkg.link, sha256: pkg.checksum, size: pkg.size };
    },
    find: (dir) => inside(dir, join("bin", exe("javac"))),
  },
  zig: {
    title: "the C and C++ compiler", folder: "zig",
    async latest() {
      const index = await json("https://ziglang.org/download/index.json");
      const version = Object.keys(index).filter((v) => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; })[0];
      const build = index[version]?.[`${arch === "arm64" ? "aarch64" : "x86_64"}-windows`];
      if (!build?.tarball) throw Error("No C compiler build was listed for this computer.");
      return { name: build.tarball.split("/").pop(), url: build.tarball, sha256: build.shasum, size: Number(build.size) };
    },
    find: (dir) => inside(dir, exe("zig")),
  },
  go: {
    title: "Go", folder: "go",
    async latest() {
      const [release] = await json("https://go.dev/dl/?mode=json");
      const file = release?.files?.find((f: any) => f.os === "windows" && f.arch === (arch === "arm64" ? "arm64" : "amd64") && f.kind === "archive");
      if (!file) throw Error("No Go build was listed for this computer.");
      return { name: file.filename, url: `https://go.dev/dl/${file.filename}`, sha256: file.sha256, size: file.size };
    },
    find: (dir) => inside(dir, join("bin", exe("go"))),
  },
};

type Plan = { file: string; /** What to show while compiling, when it is not just "Compiling…". */ note?: string; compile?: string[][]; run: string[]; env?: Record<string, string>; extra?: Record<string, string> };

export class CodeRunner {
  private runs = new Map<string, { child?: ChildProcess; stopped: boolean }>();
  private setups = new Map<string, Promise<string>>();
  private runtimes: string;
  private send: (event: CodeEvent) => void;
  constructor(runtimes: string, send: (event: CodeEvent) => void) { this.runtimes = runtimes; this.send = send; }

  async handle(request: CodeRequest) {
    if (!request || typeof request.id !== "string") throw Error("Not a run.");
    if (request.op === "start") { void this.start(request.id, String(request.lang), String(request.code)); return { started: true }; }
    const run = this.runs.get(request.id);
    if (request.op === "input") {
      const stdin = run?.child?.stdin;
      if (stdin && !stdin.destroyed) { if (request.text === null) stdin.end(); else stdin.write(String(request.text) + "\n"); }
      return { ok: true };
    }
    if (request.op === "stop") { if (run) { run.stopped = true; if (run.child) kill(run.child); } return { ok: true }; }
    throw Error("Unknown request.");
  }

  /** Ends every run (the window is closing). */
  /** A program is running, so restarting Clem now would cut it off. */
  get busy() { return this.runs.size > 0; }
  stopAll() { for (const run of this.runs.values()) { run.stopped = true; if (run.child) kill(run.child); } }

  private async start(id: string, lang: string, code: string) {
    const run = { stopped: false } as { child?: ChildProcess; stopped: boolean };
    this.runs.set(id, run);
    const emit = (type: CodeEvent["type"], text?: string) => this.send({ id, type, text });
    let dir: string | undefined;
    try {
      const plan = await this.plan(lang, code, (text) => emit("status", text));
      if (run.stopped) return;
      dir = await mkdtemp(join(tmpdir(), "clem-run-"));
      await writeFile(join(dir, plan.file), code);
      for (const [name, text] of Object.entries(plan.extra || {})) await writeFile(join(dir, name), text);
      const env = { ...process.env, ...plan.env };
      for (const step of plan.compile || []) {
        emit("status", plan.note ?? "Compiling…");
        const result = await this.exec(run, step, dir, env, COMPILE_MS);
        if (run.stopped) return;
        if (result.code !== 0) { emit("err", result.output || `The compiler stopped with code ${result.code}.\n`); this.send({ id, type: "done", ok: false }); return; }
        // Warnings are worth seeing; they do not stop the run.
        if (result.output.trim()) emit("err", result.output);
      }
      emit("status", "");
      emit("started");
      const code2 = await this.live(id, run, plan.run, dir, env);
      this.send({ id, type: "done", ok: !run.stopped && code2 === 0 });
    } catch (error) {
      if (!run.stopped) { emit("err", ((error as Error)?.message || String(error)) + "\n"); this.send({ id, type: "done", ok: false }); }
    } finally {
      this.runs.delete(id);
      if (dir) { const folder = dir; setTimeout(() => void rm(folder, { recursive: true, force: true }).catch(() => {}), 1500); }
    }
  }

  /** Runs a compile step to the end and returns what it printed. */
  private exec(run: { child?: ChildProcess; stopped: boolean }, [command, ...args]: string[], cwd: string, env: NodeJS.ProcessEnv, limit: number) {
    return new Promise<{ code: number; output: string }>((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      run.child = child;
      let output = "";
      const keep = (data: Buffer) => { output = (output + data.toString()).slice(-20_000); };
      child.stdout!.on("data", keep); child.stderr!.on("data", keep);
      const timer = setTimeout(() => { kill(child); reject(Error("Compiling took too long.")); }, limit);
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, output: tidy(output, cwd) }); });
    });
  }

  /** Runs the program with its output streamed to the chat and its input open for the person's lines. */
  private live(id: string, run: { child?: ChildProcess; stopped: boolean }, [command, ...args]: string[], cwd: string, env: NodeJS.ProcessEnv) {
    return new Promise<number>((resolve, reject) => {
      // A program built in the run's folder is started by its full path; spawn does not look in cwd for it.
      const child = spawn(!isAbsolute(command) && existsSync(join(cwd, command)) ? join(cwd, command) : command, args, { cwd, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      run.child = child;
      let total = 0;
      const stream = (type: "out" | "err") => { const decoder = new TextDecoder(); return (data: Buffer) => {
        total += data.length;
        if (total > OUTPUT_LIMIT) { if (!run.stopped) { run.stopped = true; this.send({ id, type: "err", text: "\nStopped: the program printed too much.\n" }); kill(child); } return; }
        const text = decoder.decode(data, { stream: true });
        if (text) this.send({ id, type, text: type === "err" ? tidy(text, cwd) : text });
      }; };
      child.stdout!.on("data", stream("out"));
      child.stderr!.on("data", stream("err"));
      // A program that exits without reading its input closes the pipe; writing to it later is not an error.
      child.stdin!.on("error", () => {});
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });
  }

  /** A portable toolchain from Clem's own folder, downloaded and unpacked the first time it is needed. */
  private portable(kind: keyof typeof portables, status: (text: string) => void) {
    const tool = portables[kind], dir = join(this.runtimes, tool.folder);
    const ready = tool.find(dir);
    if (ready) return Promise.resolve(ready);
    if (!windows) return Promise.reject(Error(`Install ${tool.title} to run this code.`));
    const running = this.setups.get(kind);
    if (running) return running;
    const job = (async () => {
      status(`Setting up ${tool.title} for Clem (one time)…`);
      const download = await tool.latest();
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const archive = join(dir, download.name.replace(/[^\w.+-]/g, "_"));
      const response = await fetch(download.url, { headers: { "user-agent": "Clem" } });
      if (!response.ok || !response.body) throw Error(`${tool.title} could not be downloaded (${response.status}). Check your internet connection and try again.`);
      const size = Number(response.headers.get("content-length")) || download.size || 0, hash = createHash("sha256"), file = createWriteStream(archive);
      let got = 0, shown = -1;
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        got += value.length;
        if (!file.write(value)) await new Promise<void>((resolve) => file.once("drain", () => resolve()));
        const percent = size ? Math.floor(got / size * 100) : -1;
        if (percent !== shown && (percent < 0 || percent % 2 === 0)) { shown = percent; status(`Setting up ${tool.title} for Clem (one time): ${Math.round(got / 1e6)}${size ? ` of ${Math.round(size / 1e6)}` : ""} MB…`); }
      }
      await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => (error ? reject(error) : resolve())));
      if (download.sha256 && hash.digest("hex").toLowerCase() !== download.sha256.toLowerCase()) { await rm(dir, { recursive: true, force: true }); throw Error(`The ${tool.title} download did not match its published checksum, so it was not used. Try again.`); }
      status(`Unpacking ${tool.title}…`);
      const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
      const unpacked = await new Promise<number>((resolve) => { const child = spawn(existsSync(tar) ? tar : "tar", ["-xf", archive, "-C", dir], { windowsHide: true, stdio: "ignore" }); child.on("error", () => resolve(1)); child.on("close", (code) => resolve(code ?? 1)); });
      await rm(archive, { force: true });
      const found = tool.find(dir);
      if (unpacked !== 0 || !found) { await rm(dir, { recursive: true, force: true }); throw Error(`${tool.title} could not be unpacked. Try again.`); }
      return found;
    })().finally(() => this.setups.delete(kind));
    this.setups.set(kind, job);
    return job;
  }

  private async java(status: (text: string) => void) {
    const javaHome = process.env.JAVA_HOME ? [join(process.env.JAVA_HOME, "bin")] : [];
    const installed = which(["javac"], [...javaHome, ...under(programFiles.flatMap((p) => [join(p, "Java"), join(p, "Eclipse Adoptium"), join(p, "Microsoft"), join(p, "Zulu"), join(p, "Amazon Corretto")]), /^(jdk|zulu|corretto)/i, "bin")]);
    const javac = installed ?? await this.portable("java", status);
    return { javac, java: join(javac, "..", exe("java")) };
  }

  /** How to build and run `code` in `lang`. */
  private async plan(lang: string, code: string, status: (text: string) => void): Promise<Plan> {
    const missing = (name: string, where: string) => Error(`${name} isn't installed on this computer. Install it from ${where}, then press Run again.`);
    switch (lang) {
      case "javascript":
      case "typescript": {
        // Clem's own Node.js; prompt() and input() read a line from the input box.
        const prelude = pathToFileURL(join(this.runtimes, "node-prelude.mjs")).href;
        await mkdir(this.runtimes, { recursive: true });
        await writeFile(join(this.runtimes, "node-prelude.mjs"), NODE_PRELUDE);
        const ts = lang === "typescript";
        return { file: ts ? "main.ts" : "main.js", extra: { "package.json": "{}" }, env: { ELECTRON_RUN_AS_NODE: "1", NODE_NO_WARNINGS: "1" },
          run: [process.execPath, ...(ts ? ["--experimental-transform-types"] : []), "--import", prelude, ts ? "main.ts" : "main.js"] };
      }
      case "java": {
        const { javac, java } = await this.java(status);
        // A public class must live in a file of its name; the class to start is the one holding main.
        const publicClass = code.match(/\bpublic\s+(?:(?:final|abstract|sealed|strictfp)\s+)*(?:class|record|enum|interface)\s+([A-Za-z_]\w*)/)?.[1];
        const pkg = code.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
        const main = javaMainClass(code) ?? publicClass ?? "Main";
        const file = (publicClass ?? main) + ".java";
        const utf8 = ["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8"];
        return { file, compile: [[javac, "-encoding", "UTF-8", "-d", "out", file]], run: [java, ...utf8, "-cp", "out", pkg ? `${pkg}.${main}` : main] };
      }
      case "kotlin": {
        const kotlinc = which(["kotlinc"]);
        if (!kotlinc) throw missing("Kotlin", "kotlinlang.org");
        const { java } = await this.java(status);
        return { file: "main.kt", compile: [[kotlinc, "main.kt", "-include-runtime", "-d", "main.jar"]], run: [java, "-jar", "main.jar"] };
      }
      case "c":
      case "cpp": {
        const cpp = lang === "cpp", out = exe("main"), file = cpp ? "main.cpp" : "main.c";
        // Standard output to a pipe is fully buffered in C; unbuffered, a prompt shows before the program waits for input.
        const helper = cpp ? "clem_io.cpp" : "clem_io.c";
        const extra = { [helper]: "#include <stdio.h>\n__attribute__((constructor)) static void clem_unbuffered(void) { setvbuf(stdout, NULL, _IONBF, 0); }\n" };
        const native = which(cpp ? ["g++", "clang++"] : ["gcc", "clang"], [join("C:\\msys64", "ucrt64", "bin"), join("C:\\msys64", "mingw64", "bin"), ...programFiles.map((p) => join(p, "LLVM", "bin"))]);
        const flags = cpp ? ["-std=c++20"] : ["-std=c17"];
        if (native) return { file, extra, compile: [[native, ...flags, "-O2", file, helper, "-o", out, ...(cpp ? [] : ["-lm"])]], run: [out] };
        const zig = which(["zig"]) ?? await this.portable("zig", status);
        // Zig builds its C library the first time, which takes about a minute; later builds use the cache.
        const cache = join(this.runtimes, "zig-cache");
        return { file, extra, note: existsSync(cache) ? undefined : "Compiling (the first time takes about a minute)…", env: { ZIG_GLOBAL_CACHE_DIR: cache, ZIG_LOCAL_CACHE_DIR: cache }, compile: [[zig, cpp ? "c++" : "cc", ...flags, "-O2", file, helper, "-o", out]], run: [out] };
      }
      case "go": {
        const go = which(["go"], programFiles.map((p) => join(p, "Go", "bin"))) ?? await this.portable("go", status);
        return { file: "main.go", env: { GOTOOLCHAIN: "local", GO111MODULE: "auto", GOFLAGS: "" }, compile: [[go, "build", "-o", exe("main"), "main.go"]], run: [exe("main")] };
      }
      case "rust": {
        const rustc = which(["rustc"], process.env.USERPROFILE ? [join(process.env.USERPROFILE, ".cargo", "bin")] : []);
        if (!rustc) throw missing("Rust", "rustup.rs");
        return { file: "main.rs", compile: [[rustc, "--edition", "2021", "-O", "main.rs", "-o", exe("main")]], run: [exe("main")] };
      }
      case "csharp": {
        // .NET 10 runs a single .cs file directly.
        const dotnet = which(["dotnet"], programFiles.map((p) => join(p, "dotnet")));
        if (!dotnet) throw missing(".NET 10 SDK (for C#)", "dotnet.microsoft.com");
        const env = { DOTNET_CLI_TELEMETRY_OPTOUT: "1", DOTNET_NOLOGO: "1", DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1" };
        const sdks = await new Promise<string>((resolve) => { const child = spawn(dotnet, ["--list-sdks"], { windowsHide: true, env: { ...process.env, ...env } }); let out = ""; child.stdout.on("data", (d) => (out += d)); child.on("error", () => resolve("")); child.on("close", () => resolve(out)); });
        if (!sdks.split("\n").some((line) => Number(line.split(".")[0]) >= 10)) throw missing(".NET 10 SDK (for C#)", "dotnet.microsoft.com");
        status("Building…");
        return { file: "main.cs", env, run: [dotnet, "run", "main.cs"] };
      }
      default: {
        const scripts: Record<string, { names: string[]; file: string; args?: string[]; name: string; where: string; extra?: string[] }> = {
          ruby: { names: ["ruby"], file: "main.rb", name: "Ruby", where: "rubyinstaller.org" },
          php: { names: ["php"], file: "main.php", name: "PHP", where: "php.net" },
          perl: { names: ["perl"], file: "main.pl", name: "Perl", where: "strawberryperl.com" },
          lua: { names: ["lua", "lua54", "lua5.4"], file: "main.lua", name: "Lua", where: "lua.org" },
          r: { names: ["Rscript"], file: "main.R", name: "R", where: "cran.r-project.org", extra: under(programFiles.map((p) => join(p, "R")), /^R-/, "bin") },
          swift: { names: ["swift"], file: "main.swift", name: "Swift", where: "swift.org" },
          dart: { names: ["dart"], file: "main.dart", args: ["run"], name: "Dart", where: "dart.dev" },
        };
        const script = scripts[lang];
        if (!script) throw Error(`Clem can't run ${lang} code.`);
        const path = which(script.names, script.extra);
        if (!path) throw missing(script.name, script.where);
        return { file: script.file, run: [path, ...(script.args || []), script.file] };
      }
    }
  }
}

/** The top-level class whose body holds `main`, found by matching braces with strings and comments blanked out. */
export function javaMainClass(code: string) {
  const blank = code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) => " ".repeat(m.length));
  const mainAt = blank.search(/\bvoid\s+main\s*\(/);
  if (mainAt < 0) return undefined;
  let depth = 0, top: string | undefined;
  const declaration = /\b(?:class|record|enum|interface)\s+([A-Za-z_]\w*)/g;
  for (let i = 0; i < mainAt; i++) {
    const c = blank[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && /[cire]/.test(c)) { declaration.lastIndex = i; const m = declaration.exec(blank); if (m && m.index === i) top = m[1]; }
  }
  return top;
}

/** Ends a process and everything it started (go run, dotnet and shells start children of their own). */
function kill(child: ChildProcess) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (windows) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }).on("error", () => child.kill());
  else child.kill("SIGKILL");
}
/** Compiler messages name the temporary folder; only the file name matters to the person. */
const tidy = (text: string, dir: string) => text.split(dir + (windows ? "\\" : "/")).join("").split(dir).join(".");

/** Loaded before JavaScript and TypeScript: prompt(question) and input(question) print the question and return the
 *  next line typed into the run's input box, or null when input has ended. */
const NODE_PRELUDE = `import { readSync, writeSync } from "node:fs";
const one = Buffer.alloc(1);
function line() {
  const bytes = [];
  for (;;) {
    let n = 0;
    try { n = readSync(0, one, 0, 1, null); }
    catch (error) { if (error.code === "EAGAIN") continue; if (error.code === "EOF") n = 0; else throw error; }
    if (!n) return bytes.length ? Buffer.from(bytes).toString("utf8") : null;
    if (one[0] === 10) break;
    bytes.push(one[0]);
  }
  return Buffer.from(bytes).toString("utf8").replace(/\\r$/, "");
}
function ask(question = "") {
  if (question !== "") writeSync(1, String(question) + (/\\s$/.test(String(question)) ? "" : " "));
  return line();
}
globalThis.prompt = ask;
globalThis.input = ask;
`;
