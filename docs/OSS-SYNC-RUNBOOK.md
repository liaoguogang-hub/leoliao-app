# OSS Sync Runbook — leoliao-app

> **维护者**:leoliao-app 项目维护者  
> **适用范围**:`D:\leoliao-app` 项目的阿里云 OSS 5 分钟同步机制  
> **目的**:把"manifest 同步"这一整套机制的工具/事故/排错/部署固化下来,新人接手时不用从头摸索

---

## 1. 机制背景

`LeoLiaoOSSManifest` Windows 计划任务(以 SYSTEM 身份运行)每 5 分钟触发一次:
1. `C:\aliyun-cli\aliyun.exe oss ls oss://liaoguogang/Obsidian/` 列举 bucket
2. `gen_oss_manifest.mjs`(Node)生成清单 + 上传到 `obs://liaoguogang/Obsidian/manifest.json`
3. 同时更新 `obs://liaoguogang/welcome/manifest.json`(开机欢迎图清单)
4. APK 启动时从 OSS 拉 manifest,据此决定要拉哪些笔记

整个机制走**阿里云 CLI v3.5.1**(本质是 ossutil + 其他阿里云产品的封装)。

---

## 2. 文件清单

| 文件 | 作用 | 谁能调用 |
|---|---|---|
| `scripts/gen_oss_manifest.mjs` | 核心同步脚本(列举 + 生成 + 上传) | 计划任务 / 手动 |
| `scripts/update-manifest-silent.bat` | 计划任务调用的批处理(已修复退出码传播 + CLI 预检) | 计划任务 |
| `scripts/watch-oss-manifest-task-silent.bat` | 监控任务批处理 | 计划任务 |
| `scripts/watch-oss-manifest-task.ps1` | 监控 PS 脚本 | 计划任务 |
| `scripts/set-5min-interval.ps1` + `.bat` | 把所有触发器 Interval 改成 PT5M(管理员) | 双击 bat |
| `scripts/set-5min-single.ps1` + `.bat` | 收敛成严格每 5 分钟一次(去掉重复触发器) | 双击 bat |
| `scripts/check-oss-sync.ps1` + `.bat` | **健康检查 + 自愈**(7 项检查 + -Fix 自动修复) | 任何人 |
| `scripts/register-oss-sync-check.ps1` + `.bat` | 注册 `CheckOSSSync` 计划任务(每 30 分钟) | 双击 bat(管理员) |
| `scripts/manifest-update.log` | 同步日志(每次运行追加) | — |
| `scripts/watch-task.log` | 监控日志(每 15 分钟) | — |
| `scripts/oss-sync-check.log` | 健康检查日志(每次检查追加) | — |

---

## 3. 日常检查 3 步法

任何时候怀疑同步有问题,跑这套:

```powershell
# 步骤 1:看是否健康(退出码 + 一行汇总)
& 'D:\leoliao-app\scripts\check-oss-sync.ps1' -Quiet

# 步骤 2:有异常时看详情
& 'D:\leoliao-app\scripts\check-oss-sync.ps1'

# 步骤 3:需要修就自动修
& 'D:\leoliao-app\scripts\check-oss-sync.ps1' -Fix
```

**退出码**:`0=ok` / `1=warn` / `2=fail`

7 项检查:
1. aliyun CLI 是否存在
2. bat 退出码是否正确传播(`exit /b %RC%`)
3. 计划任务 State(非管理员读不到 SYSTEM 任务,正常)
4. manifest 新鲜度(< 30 min)
5. manifest 完整性(条目数 vs OSS md 数)
6. 最近 12 次同步退出码
7. 监控最近报告

---

## 4. 已修复的历史事故(必读)

### 事故 A:`aliyun.exe` 被删,同步静默失败 2.25 天(2026-09-23 ~ 09-26)

**症状**:APK 拉到的笔记是旧的;监控一直报 OK。

**真凶**:
- `C:\aliyun-cli\aliyun.exe` 被(Windows Defender / 清理工具 / 用户)删除
- `update-manifest-silent.bat` **没把 node 退出码传播出去**,bat 永远 `exit 0`
- → Windows 调度器记 `LastTaskResult = 0` → 监控被骗报 OK
- → 故障 2.25 天无人发现

