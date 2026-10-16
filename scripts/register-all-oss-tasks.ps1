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

# ---------- 模式判定 ----------
# 交互模式: 用户双击 bat -> 有 Read-Host 等待
# 自愈模式: OSSHealOnBoot 任务开机调用(加 -SelfHealOnce)-> 绝不 Read-Host
#           (SYSTEM 会话没有控制台,Read-Host 会卡住或报错,拖垮任务)
$SelfHeal = ($args -contains '-SelfHealOnce')

if ($SelfHeal) {
    # 3 小时内跑过就跳过,避免时钟漂移 / 异常重启造成重建死循环
    $stampFile = Join-Path $ScriptDir '.oss-heal-stamps'
    $minGapMin = 180
    try {
        $raw = (Get-Content $stampFile -ErrorAction Stop -Raw).Trim()
        $lastDt = [datetime]::Parse($raw)
        $gap = (Get-Date) - $lastDt
        if ($gap.TotalMinutes -lt $minGapMin) {
            "=== 开机自愈: 上次 {0:F0} 分钟前(< {1} 分钟门槛),跳过 ===" -f $gap.TotalMinutes, $minGapMin |
                Out-File -FilePath (Join-Path $ScriptDir 'oss-heal.log') -Append -Encoding UTF8
            exit 0
        }
    } catch {
        # 时间戳不存在或损坏 -> 正常执行
    }
    try { Set-Content -Path $stampFile -Value (Get-Date).ToString('o') -ErrorAction SilentlyContinue } catch {}
    $msg = "=== 开机自愈触发 {0} : 开始清理 + 重建 ===" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    try { $msg | Out-File -FilePath (Join-Path $ScriptDir 'oss-heal.log') -Append -Encoding UTF8 } catch {}
    Say $msg 'Yellow'
}

