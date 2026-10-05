---
name: obsidian-vault-sync-check
description: Check, self-heal and alert on the D:\Obsidian vault → GitHub sync (health check + auto-fix + scheduled tasks). Covers the 8-item health check (repo / remote reachability / SSH key listed / HEAD divergence / last ok / last-12 runs / scheduled tasks / pending deletions), the -Fix self-heal path (fetch → add --ignore-removal → commit → push → 3-layer verify, rollback via git reset --mixed), registering the 3 scheduled tasks as the LOGGED-ON USER (never SYSTEM), and the two invocation traps that make the obvious call silently useless (powershell -Command "& script.ps1" swallows exit 2 into 1; a nested call without -ExecutionPolicy Bypass is blocked by RemoteSigned). Use when the user asks 查看/验证 vault 是否在同步、Obsidian 同步正常吗、sync-vault 跑得怎么样、GitHub 上的 obsidian 仓库落后了吗、最近一次成功 push 是什么时候、为什么同步失败或报 exit 128、给 vault 同步做监控/自愈/告警、把同步任务挂到计划任务, or in English to check whether the Obsidian vault is syncing to GitHub, inspect vault sync health and exit codes, diagnose git fetch / git add exit 128 failures, self-heal a broken vault sync, or register and repair the vault sync scheduled tasks.
license: MIT
metadata:
  version: "1.0"
---

# Obsidian Vault → GitHub Sync Check Skill

用于本仓库对应的 vault（`D:\Obsidian\LeoLiao`，git 仓库在 `D:\Obsidian`）的 GitHub 同步健康检查 + 自愈 + 告警。同 leoliao-app 的 `oss-sync-check` skill 对仗。

## 链路背景

| 段 | 工具 |
|---|---|
| 数据源 | `D:\Obsidian\`（vault 根） |
| 远端 | `git@github.com:liaoguogang-hub/obsidian.git`（SSH，`~/.ssh/id_rsa`，RSA SHA256 `yBTM0svz0mfyIX4OrXj6Oxc6ozp/JShCJjM4PyXUWCU`） |
| 同步器 | `D:\Obsidian\sync-vault.ps1`（"只新增+修改，绝不收删除"安全策略） |
| 健康检查 | `D:\Obsidian\check-vault-sync.ps1` |
| 自愈 | `D:\Obsidian\selfheal-vault-sync.ps1` |
| 告警 | `D:\Obsidian\notify-vault-sync.ps1`（复用 oss-sync-check 的飞书 webhook + `LeoLiaoOSSAlertToast` 弹窗任务） |
| 任务注册 | `D:\Obsidian\register-vault-sync-tasks.ps1` + `.bat` 自提权入口 |

## 当用户问以下问题时使用本 skill

- "vault 同步正常吗" / "GitHub 那边的 obsidian 仓库是不是落后了"
- "sync-vault 跑得怎么样" / "上次成功 push 是什么时候"
- "帮我做监控确保 vault → GitHub 一直在跑"
- "那条链路是不是又断了"
- "901 个删除怎么处理"
- 周期性健康检查（assistant 自己触发）

## 检查项（check-vault-sync.ps1 跑 8 项）

| # | 检查项 | 状态 | 失败含义 |
|---|---|---|---|
| 1 | `.git` 在 `D:\Obsidian\` 根 | OK/FAIL | 仓库结构坏 |
| 2 | `git ls-remote origin main` 解析得到 SHA（失败回退本地 `origin/main` 引用） | OK/FAIL | remote 配置错 / 网络 / 认证问题 |
| 3 | 本机 `~/.ssh/id_rsa.pub` 指纹在 `github.com/liaoguogang-hub.keys` 里；HTTP 拉不到时若 `ls-remote` 成功则视为 OK | OK/WARN/FAIL | key 被删或没加 |
| 4 | 本地 HEAD = origin/main SHA | OK/WARN/FAIL | 领先 = 最近 push 失败；落后 = 需要 pull |
| 5 | `sync-vault.log` 最后一次 `ok:` 距今 < 24h | OK/WARN/FAIL | 已停摆 |
| 6 | 日志最近 12 次逐 block 判定 | OK/WARN/FAIL | FAIL+INCOMPLETE+NETSKIP ≥ 3 → FAIL；> 0 → WARN |
| 7 | 任务计划器 3 个任务（COM `GetTask` 直查）：`SyncObsidianVault-LogonDelay` / `SyncObsidianVault-Periodic` / `CheckVaultSync` | OK/WARN | 任务没挂。⚠ 别用 `Get-ScheduledTask` 判存在性：本机非管理员枚举**静默返回空表**（假阴性）；COM 能区分 `0x80070002`=不存在 / `0x80070005`=无权读 |
| 8 | 工作区"已删除未提交"数量 | INFO/OK | **仅告知、不计入 overall**；888 个删除是 9-24 误推事故的复发风险面 |

第 6 项的 5 种判定：`OK`（有 `ok: 同步完成`）/ `FAIL`（有 `ERR:`/`EXCEPTION`/`WARN:`）/ `NETSKIP`（`不可达`/`TimedOut`，脚本 ping 不通直接跳过）/ `SKIP`（`skip:` 如 staged 为空，良性）/ `INCOMPLETE`（该次只有 `=== sync start` 没有结果行，通常是被中断）。

## ⚠ 调用方式（本机 ExecutionPolicy = CurrentUser:RemoteSigned）

**必须用 `-File`，并且带 `-ExecutionPolicy Bypass`**：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File D:\Obsidian\check-vault-sync.ps1 -Quiet
```

