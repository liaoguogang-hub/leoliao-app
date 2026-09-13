# register-watch-task.ps1 — 注册/卸载监控任务 WatchOSSManifestTask
#
# 类似 register-wts-task.ps1,但:
#   - TaskName 默认 WatchOSSManifestTask
#   - Action 跑 watch-oss-manifest-task-silent.bat
#   - IntervalMinutes 默认 15
#   - 复用 Schedule.Service COM(同一段逻辑),不依赖 node.exe
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File .\register-watch-task.ps1               # 注册
#   powershell -ExecutionPolicy Bypass -File .\register-watch-task.ps1 -Uninstall     # 卸载

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$TaskName    = 'WatchOSSManifestTask',
    [string]$ScriptDir   = 'D:\leoliao-app\scripts',
    [string]$BatName     = 'watch-oss-manifest-task-silent.bat',
    [int]$BootDelayMinutes = 2,
    [int]$IntervalMinutes  = 15
)

# ---------- 0. Elevation check ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host "[X] Must be run as Administrator" -ForegroundColor Red
    exit 1
}

# ---------- 1. Bat existence check ----------
$batPath = Join-Path $ScriptDir $BatName
if (-not $Uninstall -and -not (Test-Path $batPath)) {
    Write-Host "[X] bat wrapper not found: $batPath" -ForegroundColor Red
    exit 1
}

# ---------- 2. Connect Schedule.Service ----------
try {
    $svc = New-Object -ComObject Schedule.Service
    $svc.Connect()
    $folder = $svc.GetFolder('\')
} catch {
    Write-Host "[X] Cannot connect Schedule.Service: $_" -ForegroundColor Red
    exit 1
}

# ---------- 3. Uninstall branch ----------
if ($Uninstall) {
    foreach ($name in @($TaskName, "${TaskName}-Boot")) {
        try {
            $folder.DeleteTask($name, $null) | Out-Null
            Write-Host "[OK] Deleted task: $name" -ForegroundColor Green
        } catch [System.Runtime.InteropServices.COMException] {
            if ($_.Exception.Message -match 'not found' -or $_.Exception.HResult -in @(0x8007012A, 0x80070002)) {
                Write-Host "[!]  Task not found, skipped: $name"
            } else {
                Write-Host "[X] Delete failed: $name - $_" -ForegroundColor Red
            }
        }
    }
    exit 0
}

# ---------- 4. Cleanup old tasks ----------
foreach ($name in @($TaskName, "${TaskName}-Boot")) {
    try { $folder.DeleteTask($name, $null) | Out-Null } catch { }
}

# ---------- 5. Build task definition ----------
$task = $svc.NewTask(0)
$task.Principal.UserId    = 'SYSTEM'
$task.Principal.RunLevel  = 1  # TASK_RUNLEVEL_HIGHEST

$task.Settings.Enabled                     = $true
$task.Settings.StartWhenAvailable          = $true
$task.Settings.MultipleInstances           = 3  # TASK_INSTANCES_IGNORE_NEW
$task.Settings.DisallowStartIfOnBatteries  = $false
$task.Settings.StopIfGoingOnBatteries      = $false
$task.Settings.AllowHardTerminate          = $true
$task.Settings.RunOnlyIfNetworkAvailable   = $false
$task.Settings.AllowDemandStart            = $true
$task.Settings.ExecutionTimeLimit          = 'PT2M'
$task.Settings.Priority                    = 7

# Action: 直接调 .bat wrapper(里面调 powershell.exe 跑 .ps1)
$act = $task.Actions.Create(0)
$act.Path             = $batPath
$act.WorkingDirectory = $ScriptDir
$act.Arguments        = ''

# Trigger 1: BootTrigger + Delay
$boot = $task.Triggers.Create(8)  # TASK_TRIGGER_BOOT
$boot.Delay    = "PT${BootDelayMinutes}M"
$boot.Enabled  = $true

# Trigger 2: TimeTrigger every N minutes (infinite loop)
$time = $task.Triggers.Create(1)
$time.StartBoundary                = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
$time.Repetition.Interval          = "PT${IntervalMinutes}M"
$time.Repetition.StopAtDurationEnd = $false
$time.Enabled                      = $true

# ---------- 6. Register ----------
try {
    # 6 = TASK_UPDATE (overwrite same name); 3 = TASK_LOGON_NONE
    $folder.RegisterTaskDefinition($TaskName, $task, 6, $null, $null, 3, $null) | Out-Null
    Write-Host "[OK] Task registered: $TaskName" -ForegroundColor Green
} catch {
    Write-Host "[X] Register failed: $_" -ForegroundColor Red
    exit 1
}

# ---------- 7. Verify ----------
Write-Host ""
Write-Host "===== Task Status =====" -ForegroundColor Cyan
$t = Get-ScheduledTask -TaskName $TaskName
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "State:        $($t.State)"
Write-Host "UserId:       $($t.Principal.UserId)"
Write-Host "NextRunTime:  $($info.NextRunTime)"
Write-Host "Triggers:"
$t.Triggers | ForEach-Object {
    $type = $_.CimClass.CimClassName.Replace('MSFT_ScheduledTask', '')
    Write-Host "  - $type"
}
Write-Host "Action:"
Write-Host "  $batPath"

Write-Host ""
Write-Host "[OK] In $IntervalMinutes minutes watch-task.log should have new entries" -ForegroundColor Green
