# _fix-time-trigger.ps1 — 修复 LeoLiaoOSSManifest 的 TimeTrigger.Repetition.Interval
#
# schtasks /Change /RI 5 不能可靠地改 TimeTrigger 的 Repetition(它会改错 trigger 或者没改)
# 这里直接用 Schedule.Service COM 改 TimeTrigger.Repetition.Interval = PT5M,in-place 修改,任务定义不重建
#
# 用法:
#   Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile","-File","D:\leoliao-app\scripts\_fix-time-trigger.ps1"

$logPath = 'D:\leoliao-app/scripts/fix-time-trigger.log'
try {
    Start-Transcript -Path $logPath -Append | Out-Null
    Write-Host "==== _fix-time-trigger started: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') ===="
    Write-Host "Admin: $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"

    # 用 CIM(管理员能读 SYSTEM 任务)而不是 Get-ScheduledTask
    $taskName = 'LeoLiaoOSSManifest'
    $ci = Get-CimInstance -Namespace 'Root\Microsoft\Windows\TaskScheduler' -ClassName MSFT_ScheduledTask -Filter "TaskName='$taskName'" -ErrorAction Stop
    if (-not $ci) {
        Write-Host "[X] 任务 $taskName 找不到" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] 找到任务: $taskName"

    # 拿现有 XML
    $xml = $ci.Xml
    Write-Host "---- 当前 XML (TimeTrigger) ----"
    $xml -split "`n" | Where-Object { $_ -match 'TimeTrigger|Repetition' } | ForEach-Object { Write-Host $_ }

    # 改 Repetition Interval = PT5M(只改 TimeTrigger 里的)
    # 用简单字符串替换:TimeTrigger 块里 Interval="PT10M" → Interval="PT5M"
    if ($xml -match '(?s)(<TimeTrigger>.*?<Repetition>)([^<]*?Interval=")PT(?:10|15|30|60)M(")') {
        $newXml = $xml -replace '(?s)(<TimeTrigger>.*?<Repetition>)([^<]*?Interval=")PT(?:10|15|30|60)M(")', ('$1$2PT5M$3')
    } else {
        Write-Host "[!]  XML 里没找到 TimeTrigger+Repetition,直接看怎么写" -ForegroundColor Yellow
        Write-Host $xml.Substring(0, [Math]::Min(2000, $xml.Length))
        exit 2
    }

    # 用 Schedule.Service COM 重新注册(覆盖同名任务,TASK_UPDATE = 6)
    $svc = New-Object -ComObject Schedule.Service
    $svc.Connect()
    $folder = $svc.GetFolder('\')

    # 解析新 XML 成 taskDefinition
    $taskDef = $svc.NewTask(0)
    $taskDef.XmlText = $newXml
    # 强制设 Principal = SYSTEM(以防 XML 里 Principal 被改了)
    $taskDef.Principal.UserId   = 'SYSTEM'
    $taskDef.Principal.RunLevel = 1

    $folder.RegisterTaskDefinition($taskName, $taskDef, 6, $null, $null, 3, $null) | Out-Null
    Write-Host "[OK] 重新注册完成" -ForegroundColor Green

    # 验证
    $ci2 = Get-CimInstance -Namespace 'Root\Microsoft\Windows\TaskScheduler' -ClassName MSFT_ScheduledTask -Filter "TaskName='$taskName'" -ErrorAction Stop
    $i2  = Get-CimInstance -Namespace 'Root\Microsoft\Windows\TaskScheduler' -ClassName MSFT_ScheduledTaskInfo -Filter "TaskName='$taskName'" -ErrorAction Stop
    Write-Host ""
    Write-Host "==== 验证当前状态 ====" -ForegroundColor Cyan
    Write-Host ("State:        " + $ci2.State)
    Write-Host ("UserId:       " + $ci2.Principal.UserId)
    Write-Host ("NextRunTime:  " + $i2.NextRunTime)
    Write-Host "Triggers:"
    $ci2.Triggers | ForEach-Object {
        $type = $_.CimClass.CimClassName.Replace('MSFT_ScheduledTask','')
        $rep = $_.Repetition
        if ($rep) {
            Write-Host ("  - {0}  Repetition.Interval = {1}" -f $type, $rep.Interval)
        } else {
            Write-Host ("  - {0}  (no repetition)" -f $type)
        }
    }
} catch {
    Write-Host "[X] FATAL: $_" -ForegroundColor Red
    exit 99
} finally {
    Stop-Transcript | Out-Null
}
Write-Host ""
Write-Host "[Done] Log: $logPath"
Read-Host "Press Enter to close"
