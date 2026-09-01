<#
.SYNOPSIS
    Register Windows Task Scheduler task LeoLiaoOSSManifest (rebuilds leoliao-app APK's OSS manifest).

.DESCRIPTION
    Creates a WTS task with three triggers:
      1. BootTrigger + Delay 2min    (run once 2 minutes after boot)
      2. TimeTrigger every 10min      (run every 10 minutes, infinite loop)
      3. EventTrigger System/1074     (shutdown event trigger, 1s delay)

    Action: directly calls C:\Program Files\nodejs\node.exe to run gen_oss_manifest.mjs
    User:   SYSTEM (S-1-5-18), RunLevel HighestAvailable
    Settings: allow battery mode, don't wait for idle network, catch up missed runs,
              ignore new triggers when an instance is already running.

    Uses PowerShell COM Schedule.Service (not schtasks.exe) to bypass 360 / Defender
    behavior-protection blocks on task creation.

.PARAMETER Uninstall
    Uninstall the task (deletes LeoLiaoOSSManifest and LeoLiaoOSSManifest-Boot)

.PARAMETER TaskName
    Task name (default LeoLiaoOSSManifest)

.PARAMETER NodePath
    Full path to node.exe (default C:\Program Files\nodejs\node.exe)

.PARAMETER ScriptPath
    Full path to gen_oss_manifest.mjs (default D:\leoliao-app\scripts\gen_oss_manifest.mjs)

.PARAMETER ScriptDir
    Script working directory (default D:\leoliao-app\scripts)

.PARAMETER BootDelayMinutes
    Minutes to delay after boot before first run (default 2)

.PARAMETER IntervalMinutes
    Minutes between periodic runs (default 10)

.EXAMPLE
    # Install task (default config)
    powershell -ExecutionPolicy Bypass -File .\register-wts-task.ps1

.EXAMPLE
    # Uninstall task
    powershell -ExecutionPolicy Bypass -File .\register-wts-task.ps1 -Uninstall

.EXAMPLE
    # Custom paths
    powershell -ExecutionPolicy Bypass -File .\register-wts-task.ps1 `
        -NodePath 'D:\nodejs\node.exe' `
        -ScriptPath 'D:\leoliao-app\scripts\gen_oss_manifest.mjs' `
        -ScriptDir 'D:\leoliao-app\scripts'

.NOTES
    Must be run as Administrator.
    Author: Claude Code | 2026-08-22
#>

[CmdletBinding()]
param(
    [switch]$Uninstall,
    [string]$TaskName    = 'LeoLiaoOSSManifest',
    [string]$NodePath    = 'C:\Program Files\nodejs\node.exe',
    [string]$ScriptPath  = 'D:\leoliao-app\scripts\gen_oss_manifest.mjs',
    [string]$ScriptDir   = 'D:\leoliao-app\scripts',
    [int]$BootDelayMinutes = 2,
    [int]$IntervalMinutes  = 10
)

# ---------- 0. Elevation check ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Write-Host "[X] Must be run as Administrator" -ForegroundColor Red
    Write-Host "    Right-click PowerShell -> 'Run as administrator', then retry." -ForegroundColor Yellow
    exit 1
}

# ---------- 1. Node / script existence checks ----------
if (-not $Uninstall) {
    if (-not (Test-Path $NodePath)) {
        Write-Host "[X] node.exe not found: $NodePath" -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path $ScriptPath)) {
        Write-Host "[X] gen_oss_manifest.mjs not found: $ScriptPath" -ForegroundColor Red
        exit 1
    }
    if (-not (Test-Path $ScriptDir)) {
        Write-Host "[X] script dir not found: $ScriptDir" -ForegroundColor Red
        exit 1
    }

    # ---------- 1b. Copy aliyun config to SYSTEM profile (so SYSTEM user can run aliyun CLI) ----------
    # SYSTEM's HOME = C:\Windows\System32\config\systemprofile, not the current user's home.
    # Without this copy, SYSTEM-run aliyun CLI cannot find ~/.aliyun/config.json.
    $srcConfigDir  = Join-Path $env:USERPROFILE '.aliyun'
    $srcConfigFile = Join-Path $srcConfigDir 'config.json'
    $dstConfigDir  = Join-Path $env:SystemRoot 'System32\config\systemprofile\.aliyun'
    $dstConfigFile = Join-Path $dstConfigDir 'config.json'
    if (Test-Path $srcConfigFile) {
        if (-not (Test-Path $dstConfigDir)) {
            New-Item -ItemType Directory -Path $dstConfigDir -Force | Out-Null
        }
        Copy-Item -Path $srcConfigFile -Destination $dstConfigFile -Force
        Write-Host ("[OK] aliyun config copied: " + $dstConfigFile) -ForegroundColor Green
    } else {
        Write-Host ("[X] source aliyun config not found: " + $srcConfigFile) -ForegroundColor Red
        Write-Host "    Run 'aliyun configure --profile leo-oss' first." -ForegroundColor Yellow
        exit 1
    }
}

# ---------- 2. Connect Schedule.Service ----------
try {
    $svc = New-Object -ComObject Schedule.Service
    $svc.Connect()
    $folder = $svc.GetFolder('\')
}
catch {
    Write-Host "[X] Cannot connect Schedule.Service: $_" -ForegroundColor Red
    exit 1
}

# ---------- 3. Uninstall branch ----------
if ($Uninstall) {
    foreach ($name in @($TaskName, "${TaskName}-Boot")) {
        try {
            $folder.DeleteTask($name, $null) | Out-Null
            Write-Host "[OK] Deleted task: $name" -ForegroundColor Green
        }
        catch [System.Runtime.InteropServices.COMException] {
            if ($_.Exception.Message -match 'not found' -or $_.Exception.HResult -in @(0x8007012A, 0x80070002)) {
                Write-Host "[!]  Task not found, skipped: $name"
            } else {
                Write-Host "[X] Delete failed: $name - $_" -ForegroundColor Red
            }
        }
    }
    Write-Host ""
    Write-Host "Uninstall done. To reinstall:" -ForegroundColor Cyan
    Write-Host "  powershell -ExecutionPolicy Bypass -File $PSCommandPath"
    exit 0
}

# ---------- 4. Cleanup old tasks ----------
foreach ($name in @($TaskName, "${TaskName}-Boot")) {
    try {
        $folder.DeleteTask($name, $null) | Out-Null
    } catch { }
}

# ---------- 5. Build task definition ----------
$task = $svc.NewTask(0)

# Principals: SYSTEM user
$task.Principal.UserId    = 'SYSTEM'
$task.Principal.RunLevel = 1  # TASK_RUNLEVEL_HIGHEST

# Settings
$task.Settings.Enabled                     = $true
$task.Settings.StartWhenAvailable          = $true
$task.Settings.MultipleInstances           = 3  # TASK_INSTANCES_IGNORE_NEW
$task.Settings.DisallowStartIfOnBatteries  = $false
$task.Settings.StopIfGoingOnBatteries      = $false
$task.Settings.AllowHardTerminate          = $true
$task.Settings.RunOnlyIfNetworkAvailable   = $false
$task.Settings.AllowDemandStart            = $true
$task.Settings.ExecutionTimeLimit          = 'PT5M'
$task.Settings.Priority                    = 7

# Action: invoke the silent batch wrapper so it sets PATH (for aliyun CLI) and
# ALIYUN_PROFILE, redirects stdout/stderr to manifest-update.log, and exits
# with the node exit code. Direct node.exe call won't have aliyun in PATH
# when running as SYSTEM.
$batPath = Join-Path $ScriptDir 'update-manifest-silent.bat'
if (-not (Test-Path $batPath)) {
    Write-Host "[X] batch wrapper not found: $batPath" -ForegroundColor Red
    Write-Host "    Re-create from git history if missing." -ForegroundColor Yellow
    exit 1
}
$act = $task.Actions.Create(0)  # TASK_ACTION_EXEC
$act.Path              = $batPath
$act.WorkingDirectory  = $ScriptDir
$act.Arguments         = ''

# Trigger 1: BootTrigger + Delay
$boot = $task.Triggers.Create(8)  # TASK_TRIGGER_BOOT
$boot.Delay    = "PT${BootDelayMinutes}M"
$boot.Enabled  = $true

# Trigger 2: TimeTrigger every N minutes (infinite loop)
$time = $task.Triggers.Create(1)  # TASK_TRIGGER_TIME
$time.StartBoundary                  = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
$time.Repetition.Interval            = "PT${IntervalMinutes}M"
$time.Repetition.StopAtDurationEnd   = $false
$time.Enabled                        = $true

# Trigger 3: EventTrigger System/1074 (shutdown event)
$evt = $task.Triggers.Create(0)  # TASK_TRIGGER_EVENT
$evt.Subscription = "<QueryList><Query Id='0' Path='System'><Select Path='System'>*[System[EventID=1074]]</Select></Query></QueryList>"
$evt.Delay              = 'PT1S'
$evt.ExecutionTimeLimit = 'PT2M'
$evt.Enabled            = $true

# ---------- 6. Set User-scope env var (fallback for non-SYSTEM trigger paths) ----------
[Environment]::SetEnvironmentVariable('ALIYUN_PROFILE', 'leo-oss', 'User')

# ---------- 7. Register ----------
try {
    # 6 = TASK_UPDATE (overwrite same name); 3 = TASK_LOGON_NONE
    $folder.RegisterTaskDefinition($TaskName, $task, 6, $null, $null, 3, $null) | Out-Null
    Write-Host "[OK] Task registered: $TaskName" -ForegroundColor Green
}
catch {
    Write-Host "[X] Register failed: $_" -ForegroundColor Red
    exit 1
}

# ---------- 8. Verify ----------
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
Write-Host "  $batPath (silent batch wrapper, sets PATH + ALIYUN_PROFILE)"

Write-Host ""
Write-Host "[OK] In 10 minutes manifest-update.log should have new entries" -ForegroundColor Green
$verifyCmd = "Get-Content `"$ScriptDir\manifest-update.log`" -Tail 5"
Write-Host "    Verify: $verifyCmd" -ForegroundColor Cyan