import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The API serves the built interface itself (one origin). In development, Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.MAHDAR_API ?? 'http://127.0.0.1:8000', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
});
