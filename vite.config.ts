import { defineConfig } from 'vite';

/**
 * v1.69: 只保留 KaTeX 的 woff2 字体引用。
 *
 * katex.min.css 每个字族都写了 woff2 + woff + ttf 三种格式(20 字族 × 3 = 60 个文件,
 * 共约 1.03 MB)。Android WebView(Chromium 130+)完全支持 woff2,woff/ttf 永远用不到。
 * 构建时去掉这两条引用,Vite 就只打包 woff2(约 254 KB),APK 少 ~780 KB。
 * 用插件而不是维护一份 CSS 副本,升级 katex 后依然生效。
 */
function katexWoff2Only() {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.includes('katex') || !id.endsWith('.css')) return null;
      return code.replace(
        /,\s*url\([^)]*\.(?:woff|ttf)\)\s*format\((?:"|')?(?:woff|truetype)(?:"|')?\)/g,
        '',
      );
    },
  };
}

export default defineConfig({
  plugins: [katexWoff2Only()],
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