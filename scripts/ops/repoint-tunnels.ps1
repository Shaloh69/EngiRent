# repoint-tunnels.ps1 — runs ON the server PC. Called by server-repoint-tunnels.sh.
#
# Cloudflare quick tunnels rotate hostname on every restart. This reads THIS
# run's hostnames from D:\ENG\startbat-logs\tunnel-*.log and writes them into
# the only four keys that need them. Backs up both files first. Prints URL keys
# only — never another line of either .env file.
#
# CLIENT_MOBILE_URL is deliberately NOT touched: it belongs to the Flutter web
# build (port 8092), which is not one of the seven scheduled tasks and has no
# tunnel of its own.

$ErrorActionPreference = 'Stop'

function Tunnel($name) {
  $m = Select-String -Path "D:\ENG\startbat-logs\tunnel-$name.log" -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -Last 1
  if (-not $m) { throw "no hostname in tunnel-$name.log" }
  $m.Matches[0].Value
}
$api = Tunnel 'api'; $web = Tunnel 'web'; $admin = Tunnel 'admin'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Repoint($path, $pairs) {
  Copy-Item $path "$path.bak-$stamp-repoint"
  $t = [IO.File]::ReadAllText($path)
  foreach ($k in $pairs.Keys) {
    $rx = '(?m)^' + [regex]::Escape($k) + '=.*?(\r?)$'
    if (-not [regex]::IsMatch($t, $rx)) { throw "$k not found in $path" }
    $v = $pairs[$k]
    $t = [regex]::Replace($t, $rx, { param($mm) $k + '=' + $v + $mm.Groups[1].Value })
  }
  [IO.File]::WriteAllText($path, $t, $utf8)
  "backup: $path.bak-$stamp-repoint"
}

Repoint 'D:\ENG\EngiRent\server\node_server\.env' ([ordered]@{ API_PUBLIC_URL = $api; CLIENT_WEB_URL = $web; CLIENT_ADMIN_URL = $admin })
Repoint 'D:\ENG\EngiRent\client\admin\.env.local' ([ordered]@{ NEXT_PUBLIC_API_URL = "$api/api/v1" })

'--- after ---'
Select-String -Path 'D:\ENG\EngiRent\server\node_server\.env' -Pattern '^(API_PUBLIC_URL|CLIENT_WEB_URL|CLIENT_ADMIN_URL|CLIENT_MOBILE_URL)=' | ForEach-Object { $_.Line }
Select-String -Path 'D:\ENG\EngiRent\client\admin\.env.local' -Pattern '^NEXT_PUBLIC_API_URL=' | ForEach-Object { $_.Line }
