#!/bin/sh
set -eu

mkdir -p /data

cd /app/server
npx prisma generate
npx prisma migrate deploy

HERO_COUNT="$(node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); p.hero.count().then(c=>{console.log(c); return p.\$disconnect();}).catch(e=>{console.error(e); process.exit(1);})")"
if [ "$HERO_COUNT" = "0" ]; then
  echo "Empty DB — seeding from server/data snapshots..."
  cd /app
  npm run seed --workspace server
fi

exec node /app/server/dist/main.js
