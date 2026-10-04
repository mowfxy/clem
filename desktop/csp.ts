/**
 * The Content-Security-Policy of each page the app serves from mowr://app.
 * - The chat code runner's worker compiles Python (WebAssembly) and JavaScript snippets, so it alone may evaluate code;
 *   it can only fetch the bundled Pyodide files and seals its network before any snippet runs (src/chat/run-worker.ts).
 * - The HEIC photo converter's worker compiles libheif (WebAssembly) and may fetch only its own .wasm file (src/desktop/heic-worker.ts).
 */
export function contentSecurityPolicy(pathname: string) {
  if (/^\/assets\/run-worker-[\w-]+\.js$/.test(pathname)) return "default-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'; connect-src mowr://app/pyodide/";
  if (/^\/assets\/heic-worker-[\w-]+\.js$/.test(pathname)) return "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";
  return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob: http://127.0.0.1:*; frame-src https://www.youtube-nocookie.com; object-src 'none'";
}
