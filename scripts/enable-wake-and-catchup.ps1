# enable-wake-and-catchup.ps1 - 给三个 OSS 任务开启「唤醒计算机运行」+「错过后补跑」
#
# 背景: 2026-10-08 20:19 -> 10-11 12:34 共 2.7 天没有任何同步记录,
#       原因是机器关机/休眠。期间连自愈检查任务也没跑,断档无人发现。
#
# 本脚本为三个任务开启两个设置(不改触发器周期,不改 Action):
#   WakeToRun          = true  唤醒计算机后立即运行(从睡眠恢复时)
#   StartWhenAvailable = true  错过计划时间点时,一旦可用就补跑
#   DisallowStartIfOnBatteries = false  用电池时也允许启动
#   StopIfGoingOnBatteries     = false  切到电池不打断
#
# 用法: 双击 enable-wake-and-catchup.bat(自动提权)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Tasks = @('LeoLiaoOSSManifest','WatchOSSManifestTask','CheckOSSSync')

function Say {
    param([string]$Msg, [string]$Color = 'Cyan')
    Write-Host $Msg -ForegroundColor $Color
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say "管理员权限: $admin"
if (-not $admin) { Say '[X] 需要管理员权限,请双击 enable-wake-and-catchup.bat' 'Red'; exit 1 }

function Show-State {
    param($Task, [string]$Label)
    Say "  $Label" 'DarkGray'
    Say ("    State                   = {0}" -f $Task.State)
    Say ("    WakeToRun               = {0}" -f $Task.Settings.WakeToRun)
    Say ("    StartWhenAvailable      = {0}" -f $Task.Settings.StartWhenAvailable)
    Say ("    DisallowStartIfOnBatteries = {0}" -f $Task.Settings.DisallowStartIfOnBatteries)
    Say ("    StopIfGoingOnBatteries  = {0}" -f $Task.Settings.StopIfGoingOnBatteries)
    $rep = ''
    foreach ($tr in $Task.Triggers) {
        if ($tr.Repetition -and $tr.Repetition.Interval) { $rep = $tr.Repetition.Interval }
    }
    Say ("    Repetition              = {0}" -f $(if ($rep) { $rep } else { '(无)' }))
    Say ("    Triggers.Count          = {0}" -f $Task.Triggers.Count)
}

$changed = 0
$failed = @()

foreach ($n in $Tasks) {
    Say ''
    Say "===== $n =====" 'Cyan'
    try {
        $t = Get-ScheduledTask -TaskName $n -ErrorAction Stop
    } catch {
        Say "  [X] 读不到任务: $($_.Exception.Message)" 'Red'
        Say '      如果提示"找不到指定的文件",说明任务已丢失,' 'Yellow'
        Say '      请先双击 register-all-oss-tasks.bat 重新注册。' 'Yellow'
        $failed += $n
        continue
    }

    Show-State -Task $t -Label '修改前:'

    # 只改 Settings,不碰 Trigger / Action / Principal
    $s = New-ScheduledTaskSettingsSet `
        -WakeToRun `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

    try {
        Set-ScheduledTask -TaskName $n -Settings $s -ErrorAction Stop | Out-Null
        Say '  [OK] 设置已应用' 'Green'
        $changed++
    } catch {
        Say "  [X] 应用失败: $($_.Exception.Message)" 'Red'
        $failed += $n
        continue
    }

    Start-Sleep -Milliseconds 400
    $t2 = Get-ScheduledTask -TaskName $n
    Show-State -Task $t2 -Label '修改后:'
}

Say ''
Say '===== 汇总 =====' 'Cyan'
Say "  成功修改: $changed / $($Tasks.Count)"
if ($failed.Count -gt 0) {
    Say "  失败: $($failed -join ', ')" 'Red'
    exit 1
}

Say ''
Say '[OK] 三个任务已开启:唤醒即跑 + 错过补跑' 'Green'
Say ''
Say '效果:' 'Cyan'
Say '  · 合盖休眠后,唤醒计算机时立即触发一次同步'
Say '  · 如果到点时机器没开,一旦可用会自动补跑一次'
Say '  · 用电池时同样允许运行'
Say ''
Say '注意:关机状态下任务仍不会运行(那是硬件层面的),' 'Yellow'
Say '      要真正 7x24 需要把任务移到常开设备(如 NAS)。' 'Yellow'
Read-Host '按 Enter 关闭'