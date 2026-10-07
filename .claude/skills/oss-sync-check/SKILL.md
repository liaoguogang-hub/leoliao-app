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
| `scripts/check-oss-sync.ps1` | **核心** — 7 项检查 + JSON 输出 + 自愈(`-Fix`) |
| `scripts/check-oss-sync.bat` | 入口(手动双击才 pause;计划任务调用不会挂死) |
| `scripts/register-all-oss-tasks.ps1` | **一次性注册全部三个任务**(推荐用这个) |
| `scripts/register-all-oss-tasks.bat` | 自提权入口(双击注册三个任务) |
| `scripts/diag-oss-tasks.ps1` | 诊断任务配置(触发器/Action/Settings/Principal 全量打印) |
| `scripts/diag-oss-tasks.bat` | 自提权诊断入口 |
| `scripts/test-system-run.ps1` | 手动触发任务 + 抓 TaskScheduler 事件日志 |
| `scripts/set-5min-single.ps1` + `.bat` | 把双重触发收敛成严格每 5 分钟一次 |
| `scripts/oss-sync-check.log` | 检查日志(自动轮转 1MB) |

> ⚠️ `scripts/register-oss-sync-check.ps1` / `.bat` 是**有 bug 的旧版**
> (`New-ScheduledTaskAction -Argument` 类型转换失败),**不要用**。

## 三个计划任务(全部 SYSTEM 身份)

| 任务 | 频率 | 作用 |
|---|---|---|
| `LeoLiaoOSSManifest` | 5 分钟 | 核心同步:列举 OSS → 上传 `Obsidian/manifest.json` |
| `WatchOSSManifestTask` | 15 分钟 | 健康监控:检查主任务 State/LastRun/LastResult |
| `CheckOSSSync` | 30 分钟 | 深度检查 7 项 + 异常自动 `-Fix` 自愈 |

## 当用户问以下问题时使用此 skill

- "OSS 同步正常吗" / "manifest.json 是不是好的"
- "5 分钟同步机制有没有问题"
- "OSS 上的 manifest 陈旧了"
- "帮我做个监控确保它正常"
- 周期性健康检查

## 检查项(check-oss-sync.ps1 自动跑 7 项)

1. **aliyun CLI** — `C:\aliyun-cli\aliyun.exe` 是否存在
2. **bat 退出码传播** — `update-manifest-silent.bat` 是否 `exit /b %RC%`(防止监控被骗)
3. **计划任务** — `LeoLiaoOSSManifest` State 是 Ready **或 Running** 都算健康;
   只有 `Disabled` / 任务不存在 才判 FAIL。非管理员读不到 SYSTEM 任务 → 标 WARN(预期)
4. **manifest 新鲜度** — OSS LastModified 距今 > 30 分钟 → 触发自愈
5. **manifest 完整性** — 条目数 vs OSS 上 md 数(差值 0 = 健康)
6. **最近 12 次同步** — 全 exit=0
7. **监控最近报告** — 无 ERROR/WARN

> ⚠️ **为什么 `Running` 也算 OK**:检查任务(`CheckOSSSync`,30 分钟)和同步任务(`LeoLiaoOSSManifest`,5 分钟)
> 会同时触发。此刻检查看到同步任务是 `State=Running` 属**完全正常**。
> v1.60 之前这里误报 FAIL,已修正。

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

4. **部署/恢复定期任务**(首次启用,或任务丢失时):
   - 告诉用户**双击** `D:\leoliao-app\scripts\register-all-oss-tasks.bat`
   - UAC 提权后一次性注册**全部三个**任务(用 COM API,兼容性最好):
     - `LeoLiaoOSSManifest`  每 5 分钟  — 核心同步
     - `WatchOSSManifestTask` 每 15 分钟 — 健康监控
     - `CheckOSSSync`         每 30 分钟 — 深度检查 + 自动 `-Fix` 自愈
   - 全部以 **SYSTEM** 身份运行,且 `StartWhenAvailable` 开机自动恢复
   - 脚本结尾会自动复验并打印三个任务的状态和 NextRunTime

   > ⚠️ **注意**:旧脚本 `register-oss-sync-check.bat` 有已知 bug
   > (`New-ScheduledTaskAction -Argument` 参数数组解析失败),**不要用**。
   > 统一用 `register-all-oss-tasks.bat`。

5. **结果输出风格**:
   - 用 `[OK]/[WARN]/[FAIL]` 前缀 + 中文说明
   - 关键数字必给:OSS LastModified、条目数、OSS md 数、差值
   - 出问题必须解释原因,不能只说"异常"

