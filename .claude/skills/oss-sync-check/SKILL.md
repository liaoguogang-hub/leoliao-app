---
name: oss-sync-check
description: Check & self-heal the leoliao-app OSS 5-minute manifest sync (uses check-oss-sync.ps1 + bat)
---

# OSS Sync Check Skill

用于 leoliao-app(本仓库)项目的阿里云 OSS 5 分钟同步健康检查 + 自愈工具集。

## 项目背景

leoliao-app 用 Windows 计划任务 `LeoLiaoOSSManifest` 把 vault 笔记清单每 5 分钟同步到阿里云 OSS,APK 启动时拉取该 manifest。本 skill 检查整套机制是否健康并在异常时自动修复。

**任务路径**: `D:\leoliao-app\scripts\`

## 工具清单

| 文件 | 用途 |
|---|---|
| `scripts/check-oss-sync.ps1` | **核心** — 7 项检查 + JSON 输出 + 自愈 |
| `scripts/check-oss-sync.bat` | 自提权入口(双击运行 check-oss-sync.ps1) |
| `scripts/register-oss-sync-check.ps1` | 注册 `CheckOSSSync` 定期检查任务(每 30 分钟) |
| `scripts/register-oss-sync-check.bat` | 自提权入口(双击运行 register-oss-sync-check.ps1) |
| `scripts/oss-sync-check.log` | 检查日志(自动轮转 1MB) |

## 当用户问以下问题时使用此 skill

- "OSS 同步正常吗" / "manifest.json 是不是好的"
- "5 分钟同步机制有没有问题"
- "OSS 上的 manifest 陈旧了"
- "帮我做个监控确保它正常"
- 周期性健康检查

## 检查项(check-oss-sync.ps1 自动跑 7 项)

1. **aliyun CLI** — `C:\aliyun-cli\aliyun.exe` 是否存在
2. **bat 退出码传播** — `update-manifest-silent.bat` 是否 `exit /b %RC%`(防止监控被骗)
3. **计划任务** — `LeoLiaoOSSManifest` State 是否 Ready(非管理员会读不到,标 WARN)
4. **manifest 新鲜度** — OSS LastModified 距今 > 30 分钟 → 触发自愈
5. **manifest 完整性** — 条目数 vs OSS 上 md 数(差值 0 = 健康)
6. **最近 12 次同步** — 全 exit=0
7. **监控最近报告** — 无 ERROR/WARN

## 工作流程(assistant 收到本 skill 后)

1. **先读现状**,不要直接信任上次对话:
   ```powershell
   & 'D:\leoliao-app\scripts\check-oss-sync.ps1' -Quiet
   ```
   - exit 0 → 全绿,告诉用户"全绿"+ 关键证据(LastModified + 完整性)
   - exit 1 → 有 WARN,看具体哪项 → 解释 + 必要时 `-Fix`
   - exit 2 → 有 FAIL,逐项诊断 → 用 `-Fix` 自愈 → 跑用户确认

2. **需要自动修复时**(manifest 陈旧/不完整):
   ```powershell
   & 'D:\leoliao-app\scripts\check-oss-sync.ps1' -Fix
   ```
   → 内部触发一次 `node gen_oss_manifest.mjs`,会输出成功/失败

3. **需要结构化数据**(如要做趋势图、CI 检查):
   ```powershell
   & 'D:\leoliao-app\scripts\check-oss-sync.ps1' -JSON
   ```

4. **部署定期检查**(用户首次启用本机制时):
   - 告诉用户**双击** `D:\leoliao-app\scripts\register-oss-sync-check.bat`
   - UAC 提权后会自动注册 `CheckOSSSync` 计划任务(每 30 分钟,异常时自动 `-Fix`)
   - 该任务以 SYSTEM 身份运行,所以能读到 7 项中的所有项(消除"非管理员读取不到"那个 WARN)

5. **结果输出风格**:
   - 用 `[OK]/[WARN]/[FAIL]` 前缀 + 中文说明
   - 关键数字必给:OSS LastModified、条目数、OSS md 数、差值
   - 出问题必须解释原因,不能只说"异常"

## 修复过的历史事故(避免重复踩坑)

- **C:\aliyun-cli\aliyun.exe 被删** → 同步 `spawn ENOENT` 失败 2.25 天没人发现。**根因**: bat 没 `exit /b %RC%`,监控永远报 OK。**修复**: 加 bat 退出码传播 + `aliyun.exe` 存在性预检(`goto` 写法避免 `chcp 65001` 后多行括号块的 cmd 批处理重读 bug)。
- **C:\aliyun-cli\aliyun.exe 旧下载域名失效** → `https://aliyuncli.alicunya.com/` DNS 已失效。**新地址**: `https://github.com/aliyun/aliyun-cli/releases`(v3.5.1 文件 `aliyun-cli-windows-3.5.1-amd64.zip`,GitHub 直连慢建议走 `https://gh-proxy.com/` 镜像 24MB/s,**必须用官方 `SHASUMS256.txt` 校验 SHA256**)。
- **同步任务双重触发** → BootTrigger + TimeTrigger 都 PT5M,相位不同导致每 5 分钟跑 2 次(API 翻倍)。脚本 `scripts/set-5min-single.ps1` + bat 可收敛。

## 不要做的事

- **不要直接修改 `update-manifest-silent.bat`** — 它已被精心修复(预检 + 退出码传播 + goto 防 cmd 批处理 bug)。除非用户明确要求,否则改它会再次让监控被骗。
- **不要凭记忆回答 "现在是否正常"** — 每次都先跑 `check-oss-sync.ps1 -Quiet` 拿真实数据再说话。
- **不要在没有管理员权限时尝试调用 `Set-ScheduledTask`** — 直接说"需要双击 .bat 提权",不要徒劳。

## 退出码速查

| exit | 含义 | 处理 |
|---|---|---|
| 0 | 全部 OK | 告知用户"全绿" |
| 1 | 有 WARN(可能自动恢复) | 告知哪几项 + 是否需要 -Fix |
| 2 | 有 FAIL(需要关注) | 诊断 + 尝试 -Fix,如仍 FAIL 给出人工修复路径 |
