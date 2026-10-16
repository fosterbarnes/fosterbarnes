# Registers watch.ts as the "heatmap" scheduled task: starts with Windows, runs without anyone
# logged in, relaunches within 5 minutes if it stops. Run as the user who ran `gh auth login`. -Uninstall removes it.
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$taskName = 'heatmap'

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    "Removed task $taskName."
    return
}

foreach ($cmd in 'node', 'git', 'gh') {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd is not on PATH" }
}
gh auth status *> $null
if ($LASTEXITCODE) { throw 'gh is not logged in: run gh auth login' }
gh auth setup-git # git push uses the gh login.
if ($LASTEXITCODE) { throw 'gh auth setup-git failed' }

$watch = Join-Path $PSScriptRoot 'watch.ts'
$action = New-ScheduledTaskAction -Execute (Get-Command node).Source -Argument "`"$watch`"" -WorkingDirectory $PSScriptRoot
# Boot start, plus a 5-minute check that relaunches the watcher if it ever exits
# (Task Scheduler's restart-on-failure does not cover a process that exits with an error).
$trigger = @(
    New-ScheduledTaskTrigger -AtStartup
    New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
)
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
# A stored password lets the task read gh's saved login when nobody is logged in.
$cred = Get-Credential -UserName "$env:USERDOMAIN\$env:USERNAME" -Message 'Your Windows password (stored in the task)'
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -User $cred.UserName -Password $cred.GetNetworkCredential().Password -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
"Task $taskName is running. Log: $env:LOCALAPPDATA\heatmap\heatmap.log"
