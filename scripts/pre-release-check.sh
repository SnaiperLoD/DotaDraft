#!/usr/bin/env bash
# Fast local gate before sharing a link. Full e2e needs Playwright + pool.
set -euo pipefail
npm run build --workspace shared
npm test --workspace client
# Match CI: optional pool regression tests only when Postgres is actually up.
POOL_DATABASE_URL='' npm test --workspace server -- --ci --testPathIgnorePatterns=integration
echo "pre-release:check OK (run npm run test:e2e with POOL_DATABASE_URL for full smoke)"