两个坑（2026-10-06 实测确认）：

| 写法 | 后果 |
|---|---|
| `powershell -Command "& script.ps1"` | 脚本里的 `exit 2` **会被 PowerShell 压成进程退出码 1**，拿不到真实的 0/1/2 |
| 不带 `-ExecutionPolicy Bypass` 的嵌套调用 | 被 RemoteSigned 拦成 `PSSecurityException`，退出码 1、脚本根本没跑 |

任务计划注册脚本（`register-vault-sync-tasks.ps1`）里的 Action 已按 `-NoProfile -ExecutionPolicy Bypass -File` 注册，所以任务侧不受影响。

## 工作流（assistant 收到本 skill 后）

1. **先读现状，不要直接信任上次对话**：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File D:\Obsidian\check-vault-sync.ps1 -Quiet
   ```
   - exit 0 → 全绿，告知"全绿"+ 关键证据（HEAD SHA、origin/main SHA、last ok）
   - exit 1 → 有 WARN，提示哪一项 → 是否需要 `Register-ScheduledTask` 补回
   - exit 2 → 有 FAIL，逐项诊断 → 用 `-Fix` 触发自愈 → 仍 FAIL 给出人工修复路径

2. **需要自动修复时**（FAIL）：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File D:\Obsidian\check-vault-sync.ps1 -Fix
   ```
   → 内部触发 `selfheal-vault-sync.ps1`：fetch → `git add --ignore-removal .` → commit → push → 三层校验；push 失败时 `git reset --hard origin/main` 回退，绝不把脏状态推到 origin。

   ⚠ **`-Fix` 会真的 commit + push**。跑之前先预演会提交什么（只读）：
   ```powershell
   Set-Location D:\Obsidian; git -c core.quotepath=false add --dry-run --ignore-removal .
   ```
   2026-10-06 实测：该预演列出 36 个文件（30 md / 5 ps1 / 1 json），888 个删除全部被 `--ignore-removal` 正确排除。

