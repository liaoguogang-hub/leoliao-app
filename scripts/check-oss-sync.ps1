# check-oss-sync.ps1 — LeoLiao OSS manifest.json 健康检查 + 自愈
#
# 用法:
#   powershell -NoProfile -ExecutionPolicy Bypass -File D:\leoliao-app\scripts\check-oss-sync.ps1
#   powershell ... -File check-oss-sync.ps1 -Fix       异常时自动修复(手动触发一次同步)
#   powershell ... -File check-oss-sync.ps1 -Quiet    只输出汇总行
#   powershell ... -File check-oss-sync.ps1 -JSON     输出 JSON 报告
#
# 退出码:
#   0 = 全部 OK
#   1 = 有 WARN(需要关注,可能自愈)
#   2 = 有 FAIL(需要人工介入)
#
# 检测项:
#   1. aliyun CLI 是否存在
#   2. bat 退出码传播是否正确(防止监控被骗)
#   3. 计划任务 LeoLiaoOSSManifest State 是否 Ready
#   4. manifest.json 新鲜度(LastModified 距今 < 30 min)
#   5. manifest 完整性(条目数 vs OSS 实际 md 数)
#   6. 同步日志最近 1 小时是否全 exit=0
#   7. 监控报告最近是否 ERROR
#
# 自愈(Fix):
#   4 失败 -> 手动跑 gen_oss_manifest.mjs 一次
#   1 失败 -> 在日志中写明确指引
#
# 日志: D:\leoliao-app\scripts\oss-sync-check.log

param(
    [switch]$Fix,
    [switch]$Quiet,
    [switch]$JSON,
    [int]$StaleMinutes = 30,    # 超过此分钟视为 stale
    [int]$LogMaxKB = 1024        # 日志轮转阈值
)

$ErrorActionPreference = 'Continue'

# ---------- 配置 ----------
$TaskName     = 'LeoLiaoOSSManifest'
$AliyunExe    = 'C:\aliyun-cli\aliyun.exe'
$BatPath      = 'D:\leoliao-app\scripts\update-manifest-silent.bat'
$SyncScript   = 'D:\leoliao-app\scripts\gen_oss_manifest.mjs'
$SyncLog      = 'D:\leoliao-app\scripts\manifest-update.log'
$WatchLog     = 'D:\leoliao-app\scripts\watch-task.log'
$CheckLog     = 'D:\leoliao-app\scripts\oss-sync-check.log'
$Bucket       = 'oss://liaoguogang'
$ManifestKey  = 'Obsidian/manifest.json'
$BucketKey    = "$Bucket/$ManifestKey"

# ---------- 编码 / PATH ----------
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:PATH = "C:\aliyun-cli;$env:PATH"

# ---------- 日志 ----------
function Say-Log {
    param([string]$Msg, [string]$Level = 'INFO')
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] [$Level] $Msg"
    try { Add-Content -Path $CheckLog -Value $line -Encoding UTF8 } catch {}
    if (-not $Quiet -and -not $JSON) {
        $color = switch ($Level) { 'FAIL' { 'Red' } 'WARN' { 'Yellow' } default { 'Gray' } }
        Write-Host $line -ForegroundColor $color
    }
}

# 日志轮转
try {
    if (Test-Path $CheckLog) {
        $sz = (Get-Item $CheckLog).Length
        if ($sz -gt ($LogMaxKB * 1024)) {
            $arc = $CheckLog -replace '\.log$', ("-{0:yyyyMMddHHmmss}.log" -f (Get-Date))
            Move-Item $CheckLog $arc -Force
        }
    }
} catch {}

# ---------- 检测项 ----------
$results = @()

function Add-Check {
    param([string]$Name, [string]$Status, [string]$Detail)
    $script:results += [pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail }
    $color = switch ($Status) { 'OK' { 'Green' } 'WARN' { 'Yellow' } default { 'Red' } }
    $icon  = switch ($Status) { 'OK' { '[OK]  ' } 'WARN' { '[WARN]' } default { '[FAIL]' } }
    Say-Log "$icon $Name  $Detail" $(if ($Status -eq 'OK') {'INFO'} elseif ($Status -eq 'WARN') {'WARN'} else {'FAIL'})
}

# 1. aliyun CLI
if (Test-Path $AliyunExe) {
    $sz = [math]::Round((Get-Item $AliyunExe).Length / 1MB, 1)
    Add-Check 'aliyun CLI' OK "C:\aliyun-cli\aliyun.exe ($sz MB)"
} else {
    Add-Check 'aliyun CLI' FAIL "缺失 $AliyunExe -- 同步 100% 失败,需重装 Alibaba Cloud CLI"
}

