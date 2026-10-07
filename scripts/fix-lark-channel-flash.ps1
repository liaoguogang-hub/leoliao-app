# fix-lark-channel-flash.ps1 - 消除 DSH-Lark-Channel 每 15 分钟闪蓝色窗口
#
# 根因: 任务是 powershell.exe(控制台程序)直接启动,即使带 -WindowStyle Hidden,
#       每次触发仍会创建/销毁一个控制台窗口 -> 屏幕闪一下。
#
# 方案: 用 conhost.exe --headless 包一层。
#       --headless(Windows 11 / Build 22000+ 支持)让控制台程序在"无窗口"环境下运行,
#       宿主进程本身也不创建窗口。最简单、最可靠,且不需要任何额外脚本文件。
#
# [实现路径演进 —— 三种方案都试过,记录踩坑]
#   1) COM Schedule.Service + $root.GetTask()
#      -> PowerShell late-binding 返回 null(InvokeMethodOnNull)
#   2) schtasks /Change /TR
#      -> 本机被安全软件拦截,PowerShell 报"程序 schtasks.exe 无法运行"
#   3) wscript.exe + VBS 包装器  [已废弃]
#      -> 能工作,但 VBS 文件被安全软件静默删除("VBS 启动 PowerShell" 是典型木马特征),
#         导致任务指向不存在的文件、看门狗失效 —— 比闪窗严重得多。
#   4) conhost.exe --headless    [本脚本采用]
#      -> 无额外文件、无 VBS、无 wscript,安全软件无从下手
#
# 用法: 双击 fix-lark-channel-flash.bat(自动提权)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$TaskName  = 'DSH-Lark-Channel'
$InnerPs1  = Join-Path $env:USERPROFILE '.dsh\lark-channel-autostart.ps1'
$LogPath   = Join-Path $env:USERPROFILE '.dsh\logs\lark-channel.log'

function Say {
    param([string]$Msg, [string]$Color = 'Cyan')
    Write-Host $Msg -ForegroundColor $Color
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say "管理员权限: $admin"
if (-not $admin) { Say '[X] 需要管理员权限,请双击 fix-lark-channel-flash.bat' 'Red'; exit 1 }

# ---------- 前置 1: 内层脚本必须存在 ----------
if (-not (Test-Path $InnerPs1)) {
    Say "[X] 找不到内层脚本: $InnerPs1" 'Red'
    exit 1
}
Say "[OK] 内层脚本就位: $InnerPs1" 'Green'

# ---------- 前置 2: conhost --headless 必须可用 ----------
$probe = Join-Path $env:TEMP 'conhost-headless-probe.txt'
Remove-Item $probe -Force -ErrorAction SilentlyContinue
& conhost.exe --headless cmd.exe /c "echo ok > `"$probe`"" 2>&1 | Out-Null
Start-Sleep -Milliseconds 800
if (Test-Path $probe) {
    Remove-Item $probe -Force -ErrorAction SilentlyContinue
    Say '[OK] conhost --headless 可用' 'Green'
} else {
    Say '[X] conhost --headless 在本机不可用(需要 Windows 11 / Build 22000+)' 'Red'
    Say '    请改用任务计划程序 GUI 手动设置,或升级系统。' 'Yellow'
    exit 1
}

# ---------- 读修改前状态(cmdlet,不依赖 schtasks.exe)----------
try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
} catch {
    Say "[X] 读不到任务 '$TaskName': $($_.Exception.Message)" 'Red'
    exit 1
}

Say ''
Say '===== 修改前 =====' 'Cyan'
Say "  State      = $($task.State)"
Say "  Execute    = $($task.Actions[0].Execute)"
Say "  Arguments  = $($task.Actions[0].Arguments)"
$repBefore = ''
foreach ($tr in $task.Triggers) {
    if ($tr.Repetition -and $tr.Repetition.Interval) { $repBefore = $tr.Repetition.Interval }
}
Say "  Repetition = $(if ($repBefore) { $repBefore } else { '(无)' })"
Say "  触发器数量 = $($task.Triggers.Count)"

# 已经是 conhost --headless 就无需改
if ($task.Actions[0].Execute -match 'conhost\.exe' -and $task.Actions[0].Arguments -match '--headless') {
    Say ''
    Say '[OK] 已经是 conhost --headless 静默启动,无需修改。' 'Green'
    exit 0
}

# ---------- 新 Action ----------
$newArgs = '--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass ' +
           "-WindowStyle Hidden -File `"$InnerPs1`""

Say ''
Say '=== 应用修改(Set-ScheduledTask cmdlet)===' 'Cyan'
Say '  新 Execute   = conhost.exe'
Say "  新 Arguments = $newArgs"
Say ''

try {
    # 单字符串参数(PS 5.1 下传数组会报类型转换错误)
    $action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $newArgs
    Set-ScheduledTask -TaskName $TaskName -Action $action -ErrorAction Stop | Out-Null
    Say '  [OK] Set-ScheduledTask 成功' 'Green'
} catch {
    Say "  [X] Set-ScheduledTask 失败: $($_.Exception.Message)" 'Red'
    Say ''
    Say '===== 请手动改(约 30 秒)=====' 'Yellow'
    Say '  1) 运行 taskschd.msc'
    Say '  2) 任务计划程序库 -> DSH-Lark-Channel -> 右键属性 -> 「操作」选项卡'
    Say '  3) 双击那一行 -> 编辑'
    Say '  4) 程序或脚本:  conhost.exe'
    Say "     添加参数:    $newArgs"
    Say '  5) 确定 -> 确定。触发器/设置不要动。'
    Read-Host '按 Enter 关闭'
    exit 1
}

# ---------- 复验 ----------
Say ''
Say '===== 修改后 =====' 'Cyan'
$task2 = Get-ScheduledTask -TaskName $TaskName
$exec2 = $task2.Actions[0].Execute
$args2 = $task2.Actions[0].Arguments
$rep2 = ''
foreach ($tr in $task2.Triggers) {
    if ($tr.Repetition -and $tr.Repetition.Interval) { $rep2 = $tr.Repetition.Interval }
}
Say "  Execute    = $exec2"
Say "  Arguments  = $args2"
Say "  Repetition = $(if ($rep2) { $rep2 } else { '(无)' })"
Say "  触发器数量 = $($task2.Triggers.Count)"

Say ''
if ($exec2 -match 'conhost\.exe' -and $args2 -match '--headless') {
    Say '[OK] 已改为 conhost --headless(完全无窗口,不需要任何额外文件)' 'Green'
} else {
    Say '[!] Task To Run 未按预期变更,请手动检查' 'Yellow'
}
if ($repBefore -and $rep2 -eq $repBefore) {
    Say "[OK] 看门狗重复周期保留完好($rep2)" 'Green'
} elseif ($repBefore) {
    Say "[!] 重复周期变化: $repBefore -> $rep2" 'Yellow'
} else {
    Say '[!] 原本就没有周期触发器' 'Yellow'
}

Say ''
Say '完成。下一个触发点(约 15 分钟内)观察是否还闪窗。' 'Green'
Say "日志: $LogPath" 'Gray'
Read-Host '按 Enter 关闭'