// Samples random 5v5 battles against the local hero-meta snapshot
// (no OpenDota refetch) and scores how often Battle story claims something
// the engines did not compute. Repeatable: `npx ts-node scripts/audit-battle-story.ts [n]`.
import * as fs from 'fs';
import * as path from 'path';
import type { Hero, DraftRole, BattleLaneResult } from 'shared';
import { ROLES } from 'shared';
import { HeroMetaService } from '../src/hero-meta/hero-meta.service';
import { assessBattle, resolveBattle, bestMatchupEdge, type BattlePick } from '../src/battle/battle-resolution';
import { buildBattleStory } from '../src/battle/battle-story';
import { buildLaneResults } from '../src/battle/battle-lanes';
import { defaultLaneOutcomes, NO_LANE_OUTCOMES } from '../src/battle/lane-outcomes';
import { HUNT_FLOOR, LANE_HUNT_FLOOR } from '../src/battle/battle-cast';

const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const RU_LOCALE_PATH = path.join(__dirname, '..', '..', 'client', 'src', 'locales', 'ru.json');
// Lanes are a detail of the picture, not the cause (Blueprint/15-dev-plan-2026-10.md, T1.3).
const CAUSAL_COPY = /Ломается|садится на|Перелом/;
// Same spread the Explanation and lane cards call "even" (T1.2).
const NEAR_EVEN_SPREAD = 0.035 + 1e-9;
const SAMPLE = Number(process.argv[2] ?? 10000);
// AUDIT_LANE_SOURCE=proxy re-runs the audit on the pre-2026-10-02 lane source
// (game-matchup proxy only) for a before/after comparison.
const LANE_OUTCOMES = process.env.AUDIT_LANE_SOURCE === 'proxy' ? NO_LANE_OUTCOMES : defaultLaneOutcomes();
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
  return buildLaneResults(byRole(mine), byRole(opponent), lookup, LANE_OUTCOMES);
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
    turningAxisNotWinnersAxis: 0,
    nearEvenLaneGivenAWinner: 0,
    storyTallyVsExplanationEven: 0,
    causalLaneCopy: 0,
  };
  // Lane-level shape (per lane, 3 per battle): how many cards are even, where
  // the numbers come from, and how often the named pair clears HUNT_FLOOR.
  const laneStats = { lanes: 0, even: 0, fromLane: 0, fromMatchup: 0, noData: 0, decided: 0, topPairHunt: 0 };
  const absEdges: number[] = [];
  const topPairRates: number[] = [];
  const ruStory = (JSON.parse(fs.readFileSync(RU_LOCALE_PATH, 'utf-8')) as {
    battle: { story: Record<string, unknown> };
  }).battle.story;
  const storyText = (key: string): string => {
    const value = ruStory[key];
    return typeof value === 'string' ? value : '';
  };

  for (let i = 0; i < SAMPLE; i++) {
    const pool = shuffle(heroes, rand);
    const mineHeroes = pool.slice(0, 5);
    const opponentHeroes = pool.slice(5, 10);
    const mine = picks(mineHeroes);
    const opponent = picks(opponentHeroes);
    const lanes = buildLanes(mine, opponent, lookup);
    // Lanes are display-side extras: passing them changes no roll, only the
    // Explanation lines (same call shape as BattleService.fight()).
    const result = resolveBattle(mine, opponent, lookup, rand, { lanes });
    const topAxisDelta = assessBattle(mine, opponent, lookup).axisDeltas[0]?.delta ?? 0;
    const story = buildBattleStory({
      resolvedOutcome: result.resolvedOutcome,
      advantageDirection: result.advantageDirection,
      confidenceTier: result.confidenceTier,
      topAxisDelta: result.topAxisDelta,
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
    const winnerSign = result.resolvedOutcome === 'Win' ? 1 : -1;
    if (turning === 'turningAxis' && !(topAxisDelta * winnerSign > 0)) counts.turningAxisNotWinnersAxis += 1;
    for (const l of lanes) {
      laneStats.lanes += 1;
      if (l.winner === 'even') laneStats.even += 1;
      else laneStats.decided += 1;
      if (l.rateSource === 'lane') laneStats.fromLane += 1;
      else if (l.rateSource === 'matchup') laneStats.fromMatchup += 1;
      else laneStats.noData += 1;
      const huntFloor = l.rateSource === 'lane' ? LANE_HUNT_FLOOR : HUNT_FLOOR;
      if (l.topPair && l.topPair.winRate >= huntFloor) laneStats.topPairHunt += 1;
      if (l.topPair) topPairRates.push(l.topPair.winRate * 100);
      if (l.winRate !== null) absEdges.push(Math.abs(l.winRate - 0.5) * 100);
    }
    counts.nearEvenLaneGivenAWinner += lanes.filter(
      (l) => l.winRate !== null && Math.abs(l.winRate - 0.5) <= NEAR_EVEN_SPREAD && l.winner !== 'even',
    ).length;
    const explanationSaysEven = result.explanation.some(
      (line) => typeof line !== 'string' && line.key === 'battle.explain.lanes.even',
    );
    const storyTally = story.beats[0].params;
    if (explanationSaysEven && storyTally.winnerLanes !== storyTally.loserLanes) {
      counts.storyTallyVsExplanationEven += 1;
    }
    const openingParams = story.beats[0].params;
    const usedKeys: string[] = [opening, turning];
    if (openingParams.openingPairHero && openingParams.openingPairVs) {
      usedKeys.push(openingParams.openingPairTone === 'hunt' ? 'openingLaneHook' : 'openingLaneSoft');
    }
    if (usedKeys.some((key) => CAUSAL_COPY.test(storyText(key)))) counts.causalLaneCopy += 1;
    if (finish === 'finishHeld' || finish === 'finishComeback' || finish === 'finishUpset') {
      counts.finishHeldComebackUpset += 1;
    }
  }

  const pct = (k: keyof typeof counts) => ((counts[k] / counts.n) * 100).toFixed(1);
  absEdges.sort((a, b) => a - b);
  topPairRates.sort((a, b) => a - b);
  const quantile = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))]?.toFixed(1);
  const q = (p: number) => quantile(absEdges, p);
  const lanePct = (k: keyof typeof laneStats) => ((laneStats[k] / laneStats.lanes) * 100).toFixed(1);
  const lanesSummary = {
    source: process.env.AUDIT_LANE_SOURCE === 'proxy' ? 'proxy' : 'lane-outcomes',
    evenPct: lanePct('even'),
    fromLanePct: lanePct('fromLane'),
    fromMatchupPct: lanePct('fromMatchup'),
    noDataPct: lanePct('noData'),
    topPairHuntOfDecidedPct: ((laneStats.topPairHunt / Math.max(1, laneStats.decided)) * 100).toFixed(1),
    absEdgePpQuantiles: { p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9) },
    topPairPctQuantiles: {
      p25: quantile(topPairRates, 0.25),
      p50: quantile(topPairRates, 0.5),
      p68: quantile(topPairRates, 0.68),
      p75: quantile(topPairRates, 0.75),
    },
  };
  console.log(JSON.stringify({ sample: counts.n, lanes: lanesSummary, counts, pct: {
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
    turningAxisNotWinnersAxis: pct('turningAxisNotWinnersAxis'),
    storyTallyVsExplanationEven: pct('storyTallyVsExplanationEven'),
    causalLaneCopy: pct('causalLaneCopy'),
  } }, null, 2));
}

main();
