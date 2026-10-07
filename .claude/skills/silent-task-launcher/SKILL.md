---
name: silent-task-launcher
description: 消除 Windows 计划任务周期性闪现控制台窗口(蓝底闪一下)。把任务的 Task To Run 从 powershell.exe / cmd.exe 换成 conhost.exe --headless(首选,无额外文件)或 wscript.exe + VBS(有被安全软件删除的风险),保留原有触发器、watchdog、看门狗逻辑完全不变。Use when the user says 每隔几分钟/几小时 屏幕闪一下、计划任务弹窗、schtasks 触发时窗口一闪、watchdog 触发时闪现、后台任务弹窗、任务运行时窗口闪现, or in English to stop a scheduled task from flashing a console window on every trigger, run a watchdog task without visible windows, or make a scheduled task headless.
---

# Silent Task Launcher Skill

消除 Windows 计划任务在周期性触发时**闪现控制台窗口**的问题,同时保留任务原有的触发器、watchdog、自愈逻辑。

## 触发场景

用户说以下任一话时使用本 skill:

- "每 N 分钟/小时 屏幕闪一下"
- "计划任务触发时窗口会闪"
- "后台任务老是弹窗"
- "watchdog 触发时闪现"
- "schtasks 每次运行都弹黑框"
- 英文:"scheduled task flashes a window on every run"

## 根因

`Task To Run` 直接指向 **控制台程序**(`powershell.exe` / `cmd.exe` / `node.exe`)时,
Task Scheduler 每次触发都会创建一个控制台窗口。即使脚本带了 `-WindowStyle Hidden`,
**控制台窗口仍会被创建再销毁** → 屏幕上表现为"闪一下"。

窗口生命周期越短闪得越明显:常见的**看门狗脚本**运行 2~3 秒就退出(检测到服务已在跑就跳过),
于是每 15 分钟闪一次极短的窗口。

## 四种方案对比(都实测过,按优劣排序)

| # | 方案 | 结果 |
|---|---|---|
| **1** | **`conhost.exe --headless`** | ✅ **首选**。无额外文件、无 VBS,安全软件无从下手。需 Windows 11 / Build 22000+ |
| 2 | `wscript.exe` + VBS 包装器 | ⚠️ 能工作,但 **VBS 会被安全软件静默删除**("VBS 启动 PowerShell" 是典型木马特征)→ 任务指向不存在的文件 → 看门狗静默失效。**风险高于闪窗本身,不要用** |
| 3 | COM `Schedule.Service` + `$root.GetTask()` | ❌ PowerShell late-binding 返回 `null`,报 `InvokeMethodOnNull` |
| 4 | `schtasks /Change /TR` | ⚠️ 部分机器被安全软件拦截,PowerShell 报「程序 schtasks.exe 无法运行」。可作备选降级路径 |

### 首选方案(conhost --headless)

Task 的 Action 设为:

```
Execute   = conhost.exe
Arguments = --headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "<脚本完整路径>"
```

`--headless` 让被包裹的控制台程序在**完全没有窗口**的环境下运行,宿主 `conhost.exe` 自身也不创建窗口。

**改之前必须先探测可用性**(不可用就拒绝修改,避免把任务改坏):

```powershell
$probe = "$env:TEMP\conhost-probe.txt"
Remove-Item $probe -Force -ErrorAction SilentlyContinue
& conhost.exe --headless cmd.exe /c "echo ok > `"$probe`""
Start-Sleep -Milliseconds 800
Test-Path $probe    # True = 可用
```

> ⚠️ **探测必须在真实用户环境做**。在某些受限/沙箱化的 shell 里,`conhost` 的子进程创建会
> 时好时坏(同一命令有时成功有时失败),导致误判。让用户在**自己的** PowerShell 里跑探测最可靠。

## 改用 conhost 的推荐写法

用 `Set-ScheduledTask` cmdlet 只改 Action,触发器 / Settings / Principal 全部原样保留:

```powershell
$args = '--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass ' +
        "-WindowStyle Hidden -File `"$ScriptPath`""
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $args   # 单字符串!
Set-ScheduledTask -TaskName $TaskName -Action $action
```

关键点:
- `-Argument` 传 **单个字符串**。PS 5.1 下传字符串数组会报
  「无法将值转换为类型 System.String」。
- `Set-ScheduledTask` 走 CIM 直连任务调度服务,**不启动 `schtasks.exe`**,
  因此不会被拦截 `schtasks.exe` 的安全软件挡住。
- 改完必须复验:`Execute`、`Arguments`、`Repetition` 周期、`Triggers.Count` 四项。

## 工作流程

### 步骤 1:先诊断,确认是不是计划任务在闪

不要假设。逐个排查:

```powershell
# 1) 列出所有计划任务,找出周期性触发的
schtasks /Query /FO CSV /NH | ConvertFrom-Csv -Header Name,NextRun,Status |
  Where-Object { $_.NextRun -ne 'N/A' -and $_.NextRun -ne '' } |
  Sort-Object NextRun | Select-Object -First 20

# 2) 对可疑任务看详情(Execute 是不是控制台程序 + 有没有 Repeat)
schtasks /Query /TN "<任务名>" /V /FO LIST

# 3) 交叉验证:看脚本日志的写入时间是否与触发节奏吻合
Get-Item "<脚本路径>.log" | Select-Object LastWriteTime
```

