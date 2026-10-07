# test-system-run.ps1 - 模拟 SYSTEM 上下文执行,定位"注册成功但不跑"的真因
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$taskName = 'LeoLiaoOSSManifest'

Write-Host "===== 1. 手动触发任务,观察是否真的执行 ====="
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 8
$t = Get-ScheduledTask -TaskName $taskName
$i = Get-ScheduledTaskInfo -TaskName $taskName
Write-Host ("  State       = {0}" -f $t.State)
Write-Host ("  LastRunTime = {0}" -f $i.LastRunTime)
Write-Host ("  LastResult  = {0}" -f $i.LastTaskResult)
Write-Host ("  NextRunTime = {0}" -f $i.NextRunTime)

Write-Host ""
Write-Host "===== 2. TaskScheduler 事件(近 10 分钟)====="
try {
    $ev = Get-WinEvent -FilterHashtable @{LogName='Microsoft-Windows-TaskScheduler/Operational'; StartTime=(Get-Date).AddMinutes(-10)} -MaxEvents 10 -ErrorAction Stop
    foreach ($e in $ev) {
        $first = ($e.Message -split "`r?`n")[0]
        Write-Host ("  [{0}] Id={1} {2}" -f $e.TimeCreated.ToString('HH:mm:ss'), $e.Id, $first)
    }
} catch { Write-Host ("  {0}" -f $_.Exception.Message) }

Write-Host ""
Write-Host "===== 3. 直接以 cmd 跑 bat(验证 bat 本身没问题)====="
$bat = 'D:\leoliao-app\scripts\update-manifest-silent.bat'
Write-Host "  执行 $bat ..."
$p = Start-Process -FilePath 'cmd.exe' -ArgumentList ('/c', "`"$bat`"") -Wait -PassThru -NoNewWindow
Write-Host ("  bat 退出码 = {0}" -f $p.ExitCode)
Get-Content 'D:\leoliao-app\scripts\manifest-update.log' -Encoding UTF8 -Tail 3 | ForEach-Object { "  $_" }

Write-Host ""
Write-Host "===== 4. check-oss-sync.bat 是否有 pause(会在计划任务里挂死)====="
foreach ($b in @('check-oss-sync.bat','watch-oss-manifest-task-silent.bat','update-manifest-silent.bat')) {
    $hasPause = (Get-Content "D:\leoliao-app\scripts\$b" -Raw) -match '(?m)^\s*pause\s*$'
    Write-Host ("  {0,-40} pause={1}" -f $b, $hasPause)
}

Read-Host 'Press Enter to close'