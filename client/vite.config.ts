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
  build: {
    commonjsOptions: {
      // Same symlink issue as optimizeDeps above, but for the production
      // Rollup build specifically — commonjsOptions.include defaults to
      // /node_modules/, which doesn't match 'shared' once Rollup resolves
      // the symlink to its real path outside node_modules. Without this,
      // named imports from 'shared' (e.g. `import { ROLES }`) fail to
      // build with "is not exported by shared", even though dev mode works.
      include: [/shared/, /node_modules/],
    },
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
