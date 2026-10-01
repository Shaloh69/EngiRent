# Runs ON THE SERVER (desktop-gklhcri). Switches EngiRentMl to item-verification v2,
# or back to v1 with -Rollback. Invoked by deploy_v2.sh from the dev PC; can also be
# run by hand:  powershell -ExecutionPolicy Bypass -File D:\ENG\server_switch_v2.ps1 [-Rollback]
#
#   v2:       backs up app\ and svc-ml.bat (once), extracts app_v2.tar over app\,
#             points svc-ml.bat at venv-v2 with ML_PIPELINE_VERSION=v2, restarts.
#   rollback: restores both backups and restarts.
# Never prints svc-ml.bat in full: it holds the ML API key.
param([switch]$Rollback)
$ErrorActionPreference = 'Stop'
$ml    = 'D:\ENG\EngiRent\server\python_server\services\ml'
$bat   = 'D:\ENG\svc-ml.bat'
$stamp = 'pre-v2'
$appBak = "$ml\app.bak-$stamp"
$batBak = "$bat.bak-$stamp"

function Restart-Ml {
  $conn = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    # Walk up to the svc-ml.bat cmd and kill only that tree. Two other projects on
    # this box run python/node too: never kill by process name.
    $p = $conn.OwningProcess; $root = $null
    for ($i = 0; $i -lt 8 -and $p; $i++) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
      if ($proc.CommandLine -match 'svc-ml\.bat') { $root = $p; break }
      $p = $proc.ParentProcessId
    }
    if (-not $root) { throw "port 8001 is owned by PID $($conn.OwningProcess), which is not under svc-ml.bat: stopping, nothing restarted" }
    "stopping ML tree from cmd PID $root (old :8001 PID $($conn.OwningProcess))"
    taskkill /PID $root /T /F | Out-Null
    Start-Sleep -Seconds 2
  }
  Start-ScheduledTask -TaskName EngiRentMl
  "EngiRentMl started; waiting for :8001 (v2 loads its models in a background thread)"
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 5
    $c = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) {
      "ML listening, PID $($c.OwningProcess) after $(($i + 1) * 5)s"
      # Listening is not ready: v2 loads its models in a background thread and
      # /health says when that is done (item_models_ready). v1 reports null.
      for ($j = 0; $j -lt 60; $j++) {
        try {
          $h = Invoke-RestMethod http://127.0.0.1:8001/api/v1/health -TimeoutSec 20
          if ($h.item_models_ready -ne $false) {
            "health: pipeline=$($h.item_pipeline) models_ready=$($h.item_models_ready) face=$($h.face_recognition_enabled)"
            return
          }
        } catch { }
        Start-Sleep -Seconds 5
      }
      throw "ML is listening but its v2 models did not finish loading within 5 minutes: check D:\ENG\startbat-logs"
    }
  }
  throw "ML did not bind :8001 within 5 minutes: check D:\ENG\startbat-logs"
}

if ($Rollback) {
  if (-not (Test-Path $appBak) -or -not (Test-Path $batBak)) { throw "no backups found ($appBak, $batBak): nothing to roll back to" }
  Remove-Item "$ml\app" -Recurse -Force
  Copy-Item $appBak "$ml\app" -Recurse
  Copy-Item $batBak $bat -Force
  "restored app\ and svc-ml.bat from the pre-v2 backups"
  Restart-Ml
  exit 0
}

if (-not (Test-Path "$ml\venv-v2\Scripts\python.exe")) { throw "venv-v2 missing: build it first (see PROGRESS.md ML run log)" }
if (-not (Test-Path "$ml\app_v2.tar")) { throw "app_v2.tar not uploaded to $ml" }
if (-not (Test-Path $appBak)) { Copy-Item "$ml\app" $appBak -Recurse; "backed up app\ -> $appBak" }
if (-not (Test-Path $batBak)) { Copy-Item $bat $batBak; "backed up svc-ml.bat -> $batBak" }

Push-Location $ml
tar -xf "$ml\app_v2.tar"
Pop-Location
"v2 files: " + (Get-ChildItem "$ml\app\v2" -File).Count

$c = [IO.File]::ReadAllText($bat)
if ($c -notmatch 'venv-v2') {
  $old = '.\venv\Scripts\python.exe -m uvicorn'
  if (-not $c.Contains($old)) { throw "svc-ml.bat does not contain '$old': edit it by hand" }
  $c = $c.Replace($old, "set ML_PIPELINE_VERSION=v2`r`n.\venv-v2\Scripts\python.exe -m uvicorn")
  [IO.File]::WriteAllText($bat, $c, (New-Object Text.UTF8Encoding($false)))
}
"svc-ml.bat: " + ((Select-String -Path $bat -Pattern 'venv|PIPELINE' | ForEach-Object { $_.Line.Trim() }) -join ' || ')
Restart-Ml
