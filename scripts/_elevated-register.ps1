# Wrapper: run register-wts-task.ps1 with full transcript logging
# Use: Start-Process PowerShell -Verb RunAs -ArgumentList "-NoProfile","-File","D:\leoliao-app\scripts\_elevated-register.ps1"
$logPath = 'D:\leoliao-app\scripts\register-task.log'
try {
    Start-Transcript -Path $logPath -Append | Out-Null
    Write-Host ("==== Elevated register wrapper started: " + (Get-Date -Format "yyyy-MM-ddTHH:mm:ss"))
    Write-Host ("Admin: " + ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
    Write-Host ("==== Running register-wts-task.ps1 ====")
    & 'D:\leoliao-app\scripts\register-wts-task.ps1'
    Write-Host ("==== Exit code: " + $LASTEXITCODE)
}
catch {
    Write-Host ("==== FATAL: " + $_)
}
finally {
    Stop-Transcript | Out-Null
}
Write-Host ""
Write-Host "[Done] Log: $logPath"
Read-Host "Press Enter to close"