# 2. bat 退出码传播
$batOK = $false
$batIssue = ''
if (Test-Path $BatPath) {
    $bat = Get-Content $BatPath -Raw -Encoding ASCII
    if ($bat -match 'exit\s+/b\s+%RC%') {
        $batOK = $true
        Add-Check 'bat 退出码传播' OK '已传播 node 退出码(监控可信)'
    } else {
        $batIssue = 'bat 未传播 exit code,监控会被骗报 OK'
        Add-Check 'bat 退出码传播' FAIL $batIssue
    }
} else {
    Add-Check 'bat 退出码传播' FAIL "缺失 $BatPath"
}

# 3. 计划任务(非管理员可能访问不到)
$taskState = 'Unknown'
$lastRun = $null
$nextRun = $null
$lastResult = $null
$missed = 0
try {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $taskState = $task.State.ToString()
    $lastRun    = $info.LastRunTime
    $nextRun    = $info.NextRunTime
    $lastResult = $info.LastTaskResult
    $missed     = $info.NumberOfMissedRuns
    # v1.60: Running 也是健康状态 —— 检查任务常与同步任务同时触发,
    #        此时看到 State=Running 属正常,不应误报 FAIL。
    #        只有 Disabled(被禁用)/ Queued 超时 等才判 FAIL。
    if ($taskState -eq 'Ready') {
        Add-Check '计划任务' OK "State=Ready, LastResult=$lastResult, MissedRuns=$missed"
    } elseif ($taskState -eq 'Running') {
        Add-Check '计划任务' OK "State=Running(正在执行,正常), LastResult=$lastResult, MissedRuns=$missed"
    } else {
        Add-Check '计划任务' FAIL "State=$taskState (期望 Ready 或 Running)"
    }
} catch {
    # 非管理员看不到 SYSTEM 任务
    Add-Check '计划任务' WARN "无法直接读取(非管理员) - 看日志自行推断"
}

# 4. manifest 新鲜度
$manifestAgeMin = $null
$manifestSize = $null
$manifestETag = $null
$needFix = $false
try {
    $out = & aliyun --profile leo-oss oss ls $BucketKey 2>&1
    foreach ($l in $out) {
        if ($l -match '(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})') {
            $dt = [datetime]::ParseExact(("{0}-{1}-{2} {3}:{4}:{5}" -f $Matches[1],$Matches[2],$Matches[3],$Matches[4],$Matches[5],$Matches[6]), 'yyyy-MM-dd HH:mm:ss', $null)
            # CST(+0800) - 服务器时间可能和本地时区不同,这里用服务器报的本地时间
            $manifestAgeMin = [math]::Round(((Get-Date) - $dt).TotalMinutes, 1)
        }
        if ($l -match '\s+(\d+)\s+Standard\s+(\S+)\s+' + [regex]::Escape($BucketKey)) {
            $manifestSize = [int]$Matches[1]
            $manifestETag = $Matches[2]
        }
    }
    if ($null -eq $manifestAgeMin) {
        Add-Check 'manifest 新鲜度' WARN "无法解析 OSS 时间,可能是 aliyun CLI 不可用"
    } elseif ($manifestAgeMin -gt $StaleMinutes) {
        Add-Check 'manifest 新鲜度' WARN "OSS 上 manifest 已 $manifestAgeMin 分钟未更新(阈值 $StaleMinutes) - 同步可能滞后"
        $needFix = $true
    } else {
        Add-Check 'manifest 新鲜度' OK "$manifestAgeMin 分钟前更新,Size=$manifestSize B"
    }
} catch {
    Add-Check 'manifest 新鲜度' FAIL "无法查询 OSS: $($_.Exception.Message)"
}

# 5. manifest 完整性(条目数 vs OSS md 数)
$entryCount = 0
$ossMdCount = 0
$diff = 0
try {
    $tmp = "$env:TEMP\check-oss-sync-manifest.json"
    & aliyun --profile leo-oss oss cp $BucketKey $tmp -f 2>&1 | Out-Null
    if (Test-Path $tmp) {
        $j = Get-Content $tmp -Raw -Encoding UTF8 | ConvertFrom-Json
        $entryCount = @($j).Count
        # 独立数 OSS md
        $listOut = & aliyun --profile leo-oss oss ls "$Bucket/Obsidian/" 2>&1
        foreach ($line in $listOut) {
            if ($line -match "$([regex]::Escape($Bucket))/Obsidian/.+?\.md\s*$") { $ossMdCount++ }
        }
        $diff = $entryCount - $ossMdCount
        if ($diff -eq 0) {
            Add-Check 'manifest 完整性' OK "$entryCount 条 = OSS 上 $ossMdCount 个 md"
        } elseif ([Math]::Abs($diff) -le 3) {
            Add-Check 'manifest 完整性' WARN "$entryCount 条 vs $ossMdCount 个 md(差 $diff) - 可能刚加/删文件还没同步"
        } else {
            Add-Check 'manifest 完整性' FAIL "$entryCount 条 vs $ossMdCount 个 md(差 $diff 较大)"
            $needFix = $true
        }
    } else {
        Add-Check 'manifest 完整性' FAIL "无法下载 manifest"
    }
} catch {
    Add-Check 'manifest 完整性' WARN "完整性核对异常: $($_.Exception.Message)"
}

