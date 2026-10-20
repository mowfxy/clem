// Runs chat code blocks in a sealed worker (see run-worker.ts). Python keeps one worker so it stays loaded between runs;
// JavaScript gets a fresh worker per run. A stopped or timed-out run tears its worker down.

export type RunLang = 'python' | 'javascript';
export type RunEvent = { type: 'out' | 'err' | 'status'; text: string } | { type: 'done'; ok: boolean; stopped?: boolean };

const ALIASES: Record<string, RunLang> = { python: 'python', py: 'python', python3: 'python', javascript: 'javascript', js: 'javascript', mjs: 'javascript', node: 'javascript' };
/** The language a code fence runs as, or null when Clem cannot run it. */
export const runnable = (lang: string): RunLang | null => ALIASES[lang.toLowerCase()] ?? null;

const LIMIT_MS = 60_000;
let python: Worker | null = null, nextId = 1;
const spawn = (lang: RunLang) => new Worker(new URL('./run-worker.ts', import.meta.url), { type: 'module', name: 'clem-run-' + lang });
/** Runs waiting on or using the shared Python worker; stopping one restarts the worker, which ends the others too. */
const pythonRuns = new Set<() => void>();

/** Starts a run and streams its output to `on`. The returned function stops it. */
export function runCode(lang: RunLang, code: string, on: (e: RunEvent) => void): () => void {
  const id = nextId++, w = lang === 'python' ? (python ??= spawn(lang)) : spawn(lang);
  let finished = false;
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
    else if (m.type === 'out' || m.type === 'err' || m.type === 'status') on({ type: m.type, text: m.text ?? '' });
  };
  const crash = (event: ErrorEvent) => { on({ type: 'err', text: (event.message || 'The runner stopped unexpectedly.') + '\n' }); finish({ type: 'done', ok: false }, true); };
  const timer = setTimeout(() => { on({ type: 'err', text: `Stopped after ${LIMIT_MS / 1000} seconds.\n` }); finish({ type: 'done', ok: false, stopped: true }, true); }, LIMIT_MS);
  w.addEventListener('message', listen);
  w.addEventListener('error', crash);
  w.postMessage({ id, lang, code, pyodideBase: new URL('pyodide/', document.baseURI).href });
  return () => finish({ type: 'done', ok: false, stopped: true }, true);
}
