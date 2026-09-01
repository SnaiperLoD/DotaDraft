$ErrorActionPreference = 'Stop'
npm run build --workspace shared
npm test --workspace client
npm test --workspace server -- --ci --testPathIgnorePatterns=integration
Write-Host 'pre-release:check OK (run npm run test:e2e with POOL_DATABASE_URL for full smoke)'
