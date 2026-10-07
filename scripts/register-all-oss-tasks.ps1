# register-all-oss-tasks.ps1 - 一键恢复/重建全部 OSS 同步相关计划任务
#
# 注册三个任务:
#   1. LeoLiaoOSSManifest   每 5 分钟  - 核心同步(列举 OSS + 上传 manifest)
#   2. WatchOSSManifestTask  每 15 分钟 - 健康监控(检查主任务状态)
#   3. CheckOSSSync          每 30 分钟 - 深度检查 + 异常自愈(新加)
#
# 全部以 SYSTEM 身份运行,开机自动恢复。
# 用法:双击 register-all-oss-tasks.bat(自动提权),或管理员 PowerShell 里跑本脚本。

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

$ScriptDir  = 'D:\leoliao-app\scripts'
$SyncBat    = Join-Path $ScriptDir 'update-manifest-silent.bat'
$WatchBat   = Join-Path $ScriptDir 'watch-oss-manifest-task-silent.bat'
$CheckBat   = Join-Path $ScriptDir 'check-oss-sync.bat'

function Say {
    param([string]$Msg, [string]$Color = 'Cyan')
    Write-Host $Msg -ForegroundColor $Color
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say "管理员权限: $admin"
if (-not $admin) { Say '[X] 需要管理员权限,请双击 register-all-oss-tasks.bat' 'Red'; exit 1 }

# ---------- 清理旧的同名任务(幂等)----------
foreach ($n in @('LeoLiaoOSSManifest','WatchOSSManifestTask','CheckOSSSync')) {
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
        Say "  [清理] 删除旧任务 $n"
        Unregister-ScheduledTask -TaskName $n -Confirm:$false
    }
}

# ---------- 用 COM API 注册(与历史脚本一致,兼容性最好)----------
function New-RunTask {
    param(
        [string]$TaskName,
        [string]$Execute,
        [string]$Arguments,
        [int]$Minutes,
        [string]$Description
    )
    $svc = New-Object -ComObject 'Schedule.Service'
    $svc.Connect()
    $root = $svc.GetFolder('\')

    $t = $svc.NewTask(0)

    # Principal: SYSTEM, 最高权限
    $t.Principal.UserId    = 'SYSTEM'
    $t.Principal.LogonType = 5          # SERVICE_ACCOUNT
    $t.Principal.RunLevel  = 1          # HIGHEST

    # Settings — COM 接口的属性名是"取反"式,且各版本略有差异,逐项容错设置
    $t.Settings.Enabled = $true
    $settingsMap = @{
        'DisallowStartIfOnBatteries'  = $false   # 允许用电池时启动
        'StopIfGoingOnBatteries'      = $false   # 切换到电池也不停止
        'StartWhenAvailable'          = $true    # 错过触发点则开机补跑
        'RunOnlyIfNetworkAvailable'   = $false
        'WakeToRun'                   = $true    # 从睡眠唤醒也跑
        'Hidden'                      = $false   # 不要藏起来(便于排错)
    }
    foreach ($k in $settingsMap.Keys) {
        try { $t.Settings.$k = $settingsMap[$k] }
        catch { Say "  [跳过] 该系统不支持设置项 $k" 'DarkGray' }
    }
    try { $t.Settings.ExecutionTimeLimit = 'PT10M' } catch {}

    # Action
    $a = $t.Actions.Create(0)            # TASK_ACTION_EXEC
    $a.Path = $Execute
    $a.Arguments = $Arguments
    $a.WorkingDirectory = $ScriptDir

    # Trigger: Daily + 每 N 分钟重复
    # StartBoundary 设在【未来 1 分钟】,保证第一个触发点一定会到来
    # (若等于注册时刻,当天已过去的触发点会被标记已消费,任务看似注册成功却长时间不跑)
    $tr = $t.Triggers.Create(1)         # TASK_TRIGGER_DAILY
    try { $tr.DaysInterval = 1 } catch {}
    $tr.StartBoundary = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
    try {
        $tr.Repetition.Interval = "PT${Minutes}M"
        $tr.Repetition.Duration = 'P1D'
        try { $tr.Repetition.StopAtDurationEnd = $false } catch {}
    } catch {
        Say "  [跳过] Repetition 设置失败(将只触发一次): $($_.Exception.Message)" 'DarkGray'
    }

    $t.RegistrationInfo.Description = $Description

    $root.RegisterTaskDefinition($TaskName, $t, 6, $null, $null, 3, $null) | Out-Null
    Say "  [OK] 已注册 $TaskName  (每 $Minutes 分钟, SYSTEM)" 'Green'
}

Say ''
Say '=== 注册任务 ===' 'Cyan'

New-RunTask -TaskName 'LeoLiaoOSSManifest' `
    -Execute 'cmd.exe' -Arguments ('/c', "`"$SyncBat`"") -Minutes 5 `
    -Description '每 5 分钟同步阿里云 OSS manifest(核心)'

New-RunTask -TaskName 'WatchOSSManifestTask' `
    -Execute 'cmd.exe' -Arguments ('/c', "`"$WatchBat`"") -Minutes 15 `
    -Description '每 15 分钟监控 LeoLiaoOSSManifest 健康度'

New-RunTask -TaskName 'CheckOSSSync' `
    -Execute 'cmd.exe' -Arguments ('/c', "`"$CheckBat`"") -Minutes 30 `
    -Description '每 30 分钟深度检查 OSS manifest,异常自动 -Fix 自愈'

# ---------- 复验 ----------
Say ''
Say '=== 注册结果复验 ===' 'Cyan'
foreach ($n in @('LeoLiaoOSSManifest','WatchOSSManifestTask','CheckOSSSync')) {
    try {
        $task = Get-ScheduledTask -TaskName $n -ErrorAction Stop
        $info = Get-ScheduledTaskInfo -TaskName $n
        Say ("  {0,-22} State={1,-8} Next={2}" -f $n, $task.State, $info.NextRunTime) 'Green'
    } catch {
        Say ("  {0,-22} [X] 查询失败: {1}" -f $n, $_.Exception.Message) 'Red'
    }
}

Say ''
Say '完成。三个任务已全部恢复。' 'Green'
Say "日志: manifest-update.log(同步) / watch-task.log(监控) / oss-sync-check.log(检查)" 'Gray'
Read-Host '按 Enter 关闭'