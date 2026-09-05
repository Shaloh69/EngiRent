# Runs the full e2e set ON the server (desktop-gklhcri), which is the only
# place it can run end to end:
#
#   * Nine of the suites import @prisma/client and talk to MySQL directly for
#     setup and cleanup. DATABASE_URL points at localhost:3307 on this machine,
#     so those suites cannot run from a developer laptop at all.
#   * The full set is several hundred requests against a 100-per-15-minutes
#     rate limit. RATE_LIMIT_BYPASS_SECRET is read from this machine's own .env
#     and never leaves it - which is also why this is a script here rather than
#     an env var typed somewhere else.
#   * localhost:5000 skips the Cloudflare tunnel entirely, so a rotated
#     hostname cannot make a green suite look red.
#
# Usage, from an SSH session or Task Scheduler:
#   powershell -NoProfile -ExecutionPolicy Bypass -File <this file>
#   powershell ... -File <this file> -SuiteArgs "--safe"   # no rows created
#
# ASCII only, deliberately: Windows PowerShell 5.1 reads a BOM-less UTF-8
# script as ANSI, and a stray multi-byte character breaks the parser several
# lines away from where it actually is.
#
# Deploy note: this repo is the source of truth; the server's tree is a
# diverged checkout, so copy the scripts over rather than pulling.

# NOT named $Args: that is a PowerShell automatic variable and a param of
# that name is silently ignored, so every run became a full run.
param([string[]]$SuiteArgs = @())

$ErrorActionPreference = 'Stop'

$root    = 'D:\ENG\EngiRent\server\node_server'
$envPath = Join-Path $root '.env'

if (-not (Test-Path $envPath)) {
  Write-Error "No .env at $envPath - is this the server?"
}

# Only the two secrets the suites need. Values go into the process environment
# and are never written to output.
Get-Content $envPath | ForEach-Object {
  if ($_ -match '^(KIOSK_SHARED_SECRET|RATE_LIMIT_BYPASS_SECRET)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim(), 'Process')
  }
}

if (-not $env:RATE_LIMIT_BYPASS_SECRET) {
  Write-Warning "RATE_LIMIT_BYPASS_SECRET is not in .env - the later suites will hit 429s."
}
if (-not $env:KIOSK_SHARED_SECRET) {
  Write-Warning "KIOSK_SHARED_SECRET is not in .env - e2e-kiosk-trust's positive control will be SKIPPED."
}

$env:API_BASE_URL = 'http://localhost:5000/api/v1'
if (-not $env:ADMIN_EMAIL)    { $env:ADMIN_EMAIL    = 'admin@engirent.edu.ph' }
if (-not $env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD = 'EngiRent@2025!' }

Set-Location $root
node scripts\e2e-all.mjs @SuiteArgs
exit $LASTEXITCODE
