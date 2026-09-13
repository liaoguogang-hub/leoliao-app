# _tune-and-watch.ps1 — 一次性 wrapper:改现有任务间隔到 5 分钟 + 注册监控任务
#
# 流程:
#   Step 1. 改 LeoLiaoOSSManifest 的 Repetition.Interval 从 PT10M → PT5M (in-place, 不重建任务)
#           用 schtasks /Change /RI 5 — 比 Set-ScheduledTask COM 调,360 不太容易拦
#   Step 2. 注册监控任务 WatchOSSManifestTask (跑 register-watch-task.ps1)
#
# 用法:
#   Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile","-File","D:\leoliao-app\scripts\_tune-and-watch.ps1"

$logPath = 'D:\leoliao-app\scripts\tune-and-watch.log'
try {
    Start-Transcript -Path $logPath -Append | Out-Null
    Write-Host "==== _tune-and-watch started: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') ===="
    Write-Host "Admin: $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"

    # ---------- Step 1: 改现有任务间隔到 5 分钟 ----------
    Write-Host ""
    Write-Host "==== Step 1: schtasks /Change LeoLiaoOSSManifest /RI 5 ====" -ForegroundColor Cyan
    $changeOut = & schtasks /Change /TN "LeoLiaoOSSManifest" /RI 5 2>&1
    Write-Host "schtasks /Change output: $changeOut"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] schtasks /Change failed (exit=$LASTEXITCODE)" -ForegroundColor Red
    } else {
        Write-Host "[OK] LeoLiaoOSSManifest /RI 5 applied" -ForegroundColor Green
    }

    # 验证一下当前 RI
    Write-Host ""
    Write-Host "==== Verify current Repetition ====" -ForegroundColor Cyan
    try {
        $t = Get-ScheduledTask -TaskName 'LeoLiaoOSSManifest' -ErrorAction Stop
        $t.Triggers | ForEach-Object {
            $type = $_.CimClass.CimClassName.Replace('MSFT_ScheduledTask', '')
            if ($_.Repetition) {
                Write-Host "  $type  Repetition.Interval = $($_.Repetition.Interval)"
            } else {
                Write-Host "  $type  (no repetition)"
            }
        }
    } catch {
        Write-Host "[!]  Verify failed (might be a permission quirk): $($_.Exception.Message)"
    }

    # ---------- Step 2: 注册监控任务 ----------
    Write-Host ""
    Write-Host "==== Step 2: register-watch-task.ps1 ====" -ForegroundColor Cyan
    & 'D:\leoliao-app\scripts\register-watch-task.ps1'
    Write-Host "Exit code: $LASTEXITCODE"

    Write-Host ""
    Write-Host "==== Done ====" -ForegroundColor Green
    Write-Host "Verify in 5 / 15 min:"
    Write-Host "  Get-Content D:\leoliao-app\scripts\watch-task.log -Tail 10"
    Write-Host "  Get-Content D:\leoliao-app\scripts\manifest-update.log -Tail 5"
} catch {
    Write-Host "==== FATAL: $_" -ForegroundColor Red
} finally {
    Stop-Transcript | Out-Null
}
Write-Host ""
Write-Host "[Done] Log: $logPath"
Read-Host "Press Enter to close"
