#!/usr/bin/env node
// Generates both Prisma clients. Pool generate requires a URL even though it
// does not connect — empty POOL_DATABASE_URL (the local-dev default) would
// otherwise fail generate. Dummy URL is only for client generation.
const { execSync } = require('child_process');
const path = require('path');

const cwd = path.join(__dirname, '..');
const env = {
  ...process.env,
  POOL_DATABASE_URL:
    process.env.POOL_DATABASE_URL && process.env.POOL_DATABASE_URL.trim()
      ? process.env.POOL_DATABASE_URL
      : 'postgresql://dota:dota@127.0.0.1:5432/opponent_pool',
};

execSync('npx prisma generate --schema prisma/schema.prisma', { cwd, env, stdio: 'inherit' });
execSync('npx prisma generate --schema prisma-pool/schema.prisma', { cwd, env, stdio: 'inherit' });
