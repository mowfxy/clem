/// <reference lib="webworker" />
// Runs a chat code block away from the page. Python runs on Pyodide (bundled, loaded on first use); JavaScript runs as a
// module function. Python's input() and sys.stdin wait for lines the person types into the run's input box (sent here as
// "stdin" messages), which needs a browser that can pause WebAssembly (JSPI). Before any user code runs, the worker's
// network and storage are removed, so a snippet can print and compute but cannot reach Clem's local API, the web or saved data.

type Run = { id: number; lang: 'python' | 'javascript'; code: string; pyodideBase: string };
type Stdin = { id: number; type: 'stdin'; text: string | null };
type Out = { id: number; type: 'out' | 'err' | 'status' | 'done' | 'input'; text?: string; ok?: boolean };

const post = (m: Out) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
type Pyodide = { runPythonAsync(code: string, options?: { globals?: unknown }): Promise<unknown>; runPython(code: string): unknown; registerJsModule(name: string, module: object): void; setStdout(o: object): void; setStderr(o: object): void; setStdin(o: object): void; globals: { get(name: string): () => unknown } };
let pyodide: Promise<Pyodide> | null = null;
let sealed = false;

/** Removes every way out of the worker. Pyodide's `js` module reads globalThis, so this covers Python too. */
function seal() {
  if (sealed) return;
  sealed = true;
  for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'navigator', 'RTCPeerConnection', 'cookieStore'])
    // Removed from every prototype too, so Object.getPrototypeOf(self).fetch cannot bring it back.
    for (let o: object | null = globalThis; o; o = Object.getPrototypeOf(o))
      try { if (Object.prototype.hasOwnProperty.call(o, key)) Object.defineProperty(o, key, { value: undefined, configurable: false, writable: false }); } catch { /* not configurable */ }
}

/* ── Standard input ── Lines typed while a run goes are queued for it; a read with nothing queued tells the page the
   program is waiting, and resolves when the next line arrives. undefined is the end of input. */
let current = 0;
const typed: (string | undefined)[] = [];
let waiter: ((line: string | undefined) => void) | null = null;
function readLine(): Promise<string | undefined> {
  if (typed.length) return Promise.resolve(typed.shift()!);
  post({ id: current, type: 'input' });
  return new Promise((resolve) => { waiter = resolve; });
}
function stdin(message: Stdin) {
  if (message.id !== current) return;
  // The end of input reaches Python as None (undefined); a JS null would arrive as jsnull.
  const text = message.text ?? undefined;
  if (waiter) { const resolve = waiter; waiter = null; resolve(text); } else typed.push(text);
}
// input() and sys.stdin read through clem_io; run_sync pauses the Python stack until the line arrives.
const PYTHON_INPUT = String.raw`
import builtins, io, sys
import clem_io
from pyodide.ffi import run_sync, can_run_sync
def _clem_line():
    if not can_run_sync():
        raise RuntimeError("This browser cannot pause Python for input. Run it in Clem for Windows, or in Chrome or Edge.")
    line = run_sync(clem_io.read())
    return None if line is None else str(line)
def _clem_input(prompt=""):
    if prompt:
        sys.stdout.write(str(prompt))
    sys.stdout.flush()
    line = _clem_line()
    if line is None:
        raise EOFError("EOF when reading a line")
    return line
class _ClemStdin(io.TextIOBase):
    def readable(self):
        return True
    def readline(self, size=-1):
        sys.stdout.flush()
        line = _clem_line()
        return "" if line is None else line + "\n"
    def read(self, size=-1):
        out = []
        while True:
            line = self.readline()
            if not line:
                break
            out.append(line)
            if size is not None and 0 <= size <= sum(map(len, out)):
                break
        return "".join(out)
    def __iter__(self):
        return self
    def __next__(self):
        line = self.readline()
        if not line:
            raise StopIteration
        return line
builtins.input = _clem_input
sys.stdin = _ClemStdin()
`;

function loadPython(base: string, id: number) {
  if (!pyodide) pyodide = (async () => {
    post({ id, type: 'status', text: 'Loading Python…' });
    const { loadPyodide } = await import(/* @vite-ignore */ base + 'pyodide.mjs');
    const py: Pyodide = await loadPyodide({ indexURL: base, fullStdLib: false });
    py.registerJsModule('clem_io', { read: readLine });
    py.runPython(PYTHON_INPUT);
    return py;
  })().catch((e) => { pyodide = null; throw new Error('Python could not load: ' + ((e as Error)?.message || e)); });
  return pyodide;
}

const show = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || String(value);
  try { const flat = JSON.stringify(value); return flat === undefined ? String(value) : flat.length > 80 ? JSON.stringify(value, null, 2) : flat; } catch { return String(value); }
};

async function runJavaScript(run: Run) {
  const write = (type: 'out' | 'err') => (...args: unknown[]) => post({ id: run.id, type, text: args.map(show).join(' ') + '\n' });
  const log = write('out'), err = write('err');
  Object.assign(console, { log, info: log, debug: log, warn: err, error: err, table: log });
  seal();
  // An async function body, so top-level await works; the last expression is not echoed (like a script).
  const body = new Function('"use strict";return (async () => {\n' + run.code + '\n})()') as () => Promise<unknown>;
  const result = await body();
  if (result !== undefined) log(result);
}

async function runPython(run: Run) {
  const py = await loadPython(run.pyodideBase, run.id);
  // Raw writes rather than whole lines, so a prompt such as input("Name: ") shows before the program waits.
  const writer = (type: 'out' | 'err') => { const decoder = new TextDecoder(); return { write: (buffer: Uint8Array) => { const text = decoder.decode(buffer, { stream: true }); if (text) post({ id: run.id, type, text }); return buffer.length; } }; };
  py.setStdout(writer('out'));
  py.setStderr(writer('err'));
  py.setStdin({ error: true });
  post({ id: run.id, type: 'status', text: '' });
  seal();
  // Each block starts with empty globals, so one answer's snippets never see another's variables.
  const result = await py.runPythonAsync(run.code, { globals: py.globals.get('dict')() });
  if (result !== undefined && result !== null) post({ id: run.id, type: 'out', text: String(result) + '\n' });
}

// Runs go one at a time: Pyodide's stdout is global, so overlapping runs would print into each other's output.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<Run | Stdin>) => {
  const message = event.data;
  if ('type' in message && message.type === 'stdin') return stdin(message);
  queue = queue.then(() => execute(message as Run));
};

async function execute(run: Run) {
  current = run.id;
  typed.length = 0;
  waiter = null;
  try {
    await (run.lang === 'python' ? runPython(run) : runJavaScript(run));
    post({ id: run.id, type: 'done', ok: true });
  } catch (e) {
    const message = (e as Error)?.message || String(e);
    // Pyodide prefixes its own traceback frames; keep only the part that refers to the user's code.
    const trimmed = message.includes('File "<exec>"') ? 'Traceback (most recent call last):\n' + message.slice(message.indexOf('File "<exec>"')).replace(/^/, '  ') : message;
    post({ id: run.id, type: 'err', text: trimmed.trimEnd() + '\n' });
    post({ id: run.id, type: 'done', ok: false });
  }
}
