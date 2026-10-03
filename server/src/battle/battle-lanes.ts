import type {
  BattleLaneId,
  BattleLaneRateSource,
  BattleLaneResult,
  BattleLaneTopPair,
  BattleLaneWinner,
  DraftRole,
  Hero,
} from 'shared';
import type { MatchupLookup } from './battle-resolution';
import { NO_LANE_OUTCOMES, type LaneOutcomeLookup } from './lane-outcomes';

const LANE_ROLES: {
  lane: BattleLaneId;
  mine: DraftRole[];
  opponent: DraftRole[];
}[] = [
  { lane: 'safe', mine: ['Carry', 'Hard Support'], opponent: ['Offlane', 'Soft Support'] },
  { lane: 'mid', mine: ['Mid'], opponent: ['Mid'] },
  { lane: 'off', mine: ['Offlane', 'Soft Support'], opponent: ['Carry', 'Hard Support'] },
];

export const LANE_LABEL: Record<BattleLaneId, string> = {
  safe: 'safe lane',
  mid: 'mid',
  off: 'offlane',
};

/**
 * The one "even lane" boundary (Blueprint/15-dev-plan-2026-10.md, T1.2): a
 * lane whose average pair rate is within 3.5pp of 50% is nobody's lane.
 * Decided here once; the lane card, Explanation, story tally and comeback
 * check all read `BattleLaneResult.winner` instead of re-deriving it.
 * Display-only — lanes never feed the fight roll. Re-checked for real STRATZ
 * lane win rates (2026-10-02, Blueprint/06-battle-engine.md): kept at 3.5pp.
 */
export const LANE_EVEN_SPREAD_PP = 3.5;

export function laneWinnerFor(winRate: number | null): BattleLaneWinner {
  if (winRate === null) return 'even';
  const edge = winRate - 0.5;
  if (Math.abs(edge) * 100 <= LANE_EVEN_SPREAD_PP + 1e-9) return 'even';
  return edge > 0 ? 'mine' : 'opponent';
}

function bestPair(pairs: BattleLaneTopPair[]): BattleLaneTopPair | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((best, pair) => (pair.winRate > best.winRate ? pair : best));
}

interface LanePairs {
  edges: number[];
  minePairs: BattleLaneTopPair[];
  opponentPairs: BattleLaneTopPair[];
}

function collectPairs(
  mine: Hero[],
  opponent: Hero[],
  rate: (heroId: number, vsId: number) => number | null,
): LanePairs {
  const out: LanePairs = { edges: [], minePairs: [], opponentPairs: [] };
  for (const hero of mine) {
    for (const enemy of opponent) {
      const winRate = rate(hero.id, enemy.id);
      if (winRate !== null) {
        out.edges.push(winRate - 0.5);
        out.minePairs.push({ hero: hero.name, heroId: hero.id, vs: enemy.name, vsId: enemy.id, winRate });
      }
      const opponentWinRate = rate(enemy.id, hero.id);
      if (opponentWinRate !== null) {
        out.opponentPairs.push({
          hero: enemy.name,
          heroId: enemy.id,
          vs: hero.name,
          vsId: hero.id,
          winRate: opponentWinRate,
        });
      }
    }
  }
  return out;
}

/**
 * Lane cards read real lane win rates (STRATZ `laneOutcome`, lane-outcomes.ts)
 * per hero pair. Only when NO pair in a lane has lane data does the lane fall
 * back to the proxy — the average game-matchup pair share (cleaned STRATZ,
 * centred on 0.5 since 2026-10-03) — and it is flagged `rateSource: 'matchup'`.
 * The two scales are never mixed in one lane (lane WR spreads ~15pp per pair,
 * cleaned game matchups ~2.5pp).
 */
export function buildLaneResults(
  mineByRole: Map<string, Hero>,
  opponentByRole: Map<string, Hero>,
  lookup: MatchupLookup,
  laneLookup: LaneOutcomeLookup = NO_LANE_OUTCOMES,
): BattleLaneResult[] {
  return LANE_ROLES.map((spec) => {
    const mine = spec.mine.map((role) => mineByRole.get(role)).filter((hero): hero is Hero => hero != null);
    const opponent = spec.opponent
      .map((role) => opponentByRole.get(role))
      .filter((hero): hero is Hero => hero != null);
    let rateSource: BattleLaneRateSource | null = 'lane';
    let pairs = collectPairs(mine, opponent, (a, b) => laneLookup.getLaneWinRate(a, b));
    if (pairs.edges.length === 0) {
      rateSource = 'matchup';
      pairs = collectPairs(mine, opponent, (a, b) => lookup.getMatchupWinRate(a, b));
    }
    const { edges, minePairs, opponentPairs } = pairs;
    const averageEdge = edges.length > 0 ? edges.reduce((sum, edge) => sum + edge, 0) / edges.length : 0;
    const winRate = edges.length > 0 ? 0.5 + averageEdge : null;
    if (winRate === null) rateSource = null;
    const winner = laneWinnerFor(winRate);
    const topPair =
      winner === 'mine' ? bestPair(minePairs) : winner === 'opponent' ? bestPair(opponentPairs) : null;
    return {
      lane: spec.lane,
      mine: mine.map((hero) => hero.name),
      opponent: opponent.map((hero) => hero.name),
      winner,
      winRate,
      mineIds: mine.map((hero) => hero.id),
      opponentIds: opponent.map((hero) => hero.id),
      topPair,
      rateSource,
    };
  });
}

// Lane payloads built before 2026-10-02 have no `rateSource`; they all used
// the game-matchup proxy.
export function laneRateSource(lane: BattleLaneResult): BattleLaneRateSource | null {
  if (lane.winRate === null) return null;
  return lane.rateSource ?? 'matchup';
}