## 修复过的历史事故(避免重复踩坑)

- **C:\aliyun-cli\aliyun.exe 被删** → 同步 `spawn ENOENT` 失败 2.25 天没人发现。**根因**: bat 没 `exit /b %RC%`,监控永远报 OK。**修复**: 加 bat 退出码传播 + `aliyun.exe` 存在性预检(`goto` 写法避免 `chcp 65001` 后多行括号块的 cmd 批处理重读 bug)。
- **C:\aliyun-cli\aliyun.exe 旧下载域名失效** → `https://aliyuncli.alicunya.com/` DNS 已失效。**新地址**: `https://github.com/aliyun/aliyun-cli/releases`(v3.5.1 文件 `aliyun-cli-windows-3.5.1-amd64.zip`,GitHub 直连慢建议走 `https://gh-proxy.com/` 镜像 24MB/s,**必须用官方 `SHASUMS256.txt` 校验 SHA256**)。
- **同步任务双重触发** → BootTrigger + TimeTrigger 都 PT5M,相位不同导致每 5 分钟跑 2 次(API 翻倍)。脚本 `scripts/set-5min-single.ps1` + bat 可收敛。
- **三个计划任务整体消失(2026-10-07 发现,断档 12 天)** → `schtasks /Query` 报"系统找不到指定的文件",不是权限问题。日志 `manifest-update.log` 停在 9/26 07:01。**恢复**: 双击 `register-all-oss-tasks.bat` 重新注册。**教训**: 定期用 `diag-oss-tasks.bat`(管理员)复验任务是否还在,别等 APK 拉到旧笔记才发现。
- **`pause` 让 CheckOSSSync 永久挂死** → `check-oss-sync.bat` 末尾的 `pause` 在计划任务(无交互控制台)下永久等待,任务卡在 Running 直到 `ExecutionTimeLimit` 强杀。**修复**: 用 `%CMDCMDLINE%` 判断是否手动双击,只在手动时 pause。
- **注册成功但长时间不触发** → COM 注册时 `StartBoundary` 若等于注册时刻,当天已过去的触发点会被标记为已消费。**修复**: `StartBoundary = (Get-Date).AddMinutes(1)`,保证第一个触发点必到。**判断依据**: 任务 `State=Ready` + `LastRunTime=1999/11/30`(哨兵值=从未运行) + `LastResult=267011`(0x41303=SCHED_S_TASK_HAS_NOT_RUN)。
- **COM `Settings` 属性名与 cmdlet 不同** → COM 接口用取反式命名(`DisallowStartIfOnBatteries` 而非 `AllowStartIfOnBatteries`;`StopIfGoingOnBatteries` 而非 `DontStopIfGoingOnBatteries`),且各 Windows 版本支持程度不一。**修复**: 逐项 try/catch,失败只打印 `[跳过]` 不中断注册。
- **`New-ScheduledTaskAction -Argument` 数组解析失败** → PS 5.1 下"无法将值转换为类型 System.String"。**规避**: 任务 Action 改用 `cmd.exe /c <bat>` 形式(参数是 2 元素简单数组,或直接单字符串)。

## 不要做的事

- **不要直接修改 `update-manifest-silent.bat`** — 它已被精心修复(预检 + 退出码传播 + goto 防 cmd 批处理 bug)。除非用户明确要求,否则改它会再次让监控被骗。
- **不要凭记忆回答 "现在是否正常"** — 每次都先跑 `check-oss-sync.ps1 -Quiet` 拿真实数据再说话。
- **不要在没有管理员权限时尝试调用 `Set-ScheduledTask` / `Register-ScheduledTask`** — 直接说"需要双击 .bat 提权",不要徒劳。
- **不要在任何被计划任务调用的 bat 里放无条件 `pause`** — 会让任务永久挂死。只在检测到"手动双击"时才 pause。
- **不要用 `Register-ScheduledTask` cmdlet 的 `-Argument` 传长参数数组** — PS 5.1 会报类型转换错误。改用 COM API 或 `cmd.exe /c <bat>`。

## 退出码速查

| exit | 含义 | 处理 |
|---|---|---|
| 0 | 全部 OK | 告知用户"全绿" |
| 1 | 有 WARN(可能自动恢复) | 告知哪几项 + 是否需要 -Fix |
| 2 | 有 FAIL(需要关注) | 诊断 + 尝试 -Fix,如仍 FAIL 给出人工修复路径 |
