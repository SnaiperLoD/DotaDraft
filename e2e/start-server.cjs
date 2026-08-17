const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const serverDir = path.join(repoRoot, 'server');
const dbPath = path.join(os.tmpdir(), `dotadraft-e2e-${process.env.PORT || '3012'}.db`);
const databaseUrl = `file:${dbPath.replace(/\\/g, '/')}`;

process.env.DATABASE_URL = databaseUrl;
process.env.PORT = process.env.PORT || '3012';
const poolUrl = (process.env.POOL_DATABASE_URL || '').trim();
process.env.POOL_DATABASE_URL = poolUrl;

for (const suffix of ['', '-journal']) {
  const file = dbPath + suffix;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

execSync('npx prisma db push --skip-generate --schema=prisma/schema.prisma', {
  cwd: serverDir,
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'inherit',
});

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

async function seedAndStart() {
  const raw = JSON.parse(fs.readFileSync(path.join(serverDir, 'data', 'heroes.json'), 'utf8'));
  for (const hero of raw) {
    await prisma.hero.create({
      data: {
        id: hero.id,
        name: hero.name,
        primaryAttribute: hero.primary_attribute,
        attackType: hero.attack_type,
        roles: JSON.stringify(hero.roles),
        tags: JSON.stringify(hero.tags),
        synergyTags: JSON.stringify(hero.synergy_tags),
        counterTags: JSON.stringify(hero.counter_tags),
        evaluationValues: JSON.stringify(hero.evaluation_values),
        evaluationValuesByRole: JSON.stringify(hero.evaluation_values_by_role ?? {}),
        presumedPositions: '[]',
      },
    });
  }
  const count = await prisma.hero.count();
  if (count < 100) {
    throw new Error(`e2e seed produced ${count} heroes, expected the full roster`);
  }

  if (poolUrl) {
    const proPath = path.join(serverDir, 'data', 'pro-matches.json');
    const { matches } = JSON.parse(fs.readFileSync(proPath, 'utf8'));
    // Enough for overlap-filtered pulls without loading the full 764-match snapshot.
    const sample = matches.slice(0, 40);
    for (const match of sample) {
      await prisma.proMatch.create({
        data: {
          id: match.matchId,
          radiantName: match.radiantName,
          direName: match.direName,
          leagueName: match.leagueName,
          radiantWin: match.radiantWin,
          radiantHeroIds: JSON.stringify(match.radiantHeroIds),
          direHeroIds: JSON.stringify(match.direHeroIds),
          radiantHeroRoles: match.radiantHeroRoles ? JSON.stringify(match.radiantHeroRoles) : null,
          direHeroRoles: match.direHeroRoles ? JSON.stringify(match.direHeroRoles) : null,
          startTime: new Date(match.startTime),
        },
      });
    }
  }
  await prisma.$disconnect();

  if (poolUrl) {
    execSync('npx prisma generate --schema=prisma-pool/schema.prisma', {
      cwd: serverDir,
      env: { ...process.env, POOL_DATABASE_URL: poolUrl },
      stdio: 'inherit',
    });
    execSync('npx prisma migrate deploy --schema=prisma-pool/schema.prisma', {
      cwd: serverDir,
      env: { ...process.env, POOL_DATABASE_URL: poolUrl },
      stdio: 'inherit',
    });
    execSync('npx ts-node --transpile-only scripts/seed-opponent-pool.ts', {
      cwd: serverDir,
      env: { ...process.env, POOL_DATABASE_URL: poolUrl, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });
  }

  process.chdir(serverDir);
  require('ts-node/register/transpile-only');
  require(path.join(serverDir, 'src', 'main.ts'));
}

seedAndStart().catch((err) => {
  console.error(err);
  process.exit(1);
});
