import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Serves Pyodide at /pyodide/ (dev) and copies it into the build, so chat code blocks run Python without a CDN. */
const PYODIDE = join('node_modules', 'pyodide'), PYODIDE_FILES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];
const TYPES: Record<string, string> = { mjs: 'text/javascript', wasm: 'application/wasm', zip: 'application/zip', json: 'application/json' };
function pyodide(): Plugin {
  return {
    name: 'mowr-pyodide',
    configureServer(server) {
      server.middlewares.use('/pyodide/', (req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\//, '');
        if (!PYODIDE_FILES.includes(name)) return next();
        res.setHeader('Content-Type', TYPES[name.split('.').pop()!]);
        res.end(readFileSync(join(PYODIDE, name)));
      });
    },
    generateBundle() {
      for (const name of PYODIDE_FILES) this.emitFile({ type: 'asset', fileName: 'pyodide/' + name, source: readFileSync(join(PYODIDE, name)) });
    },
  };
}

export default defineConfig({ base:'./', plugins: [react(), pyodide()], worker: { format: 'es' }, server: { proxy: { '/api': process.env.MOWR_API_ORIGIN || 'http://127.0.0.1:8787' } }, build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } } });
