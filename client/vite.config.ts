import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sharedEntry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared/index.ts');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Workspace `shared` ships CJS dist. Vite's optimizeDeps cache does not
      // invalidate when that dist grows new named exports, so
      // `import { OWNER_TOKEN_HEADER }` / `CM_STEPS` become undefined in the
      // browser (401 Missing owner token, then crash on CM_STEPS.length).
      // Point at the TypeScript source instead of prebundling dist.
      shared: sharedEntry,
    },
  },
  optimizeDeps: {
    exclude: ['shared'],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/],
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.E2E_API_ORIGIN ?? 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
