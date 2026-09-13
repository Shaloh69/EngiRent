# restart-node-admin.ps1 — runs ON the server PC. Called by server-repoint-tunnels.sh.
#
# Makes Node and the admin console pick up re-pointed URLs. Two runbook gotchas
# are handled here rather than remembered:
#   * Stop-ScheduledTask does NOT kill the process — the real owner of the port
#     is killed first, or the old config keeps being served.
#   * Admin bakes NEXT_PUBLIC_* at BUILD time; its task runs `npm run build`
#     on every start, so a restart is a rebuild (~3-4 min).

$ErrorActionPreference = 'Continue'

foreach ($pair in @(@{Port=5000; Task='EngiRentNode'}, @{Port=3001; Task='EngiRentAdmin'})) {
  $c = Get-NetTCPConnection -LocalPort $pair.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    "port $($pair.Port): stopping owner PID $($c.OwningProcess)"
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  } else {
    "port $($pair.Port): nothing listening"
  }
  Start-ScheduledTask -TaskName $pair.Task
  "started task $($pair.Task) at $(Get-Date -Format HH:mm:ss)"
}
'Node needs ~1-4 min (build + start); admin ~3-4 min (full next build). Prove it by the PID on the port changing.'
