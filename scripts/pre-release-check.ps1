$ErrorActionPreference = 'Stop'

function Invoke-Step([string]$Label, [scriptblock]$Block) {
  & $Block
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

Invoke-Step 'shared build' { npm run build --workspace shared }
Invoke-Step 'client unit tests' { npm test --workspace client }
# Match CI: optional pool regression tests only when Postgres is actually up.
$env:POOL_DATABASE_URL = ''
Invoke-Step 'server unit tests' {
  npm test --workspace server -- --ci --testPathIgnorePatterns=integration
}
Write-Host 'pre-release:check OK (run npm run test:e2e with POOL_DATABASE_URL for full smoke)'
