// Runs chat code blocks. Python and JavaScript run in a sealed worker (see run-worker.ts) everywhere: Python keeps one
// worker so it stays loaded between runs, JavaScript gets a fresh worker per run. In Clem for Windows, the other
// languages (Java, C, C++, C#, Go, Rust, TypeScript…) run on this computer through the main process
// (desktop/code-runner.ts), as does JavaScript that reads input. A stopped or timed-out run tears its worker down.
// While a program runs, lines typed into its input box go to its standard input.

export type WorkerLang = 'python' | 'javascript';
export type LocalLang = 'typescript' | 'java' | 'c' | 'cpp' | 'csharp' | 'go' | 'rust' | 'kotlin' | 'ruby' | 'php' | 'perl' | 'lua' | 'r' | 'swift' | 'dart';
export type RunLang = WorkerLang | LocalLang;
export type RunEvent = { type: 'out' | 'err' | 'status'; text: string } | { type: 'waiting' } | { type: 'done'; ok: boolean; stopped?: boolean };
/** Stops the run when called; `send` hands the program a line of input (null ends its input). */
export type RunHandle = (() => void) & { send(line: string | null): void };

const ALIASES: Record<string, RunLang> = {
  python: 'python', py: 'python', python3: 'python', javascript: 'javascript', js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript', jsx: 'javascript',
  typescript: 'typescript', ts: 'typescript', mts: 'typescript', java: 'java', c: 'c', h: 'c', cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', csharp: 'csharp', 'c#': 'csharp', go: 'go', golang: 'go', rust: 'rust', rs: 'rust', kotlin: 'kotlin', kt: 'kotlin',
  ruby: 'ruby', rb: 'ruby', php: 'php', perl: 'perl', pl: 'perl', lua: 'lua', r: 'r', swift: 'swift', dart: 'dart',
};
type CodeBridge = { runCode?: (request: { op: string; id?: string; lang?: string; code?: string; text?: string | null }) => Promise<unknown>; onCode?: (listener: (event: { id: string; type: string; text?: string; ok?: boolean }) => void) => () => void };
const bridge = () => (globalThis as { clemDesktop?: CodeBridge }).clemDesktop;
const local = () => { const b = bridge(); return b?.runCode && b.onCode ? b : null; };
/** The language a code fence runs as, or null when Clem cannot run it here. */
export const runnable = (lang: string): RunLang | null => {
  const run = ALIASES[lang.toLowerCase()] ?? null;
  return run === 'python' || run === 'javascript' || (run && local()) ? run : null;
};
/** JavaScript that reads input or uses Node's modules runs under Node on this computer, where it can. */
const wantsNode = (code: string) => /\bprompt\s*\(|\breadline\b|process\.stdin|\brequire\s*\(|from\s+['"]node:|from\s+['"](?:fs|readline|path|os|child_process)['"]/.test(code);

const LIMIT_MS = 60_000;
let python: Worker | null = null, nextId = 1;
const spawn = (lang: WorkerLang) => new Worker(new URL('./run-worker.ts', import.meta.url), { type: 'module', name: 'clem-run-' + lang });
/** Runs waiting on or using the shared Python worker; stopping one restarts the worker, which ends the others too. */
const pythonRuns = new Set<() => void>();

/** Starts a run and streams its output to `on`. The returned function stops it. The time limit counts from the last
 *  input, so a program waiting for the person is not cut off while they type. */
export function runCode(lang: RunLang, code: string, on: (e: RunEvent) => void): RunHandle {
  const desktop = local();
  if (lang !== 'python' && (lang !== 'javascript' || (desktop && wantsNode(code)))) {
    if (!desktop) { on({ type: 'err', text: 'This language runs in Clem for Windows.\n' }); on({ type: 'done', ok: false }); return Object.assign(() => {}, { send() {} }); }
    return runLocal(desktop, lang, code, on);
  }
  const id = nextId++, w = lang === 'python' ? (python ??= spawn(lang)) : spawn(lang);
  let finished = false, timer = setTimeout(() => {}, 0);
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { on({ type: 'err', text: `Stopped after ${LIMIT_MS / 1000} seconds.\n` }); finish({ type: 'done', ok: false, stopped: true }, true); }, LIMIT_MS); };
  const finish = (e: RunEvent & { type: 'done' }, kill = false) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    pythonRuns.delete(ended);
    w.removeEventListener('message', listen);
    w.removeEventListener('error', crash);
    if (kill || lang !== 'python') w.terminate();
    if (kill && w === python) {
      python = null;
      for (const other of [...pythonRuns]) other();
    }
    on(e);
  };
  const ended = () => { on({ type: 'err', text: 'Python restarted because another run was stopped. Run this block again.\n' }); finish({ type: 'done', ok: false, stopped: true }); };
  if (lang === 'python') pythonRuns.add(ended);
  const listen = (event: MessageEvent<{ id: number; type: string; text?: string; ok?: boolean }>) => {
    const m = event.data;
    if (m.id !== id) return;
    if (m.type === 'done') finish({ type: 'done', ok: !!m.ok });
    // Waiting on the person: the clock stops until they answer.
    else if (m.type === 'input') { clearTimeout(timer); on({ type: 'waiting' }); }
    else if (m.type === 'out' || m.type === 'err' || m.type === 'status') on({ type: m.type, text: m.text ?? '' });
  };
  const crash = (event: ErrorEvent) => { on({ type: 'err', text: (event.message || 'The runner stopped unexpectedly.') + '\n' }); finish({ type: 'done', ok: false }, true); };
  arm();
  w.addEventListener('message', listen);
  w.addEventListener('error', crash);
  w.postMessage({ id, lang, code, pyodideBase: new URL('pyodide/', document.baseURI).href });
  return Object.assign(() => finish({ type: 'done', ok: false, stopped: true }, true), {
    send(line: string | null) { if (finished) return; arm(); w.postMessage({ id, type: 'stdin', text: line }); },
  });
}

