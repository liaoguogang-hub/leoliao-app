# set-5min-interval.ps1 - 把 LeoLiaoOSSManifest 的重复间隔统一改成 5 分钟
#
# 背景: 该任务有多个触发器(BootTrigger/TimeTrigger/EventTrigger),
#       schtasks /Change /RI 5 只改了其中一个,TimeTrigger 仍是 PT10M,
#       所以实际节奏一直是 10 分钟。本脚本遍历所有"已有非空重复间隔"的触发器统一改。
#
# 用法(必须管理员,推荐双击 set-5min-interval.bat):
#   powershell -NoProfile -ExecutionPolicy Bypass -File D:\leoliao-app\scripts\set-5min-interval.ps1

$ErrorActionPreference = 'Stop'
$TaskName = 'LeoLiaoOSSManifest'
$NewInterval = 'PT5M'
$LogPath = 'D:\leoliao-app\scripts\set-5min-interval.log'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

function Say {
    param([string]$Msg, [string]$Color = 'Gray')
    Write-Host $Msg -ForegroundColor $Color
    try { Add-Content -Path $LogPath -Value $Msg -Encoding UTF8 } catch {}
}

function Show-Triggers {
    param($Task)
    foreach ($tr in $Task.Triggers) {
        $type = $tr.CimClass.CimClassName.Replace('MSFT_ScheduledTask', '')
        $iv = if ($tr.Repetition -and $tr.Repetition.Interval) { $tr.Repetition.Interval } else { '(无重复)' }
        Say ("    {0,-24} Interval = {1}" -f $type, $iv)
    }
}

Say "==== set-5min-interval  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====" 'Cyan'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say "管理员权限: $isAdmin"
if (-not $isAdmin) {
    Say "[X] 需要管理员权限。请双击 set-5min-interval.bat(会自动请求提权)。" 'Red'
    exit 1
}

try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
} catch {
    Say "[X] 找不到任务 '$TaskName': $($_.Exception.Message)" 'Red'
    exit 1
}

Say ""
Say "===== 修改前 =====" 'Cyan'
Show-Triggers -Task $task

$changed = 0
foreach ($tr in $task.Triggers) {
    if ($tr.Repetition -and $tr.Repetition.Interval) {
        $old = $tr.Repetition.Interval
        $tr.Repetition.Interval = $NewInterval
        $changed++
        Say ("  [改] {0}: {1} 到 {2}" -f $tr.CimClass.CimClassName.Replace('MSFT_ScheduledTask',''), $old, $NewInterval) 'Yellow'
    }
}

if ($changed -eq 0) {
    Say "[!] 没有任何触发器带重复间隔,未做修改。" 'Yellow'
    exit 0
}

try {
    Set-ScheduledTask -TaskName $TaskName -Trigger $task.Triggers | Out-Null
    Say "[OK] 已写回任务定义($changed 个触发器)" 'Green'
} catch {
    Say "[X] Set-ScheduledTask 失败: $($_.Exception.Message)" 'Red'
    exit 1
}

Start-Sleep -Milliseconds 500
Say ""
Say "===== 修改后(重新读取)=====" 'Cyan'
try {
    $task2 = Get-ScheduledTask -TaskName $TaskName
    Show-Triggers -Task $task2
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Say ""
    Say "  State       = $($task2.State)"
    Say "  NextRunTime = $($info.NextRunTime)"
} catch {
    Say "  [!] 复验读取失败: $($_.Exception.Message)" 'Yellow'
}

Say ""
Say "完成。验证方式(等 10 分钟看间隔)" 'Green'
Say "  Get-Content D:\leoliao-app\scripts\manifest-update.log -Tail 5"
Say "日志: $LogPath"