# 6. 同步日志最近 1 小时退出码
try {
    if (Test-Path $SyncLog) {
        $recent = Select-String -Path $SyncLog -Pattern 'end \(exit=' -Encoding UTF8 | Select-Object -Last 12
        $fails = @($recent | Where-Object { $_ -match 'exit=1\b' })
        if ($fails.Count -gt 0) {
            Add-Check '最近 12 次同步' FAIL "$($fails.Count) 次失败 / $($recent.Count) 次"
        } elseif ($recent.Count -gt 0) {
            Add-Check '最近 12 次同步' OK "全部 exit=0"
        } else {
            Add-Check '最近 12 次同步' WARN "日志无最近 end 标记"
        }
    } else {
        Add-Check '最近 12 次同步' FAIL "日志不存在: $SyncLog"
    }
} catch {
    Add-Check '最近 12 次同步' WARN "解析日志异常"
}

# 7. 监控最近报告
try {
    if (Test-Path $WatchLog) {
        $reports = Select-String -Path $WatchLog -Pattern '\[(INFO|WARN|ERROR)\]' -Encoding UTF8 | Select-Object -Last 4
        $errs = @($reports | Where-Object { $_ -match '\[ERROR\]|\[WARN\]' })
        if ($errs.Count -gt 0) {
            Add-Check '监控最近报告' FAIL "$($errs.Count) 条 WARN/ERROR"
        } elseif ($reports.Count -gt 0) {
            Add-Check '监控最近报告' OK "最近 $($reports.Count) 条全是 INFO/OK"
        } else {
            Add-Check '监控最近报告' WARN '无最近报告'
        }
    } else {
        Add-Check '监控最近报告' WARN "日志不存在"
    }
} catch {}

# ---------- 汇总 ----------
$failCount = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
$warnCount = @($results | Where-Object { $_.Status -eq 'WARN' }).Count
$okCount   = @($results | Where-Object { $_.Status -eq 'OK' }).Count
$overall   = if ($failCount -gt 0) {'FAIL'} elseif ($warnCount -gt 0) {'WARN'} else {'OK'}

Say-Log "==== 汇总 OK=$okCount WARN=$warnCount FAIL=$failCount  overall=$overall ====" $(if ($overall -eq 'OK') {'INFO'} elseif ($overall -eq 'WARN') {'WARN'} else {'FAIL'})

# ---------- 自愈 ----------
if ($Fix -and $needFix -and (Test-Path $AliyunExe)) {
    Say-Log "==== 开始自愈(手动触发同步)===" 'INFO'
    try {
        Set-Location (Split-Path $SyncScript -Parent)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $proc = Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList $SyncScript -Wait -PassThru -NoNewWindow
        $sw.Stop()
        if ($proc.ExitCode -eq 0) {
            Say-Log "自愈成功: 手动同步 exit=0,耗时 $([math]::Round($sw.Elapsed.TotalSeconds,1))s" 'INFO'
        } else {
            Say-Log "自愈失败: node exit=$($proc.ExitCode)" 'FAIL'
        }
    } catch {
        Say-Log "自愈异常: $($_.Exception.Message)" 'FAIL'
    }
}

# ---------- JSON 输出 ----------
if ($JSON) {
    $payload = [pscustomobject]@{
        Timestamp   = (Get-Date -Format 'o')
        Overall     = $overall
        OK          = $okCount
        WARN        = $warnCount
        FAIL        = $failCount
        Checks      = $results
        Manifest    = [pscustomobject]@{
            Size    = $manifestSize
            ETag    = $manifestETag
            AgeMin  = $manifestAgeMin
            Entries = $entryCount
            OSSMd   = $ossMdCount
        }
        Task        = [pscustomobject]@{
            State      = $taskState
            LastRun    = if ($lastRun) { $lastRun.ToString('o') } else { $null }
            NextRun    = if ($nextRun) { $nextRun.ToString('o') } else { $null }
            LastResult = $lastResult
            MissedRuns = $missed
        }
    }
    $payload | ConvertTo-Json -Depth 4
}

# ---------- 退出码 ----------
if ($overall -eq 'FAIL') { exit 2 }
elseif ($overall -eq 'WARN') { exit 1 }
else { exit 0 }