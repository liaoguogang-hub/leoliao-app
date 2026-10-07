---
name: silent-task-launcher
description: 消除 Windows 计划任务周期性闪现控制台窗口(蓝底闪一下)。把任务的 Task To Run 从 powershell.exe / cmd.exe 换成 wscript.exe //B //Nologo 调用 VBS 包装器,保留原有触发器、watchdog、看门狗逻辑完全不变。Use when the user says 每隔几分钟/几小时 屏幕闪一下、计划任务弹窗、schtasks 触发时窗口一闪、watchdog 触发时闪现、后台任务弹窗、任务运行时窗口闪现, or in English to stop a scheduled task from flashing a console window on every trigger, wrap a PowerShell task in a hidden VBS launcher, or make a watchdog task run without visible windows.
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

## 解决方案

用 `wscript.exe`(GUI 宿主,本身没有控制台)调用一个 VBS 包装器,
VBS 再以 `0`(完全隐藏、不等待)拉起原脚本:

```
wscript.exe //B //Nologo <路径>\<name>-hidden-launcher.vbs
```

VBS 内容:

```vbs
' <用途说明>
Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""<完整脚本路径>""", 0, False
```

关键点:

- `//B` = 禁止显示脚本错误对话框
- `//Nologo` = 不显示 WScript 宿主自身的消息框
- `shell.Run ..., 0, False` → `0` = 完全隐藏;`False` = 不等待退出
- VBS **必须纯 ASCII、无 BOM**(WSH 对 BOM 敏感,带 BOM 可能解析失败)

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
| **看门狗**(短暂运行后退出) | 脚本会检测"服务是否已在跑",在跑就 `exit 0` | 用本 skill(保留周期性,只改启动方式) |
| **常驻服务**(前台阻塞) | 脚本永不退出,任务实例长期 Running | 同样用本 skill;15 分钟重复只是保活 |

**不要**直接删掉周期性触发 —— 看门狗的周期性是崩溃恢复能力,删了就失去自愈。

### 步骤 3:写 VBS 包装器

```powershell
$vbs = @"
' Silent launcher: 任务名 — 消除周期性触发时的控制台窗口闪现
Option Explicit
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""<完整脚本路径>""", 0, False
"@
[System.IO.File]::WriteAllText($vbsPath, $vbs, (New-Object System.Text.ASCIIEncoding))
```

**必须用 ASCII 编码**,不能用其他方式。

### 步骤 4:写修复脚本(改任务的 Action)

用 COM API 改,这样**触发器 / Settings / Principal 全部原样保留**:

```powershell
$svc = New-Object -ComObject 'Schedule.Service'
$svc.Connect()
$root = $svc.GetFolder('\')
$t = $svc.GetTask($TaskName)

$a = $t.Actions.Create(0)
$a.Path = 'wscript.exe'
$a.Arguments = "//B //Nologo `"$VbsPath`""

$t.RegistrationInfo.Description = '<更新后的描述>'

# 第 5 个参数 logonType 沿用原任务的值最安全
$root.RegisterTaskDefinition($TaskName, $t, 6, $null, $null, 3, $null) | Out-Null
```

> `RegisterTaskDefinition` 第 6 个参数(flag)= 6 表示 `TASK_CREATE_OR_UPDATE`。
> 先 `$svc.GetTask()` 拿到对象再改,能最大限度保留原有配置。

### 步骤 5:验证

改完后**等一个完整触发周期**再确认(15 分钟任务就等 15 分钟):

```powershell
# 确认 Execute / Arguments 已改
schtasks /Query /TN "<任务名>" /V /FO LIST |
  Select-String 'Task To Run|Repeat|Status'

# 确认脚本仍被正常执行(日志时间戳推进 + 功能未坏)
Get-Content "<日志路径>" -Tail 5
```

## 注意事项(踩过的坑)

- **不要删周期性触发** —— 看门狗靠它做崩溃恢复。只改启动方式。
- **VBS 必须 ASCII 无 BOM** —— 带 BOM 的 VBS 在部分系统上解析失败。
- **不要把 `-WindowStyle Hidden` 当解决方案** —— 它只隐藏窗口,不阻止控制台被创建。
- **非管理员改不了 SYSTEM 任务** —— 修复脚本必须自提权(bat 里 `fltmc` 检测 + `Start-Process -Verb RunAs`)。
- **改完后确认脚本功能没坏** —— 有些脚本靠命令行参数或工作目录,
  VBS 包装器里要**完整保留原命令行**。
- **PowerShell 里写含 `<` `>` 的多行文本要用 here-string** ——
  直接内联会被当成重定向符,报 `ParserError`。

## 变体

| 需求 | 做法 |
|---|---|
| 只想彻底不闪,不管周期 | 去掉 Repeat,只在登录时触发一次 |
| 保留看门狗但不闪 | 本 skill 的标准做法 |
| 保留看门狗 + 隐藏任务本身 | 再加任务属性 `Hidden = True` |
| 非 PowerShell 脚本(`node.exe` / `python.exe`) | VBS 里 `shell.Run "node ""<script.js>""", 0, False` |

## 已落地案例

| 任务 | 现象 | 修复 |
|---|---|---|
| `DSH-Lark-Channel` | 每 15 分钟闪一次蓝底窗口 | `powershell.exe` → `wscript.exe //B //Nologo lark-hidden-launcher.vbs` |
| `CheckOSSSync` | 任务永久 Running | bat 里无条件 `pause` 在计划任务下永久阻塞 → 改为仅手动双击时 pause |

## 关联

- `.claude/skills/oss-sync-check/SKILL.md` —— 同类"计划任务静默化"问题的另一个案例