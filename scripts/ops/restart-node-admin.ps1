# restart-node-admin.ps1 — runs ON the server PC. Called by server-repoint-tunnels.sh.
#
# Makes Node and the admin console pick up re-pointed URLs. Two runbook gotchas
# are handled here rather than remembered:
#   * Stop-ScheduledTask does NOT kill the process — the real owner of the port
#     is killed first, or the old config keeps being served.
#   * Admin bakes NEXT_PUBLIC_* at BUILD time; its task runs `npm run build`
#     on every start, so a restart is a rebuild (~3-4 min).

$ErrorActionPreference = 'Continue'

#
# THIRD gotcha, found 2026-09-13 when admin did not come back: killing the port
# owner does not end the task instance at once -- cmd/npm are still unwinding.
# Start-ScheduledTask on a task that is still Running is SILENTLY IGNORED
# (default "do not start a new instance"). Node won that race by luck; admin
# lost it and stayed down with LastTaskResult 4294967295. So: stop the task,
# wait until it is really not Running, and only then start it -- and verify
# the start took.

foreach ($pair in @(@{Port=5000; Task='EngiRentNode'}, @{Port=3001; Task='EngiRentAdmin'})) {
  $c = Get-NetTCPConnection -LocalPort $pair.Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    "port $($pair.Port): stopping owner PID $($c.OwningProcess)"
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  } else {
    "port $($pair.Port): nothing listening"
  }
  Stop-ScheduledTask -TaskName $pair.Task -ErrorAction SilentlyContinue
  $waited = 0
  while ((Get-ScheduledTask -TaskName $pair.Task).State -eq 'Running' -and $waited -lt 30) {
    Start-Sleep -Seconds 1; $waited++
  }
  "task $($pair.Task) state before start: $((Get-ScheduledTask -TaskName $pair.Task).State) (waited ${waited}s)"
  Start-ScheduledTask -TaskName $pair.Task
  Start-Sleep -Seconds 2
  $state = (Get-ScheduledTask -TaskName $pair.Task).State
  if ($state -eq 'Running') {
    "started task $($pair.Task) at $(Get-Date -Format HH:mm:ss) -- state Running"
  } else {
    "WARNING: $($pair.Task) did not start (state $state). Run Start-ScheduledTask again."
  }
}
'Node needs ~1-4 min (build + start); admin ~3-4 min (full next build). Prove it by the PID on the port changing.'