3. **需要结构化数据**（做趋势图、CI 检查）：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File D:\Obsidian\check-vault-sync.ps1 -JSON
   ```

4. **告警链路**（selfheal 仍 FAIL 时触发）：
   ```powershell
   & 'D:\Obsidian\notify-vault-sync.ps1' -ExitCode 2
   ```
   - 状态文件 `C:\ProgramData\vault-sync-state.json`（连续失败计数）
   - 弹窗走 `LeoLiaoOSSAlertToast` 任务
   - 飞书 webhook 复用 `C:\ProgramData\leoliao-alert.json`

5. **任务计划器**（首次启用本机制时）：
   - 先清历史：`register-sync-tasks*.ps1` 注册过的 `ObsidianVault_Sync_*` 若有残留，先 `Unregister-ScheduledTask -TaskName 'ObsidianVault_Sync_Boot30m' -Confirm:$false` 清掉（当前本机已无残留）。
   - 运行注册：`D:\Obsidian\register-vault-sync-tasks.ps1` **需要提权**（非管理员会报 `Unspecified error`）。两条路：
     - 用户**双击** `D:\Obsidian\register-vault-sync-tasks.bat`（UAC 提权入口）；或
     - assistant 用 `Start-Process -Verb RunAs -Wait -PassThru` 拉起同一个 ps1（UAC 弹窗需用户点"是"），结果写在 `D:\Obsidian\scripts\register-tasks-result.txt`，读该文件即可验收。
   - 注册 3 个任务（全部**以当前登录用户** `LEOTHINKBOOK\guoga` 身份、**LogonType=3 仅登录时运行**、不存密码）：
     | 任务名 | 触发 | 动作 |
     |---|---|---|
     | `SyncObsidianVault-LogonDelay` | AtLogOn + 5 min | `sync-vault.ps1` |
     | `SyncObsidianVault-Periodic` | 每 30 分钟 | `sync-vault.ps1` |
     | `CheckVaultSync` | 每 15 分钟 | `check-vault-sync.ps1 -Fix` |
   - ⚠ 动作里**必须**带 `-NonInteractive -WindowStyle Hidden`：交互式用户任务若不加，`powershell -File` 会**弹出控制台窗口**。`SyncObsidianVault-Periodic`(30 min) + `CheckVaultSync`(15 min) 叠加起来**每小时最多弹 6 次窗口**（2026-10-06 用户截图实际踩到）。完整参数：`-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "<script>"`
   - 验收：`Start-ScheduledTask -TaskName CheckVaultSync` 后看 `scripts\vault-sync-check.log` 是否新增一行，并用 `Get-ScheduledTaskInfo` 核对 `LastTaskResult`（0=OK / 1=WARN / 2=FAIL）。日志行含 `nonOK=[项名:状态]`，可直接看出是哪一项非 OK。

   ⚠ **绝不要注册成 SYSTEM**（老脚本 `sync-tasks.xml` 用的就是 `<UserId>S-1-5-18</UserId>`，这正是历史故障根因，见下）。

## 修复过的历史背景（避免重复踩坑）

- **`D:\Obsidian\` 下早就存在过两份"老"注册脚本**：
  - `register-sync-tasks.ps1`（2026/8/8，用 `schtasks.exe /XML` 注册 → 任务名 `ObsidianVault_Sync_Boot30m` / `_Shutdown` / `_DailyBackup`）
  - `register-sync-tasks-cmdlet.ps1`（2026/9/24，用 PowerShell `Register-ScheduledTask -Xml` cmdlet 替代上面那个；备注说本机 schtasks.exe 被安全策略拦了，所以改用 cmdlet 路径）
  - 配套 XML：`D:\Obsidian\sync-tasks.xml`、`sync-tasks-shutdown.xml`
  - **任务计划器里当前是 0 个任务**——这意味着老注册脚本**没跑成功**或跑成功后被删了/失活。`check-vault-sync.ps1` 第 7 项（任务已注册）一旦跑起来会持续观察这条。
  - **不要双跑**：本 skill 用的新任务名是 `SyncObsidianVault-BootDelay` / `-Periodic` / `-Shutdown` + `CheckVaultSync`，跟老任务名不重名；但双跑意味着同一分钟跑两次 `sync-vault.ps1`。**第一次跑新注册脚本前，先用 `Get-ScheduledTask` 把老的 `ObsidianVault_Sync_*` 三个任务 `Unregister-ScheduledTask -Confirm:$false` 清掉。**

- **2026-10-06 `check-vault-sync.ps1` 首跑暴露的 6 个 bug（已全部修掉）**：

  | # | bug | 现象 | 根因 | 修法 |
  |---|---|---|---|---|
  | 1 | **`Invoke-Git` 参数名叫 `$Args`** | 全部 git 调用恒失败：假 `remote-resolvable` FAIL + `head-in-sync` 不确定 | `$Args` 是 PowerShell 自动变量，`@Args` splat 变成空数组 → 实际执行 `git -C D:\Obsidian`（无子命令），打印 usage、rc=1 | 改名 `$GitArgs` |
  | 2 | `recent-sync` 取第一次 `ok:` | 报 `last ok @ 2026-08-08`（应为 10-03） | `foreach ... break` 落在首条匹配 | 改取 `$okLines[-1]` |
  | 3 | `last12-syncs` 固定 6 行前瞻 | 把 `SKIP` 误标成 `OK`（跨 run 串味） | 前瞻窗口越过下一个 `=== sync start` | 改逐 block 扫描（到下一个 start 为止），并新增 `INCOMPLETE`/`NETSKIP` |
  | 4 | `-Fix` 嵌套子进程缺 Bypass | 复检被策略拦 | 嵌套 `powershell -File` 没带 `-ExecutionPolicy Bypass` | 补上 |
  | 5 | `checks = @($results)` | `[pscustomobject]` 抛 `Argument types do not match`，`$final` 变 `$null`、整表输出为空 | PS 5.1 下 `@()` 包 `List[object]` 触发的转换问题 | 改 `[object[]]$results.ToArray()` |
  | 6 | 无 `pending-deletions` 项 | 888 个待处理删除完全不可见 | 设计缺失 | 新增第 8 项（INFO，不计入 overall） |
  | 7 | `selfheal` push 失败回退写的是 `git reset --hard` | push 失败时会**复活 888 个已删除文件**并丢弃未提交修改 | `--hard` 会连工作区一起重置，与"永不删除"策略直接冲突 | 改 `git reset --mixed`（只动 HEAD+索引，工作区一字不动） |
  | 8 | `check`/`selfheal` 用 `$env:USERPROFILE` 定位 SSH key | 任务以 SYSTEM 身份运行时指向 `C:\Windows\System32\config\systemprofile`，找不到 key | SYSTEM 的 profile 不是 `C:\Users\guoga` | 两脚本改为候选路径列表，首选 `C:\Users\guoga\.ssh\...` |
  | 9 | `selfheal` 设的 `GIT_SSH_COMMAND` 以 `-i` 开头 | fetch 直接 128：`/usr/bin/sh: - : invalid option` | Git for Windows 把 GIT_SSH_COMMAND 交给 `/usr/bin/sh` 解析；只写 flags 会被 sh 当成自己的选项，反斜杠路径还会被当转义符 | 改成 `ssh -i "<正斜杠 key 路径>" ...`（必须程序名开头） |
  | 10 | `selfheal` 结果只写 `vault-selfheal.log`，而检查读 `sync-vault.log` | 自愈成功后健康检查仍报 FAIL / "last ok 51h ago" | 两个日志文件，检查只解析一个 | `selfheal` 的 `Write-Log` 增加镜像：把结果按 `=== sync start (selfheal) ===` / `ok:` / `ERR:` 格式同时追加到 `sync-vault.log` |
  | 11 | 告警口径是"最近 12 次里累计失败 ≥ 3" | 修复后仍持续 FAIL（历史 4 次失败卡在窗口里） | 窗口法把历史伤疤当当前故障 | 改为**连续失败**驱动：从最后一次往前数，连续 ≥ 3 → FAIL，≥ 1 → WARN；12 次窗口统计仍放在 detail 里 |

  ✅ **历史 23:00 失败的根因已确认（2026-10-06）**：老的 `D:\Obsidian\sync-tasks.xml` / `sync-tasks-shutdown.xml`（2026-08-08）里写的是
  
  ```xml
  <UserId>S-1-5-18</UserId>            <!-- SYSTEM -->
  <RunLevel>HighestAvailable</RunLevel>
  <Command>powershell.exe</Command>
  <Arguments>-NoProfile -ExecutionPolicy Bypass -File "D:\Obsidian\sync-vault.ps1"</Arguments>
  ```
  
  即**老同步任务以 SYSTEM 身份运行**，而实测确认两件事：
  1. `C:\Windows\System32\config\systemprofile\.ssh\id_rsa` **不存在** → SYSTEM 下 SSH 认证必然失败；
  2. `D:\Obsidian` 的 owner 是 `LEOTHINKBOOK\guoga`，git 以 SYSTEM 运行会命中 **"detected dubious ownership"** → 需要写 index 的命令（如 `git add`）直接 exit 128。
  
  这正好**成对解释**日志里的 `WARN: fetch 失败 (exit=128)` + `ERR: git add 失败 (exit=128)`。而所有成功运行（22:01 / 06:52 / 23:20 / 21:19 / 08:37–08:40）都是**用户身份手动触发**，所以能成功。
  
  那些老任务现在已不存在（`GetTask` 返回 `0x80070002`），推测被删除或在 Windows 升级中丢失（`Tasks_Migrated` 目录 + `.cc-connect\watchdog-task-backup-20261002-182443.xml` 均提示本机有过任务变动）。**新注册务必用当前用户身份**，否则一定会复刻这个故障。

  另外：`ssh-key-listed` 加了 2 次重试 + `ls-remote` 成功时的降级判 OK（本机 `Invoke-WebRequest` 拉 `github.com/*.keys` 时通时不通）。

- **2026-10-04～10-05 期间 automated push 全断，最后一次成功是 2026-10-03 21:19**：
  - 日志证据：`09-25 23:00`、`10-03 23:00`、`10-04 23:00`、`10-05 21:15` 全部 `fetch 失败 exit=128` + `git add 失败 exit=128`；`10-05 21:08` 那次只有 start 没有结果行（INCOMPLETE）。
  - `10-03 21:19:58` 那次 `ok:` **确实产生了提交** `ecbda9d auto-sync 2026-10-03 21:19` 并推上去了（早期诊断说它"没产生 commit"是错的，已更正）。
  - 本机 `id_rsa`（SHA256:`yBTM0svz0mfyIX4OrXj6Oxc6ozp/JShCJjM4PyXUWCU`）**确认仍在** `github.com/liaoguogang-hub.keys` 里；SSH 握手能走到 publickey 阶段。所以 128 不是"key 被删"。
  - **根因已确认**：老任务以 SYSTEM 身份运行（详见上一条）—— 不再是不明原因。
  - **2026-10-06 已修复并实测**：重新注册 3 个任务（**当前用户身份**），`SyncObsidianVault-Periodic` 成功推送 `1adbab4`、`CheckVaultSync` 成功执行（`LastTaskResult=0/1` 与退出码一致），`overall=OK / rc=0`。
- **`sync-vault.ps1` 的"绝不收删除"策略**：用户已确认保留这条策略，绝不把 `git status` 里的 `D ...` 自动 stage。本 skill 不会绕过这条。
- **Worktree 噪音**：`../.claude/worktrees/agent-*/` 是 Claude Code 的隔离 agent 工作树，不应进 commit。`sync-vault.ps1` + `.gitignore` 已屏蔽（见 `leoliao-app` 的 `e7dc5e1 fix(sync)` 修那本）。
- **SSH key 路径**：本机只有 `id_rsa`（RSA SHA256 `yBTM0svz0mfyIX4OrXj6Oxc6ozp/JShCJjM4PyXUWCU`），**没有 ed25519**。`selfheal-vault-sync.ps1` 显式 `-i` 指定私钥 + `IdentitiesOnly=yes`，**不依赖 ssh-agent**（`ssh-agent` 服务 Stopped/Disabled）。
- **CRLF 警告**：`sync-vault.ps1` 跑在 Windows PowerShell 5.1 + git autocrlf，会出现 `LF will be replaced by CRLF`，可忽略。
- **编码：所有 `.ps1` UTF-8 with BOM**，`.bat` ASCII 无 BOM —— 与 `github-sync` skill 的编码陷阱一致。本 skill 新增的脚本都已按这条写。

## 不要做的事

- **不要直接修改 `sync-vault.ps1`**：它已含"只新增+修改，绝不收删除"安全策略 + 暂存区二次校验 + 改写 691 个删除的事故回滚（45af344）。除非用户明确要求。
- **不要把待处理删除当垃圾直接 commit**：先用 `check-vault-sync.ps1` 的第 8 项（`pending-deletions`，当前 **888** 个）看数量，让用户人工决定（commit / 永久跳过 / 人工核对）。
- **不要在没有管理员权限时尝试 `Set-ScheduledTask`**：直接说"需要双击 .bat 提权"。
- **不要凭记忆回答"现在是否正常"**：每次都先跑 `check-vault-sync.ps1 -Quiet` 拿真实数据再说话。
- **不要尝试 `ssh-add`**：`ssh-agent` 服务 `Stopped/Disabled`，所有脚本显式 `-i` 指定私钥绕开。

## 退出码速查

| exit | 含义 | 处理 |
|---|---|---|
| 0 | 全部 OK | "全绿"+ 关键证据 |
| 1 | 有 WARN | 看具体哪项 → 提示用户补（任务未挂 / 偶尔失败）|
| 2 | 有 FAIL | 诊断 → `-Fix` → 仍 FAIL 告警 + 给出人工路径 |

## 与 leoliao-app oss-sync-check skill 的差异

| 链路 | 数据方向 | 触发频率 | 同步工具 | 告警阈值 |
|---|---|---|---|---|
| **vault → OSS**（leoliao-app） | NAS → OSS | 5 分钟 | `sync_vault.sh` + aliyun CLI | 连续 3 次 |
| **vault → GitHub**（本 skill） | Windows → GitHub | 30 分钟（sync）/ 15 分钟（check） | `sync-vault.ps1` + git | 连续 3 次 |

两条链路本应共享告警基础设施（`C:\ProgramData\leoliao-alert.json` 飞书 webhook、`LeoLiaoOSSAlertToast` 弹窗任务）。

⚠ 但 2026-10-06 实测：`LeoLiaoOSSAlertToast`、`LeoLiaoOSSManifest`、`CheckOSSSync` **在本机都不存在** → 飞书 + "写消息文件"两条通道可用，**弹窗通道当前是哑的**（`notify-vault-sync.ps1` 会捕获失败并记日志，不会中断）。若要弹窗，需补注册该 toast 任务。

## 脚本清单与恢复方式

同步链路的 4 个脚本**常驻在 vault 根目录**（`D:\Obsidian\`），并且已被版本化在 `liaoguogang-hub/obsidian` 仓库里（`e280440` 起）——丢失时从 vault 仓库拉回即可：

| 脚本 | 作用 |
|---|---|
| `D:\Obsidian\sync-vault.ps1` | 用户原有同步器（只增+改、绝不收删除） |
| `D:\Obsidian\check-vault-sync.ps1` | 8 项健康检查（本 skill 的核心） |
| `D:\Obsidian\selfheal-vault-sync.ps1` | `-Fix` 调用的自愈重推 |
| `D:\Obsidian\notify-vault-sync.ps1` | 连续失败告警（飞书 + 消息文件） |
| `D:\Obsidian\register-vault-sync-tasks.ps1` / `.bat` | 注册 3 个计划任务（`.bat` 提权入口） |

⚠ `register-vault-sync-tasks.bat` **不在** vault 仓库里：`.gitignore` 是"MD 白名单"（只放行 `*.ps1`/`*.md` 等），`.bat` 收不进去。需要版本化它的话，要在 `.gitignore` 里加精确白名单行 `!register-vault-sync-tasks.bat`。

## 本 skill 的副本位置（改一处要同步其余）

| 位置 | 角色 |
|---|---|
| `C:\Users\guoga\.claude\skills\obsidian-vault-sync-check\SKILL.md` | **全局副本** —— DSH/Claude 会话实际加载的就是这里 |
| `D:\leoliao-app\.claude\skills\obsidian-vault-sync-check\SKILL.md` | leoliao-app 仓库（真实项目根，推 `liaoguogang-hub/leoliao-app`） |
| `C:\Users\guoga\Documents\DSH\leoliao-app\.claude\skills\obsidian-vault-sync-check\SKILL.md` | leoliao-app 的 DSH 工作副本（两副本必须一致） |
| `D:\Obsidian\LeoLiao\.claude\skills\obsidian-vault-sync-check\SKILL.md` | vault 内副本（推 `liaoguogang-hub/obsidian`，随 vault 一起走） |

改动后按 `github-sync` skill 的流程同步并校验 SHA256 一致。

---

**调用方式**：用户说"vault 同步正常吗"或类似 → assistant 跑 `check-vault-sync.ps1 -Quiet`，不要省略任何步骤。