#!/bin/sh
set -eu

mkdir -p /data

cd /app/server
npx prisma migrate deploy

HERO_COUNT="$(node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); p.hero.count().then(c=>{console.log(c); return p.\$disconnect();}).catch(e=>{console.error(e); process.exit(1);})")"
if [ "$HERO_COUNT" = "0" ]; then
  echo "Empty DB — seeding from server/data snapshots..."
  node /app/server/dist/seed.js
fi

if [ -n "${POOL_DATABASE_URL:-}" ]; then
  echo "Migrating opponent pool..."
  npx prisma migrate deploy --schema=prisma-pool/schema.prisma
  POOL_COUNT="$(node -e "const {PrismaClient}=require('./generated/pool-client'); const p=new PrismaClient(); p.pooledDraft.count().then(c=>{console.log(c); return p.\$disconnect();}).catch(e=>{console.error(e); process.exit(1);})")"
  if [ "$POOL_COUNT" = "0" ]; then
    echo "Empty opponent pool — seeding pro drafts from the local snapshot..."
    npx ts-node --transpile-only scripts/seed-opponent-pool.ts
  else
    echo "Opponent pool already has rows — upserting legacy host-archive player drafts..."
    npx ts-node --transpile-only scripts/backfill-legacy-player-pool.ts
  fi
fi

exec env NODE_ENV=production node /app/server/dist/main.js
