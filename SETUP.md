# LeoLiao APP — 本地 build APK 步骤

> 在 Leo 的电脑（Mac/Windows/Linux）上把 `/mnt/work/leoliao-app/` 跑起来，产出 APK 装到手机。

## 0. 前提检查

Leo 电脑上需要：

- **Node.js 20+** — [nodejs.org](https://nodejs.org) 下载 LTS 版
- **Android Studio** — [developer.android.com/studio](https://developer.android.com/studio) 下载
  - 安装时勾选：Android SDK（API 34）、Android SDK Build-Tools、Android SDK Platform-Tools、Android Emulator（可选）
- **JDK 17** — Android Studio 自带，**不需要单独装**
- **USB 数据线 + 能开"USB 调试"的手机**

终端验证：
```bash
node -v          # 应 >= v20
npm -v           # 应 >= 10
java -version    # 应是 17.x（Android Studio 自带）
adb version      # 应有版本号
```

## 1. 把项目从 NAS 拉到电脑

```bash
# Mac/Linux
scp -r user@nas-ip:/mnt/work/leoliao-app ~/leoliao-app
cd ~/leoliao-app

# Windows：用 WinSCP 或 FileZilla 拖下来
```

## 2. 装依赖

```bash
cd ~/leoliao-app
npm install
# → 大约 1-2 分钟
```

## 3. 浏览器先看效果

```bash
npm run dev
# → http://localhost:5173
# → 应看到 "📚 LeoLiao" 启动页
# → 浏览器控制台（DevTools）应看到 [LeoLiao] Platform: web Native: false
```

如果浏览器能看到，基础链路就通了。

## 4. 第一次同步到 Android

```bash
npm run build         # tsc + vite build → dist/
npx cap sync android  # dist/ 复制到 android/app/src/main/assets/public/
# → 看到 "Sync finished" 表示成功
```

## 5a. 用 Android Studio 跑（推荐）

```bash
npx cap open android
# → Android Studio 自动打开 android/ 子目录
# → 第一次打开会下载 Gradle + Android SDK 依赖，5-15 分钟（看网速）
# → 等底部 Build 进度条跑完
# → 手机 USB 连上电脑，开启"USB 调试"（手机设置 → 开发者选项）
# → 点 IDE 顶部 ▶ 绿色三角 Run
# → 手机上出现 LeoLiao APP 图标
```

## 5b. 命令行直接 build APK

```bash
cd android
./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

APK 拷贝到手机点击安装（需允许"未知来源"）。

## 6. 日常开发循环

```bash
# 改 src/* 之后
npm run sync              # 同步到 android/
# → Android Studio 点 ▶ 重新 Run
```

或者更简洁的：
```bash
npm run android:apk       # 一键 build + assembleDebug
```

## 7. 排错清单

| 症状 | 解决 |
|---|---|
| `JAVA_HOME not set` | Android Studio 自带 JDK，加 PATH: `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` (Mac) |
| `SDK location not found` | Android Studio 第一次打开会问 SDK 装哪里，指定一个目录（如 `~/Android/Sdk`） |
| Gradle 下载超时 | 在 `~/.gradle/init.d/repos.gradle.kts` 配阿里云镜像 |
| 手机连不上 | 装 Google USB Driver（Windows）；Mac 一般自动识别 |
| APK 装不上 | 手机开启"开发者选项 → USB 调试 + 允许未知来源" |
| 白屏 | 看 `adb logcat | grep -i capacitor`，通常是 dist/ 没同步 |
| 网络访问 NAS 不通 | `android/app/src/main/AndroidManifest.xml` 加 `usesCleartextTraffic="true"` |

## 8. 后续阶段

Phase 0（脚手架）✅ 完成后，进入：

- **Phase 1**: MD 读取器（拉 OSS → 渲染 → 文件树）
- **Phase 2**: 全文搜索
- **Phase 3**: 反向链接 / 标签
- **Phase 4**: 体验打磨

每次阶段完成 Leo 在 NAS 跑一次同步，Leo 电脑 `npm run sync` + Android Studio Run 就能装新版。

## 时间预算

| 阶段 | 时间 |
|---|---|
| 安装 Android Studio + SDK | 30 分钟（首次） |
| 项目跑通 Hello World | 1 小时 |
| 进 Phase 1 后边写边调 | 持续迭代 |