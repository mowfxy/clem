import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base:'./', plugins: [react()], server: { proxy: { '/api': process.env.MOWR_API_ORIGIN || 'http://127.0.0.1:8787' } }, build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } } });

