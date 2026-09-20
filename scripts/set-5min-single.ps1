# set-5min-single.ps1 - 让 LeoLiaoOSSManifest 严格"每 5 分钟只跑一次"
#
# 背景:
#   该任务有多个触发器,且 BootTrigger 和 TimeTrigger 都带 PT5M 重复,
#   两者相位不同 -> 实际每 5 分钟跑 2 次(实测 15:00:59 与 15:01:55 各一次)。
#   代价:每次要列举 10807 个对象,API 调用量翻倍。
#
# 本脚本:
#   1) 找出所有"带重复间隔"的触发器
#   2) 保留其中一个(优先 TimeTrigger)设为 PT5M
#   3) 其余触发器清掉重复间隔(BootTrigger 仍会在开机时跑一次,但不再周期叠加)
#   4) 写回 + 复验 + 打印改前/改后
#
# 用法(必须管理员,推荐双击 set-5min-single.bat):
#   powershell -NoProfile -ExecutionPolicy Bypass -File D:\leoliao-app\scripts\set-5min-single.ps1
#   预览不改动:  ... -File D:\leoliao-app\scripts\set-5min-single.ps1 -DryRun
#
# 日志: D:\leoliao-app\scripts\set-5min-single.log

param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$TaskName    = 'LeoLiaoOSSManifest'
$NewInterval = 'PT5M'
$LogPath     = 'D:\leoliao-app\scripts\set-5min-single.log'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

function Say {
    param([string]$Msg, [string]$Color = 'Gray')
    Write-Host $Msg -ForegroundColor $Color
    try { Add-Content -Path $LogPath -Value $Msg -Encoding UTF8 } catch {}
}

function Get-TypeName {
    param($Trigger)
    return $Trigger.CimClass.CimClassName.Replace('MSFT_ScheduledTask', '')
}

function Show-Triggers {
    param($Task)
    foreach ($tr in $Task.Triggers) {
        $iv = if ($tr.Repetition -and $tr.Repetition.Interval) { $tr.Repetition.Interval } else { '(无重复)' }
        Say ("    {0,-24} Interval = {1}" -f (Get-TypeName $tr), $iv)
    }
}

Say "==== set-5min-single  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  DryRun=$DryRun ====" 'Cyan'

# ---------- 权限 ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say "管理员权限: $isAdmin"
if (-not $isAdmin) {
    Say "[X] 需要管理员权限。请双击 set-5min-single.bat(会自动请求提权)。" 'Red'
    exit 1
}

# ---------- 读取 ----------
try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
} catch {
    Say "[X] 找不到任务 '$TaskName': $($_.Exception.Message)" 'Red'
    exit 1
}

Say ""
Say "===== 修改前 =====" 'Cyan'
Show-Triggers -Task $task

# ---------- 找带重复的触发器 ----------
$repeating = @()
foreach ($tr in $task.Triggers) {
    if ($tr.Repetition -and $tr.Repetition.Interval) { $repeating += $tr }
}

Say ""
Say ("带重复间隔的触发器数量: {0}" -f $repeating.Count)

if ($repeating.Count -eq 0) {
    Say "[!] 没有任何触发器带重复间隔,未做修改。" 'Yellow'
    exit 0
}

if ($repeating.Count -eq 1) {
    $only = $repeating[0]
    if ($only.Repetition.Interval -eq $NewInterval) {
        Say "[OK] 只有 1 个重复触发器且已是 $NewInterval,无需修改(已经是严格每 5 分钟一次)。" 'Green'
        exit 0
    }
}

# ---------- 选保留哪个:优先 TimeTrigger ----------
$keep = $null
foreach ($tr in $repeating) {
    if ((Get-TypeName $tr) -like '*TimeTrigger*') { $keep = $tr; break }
}
if (-not $keep) { $keep = $repeating[0] }

Say ("保留: {0} 设为 {1}" -f (Get-TypeName $keep), $NewInterval) 'Yellow'
$keep.Repetition.Interval = $NewInterval

# ---------- 其余重复触发器:清掉重复 ----------
$cleared = 0
$failed = @()
foreach ($tr in $task.Triggers) {
    if ($tr -eq $keep) { continue }
    if ($tr.Repetition -and $tr.Repetition.Interval) {
        try {
            $tr.Repetition.Interval = $null
            $cleared++
            Say ("  [清重复] {0}" -f (Get-TypeName $tr)) 'Yellow'
        } catch {
            $failed += (Get-TypeName $tr)
            Say ("  [!] 清除失败 {0}: {1}" -f (Get-TypeName $tr), $_.Exception.Message) 'Red'
        }
    }
}

if ($DryRun) {
    Say ""
    Say "[DryRun] 未写回任务定义。若正式执行将:保留 1 个 PT5M、清除 $cleared 个重复。" 'Cyan'
    exit 0
}

# ---------- 写回 ----------
try {
    Set-ScheduledTask -TaskName $TaskName -Trigger $task.Triggers | Out-Null
    Say ""
    Say "[OK] 已写回任务定义(清除重复 $cleared 个)" 'Green'
} catch {
    Say ""
    Say "[X] Set-ScheduledTask 失败: $($_.Exception.Message)" 'Red'
    Say "    任务未被修改,仍是原状态。" 'Yellow'
    exit 1
}

# ---------- 复验 ----------
Start-Sleep -Milliseconds 500
Say ""
Say "===== 修改后(重新读取)=====" 'Cyan'
try {
    $task2 = Get-ScheduledTask -TaskName $TaskName
    Show-Triggers -Task $task2
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Say ""
    Say "  State       = $($task2.State)"
    Say "  LastRunTime = $($info.LastRunTime)"
    Say "  NextRunTime = $($info.NextRunTime)"
} catch {
    Say "  [!] 复验读取失败: $($_.Exception.Message)" 'Yellow'
}

Say ""
Say "预期效果: 之后每 5 分钟只跑 1 次(不再是 2 次)。" 'Green'
Say "验证方法(等 15 分钟看间隔):" 
Say "  Get-Content D:\leoliao-app\scripts\manifest-update.log -Tail 8"
Say "日志: $LogPath"