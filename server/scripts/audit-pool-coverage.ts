import { PrismaService } from '../src/prisma/prisma.service';
import { HeroService, ensureRoleCoverage } from '../src/hero/hero.service';
import { seededShuffle } from '../src/common/random';
import type { Hero } from 'shared';

// Backlog item 8 (Blueprint/10-tech-debt-backlog.md, "Draft hero distribution"):
// the user reported it "feels like" the guarantee of a draftable core/support
// spread across the offered pools isn't working. This is that repeatable check.
//
// It drives the REAL HeroService.randomPool against the live SQLite DB — the
// same code path (randomPool -> ensureRoleCoverage -> seededShuffle, on the
// same presumed_positions the server serves), not a re-implementation — and
// replays the exact per-round seed/exclusion chain draft.service.ts uses:
//   round 1 pool  = randomPool([],            5, seed)
//   round r pool  = randomPool(picked ∪ prevPool, 5, seed + (r-1))
// so a hero offered one round can't reappear the next (consecutive-round
// exclusion), matching create()/pick().
//
// Reports three things:
//   1. The binary guarantee ensureRoleCoverage() exists to provide — every
//      offered pool has >=1 Support and >=1 core. A single violation is a bug.
//   2. Support-count-per-pool distribution — the "does it FEEL support-starved"
//      angle (the guarantee only promises >=1, not a balanced split).
//   3. Granular primary-position coverage the guarantee does NOT cover:
//      whether a full draft can even source one of each Carry/Mid/Offlane.
//
// Read-only: no writes, safe to run against the real DB. Run with
//   npm run audit-pool-coverage [numDrafts]

const POOL_SIZE = 5;
const ROUNDS = 5;
const DEFAULT_DRAFTS = 50000;

// Same Support test ensureRoleCoverage uses, lifted so we can also bucket by
// the finer primary position (highest-share) the guarantee ignores.
function isSupport(h: Hero): boolean {
  return h.presumed_positions.length > 0
    ? h.presumed_positions.some((p) => p.position === 'Support')
    : h.roles.includes('Support');
}

function primaryPosition(h: Hero): string | null {
  if (h.presumed_positions.length === 0) return null;
  return [...h.presumed_positions].sort((a, b) => b.share - a.share)[0].position;
}

// Deterministic per-draft base seed so a flagged draft can be reproduced.
function draftSeed(n: number): number {
  return ((12345 + n * 2654435761) >>> 0) & 0x7fffffff;
}

