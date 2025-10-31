import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const apiPort = Number(process.env.API_PORT ?? '8000');

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@solver': join(repoRoot, 'solver'),
    },
  },
});
