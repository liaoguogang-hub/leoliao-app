# show-toast.ps1 — 在交互用户会话里弹 Windows 通知
# 由 SYSTEM 计划任务通过 schtasks /run 触发(SYSTEM 自己弹的窗在 Session 0,桌面看不到)
# 消息内容从 C:\ProgramData\leoliao-sync-alert.txt 读取

$ErrorActionPreference = 'Stop'
$msgFile = 'C:\ProgramData\leoliao-sync-alert.txt'

if (-not (Test-Path $msgFile)) { exit 0 }

$lines = Get-Content $msgFile -Encoding UTF8
$title = if ($lines.Count -ge 1) { $lines[0] } else { 'OSS 同步' }
$body  = if ($lines.Count -ge 2) { ($lines[1..($lines.Count-1)] -join "`n") } else { '' }

[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.UI.Notifications.ToastNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]

$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)

$texts = $template.GetElementsByTagName('text')
$texts.Item(0).AppendChild($template.CreateTextNode($title)) | Out-Null
$texts.Item(1).AppendChild($template.CreateTextNode($body))  | Out-Null

# 借用 PowerShell 已注册的 AppUserModelID,免去自己注册快捷方式
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
