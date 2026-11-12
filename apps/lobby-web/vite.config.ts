import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 部署在 /lobby/ 子路径下，与同机其他站点共存。
 * 开发环境同样通过 /lobby 前缀代理到后端，保证路径一致。
 */
const BASE = '/lobby/';

// 后端地址可用环境变量覆盖，避免换机器就要改代码
const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8080';
const WS_TARGET = process.env.VITE_WS_TARGET ?? 'ws://127.0.0.1:9000';

export default defineConfig({
  plugins: [react()],
  base: BASE,
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/lobby/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/lobby/, ''),
      },
      '/lobby/ws': {
        target: WS_TARGET,
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
    // 各视图/玩法按需加载，CSS 也按 chunk 拆分
    cssCodeSplit: true,
  },
});
