# 同步脚本

> OSS 同步方案:Obsidian 端用 Remotely Save 插件直接把 md push 到 OSS `Obsidian/` 目录,
> Win 笔记本上的脚本只负责**扫 OSS 实际文件,重建 manifest.json** 给 APK 用。

## 文件清单

| 文件 | 作用 | 触发 |
|---|---|---|
| `gen_oss_manifest.mjs` | 列 `oss://liaoguogang/Obsidian/` 实际对象,只收 `.md`,生成 `Obsidian/manifest.json` 上传;顺带重建 `welcome/manifest.json` | 手动 / WTS |
| `update-manifest-silent.bat` | WTS 调用的无窗口入口(备用,当前注册任务用 COM 不走它) | Windows 任务计划程序 |
| `register-wts-task.ps1` | **注册/卸载 WTS 任务 LeoLiaoOSSManifest**(三触发器:开机 +2min / 每 10min / 关机事件),用 PowerShell COM Schedule.Service 不走 schtasks.exe,避开 360/Defender 拦截 | 重装系统 / 换电脑 / 任务丢了时跑 |
| `_elevated-register.ps1` | Wrapper:从非管理员 shell 通过 UAC 提权跑 register-wts-task.ps1,全程 Start-Transcript 记录到 `register-task.log`,便于事后排查 | 同上,但方便从普通 PowerShell/终端一键触发(只点 UAC 一次) |
| `更新清单-手动.bat` | 双击跑 `gen_oss_manifest.mjs` 的可视化版,出错/不确定时手动用 | 手动 |
| `upload_welcome.mjs` | 把本地图床上传到 OSS `welcome/` 目录(boot 欢迎图素材) | 手动 |
| `md2html.mjs` | md → 单文件 HTML(暗色主题,Obsidian 风)导出工具 | 手动 |
| `generate-icons.mjs` | 生成 APK 图标 | 手动 / 改图标时 |

## 用法

### 1. 配置凭证(只一次)

```bash
aliyun configure --profile leo-oss
# 依次输入 AccessKey ID / Secret / region=cn-shanghai
```

凭证存放在 `~/.aliyun/config.json`(aliyun CLI 默认位置),由脚本通过 `--profile leo-oss` 引用。

### 2. 手动刷新 manifest(改完笔记不确定 WTS 跑没跑时)

双击 `更新清单-手动.bat`,等 3~5 秒看到 `✨ 完成!` 就 OK。

### 3. 试跑(看数量对不对)

```bash
ALIYUN_PROFILE=leo-oss node gen_oss_manifest.mjs --dry-run
```

只列本地清单到 `%TEMP%\Obsidian-manifest-new.json`,**不上传**。确认无误后去掉 `--dry-run` 再跑一次。

### 4. 看 WTS 触发历史

```bash
schtasks /Query /TN \LeoLiaoOSSManifest /FO LIST /V
# 或直接 tail scripts/manifest-update.log
```

WTS 任务当前是 **每 10 分钟** 触发 + 开机 +2 分钟 + 关机事件。

### 5. 重新注册 WTS 任务(重装系统 / 换电脑 / 任务丢了时)

**必须管理员 PowerShell**:

```powershell
# 安装(默认路径 D:\leoliao-app\scripts)
powershell -ExecutionPolicy Bypass -File .\register-wts-task.ps1

# 卸载
powershell -ExecutionPolicy Bypass -File .\register-wts-task.ps1 -Uninstall

# 自定义路径(脚本里支持 -NodePath / -ScriptPath / -ScriptDir / -BootDelayMinutes / -IntervalMinutes)
powershell -ExecutionPolicy Bypass -File .\register-wts-task.ps1 `
    -NodePath 'D:\nodejs\node.exe' `
    -ScriptPath 'D:\leoliao-app\scripts\gen_oss_manifest.mjs'
```

实现细节:走 PowerShell COM `Schedule.Service`,不调用 `schtasks.exe`,**避开 360 安全卫士 / Windows Defender 高级防护对 schtasks 创建任务的拦截**(典型错误:`程序"schtasks.exe"无法运行: 拒绝访问`)。

#### 一键提权跑(从普通 PowerShell / 终端触发)

如果当前 shell 不是管理员(或者想避免手动开"管理员 PowerShell"),可以用 wrapper:

```powershell
# 在任意 shell(普通 PowerShell / Git Bash / VSCode 终端)跑这一行:
powershell -NoProfile -Command 'Start-Process PowerShell -Verb RunAs -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","D:\leoliao-app\scripts\_elevated-register.ps1"'

# 然后在 UAC 弹窗点 "是"
# 全程会自动写到 D:\leoliao-app\scripts\register-task.log
```

`Start-Process -Verb RunAs` 是触发 UAC 的标准做法,Windows 安全机制保证必须用户点"是"——这一步**没有任何代码可以绕开**(也不能绕)。

## 工作原理

```
[Obsidian vault]
      │  Remotely Save 插件(写入即推)
      ▼
[OSS: oss://liaoguogang/Obsidian/]
      │  gen_oss_manifest.mjs 列目录 → 比对现有 → 写 manifest.json
      │  ▲
      │  │  WTS 每 30 分钟调 update-manifest-silent.bat
      │
      ├── Obsidian/manifest.json    ← APK 拉这个做增量
      ├── 0-Inbox/闪念.md
      ├── 01.公众号/README.md
      └── ...

[APK]
      │  启动 / 点「🔄 重新同步」
      ▼  sync.ts: GET baseUrl/manifest.json → 增量下载 → Dexie
```

每个 manifest entry:
```json
{ "path": "01.公众号/README.md", "size": 2523, "mtime": 1718431200000, "hash": "<OSS ETag 或 s{size}-m{mtime}>" }
```

APK 的增量判定在 `src/services/sync.ts`:
```ts
if (!(c && c.hash === e.hash && c.mtime >= e.mtime)) miss.push(e);
```

## 权限要求

`leo-oss` 这个 RAM 用户只需要这 6 个 action(策略定义见 `../policies/leoliao-vault-sync.json`):

```
oss:GetBucketInfo
oss:ListObjects
oss:GetObject
oss:GetObjectMeta
oss:PutObject
oss:DeleteObject
```

## 日志

- WTS 触发输出:`scripts/manifest-update.log`(每次跑追加,可 `tail -f` 实时看)
- `gen_oss_manifest.mjs` 直接跑时打 stdout
