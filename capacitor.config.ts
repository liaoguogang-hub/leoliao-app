import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.leoliao.app',
  appName: '知识库',
  webDir: 'dist',
  // Android 允许访问 NAS / OSS（http 协议）
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  android: {
    // 允许混合内容（HTTPS 页面里加载 HTTP 资源）
    allowMixedContent: true,
  },
};

export default config;