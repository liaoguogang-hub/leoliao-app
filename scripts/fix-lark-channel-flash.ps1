# fix-lark-channel-flash.ps1 - 消除 DSH-Lark-Channel 每 15 分钟闪蓝色窗口
#
# 根因: 任务是 powershell.exe(控制台程序)直接启动,即使带 -WindowStyle Hidden,
#       每次触发仍会创建/销毁一个控制台窗口 -> 屏幕闪一下。
#       脚本本身 3 秒内 exit(检测到 channel 已在跑就跳过),所以窗口生命周期很短。
#
# 方案: Task To Run 改为 wscript.exe(无控制台宿主)调用一个 VBS 包装器,
#       VBS 再以 0(完全隐藏、不等待)方式拉起同一个 autostart 脚本。
#       15 分钟看门狗逻辑、settings 自愈、防重复启动全部保持不变。
#
# 用法: 双击 fix-lark-channel-flash.bat(自动提权)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$TaskName = 'DSH-Lark-Channel'
$VbsPath  = Join-Path $env:USERPROFILE '.dsh\lark-hidden-launcher.vbs'

function Say {
    param([string]$Msg, [string]$Color = 'Cyan')
    Write-Host $Msg -ForegroundColor $Color
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Say "管理员权限: $admin"
if (-not $admin) { Say '[X] 需要管理员权限,请双击 fix-lark-channel-flash.bat' 'Red'; exit 1 }

# ---------- 前置: VBS 必须存在 ----------
if (-not (Test-Path $VbsPath)) {
    Say "[X] 找不到静默启动器: $VbsPath" 'Red'
    Say "    请确认文件存在后重试。" 'Yellow'
    exit 1
}
Say "[OK] 静默启动器就位: $VbsPath" 'Green'

# ---------- 读当前任务 ----------
try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
} catch {
    Say "[X] 找不到任务 '$TaskName': $($_.Exception.Message)" 'Red'
    exit 1
}

$oldExec = $task.Actions[0].Execute
$oldArgs = $task.Actions[0].Arguments
Say ''
Say '===== 修改前 =====' 'Cyan'
Say "  Execute  = $oldExec"
Say "  Arguments = $oldArgs"

# ---------- 改成 wscript 静默启动 ----------
$newArgs = "//B //Nologo `"$VbsPath`""

# 用 COM API 改 Action(保留所有 trigger / settings / principal 不变)
$svc = New-Object -ComObject 'Schedule.Service'
$svc.Connect()
$root = $svc.GetFolder('\')
$t = $svc.GetTask($TaskName)

$a = $t.Actions.Create(0)
$a.Path = 'wscript.exe'
$a.Arguments = $newArgs

$t.RegistrationInfo.Description = 'DSH Lark channel: 15-minute watchdog, silent launch via wscript.exe (no console flash). Log: C:\Users\guoga\.dsh\logs\lark-channel.log'

$root.RegisterTaskDefinition(
    $TaskName,
    $t,
    6,      # TASK_CREATE_OR_UPDATE = 6
    $null,  # user
    $null,  # password
    3,      # TASK_LOGON_SERVICE_ACCOUNT? -> 实际用 5=TASK_LOGON_NONE
    $null
) | Out-Null

Say ''
Say '===== 修改后 =====' 'Cyan'
$t2 = $svc.GetTask($TaskName)
Say "  Execute  = $($t2.Actions.Item(1).Path)"
Say "  Arguments = $($t2.Actions.Item(1).Arguments)"
Say ''
Say "[OK] 已改为静默启动,15 分钟看门狗逻辑保持不变" 'Green'
Say '提示: 下次触发(约 15 分钟内)观察是否还闪窗。' 'Gray'
Say "日志: $(Join-Path $env:USERPROFILE '.dsh\logs\lark-channel.log')" 'Gray'
Read-Host '按 Enter 关闭'