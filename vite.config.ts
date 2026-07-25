import { defineConfig } from 'vite';

export default defineConfig({
  define: { global: 'globalThis' },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    // V33: 强制预打包 mammoth / jszip,避免 require 转 ESM 失败
    commonjsOptions: {
      include: [/node_modules/, /mammoth/, /jszip/],
    },
  },
  optimizeDeps: {
    // V33: 显式 include mammoth + jszip,确保 polyfill 正确
    include: ['mammoth', 'jszip', 'dompurify'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
});