// Samples random 5v5 battles against the local hero-meta snapshot
// (no OpenDota refetch) and scores how often Battle story claims something
// the engines did not compute. Repeatable: `npx ts-node scripts/audit-battle-story.ts [n]`.
import * as fs from 'fs';
import * as path from 'path';
import type { Hero, DraftRole, BattleLaneResult } from 'shared';
import { ROLES } from 'shared';
import { HeroMetaService } from '../src/hero-meta/hero-meta.service';
import { resolveBattle, bestMatchupEdge, type BattlePick } from '../src/battle/battle-resolution';
import { buildBattleStory } from '../src/battle/battle-story';
import { buildLaneResults } from '../src/battle/battle-lanes';

const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const SAMPLE = Number(process.argv[2] ?? 10000);
const ROLES_LIST = [...ROLES] as DraftRole[];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function asHero(raw: Hero): Hero {
  return {
    ...raw,
    presumed_positions: raw.presumed_positions ?? [],
    evaluation_values_by_role: raw.evaluation_values_by_role ?? {
      Carry: { no_info: true },
      Mid: { no_info: true },
      Offlane: { no_info: true },
      Support: { no_info: true },
    },
  };
}

function picks(heroes: Hero[]): BattlePick[] {
  return heroes.map((hero, i) => ({ hero, assignedRole: ROLES_LIST[i] }));
}

function byRole(picks: BattlePick[]): Map<string, Hero> {
  const map = new Map<string, Hero>();
  for (const pick of picks) {
    if (pick.assignedRole) map.set(pick.assignedRole, pick.hero);
  }
  return map;
}

function buildLanes(mine: BattlePick[], opponent: BattlePick[], lookup: HeroMetaService): BattleLaneResult[] {
  return buildLaneResults(byRole(mine), byRole(opponent), lookup);
}

function main() {
  const heroes = (JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8')) as Hero[]).map(asHero);
  const lookup = new HeroMetaService();
  const rand = mulberry32(20260816);

  const counts = {
    n: 0,
    evenLanesSoldAsAhead: 0,
    matchupFallbackInvented: 0,
    matchupUsedAtOrBelow50: 0,
    finishIsCinematicKey: 0,
    openingEvenKey: 0,
    turningUsesAxisNotCatch: 0,
    finishHeldComebackUpset: 0,
    legacyEvenSoldAsAhead: 0,
    legacyMatchupInvented: 0,
    legacyFinishCinematic: 0,
  };

  for (let i = 0; i < SAMPLE; i++) {
    const pool = shuffle(heroes, rand);
    const mineHeroes = pool.slice(0, 5);
    const opponentHeroes = pool.slice(5, 10);
    const mine = picks(mineHeroes);
    const opponent = picks(opponentHeroes);
    const result = resolveBattle(mine, opponent, lookup, rand);
    const lanes = buildLanes(mine, opponent, lookup);
    const story = buildBattleStory({
      resolvedOutcome: result.resolvedOutcome,
      advantageDirection: result.advantageDirection,
      lanes,
      mine,
      opponent,
      lookup,
      highSkillSwingHeroName: result.highSkillSwingHeroName,
      topAxis: result.topAxis,
    });

    counts.n += 1;
    const winnerLane = result.resolvedOutcome === 'Win' ? 'mine' : 'opponent';
    const loserLane = winnerLane === 'mine' ? 'opponent' : 'mine';
    const winnerWins = lanes.filter((l) => l.winner === winnerLane).length;
    const loserWins = lanes.filter((l) => l.winner === loserLane).length;
    const opening = story.beats[0].key;
    const turning = story.beats[1].key;
    const finish = story.beats[3].key;
    const even = winnerWins === loserWins;
    const cameFromBehind = winnerWins < loserWins;
    const isUpset =
      (result.advantageDirection === 'A' && result.resolvedOutcome === 'Lose') ||
      (result.advantageDirection === 'B' && result.resolvedOutcome === 'Win');

    if (even && opening === 'openingAhead') counts.evenLanesSoldAsAhead += 1;
    if (even && opening === 'openingEven') counts.openingEvenKey += 1;
    // Legacy generator always used openingAhead for even lanes.
    if (even && !isUpset && !cameFromBehind) counts.legacyEvenSoldAsAhead += 1;

    const winners = result.resolvedOutcome === 'Win' ? mine : opponent;
    const losers = result.resolvedOutcome === 'Win' ? opponent : mine;
    const matchup = bestMatchupEdge(
      winners.map((p) => p.hero),
      losers.map((p) => p.hero),
      lookup,
    );
    const namedWinner = story.beats[1].params.matchupWinner;
    if (!matchup && namedWinner) counts.matchupFallbackInvented += 1;
    if (matchup && matchup.winRate <= 0.5 && namedWinner === matchup.hero) {
      counts.matchupUsedAtOrBelow50 += 1;
    }
    if (!matchup || matchup.winRate <= 0.5) counts.legacyMatchupInvented += 1;

    if ((finish as string) === 'finishText') counts.finishIsCinematicKey += 1;
    counts.legacyFinishCinematic += 1;
    if (turning === 'turningAxis') counts.turningUsesAxisNotCatch += 1;
    if (finish === 'finishHeld' || finish === 'finishComeback' || finish === 'finishUpset') {
      counts.finishHeldComebackUpset += 1;
    }
  }

  const pct = (k: keyof typeof counts) => ((counts[k] / counts.n) * 100).toFixed(1);
  console.log(JSON.stringify({ sample: counts.n, counts, pct: {
    evenLanesSoldAsAhead: pct('evenLanesSoldAsAhead'),
    matchupFallbackInvented: pct('matchupFallbackInvented'),
    matchupUsedAtOrBelow50: pct('matchupUsedAtOrBelow50'),
    finishIsCinematicKey: pct('finishIsCinematicKey'),
    openingEvenKey: pct('openingEvenKey'),
    turningUsesAxisNotCatch: pct('turningUsesAxisNotCatch'),
    finishHeldComebackUpset: pct('finishHeldComebackUpset'),
    legacyEvenSoldAsAhead: pct('legacyEvenSoldAsAhead'),
    legacyMatchupInvented: pct('legacyMatchupInvented'),
    legacyFinishCinematic: pct('legacyFinishCinematic'),
  } }, null, 2));
}

main();
