# diag-oss-tasks.ps1 - 诊断三个 OSS 任务的触发器配置(需管理员)
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

foreach ($n in @('LeoLiaoOSSManifest','WatchOSSManifestTask','CheckOSSSync')) {
    Write-Host "===== $n ====="
    try {
        $t = Get-ScheduledTask -TaskName $n -ErrorAction Stop
        $i = Get-ScheduledTaskInfo -TaskName $n
        Write-Host ("  State       = {0}" -f $t.State)
        Write-Host ("  LastRunTime = {0}" -f $i.LastRunTime)
        Write-Host ("  LastResult  = {0}" -f $i.LastTaskResult)
        Write-Host ("  NextRunTime = {0}" -f $i.NextRunTime)
        Write-Host ("  MissedRuns  = {0}" -f $i.NumberOfMissedRuns)
        Write-Host "  Triggers:"
        foreach ($tr in $t.Triggers) {
            $ty = $tr.CimClass.CimClassName.Replace('MSFT_ScheduledTask','')
            $iv = if ($tr.Repetition -and $tr.Repetition.Interval) { $tr.Repetition.Interval } else { '(NO-REPEAT)' }
            $du = if ($tr.Repetition -and $tr.Repetition.Duration) { $tr.Repetition.Duration } else { '-' }
            $sb = if ($tr.StartBoundary) { $tr.StartBoundary } else { '-' }
            $en = if ($tr.Enabled -ne $null) { $tr.Enabled } else { '?' }
            Write-Host ("    {0,-22} Enabled={1,-6} Interval={2,-10} Duration={3,-10} Start={4}" -f $ty, $en, $iv, $du, $sb)
        }
        Write-Host "  Action:"
        foreach ($a in $t.Actions) {
            Write-Host ("    Exec  = {0}" -f $a.Execute)
            Write-Host ("    Args  = {0}" -f $a.Arguments)
            Write-Host ("    WDir  = {0}" -f $a.WorkingDirectory)
        }
        Write-Host "  Settings:"
        Write-Host ("    Enabled={0} StartWhenAvailable={1} WakeToRun={2} DisallowStartIfOnBatteries={3}" -f `
            $t.Settings.Enabled, $t.Settings.StartWhenAvailable, $t.Settings.WakeToRun, $t.Settings.DisallowStartIfOnBatteries)
        Write-Host "  Principal:"
        Write-Host ("    UserId={0} LogonType={1} RunLevel={2}" -f $t.Principal.UserId, $t.Principal.LogonType, $t.Principal.RunLevel)
    } catch {
        Write-Host ("  [X] {0}" -f $_.Exception.Message)
    }
    Write-Host ""
}
Read-Host 'Press Enter to close'