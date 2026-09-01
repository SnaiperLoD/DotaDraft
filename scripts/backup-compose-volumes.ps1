# Off-box backup for docker compose volumes. Writes into ./backups/
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
New-Item -ItemType Directory -Force -Path backups | Out-Null
$Stamp = Get-Date -Format 'yyyy-MM-dd-HHmm'
docker compose cp "api:/data/prod.db" "./backups/prod-$Stamp.db"
docker compose exec -T pool pg_dump -U dota opponent_pool | Set-Content -Encoding utf8 "./backups/pool-$Stamp.sql"
Write-Host "Wrote backups/prod-$Stamp.db and backups/pool-$Stamp.sql"
