/// <reference lib="webworker" />
// Runs a chat code block away from the page. Python runs on Pyodide (bundled, loaded on first use); JavaScript runs as a
// module function. Before any user code runs, the worker's network and storage are removed, so a snippet can print and
// compute but cannot reach Clem's local API, the web or saved data.

type Run = { id: number; lang: 'python' | 'javascript'; code: string; pyodideBase: string };
type Out = { id: number; type: 'out' | 'err' | 'status' | 'done'; text?: string; ok?: boolean };

const post = (m: Out) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
type Pyodide = { runPythonAsync(code: string, options?: { globals?: unknown }): Promise<unknown>; setStdout(o: object): void; setStderr(o: object): void; setStdin(o: object): void; globals: { get(name: string): () => unknown } };
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

function loadPython(base: string, id: number) {
  if (!pyodide) pyodide = (async () => {
    post({ id, type: 'status', text: 'Loading Python…' });
    const { loadPyodide } = await import(/* @vite-ignore */ base + 'pyodide.mjs');
    return loadPyodide({ indexURL: base, fullStdLib: false });
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
  py.setStdout({ batched: (text: string) => post({ id: run.id, type: 'out', text: text + '\n' }) });
  py.setStderr({ batched: (text: string) => post({ id: run.id, type: 'err', text: text + '\n' }) });
  py.setStdin({ error: true });
  post({ id: run.id, type: 'status', text: '' });
  seal();
  // Each block starts with empty globals, so one answer's snippets never see another's variables.
  const result = await py.runPythonAsync(run.code, { globals: py.globals.get('dict')() });
  if (result !== undefined && result !== null) post({ id: run.id, type: 'out', text: String(result) + '\n' });
}

// Runs go one at a time: Pyodide's stdout is global, so overlapping runs would print into each other's output.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<Run>) => { queue = queue.then(() => execute(event.data)); };

async function execute(run: Run) {
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