**修复**:
- `update-manifest-silent.bat` 加 `exit /b %RC%`(传播 node 退出码)
- 加 `aliyun.exe` 存在性预检(用 `goto`,避开 `chcp 65001` 后多行括号块的 cmd 批处理重读 bug)
- 重装 aliyun CLI v3.5.1 到 `C:\aliyun-cli\`

**预防**:`check-oss-sync.ps1` 第 1 项持续检查,缺了直接 FAIL。

### 事故 B:`aliyuncli.alicunya.com` DNS 失效

**症状**:`https://aliyuncli.alicunya.com/aliyun-cli-windows-x64.zip` 打不开。

**真凶**:该域名 DNS 已失效(2026 年起)。

**正确下载方式**:
- GitHub 官方:`https://github.com/aliyun/aliyun-cli/releases`(v3.5.1 文件名 `aliyun-cli-windows-3.5.1-amd64.zip`)
- 直连慢(中国网络 ~22 KB/s),用 **`https://gh-proxy.com/` 镜像**(24 MB/s,3.2 秒下完 75 MB)
- **必须用官方 `SHASUMS256.txt` 校验 SHA256**

```powershell
$expected = 'e35c0f66727df399c996646a4c33f64cd5b69f66eee3e33e1c4f51d41c603997'
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
if ($hash -eq $expected) { Write-Host 'OK' } else { Write-Host 'BAD' }
```

### 事故 C:同步任务双重触发(每 5 分钟跑 2 次)

**症状**:日志显示 :X0:59 和 :X1:55 两次,OSS API 调用翻倍(每小时 ~24 次而不是 ~12)。

**真凶**:`schtasks /Change /RI 5` 只改了 BootTrigger,没改 TimeTrigger。`LeoLiaoOSSManifest` 的 TimeTrigger 仍是 PT10M,BootTrigger 是 PT5M。

**修复**:用 `set-5min-single.ps1` 清理其他触发器的重复,只保留一个 PT5M。但用户后来决定**保留双重**(更实时 + 不在乎 API 调用量),所以没生效。如果将来要严格 5 分钟一次:`双击 scripts/set-5min-single.bat`。

### 事故 D:多行括号块 + chcp 65001 = cmd 批处理重读 bug

**症状**:`exit /b 2`,但 ERROR 行没写入,node 也没跑。

**真凶**:`chcp 65001` 改变代码页后,cmd.exe 重新读取批处理文件时按字节偏移,**多行 `( ... )` 块会被错位解析**。

**修复**:用 `goto` + 标签替代多行括号块:
```bat
if exist "C:\aliyun-cli\aliyun.exe" goto cli_ok
echo ERROR: ... >> log
exit /b 2
:cli_ok
"C:\Program Files\nodejs\node.exe" gen_oss_manifest.mjs >> log 2>&1
set "RC=%errorlevel%"
echo [%date% %time%] ===== end (exit=%RC%) ===== >> log
exit /b %RC%
```

### 事故 E:bash commit 消息里孤立的 `'` 让 git 把后续当 pathspec

**症状**:`git commit` 报 `did not match any file(s) known to git`,`Everything up-to-date`。

**真凶**:commit 消息里如果有一个孤立的 `'`(如被 shell 当作 pathspec 前缀),git 会把 `'` 之后的内容当 pathspec 而不是消息。

**修复**:用 `git commit -F <msgfile>` 读消息文件,**避免任何 shell 转义**:
```powershell
$msg = @'
feat(scope): subject

body
'@
$msg | Out-File msg.txt -Encoding utf8NoBOM
git commit -F msg.txt
```

---

## 5. 部署定期检查(新机器必做)

```powershell
# 1. 双击部署(管理员)
D:\leoliao-app\scripts\register-oss-sync-check.bat

# 2. 立即触发一次验证
& 'D:\leoliao-app\scripts\check-oss-sync.ps1' -Fix

# 3. 等 30 分钟后看日志
Get-Content 'D:\leoliao-app\scripts\oss-sync-check.log' -Tail 10
```

会注册 `CheckOSSSync` 计划任务(以 SYSTEM 身份),每 30 分钟跑一次 `check-oss-sync.ps1 -Fix`。

---

## 6. 关键诊断信息