async function main() {
  const numDrafts = parseInt(process.argv[2] || String(DEFAULT_DRAFTS), 10);
  const prisma = new PrismaService();
  await prisma.$connect();
  const heroService = new HeroService(prisma);

  // Fetch the served hero set ONCE, then exercise the real ensureRoleCoverage
  // + seededShuffle (the functions actually under audit) directly. This mirrors
  // HeroService.randomPool exactly — which is only `findAll -> filter exclude ->
  // seededShuffle -> slice -> ensureRoleCoverage` — without re-querying the DB
  // 250k times (findAll is a per-call query in prod, negligible there but the
  // whole cost here).
  const all = await heroService.findAll();
  const byId = new Map(all.map((h) => [h.id, h]));
  const localRandomPool = (excludeIds: number[], size: number, seed: number): Hero[] => {
    const ex = new Set(excludeIds);
    const available = all.filter((h) => !ex.has(h.id));
    const shuffled = seededShuffle(available, seed);
    return ensureRoleCoverage(shuffled.slice(0, size), shuffled.slice(size));
  };
  const supportPool = all.filter(isSupport).length;
  const corePool = all.length - supportPool;
  const emptyPositions = all.filter((h) => h.presumed_positions.length === 0);

  console.log('=== POOL COVERAGE AUDIT (backlog item 8) ===');
  console.log(`Hero pool: ${all.length} heroes | Support-eligible: ${supportPool} | core-only: ${corePool}`);
  if (emptyPositions.length > 0) {
    console.log(
      `WARNING: ${emptyPositions.length} heroes have EMPTY presumed_positions and fall back to the roles tag ` +
        `(reseed with npm run seed if hero-meta.json has since gained positions): ` +
        emptyPositions.map((h) => h.name).join(', '),
    );
  }
  console.log(`Simulating ${numDrafts} full 5-round drafts...\n`);

  let poolsExamined = 0;
  let guaranteeViolations = 0;
  const supHist = Array(POOL_SIZE + 1).fill(0); // supports per pool, 0..5
  const distinctPrimHist: Record<number, number> = {};

  // Union-of-all-offered coverage per draft (can the player even SOURCE a
  // standard 1 Carry / 1 Mid / 1 Offlane / 2 Support team from everything shown?)
  let noCarry = 0;
  let noMid = 0;
  let noOfflane = 0;
  let cannotSourceStandard = 0;
  const sampleFailSeeds: number[] = [];

  for (let n = 0; n < numDrafts; n++) {
    const seed = draftSeed(n);
    const picked: number[] = [];
    let prevPool: number[] = [];
    const everOffered = new Set<number>();

    for (let round = 0; round < ROUNDS; round++) {
      const exclude = round === 0 ? [] : [...new Set([...picked, ...prevPool])];
      const pool = localRandomPool(exclude, POOL_SIZE, (seed + round) >>> 0);
      poolsExamined++;

      const supCount = pool.filter(isSupport).length;
      const coreCount = pool.length - supCount;
      if (supCount < 1 || coreCount < 1) guaranteeViolations++;
      supHist[supCount]++;

      const distinct = new Set(pool.map((h) => primaryPosition(h))).size;
      distinctPrimHist[distinct] = (distinctPrimHist[distinct] || 0) + 1;

      for (const h of pool) everOffered.add(h.id);

      // Deterministic pick so downstream exclusion is reproducible; pool[0] is
      // an arbitrary-but-fixed policy (the pool composition, not the pick, is
      // what this audit measures).
      picked.push(pool[0].id);
      prevPool = pool.map((h) => h.id);
    }

    const offeredPrims = [...everOffered].map((id) => primaryPosition(byId.get(id)!));
    const hasCarry = offeredPrims.includes('Carry');
    const hasMid = offeredPrims.includes('Mid');
    const hasOff = offeredPrims.includes('Offlane');
    const supOffered = offeredPrims.filter((p) => p === 'Support').length;
    if (!hasCarry) noCarry++;
    if (!hasMid) noMid++;
    if (!hasOff) noOfflane++;
    if (!(hasCarry && hasMid && hasOff && supOffered >= 2)) {
      cannotSourceStandard++;
      if (sampleFailSeeds.length < 10) sampleFailSeeds.push(seed);
    }
  }

  const pct = (n: number, d: number) => ((n / d) * 100).toFixed(2) + '%';

  console.log('--- 1. Binary guarantee (>=1 Support AND >=1 core per pool) ---');
  console.log(`Pools examined: ${poolsExamined}`);
  console.log(
    `Guarantee violations: ${guaranteeViolations} (${pct(guaranteeViolations, poolsExamined)})` +
      (guaranteeViolations === 0 ? '  ✓ guarantee holds' : '  ✗ BUG'),
  );

  console.log('\n--- 2. Support count per pool (guarantee promises >=1, not a balanced split) ---');
  const meanSup = supHist.reduce((s, c, i) => s + c * i, 0) / poolsExamined;
  for (let i = 0; i <= POOL_SIZE; i++) {
    console.log(`  ${i} support(s): ${String(supHist[i]).padStart(8)}  (${pct(supHist[i], poolsExamined)})`);
  }
  console.log(`  mean: ${meanSup.toFixed(2)} supports/pool (base rate ${((supportPool / all.length) * POOL_SIZE).toFixed(2)})`);

  console.log('\n--- 3. Distinct primary positions per single pool (NOT covered by the guarantee) ---');
  for (const k of Object.keys(distinctPrimHist).map(Number).sort((a, b) => a - b)) {
    console.log(`  ${k} distinct: ${String(distinctPrimHist[k]).padStart(8)}  (${pct(distinctPrimHist[k], poolsExamined)})`);
  }

  console.log('\n--- 4. Full-draft positional sourcing (union of all 5 offered pools) ---');
  console.log(`  drafts never offering ANY Carry:   ${noCarry} (${pct(noCarry, numDrafts)})`);
  console.log(`  drafts never offering ANY Mid:     ${noMid} (${pct(noMid, numDrafts)})`);
  console.log(`  drafts never offering ANY Offlane: ${noOfflane} (${pct(noOfflane, numDrafts)})`);
  console.log(
    `  drafts unable to source 1 Carry + 1 Mid + 1 Offlane + 2 Support: ${cannotSourceStandard} (${pct(cannotSourceStandard, numDrafts)})`,
  );
  if (sampleFailSeeds.length) console.log(`  sample failing seeds: ${sampleFailSeeds.join(', ')}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