**判定标准**:任务详情里 `Repeat: Every: N Minute(s)` + `Task To Run` 是
`powershell.exe` / `cmd.exe` / `node.exe`,且日志时间戳呈相同周期 → 就是它。

> 非管理员只能看到当前用户的任务。SYSTEM 任务会报 `Access is denied`,
> 此时让用户双击一个自提权 bat 来跑诊断。

### 步骤 2:确认脚本是"看门狗"还是"常驻服务"

读脚本头部注释。两种情况处理不同:

| 类型 | 特征 | 处理 |
|---|---|---|
| **看门狗**(短暂运行后退出) | 脚本会检测"服务是否已在跑",在跑就 `exit 0` | 保留周期性,只改启动方式 |
| **常驻服务**(前台阻塞) | 脚本永不退出,任务实例长期 Running | 同样只改启动方式;周期性触发只是保活 |

**不要**直接删掉周期性触发 —— 看门狗的周期性是崩溃恢复能力,删了就失去自愈。

> 若任务的 `MultipleInstances = IgnoreNew`,服务在跑时新触发会被**直接跳过**
> (`LastResult = 0x800710E0`),这是**正常设计**,不是故障。也意味着看门狗只在
> 服务真的挂掉时才起作用 —— 别因为"日志没新记录"就判定它坏了。

### 步骤 3:改 Action(见上文"推荐写法")

### 步骤 4:验证

改完后**等一个完整触发周期**再确认(15 分钟任务就等 15 分钟):

```powershell
$t = Get-ScheduledTask -TaskName '<任务名>'
$t.Actions[0].Execute           # 期望 conhost.exe
$t.Actions[0].Arguments         # 期望含 --headless
$t.Triggers.Count               # 期望与改前一致
```

功能验证(可选,不需管理员):手工执行与任务**完全相同**的 conhost 命令行,
确认内层脚本被真实拉起(看它的日志是否新增一行)。

## 注意事项(踩过的坑)

- **不要用 VBS 方案** —— VBS 会被安全软件静默删除,任务随即指向不存在的文件,
  看门狗失效且**没有任何报错**。这是比闪窗严重得多的故障。
- **不要删周期性触发** —— 看门狗靠它做崩溃恢复。
- **不要把 `-WindowStyle Hidden` 当解决方案** —— 它只隐藏窗口,不阻止控制台被创建。
- **非管理员改不了 SYSTEM 任务** —— 修复脚本必须自提权;bat 里用
  **`net session`** 检测提权,**不要用 `fltmc`**(它在非管理员下也返回成功,
  会导致 bat 误判"已是管理员"从而跳过 UAC,后续 schtasks 全部 Access denied)。
- **`New-ScheduledTaskAction -Argument` 传数组会在 PS 5.1 报类型转换错误** —— 用单字符串。
- **改完必须确认脚本功能没坏**;**完整保留原命令行**参数与工作目录。
- **PowerShell 里写含 `<` `>` 的多行文本要用 here-string** —— 直接内联会被当重定向符。
- **在沙箱/受限 shell 里测 `conhost --headless` 不可靠** —— 子进程创建可能被拦,
  结论要放到真实用户环境验证。

## 变体

| 需求 | 做法 |
|---|---|
| 彻底不闪,不管周期 | 去掉 Repeat,只在登录时触发一次 |
| 保留看门狗但不闪 | 本 skill 的标准做法(conhost --headless) |
| conhost 不可用(旧系统) | 用 `wscript` + VBS,但必须接受"VBS 可能被安全软件删除"的风险,并**加一个巡检** |
| 非 PowerShell 脚本(`node.exe` / `python.exe`) | `conhost.exe --headless node "<script.js>"` |
| 想彻底不依赖交互会话 | 把任务改成「不管用户是否登录都要运行」(`-LogonType S4U`),任务在 session 0 执行,没有桌面可显示窗口 |

## 已落地案例

| 任务 | 现象 | 修复 |
|---|---|---|
| `DSH-Lark-Channel` | 每 15 分钟闪一次蓝底窗口 | `powershell.exe` → **`conhost.exe --headless powershell.exe ...`**;周期 PT15M 与 2 个触发器保留不变 |
| `CheckOSSSync` | 任务永久 Running | bat 里无条件 `pause` 在计划任务下永久阻塞 → 改为仅手动双击时 pause |

## 关联

- `.claude/skills/oss-sync-check/SKILL.md` —— 同类"计划任务静默化/可靠性"问题的另一个案例
- `scripts/make-silent-launcher.ps1` —— 本 skill 的通用实现(参数化处理任意任务,含 DryRun)
- `scripts/fix-lark-channel-flash.ps1` —— DSH-Lark-Channel 的具体修复脚本