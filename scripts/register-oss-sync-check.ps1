# register-oss-sync-check.ps1 - 注册 CheckOSSSync 定期检查任务
# 管理员双击 register-oss-sync-check.bat 自动调用本脚本
# 每 30 分钟跑 check-oss-sync.ps1 -Fix(异常时自动触发一次同步)

$TaskName = 'CheckOSSSync'
$BatPath  = 'D:\leoliao-app\scripts\check-oss-sync.bat'
$Ps1Path  = 'D:\leoliao-app\scripts\check-oss-sync.ps1'

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

function Say {
    param([string]$Msg, [string]$Color = 'Cyan')
    Write-Host $Msg -ForegroundColor $Color
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say "Admin: $admin"
if (-not $admin) {
    Say "[X] 需要管理员权限" 'Red'; exit 1
}

# 删除旧的同名任务(幂等)
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Say "[INFO] 任务 '$TaskName' 已存在,先删除再重建"
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# 让任务执行 bat(已包含 aliyun PATH、UAC 预检、退出码传播)
# 不用 -Argument 数组(PS 5.1 的 New-ScheduledTaskAction -Argument 解析数组有问题),
# 也不用 -WorkingDirectory(由 bat 自己 cd /d 到正确目录)
$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
    -Argument ('/c', $BatPath) `
    -WorkingDirectory (Split-Path $BatPath -Parent)

$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 30) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "每 30 分钟检查 OSS manifest.json 健康,异常时自动触发一次同步(由 check-oss-sync.ps1 -Fix 执行)。日志: D:\leoliao-app\scripts\oss-sync-check.log" `
    -Force | Out-Null

Say "[OK] 任务 '$TaskName' 已注册:每 30 分钟,异常自动 -Fix" 'Green'

# 立即触发一次(便于立刻验证)
$runNow = Read-Host "立即跑一次验证吗?(Y/n)"
if ($runNow -ne 'n' -and $runNow -ne 'N') {
    Say "[INFO] 立即触发..." 'Cyan'
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 3
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Say "  State       = $($info.State)"
    Say "  LastRunTime = $($info.LastRunTime)"
    Say "  NextRunTime = $($info.NextRunTime)"
}

Say ""
Say "完成。每 30 分钟自动检查 + 异常自动同步。" 'Green'
Say "日志: $Ps1Path  路径所在目录" 'Gray'
Read-Host "按 Enter 关闭"