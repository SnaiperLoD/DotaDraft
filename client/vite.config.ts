import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // 'shared' is a workspace symlink, not a real node_modules dependency, so
    // Vite's dep scanner skips it and serves its CommonJS build as-is (which
    // breaks in the browser). Forcing it through esbuild's pre-bundling gives
    // it the same CJS->ESM interop other node_modules deps get for free.
    include: ['shared'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
