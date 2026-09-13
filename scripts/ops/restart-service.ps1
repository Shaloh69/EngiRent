# restart-service.ps1 -- runs ON the server PC. Restarts ONE EngiRent service.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File restart-service.ps1 -Port 3000 -Task EngiRentWeb
#
# The same three runbook gotchas as restart-node-admin.ps1, generalised so a
# release can restart just the website (or just Node) instead of both of the
# pair that script is hardwired to:
#   * Stop-ScheduledTask does NOT kill the process -- the real owner of the
#     port is killed first, or the old build keeps being served.
#   * Every svc-*.bat runs `npm run build && npm start`, so a restart is a
#     rebuild. That is what makes a config change (a changelog, a release
#     number, an env var) actually reach the running site.
#   * Start-ScheduledTask on a task that is still Running is SILENTLY IGNORED.
#     Wait until it is really not Running, start it, and check the start took.
#
# It proves nothing on its own. The caller proves the restart by the PID on the
# port CHANGING, and the change by reading it back from the live service.

param(
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(Mandatory = $true)][ValidateSet('EngiRentNode', 'EngiRentWeb', 'EngiRentAdmin')][string]$Task
)

$ErrorActionPreference = 'Continue'

$c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) {
  "port ${Port}: stopping owner PID $($c.OwningProcess)"
  Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
} else {
  "port ${Port}: nothing listening"
}

Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
$waited = 0
while ((Get-ScheduledTask -TaskName $Task).State -eq 'Running' -and $waited -lt 30) {
  Start-Sleep -Seconds 1; $waited++
}
"task $Task state before start: $((Get-ScheduledTask -TaskName $Task).State) (waited ${waited}s)"

Start-ScheduledTask -TaskName $Task
Start-Sleep -Seconds 2
$state = (Get-ScheduledTask -TaskName $Task).State
if ($state -eq 'Running') {
  "started task $Task at $(Get-Date -Format HH:mm:ss) -- state Running"
} else {
  "WARNING: $Task did not start (state $state). Run Start-ScheduledTask again."
  exit 2
}
