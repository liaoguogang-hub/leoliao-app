# make-silent-launcher.ps1 — 通用工具:消除计划任务周期性窗口闪现
#
# 用法(管理员 PowerShell):
#   .\make-silent-launcher.ps1 -TaskName 'MyTask' -ScriptPath 'C:\x\my-script.ps1'
#
# 可选:
#   -KeepArgs '<额外参数>'   追加到内层命令行
#   -DryRun                  只打印将要做什么,不修改
#
# 原理: 用 conhost.exe --headless 包一层。
#       --headless(Windows 11 / Build 22000+)让控制台程序在"无窗口"环境运行,
#       宿主进程本身也不创建窗口。不需要任何额外的 VBS/wscript 文件。
#
# [为什么不用其他方案 —— 都踩过]
#   1) COM Schedule.Service + $root.GetTask()
#      -> PowerShell late-binding 返回 null,报 InvokeMethodOnNull
#   2) schtasks /Change /TR
#      -> 部分机器被安全软件拦截,PowerShell 报"程序 schtasks.exe 无法运行"
#      -> 本脚本的降级路径里保留它,作为 Set-ScheduledTask 失败后的备选
#   3) wscript.exe + VBS 包装器
#      -> 能工作,但 VBS 文件会被安全软件静默删除
#         ("VBS 启动 PowerShell" 是典型木马特征),任务随即指向不存在的文件,
#         看门狗静默失效 —— 比闪窗严重得多。**不要用这个方案。**
#   4) conhost.exe --headless  ← 本脚本采用
#      -> 无额外文件、无 VBS,安全软件无从下手

param(
    [Parameter(Mandatory = $true)][string]$TaskName,
    [Parameter(Mandatory = $true)][string]$ScriptPath,
    [string]$KeepArgs = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

function Say {
    param([string]$Msg, [string]$Color = 'Cyan')
    Write-Host $Msg -ForegroundColor $Color
}

# ---------- 权限 ----------
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Say '[X] 需要管理员权限' 'Red'
    Say '    请右键 bat 以管理员运行,或在管理员 PowerShell 里执行本脚本。' 'Yellow'
    exit 1
}

# ---------- 前置检查 ----------
if (-not (Test-Path $ScriptPath)) {
    Say "[X] 脚本不存在: $ScriptPath" 'Red'
    exit 1
}

# conhost --headless 可用性探测(不通过就直接拒绝,避免把任务改坏)
$probe = Join-Path $env:TEMP 'conhost-headless-probe.txt'
Remove-Item $probe -Force -ErrorAction SilentlyContinue
& conhost.exe --headless cmd.exe /c "echo ok > `"$probe`"" 2>&1 | Out-Null
Start-Sleep -Milliseconds 800
if (Test-Path $probe) {
    Remove-Item $probe -Force -ErrorAction SilentlyContinue
    Say '[OK] conhost --headless 可用' 'Green'
} else {
    Say '[X] conhost --headless 在本机不可用(需要 Windows 11 / Build 22000+)' 'Red'
    Say '    请改用任务计划程序 GUI 手动设置,或改用其它方案。' 'Yellow'
    exit 1
}

# ---------- 读当前状态(cmdlet,不依赖 schtasks.exe)----------
try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
} catch {
    Say "[X] 读不到任务 '$TaskName': $($_.Exception.Message)" 'Red'
    exit 1
}

$repBefore = ''
foreach ($tr in $task.Triggers) {
    if ($tr.Repetition -and $tr.Repetition.Interval) { $repBefore = $tr.Repetition.Interval }
}

Say '===== 当前任务 =====' 'Cyan'
Say "  TaskName   = $TaskName"
Say "  Execute    = $($task.Actions[0].Execute)"
Say "  Arguments  = $($task.Actions[0].Arguments)"
Say "  Repetition = $(if ($repBefore) { $repBefore } else { '(无)' })"
Say "  触发器数量 = $($task.Triggers.Count)"

# 已静默则跳过
if ($task.Actions[0].Execute -match 'conhost\.exe' -and $task.Actions[0].Arguments -match '--headless') {
    Say ''
    Say '[OK] 已经是 conhost --headless 静默启动,无需修改。' 'Green'
    exit 0
}

# ---------- 新 Action ----------
$inner = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden ' +
         "-File `"$ScriptPath`""
if ($KeepArgs) { $inner = "$inner $KeepArgs" }
$newArgs = "--headless $inner"

Say ''
Say '===== 即将应用 =====' 'Cyan'
Say '  Execute   = conhost.exe'
Say "  Arguments = $newArgs"

if ($DryRun) {
    Say ''
    Say '[DryRun] 不做实际修改。去掉 -DryRun 再执行即可生效。' 'Yellow'
    exit 0
}

# ---------- 应用(Set-ScheduledTask 优先,schtasks 降级)----------
Say ''
Say '=== 应用修改 ===' 'Cyan'
$applied = $false
try {
    # 单字符串参数:PS 5.1 下传数组会报类型转换错误
    $action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument $newArgs
    Set-ScheduledTask -TaskName $TaskName -Action $action -ErrorAction Stop | Out-Null
    Say '  [OK] Set-ScheduledTask 成功' 'Green'
    $applied = $true
} catch {
    Say "  [!] Set-ScheduledTask 失败: $($_.Exception.Message)" 'Yellow'
}

if (-not $applied) {
    Say '  尝试降级: schtasks /Change /TR' 'Yellow'
    $out = schtasks /Change /TN $TaskName /TR "conhost.exe $newArgs" 2>&1
    if ($LASTEXITCODE -eq 0) {
        Say '  [OK] schtasks 成功' 'Green'
        $applied = $true
    } else {
        Say '  [X] schtasks 也失败' 'Red'
        $out | ForEach-Object { "    $_" }
        Say ''
        Say '===== 请手动改(约 30 秒)=====' 'Yellow'
        Say '  1) 运行 taskschd.msc'
        Say "  2) 找到任务 $TaskName -> 右键属性 -> 「操作」选项卡 -> 双击那一行 -> 编辑"
        Say '  3) 程序或脚本:  conhost.exe'
        Say "     添加参数:    $newArgs"
        Say '  4) 确定 -> 确定。触发器/设置不要动。'
        exit 1
    }
}

# ---------- 复验 ----------
$task2 = Get-ScheduledTask -TaskName $TaskName
$exec2 = $task2.Actions[0].Execute
$args2 = $task2.Actions[0].Arguments
$rep2 = ''
foreach ($tr in $task2.Triggers) {
    if ($tr.Repetition -and $tr.Repetition.Interval) { $rep2 = $tr.Repetition.Interval }
}

Say ''
Say '===== 修改后 =====' 'Cyan'
Say "  Execute    = $exec2"
Say "  Arguments  = $args2"
Say "  Repetition = $(if ($rep2) { $rep2 } else { '(无)' })"
Say "  触发器数量 = $($task2.Triggers.Count)"

Say ''
if ($exec2 -match 'conhost\.exe' -and $args2 -match '--headless') {
    Say '[OK] 已改为 conhost --headless(无窗口,无需额外文件)' 'Green'
} else {
    Say '[!] Task To Run 未按预期变更,请手动检查' 'Yellow'
}
if ($repBefore -and $rep2 -eq $repBefore) {
    Say "[OK] 周期性看门狗触发保留完好($rep2)" 'Green'
} elseif ($repBefore) {
    Say "[!] 重复周期变化: $repBefore -> $rep2" 'Yellow'
} else {
    Say '[!] 原本就没有周期触发器' 'Yellow'
}

Say ''
Say '完成。等一个完整触发周期观察是否还闪窗。' 'Green'