# ---------- 清理旧的同名任务(幂等)----------
$AllTasks = @('LeoLiaoOSSManifest','WatchOSSManifestTask','CheckOSSSync','OSSHealOnBoot')
# 自愈模式下【不删自己】: OSSHealOnBoot 正在运行时把它删掉,一旦本脚本中途
# 被中断(超时/崩溃)就会留下"三个核心任务删了没建 + 自愈任务也没了"的更坏状态。
# 交互模式下可以全清,因为用户就在旁边看着。
$CleanTasks = if ($SelfHeal) { @('LeoLiaoOSSManifest','WatchOSSManifestTask','CheckOSSSync') } else { $AllTasks }
foreach ($n in $CleanTasks) {
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
        # v1.64 修复: Duration 决定重复窗口的长度。
        #   之前设成 'P1D'(1 天),导致任务只在注册后 24 小时内重复,
        #   之后永久静默 —— 表现为"任务还在、配置正常、但几天不跑一次"。
        #   改为 3650 天(约 10 年),配合 StopAtDurationEnd=false 实现持续重复。
        $tr.Repetition.Duration = 'P3650D'
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
Say '完成。核心任务已全部恢复。' 'Green'
Say "日志: manifest-update.log(同步) / watch-task.log(监控) / oss-sync-check.log(检查)" 'Gray'

# ============================================================
# 额外注册 SYSTEM 级自愈任务 OSSHealOnBoot
#
# 为什么需要: 10/8 与 10/13 各发生过一次三个 OSS 任务被系统更新清空的事故。
#   启动项 ensure-oss-tasks-on-boot.cmd 在用户上下文运行,提权要弹 UAC;
#   而自动登录 / 远程会话下 UAC 无人点击 -> 等于失效。
#   本任务以 SYSTEM 身份 + 开机触发器运行,不依赖任何用户登录与 UAC。
#
# 为什么"整体重建"而不是"只补缺":
#   用户级 schtasks 无法区分"任务存在但无权限"与"任务真丢失"
#   (两者都返回 Access is denied)。本脚本是幂等的(先删后建,
#   配置全部来自脚本本身),整体重建的结果与新建一致,不会丢配置。
#
# 触发: TASK_TRIGGER_BOOT(8) + Delay 5 分钟(等计划任务服务就绪)
# 限频: -SelfHealOnce 入口有 3 小时去重
# ============================================================
$HealTaskName = 'OSSHealOnBoot'
$HealLog      = Join-Path $ScriptDir 'oss-heal.log'

Say ''
Say '=== 注册 SYSTEM 级自愈任务(开机 5 分钟后自动重建,无需 UAC)===' 'Cyan'
try {
    $svcH = New-Object -ComObject 'Schedule.Service'
    $svcH.Connect()
    $rootH = $svcH.GetFolder('\')

    $h = $svcH.NewTask(0)

    # Principal: SYSTEM + 最高权限(与三个核心任务一致)
    $h.Principal.UserId    = 'SYSTEM'
    $h.Principal.LogonType = 5          # SERVICE_ACCOUNT
    $h.Principal.RunLevel  = 1          # HIGHEST

    # Settings: 逐项容错(COM 属性名各系统版本略有差异)
    $h.Settings.Enabled = $true
    $healSettings = @{
        'DisallowStartIfOnBatteries' = $false
        'StopIfGoingOnBatteries'     = $false
        'StartWhenAvailable'         = $true    # 错过开机点则尽快补跑
        'WakeToRun'                  = $false   # 别为自愈把机器唤醒
        'Hidden'                     = $false
    }
    foreach ($k in $healSettings.Keys) {
        try { $h.Settings.$k = $healSettings[$k] } catch {}
    }
    try { $h.Settings.ExecutionTimeLimit = 'PT15M' } catch {}

    # Trigger: 系统启动 + 延迟 5 分钟
    $bt = $h.Triggers.Create(8)          # TASK_TRIGGER_BOOT
    try { $bt.Delay = 'PT5M' } catch { Say "  [警告] 无法设置 Delay: $($_.Exception.Message)" 'Yellow' }
    try { $bt.Enabled = $true } catch {}
    try { $bt.StartBoundary = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss') } catch {}

    # Action: 调用本脚本自身(-SelfHealOnce 非交互模式)
    $ha = $h.Actions.Create(0)           # TASK_ACTION_EXEC
    $ha.Path = 'powershell.exe'
    $ha.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -SelfHealOnce"
    $ha.WorkingDirectory = $ScriptDir

    $h.RegistrationInfo.Description = 'OSS 自愈: 开机 5 分钟后检查并重建 LeoLiaoOSSManifest / WatchOSSManifestTask / CheckOSSSync'

    # 第 6 个参数 logonType 用 3,与三个核心任务保持一致(该组合在本机已验证可用)
    $rootH.RegisterTaskDefinition($HealTaskName, $h, 6, 'SYSTEM', $null, 3, $null) | Out-Null
    Say "  [OK] 已注册 $HealTaskName (BOOT + 5min 延迟, SYSTEM)" 'Green'
} catch {
    Say "  [X] 注册失败: $($_.Exception.Message)" 'Red'
    try {
        "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] 注册 OSSHealOnBoot 失败: $($_.Exception.Message)" |
            Out-File -FilePath $HealLog -Append -Encoding UTF8
    } catch {}
}

# ---------- 最终复验(四个任务)----------
Say ''
Say '=== 最终复验(共 4 个任务)===' 'Cyan'
foreach ($n in $AllTasks) {
    try {
        $task = Get-ScheduledTask -TaskName $n -ErrorAction Stop
        $info = Get-ScheduledTaskInfo -TaskName $n
        Say ("  {0,-22} State={1,-9} Next={2}" -f $n, $task.State, $info.NextRunTime) 'Green'
    } catch {
        Say ("  {0,-22} [X] {1}" -f $n, $_.Exception.Message) 'Red'
    }
}

if ($SelfHeal) {
    # 自愈模式:写日志收尾,绝不 Read-Host
    $done = "=== 开机自愈完成 {0} ===" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    try { $done | Out-File -FilePath $HealLog -Append -Encoding UTF8 } catch {}
    Say $done 'Yellow'
    exit 0
}

Read-Host '按 Enter 关闭'