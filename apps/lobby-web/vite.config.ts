import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 部署在 /lobby/ 子路径下，与同机其他站点共存。
 * 开发环境同样通过 /lobby 前缀代理到后端，保证路径一致。
 */
const BASE = '/lobby/';

export default defineConfig({
  plugins: [react()],
  base: BASE,
  server: {
    port: 5173,
    proxy: {
      '/lobby/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lobby/, ''),
      },
      '/lobby/ws': {
        target: 'ws://127.0.0.1:9000',
        ws: true,
        rewrite: (path) => path.replace(/^\/lobby/, ''),
      },
    },
  },
  optimizeDeps: {
    exclude: ['@cc/protocol'],
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
