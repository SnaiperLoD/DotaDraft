#!/usr/bin/env bash
# Off-box backup for docker compose volumes. Writes into ./backups/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p backups
STAMP="$(date +%F-%H%M)"
docker compose cp api:/data/prod.db "./backups/prod-${STAMP}.db"
docker compose exec -T pool pg_dump -U dota opponent_pool > "./backups/pool-${STAMP}.sql"
echo "Wrote backups/prod-${STAMP}.db and backups/pool-${STAMP}.sql"