let localId = 0;
const localRuns = new Map<string, (e: { type: string; text?: string; ok?: boolean }) => void>();
let unlisten: (() => void) | null = null;
/** A run on this computer (desktop/code-runner.ts): output and the end arrive as events, input goes back by id. */
function runLocal(desktop: CodeBridge, lang: RunLang, code: string, on: (e: RunEvent) => void): RunHandle {
  const id = `run-${Date.now().toString(36)}-${++localId}`;
  unlisten ??= desktop.onCode!((event) => localRuns.get(event.id)?.(event));
  let finished = false, timer = setTimeout(() => {}, 0);
  // Setting up a language the first time (a download) is not counted; the limit starts once the program does.
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { on({ type: 'err', text: `Stopped after ${LIMIT_MS / 1000} seconds.\n` }); stop(); }, LIMIT_MS); };
  const finish = (e: RunEvent & { type: 'done' }) => { if (finished) return; finished = true; clearTimeout(timer); localRuns.delete(id); on(e); };
  const stop = () => { if (finished) return; void desktop.runCode!({ op: 'stop', id }).catch(() => {}); finish({ type: 'done', ok: false, stopped: true }); };
  localRuns.set(id, (e) => {
    if (e.type === 'done') finish({ type: 'done', ok: !!e.ok });
    else if (e.type === 'started') arm();
    else if (e.type === 'out' || e.type === 'err' || e.type === 'status') on({ type: e.type, text: e.text ?? '' });
  });
  desktop.runCode!({ op: 'start', id, lang, code }).catch((error: Error) => { on({ type: 'err', text: (error?.message || String(error)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') + '\n' }); finish({ type: 'done', ok: false }); });
  return Object.assign(() => stop(), {
    send(line: string | null) { if (finished) return; arm(); void desktop.runCode!({ op: 'input', id, text: line }).catch(() => {}); },
  });
}
