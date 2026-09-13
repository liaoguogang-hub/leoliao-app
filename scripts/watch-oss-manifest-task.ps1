# watch-oss-manifest-task.ps1 — 监控 LeoLiaoOSSManifest 任务健康度
#
# 每 15 分钟跑一次(由 WTS 任务 WatchOSSManifestTask 触发),检查:
#   1. 任务是否还在系统里
#   2. State 是否为 Ready
#   3. LastRunTime 距今多久(>20 分钟 → WARN,>45 分钟 → ERROR)
#   4. MissedRuns 是否有漏跑
#
# 输出: 追加到 D:\leoliao-app\scripts\watch-task.log
#   - INFO / OK / WARN / ERROR 四级
#   - 一行一条: [2026-09-13 12:30:00] [INFO] xxx
#
# 设计: 由 SYSTEM 用户跑(能读到 SYSTEM 任务的元数据)
#       如果以 guoga 跑,Get-ScheduledTask 会"拒绝访问",全部行会变 ERROR
#       → ERROR 不一定是任务挂了,可能是权限问题,看消息体判断

$ErrorActionPreference = 'Stop'
$TaskName  = 'LeoLiaoOSSManifest'
$LogPath   = 'D:\leoliao-app\scripts\watch-task.log'
$WarnMin   = 20   # LastRunTime 超过 20 分钟 → WARN
$ErrorMin  = 45   # LastRunTime 超过 45 分钟 → ERROR
$MaxLogKB  = 512  # 日志轮转阈值(KB)

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] [$Level] $Message"
    try {
        Add-Content -Path $LogPath -Value $line -Encoding UTF8
    } catch {
        # 日志写不了也别让脚本崩溃
    }
    # 同时输出到 console(给 WTS 历史记录留痕)
    Write-Host $line
}

# ---------- 日志轮转:超过 512KB 就重命名 ----------
try {
    if (Test-Path $LogPath) {
        $size = (Get-Item $LogPath).Length
        if ($size -gt ($MaxLogKB * 1024)) {
            $archive = $LogPath -replace '\.log$', ("-{0:yyyyMMddHHmmss}.log" -f (Get-Date))
            Move-Item -Path $LogPath -Destination $archive -Force
            Write-Log "日志轮转: 旧日志 → $archive (原大小 $([math]::Round($size/1024,1)) KB)" 'INFO'
        }
    }
} catch {
    Write-Log "日志轮转失败: $($_.Exception.Message)" 'WARN'
}

# ---------- 查任务 ----------
try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop

    $state      = $task.State.ToString()
    $lastRun    = $info.LastRunTime
    $lastResult = $info.LastTaskResult
    $nextRun    = $info.NextRunTime
    $missed     = $info.NumberOfMissedRuns

    if ($lastRun -eq $null -or $lastRun -eq [datetime][]) {
        Write-Log "任务在系统里但从未跑过 (State=$state, NextRun=$nextRun)" 'WARN'
    } else {
        $idleMin = ((Get-Date) - $lastRun).TotalMinutes
        $idleStr = "$([math]::Round($idleMin, 1)) 分钟前"

        if ($idleMin -gt $ErrorMin) {
            Write-Log "⚠️  任务长时间未跑! LastRun=$lastRun ($idleStr), LastResult=$lastResult, NextRun=$nextRun, MissedRuns=$missed, State=$state" 'ERROR'
        } elseif ($idleMin -gt $WarnMin) {
            Write-Log "⚠️  任务有点久没跑。 LastRun=$lastRun ($idleStr), NextRun=$nextRun, MissedRuns=$missed, State=$state" 'WARN'
        } else {
            Write-Log "OK: State=$state, LastRun=$lastRun ($idleStr), LastResult=$lastResult, NextRun=$nextRun, MissedRuns=$missed" 'INFO'
        }
    }
} catch {
    $msg = $_.Exception.Message -replace "`r`n", ' ' -replace "`n", ' '
    Write-Log "❌ 任务查询失败(可能任务丢了,或权限不够): $msg" 'ERROR'
}
