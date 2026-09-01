# notify-sync-status.ps1 — OSS 同步失败告警
# 由 update-manifest-silent.bat 在每次同步后调用(SYSTEM 身份)
#
# 逻辑:
#   - 连续失败达到 $Threshold 次 → 告警一次
#   - 之后每 $RepeatHours 小时重复告警一次(避免刷屏)
#   - 恢复成功 → 发一条恢复通知,计数清零
#
# 通道:
#   1. Windows 弹窗 — SYSTEM 弹不到桌面,改为触发用户会话里的 LeoLiaoOSSAlertToast 任务
#   2. 飞书 — webhook 存在 C:\ProgramData\leoliao-alert.json,没配就跳过

param(
    [Parameter(Mandatory=$true)][int]$ExitCode,
    [int]$Threshold    = 3,
    [int]$RepeatHours  = 6
)

$ErrorActionPreference = 'Continue'

$stateFile  = 'C:\ProgramData\leoliao-sync-state.json'
$msgFile    = 'C:\ProgramData\leoliao-sync-alert.txt'
$configFile = 'C:\ProgramData\leoliao-alert.json'
$logFile    = 'D:\leoliao-app\scripts\manifest-update.log'

function Write-Log($m) {
    "[$(Get-Date -Format 'yyyy/MM/dd HH:mm:ss')] [alert] $m" |
        Out-File -FilePath $logFile -Append -Encoding UTF8
}

# ---------- 读状态 ----------
$state = if (Test-Path $stateFile) {
    try { Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $null }
} else { $null }

if (-not $state) {
    $state = [pscustomobject]@{ fails = 0; alerted = $false; lastAlert = '' }
}

# ---------- 发告警 ----------
function Send-Alert($title, $body) {
    # 1. 弹窗:写消息文件 → 触发用户会话任务
    try {
        "$title`n$body" | Out-File -FilePath $msgFile -Encoding UTF8 -Force
        schtasks /run /tn "LeoLiaoOSSAlertToast" 2>&1 | Out-Null
        Write-Log "弹窗已触发"
    } catch { Write-Log "弹窗失败: $_" }

    # 2. 飞书
    if (Test-Path $configFile) {
        try {
            $cfg = Get-Content $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($cfg.webhook -and $cfg.webhook -notmatch 'your_key_here') {
                $payload = @{
                    msg_type = 'text'
                    content  = @{ text = "$title`n$body" }
                } | ConvertTo-Json -Depth 5 -Compress

                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $resp = Invoke-RestMethod -Uri $cfg.webhook -Method Post `
                        -ContentType 'application/json; charset=utf-8' `
                        -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 15
                if ($resp.code -eq 0 -or $resp.StatusCode -eq 0) { Write-Log "飞书已推送" }
                else { Write-Log "飞书返回异常: $($resp | ConvertTo-Json -Compress)" }
            } else {
                Write-Log "飞书 webhook 未配置,跳过"
            }
        } catch { Write-Log "飞书推送失败: $_" }
    } else {
        Write-Log "无 $configFile,跳过飞书"
    }
}

# ---------- 主逻辑 ----------
if ($ExitCode -eq 0) {
    if ($state.alerted) {
        Send-Alert "✅ OSS 同步已恢复" "之前连续失败 $($state.fails) 次,现已恢复正常。"
        Write-Log "已恢复,发送恢复通知"
    }
    $state.fails   = 0
    $state.alerted = $false
}
else {
    $state.fails = [int]$state.fails + 1

    $shouldAlert = $false
    if (-not $state.alerted -and $state.fails -ge $Threshold) {
        $shouldAlert = $true
    }
    elseif ($state.alerted -and $state.lastAlert) {
        try {
            if ((Get-Date) - [datetime]$state.lastAlert -gt [timespan]::FromHours($RepeatHours)) {
                $shouldAlert = $true
            }
        } catch { $shouldAlert = $true }
    }

    if ($shouldAlert) {
        # 从日志里抓最后一条错误行,让告警带上真实原因
        $reason = '(未知)'
        try {
            $tail = Get-Content $logFile -Tail 40 -Encoding UTF8 |
                    Where-Object { $_ -match '失败|Error|error|ENOENT' } | Select-Object -Last 1
            if ($tail) { $reason = $tail.Trim() }
        } catch {}

        $mins = $state.fails * 10
        Send-Alert "❌ OSS 同步连续失败 $($state.fails) 次" `
                   "已停摆约 $mins 分钟。`n原因: $reason`n日志: D:\leoliao-app\scripts\manifest-update.log"

        $state.alerted   = $true
        $state.lastAlert = (Get-Date).ToString('o')
        Write-Log "已告警(连续失败 $($state.fails) 次)"
    }
}

# ---------- 存状态 ----------
try {
    $state | ConvertTo-Json -Compress | Out-File -FilePath $stateFile -Encoding UTF8 -Force
} catch { Write-Log "写状态失败: $_" }