### 手动验证 manifest 是否健康
```powershell
$env:PATH = "C:\aliyun-cli;$env:PATH"; $env:ALIYUN_PROFILE = 'leo-oss'
& aliyun --profile leo-oss oss ls oss://liaoguogang/Obsidian/manifest.json
```

期望:`LastModifiedTime` < 10 分钟前,Size > 100KB,ETag 稳定。

### 检查同步运行频率
```powershell
Select-String -Path 'D:\leoliao-app\scripts\manifest-update.log' -Pattern 'end \(exit=' -Encoding UTF8 |
  Select-Object -Last 20 |
  ForEach-Object { $_.Line.Trim() }
```

期望:间隔 5 分钟,全 `exit=0`。如果出现 `exit=1`,`Get-Content oss-sync-check.log` 看哪项 FAIL。

### 当前正常状态(2026-09-26 后)
- 触发器:BootTrigger + TimeTrigger 各 PT5M(双重,每 5 分钟跑 2 次)
- Watchdog 频率:15 分钟
- 自愈检查频率:30 分钟
- manifest 路径:`oss://liaoguogang/Obsidian/manifest.json`(1016-1019 条)
- welcome 路径:`oss://liaoguogang/welcome/manifest.json`(10 张图)

---

## 7. 双副本约定(代码同步)

| 路径 | 角色 |
|---|---|
| `D:\leoliao-app` | 真实项目根,git 仓库、构建在这跑 |
| `C:\Users\guoga\Documents\DSH\leoliao-app` | DSH 工作副本 |

**每次改动都要双向 Copy-Item 同步**,否则 DSH 端看到的内容和实际构建/推送的内容会漂移。

### 编码陷阱
- `.ps1`:**必须 UTF-8 BOM**(用 `[System.IO.File]::WriteAllText($p, $c, (New-Object System.Text.UTF8Encoding($true)))`)
- `.bat`:**必须 ASCII 无 BOM**(用 `[System.Text.ASCIIEncoding]`),不然 `@echo off` 前面有 BOM 会乱
- `.md` / `.ts` / `.mjs`:普通 UTF-8

---

## 8. 升级路径

### aliyun CLI 升级
1. GitHub releases:`https://github.com/aliyun/aliyun-cli/releases/latest`
2. 走 `gh-proxy.com` 镜像(中国网络快)
3. 校验 SHA256 对照官方 `SHASUMS256.txt`
4. 解压覆盖 `C:\aliyun-cli\aliyun.exe`(直接替换,无需其他步骤)

### 重新部署所有定期任务
```powershell
# 删除旧任务,重跑注册脚本
Unregister-ScheduledTask -TaskName LeoLiaoOSSManifest -Confirm:$false
Unregister-ScheduledTask -TaskName WatchOSSManifestTask -Confirm:$false
Unregister-ScheduledTask -TaskName CheckOSSSync -Confirm:$false
# 然后按 section 5 重新部署
```

---

## 9. 故障排查决策树

```
check-oss-sync.ps1 报 FAIL
├─ aliyun CLI FAIL
│  └─ 重装(见事故 B)
├─ bat 退出码 FAIL
│  └─ 检查 update-manifest-silent.bat 含 "exit /b %RC%"
├─ manifest 新鲜度 FAIL(>30min)
│  └─ 跑 -Fix;如果还失败,看 gen_oss_manifest.mjs 输出的具体错误
├─ manifest 完整性 FAIL(差值大)
│  └─ 跑 -Fix;如果仍 FAIL,看 OSS bucket 里是否有非 .md 文件或不在 Obsidian/ 前缀下的文件
├─ 最近 12 次同步 FAIL
│  └─ tail manifest-update.log 看具体 spawn 错误或 node 错误
└─ 监控最近报告 FAIL
   └─ tail watch-task.log 看具体错误(可能是权限问题导致监控失效)
```

---

## 10. 关联文档

- `.claude/skills/oss-sync-check/SKILL.md` —— DSH skill 定义(健康检查 + 自愈)
- `.claude/skills/github-sync/SKILL.md` —— DSH skill 定义(commit + push + SHA 校验)
- `docs/releases/` —— 历史版本发布说明
- `CHANGELOG.md` —— leoliao-app 版本历史
