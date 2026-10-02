import type {
  BattleLaneId,
  BattleLaneResult,
  BattleLaneTopPair,
  BattleLaneWinner,
  DraftRole,
  Hero,
} from 'shared';
import type { MatchupLookup } from './battle-resolution';

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
 * The one "even lane" boundary (Blueprint/15-dev-plan-2026-10.md, T1.2): an
 * average matchup within 3.5pp of 50% is nobody's lane. Decided here once;
 * the lane card, Explanation, story tally and comeback check all read
 * `BattleLaneResult.winner` instead of re-deriving it. Display-only — lanes
 * never feed the fight roll.
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

export function buildLaneResults(
  mineByRole: Map<string, Hero>,
  opponentByRole: Map<string, Hero>,
  lookup: MatchupLookup,
): BattleLaneResult[] {
  return LANE_ROLES.map((spec) => {
    const mine = spec.mine.map((role) => mineByRole.get(role)).filter((hero): hero is Hero => hero != null);
    const opponent = spec.opponent
      .map((role) => opponentByRole.get(role))
      .filter((hero): hero is Hero => hero != null);
    const edges: number[] = [];
    const minePairs: BattleLaneTopPair[] = [];
    const opponentPairs: BattleLaneTopPair[] = [];
    for (const hero of mine) {
      for (const enemy of opponent) {
        const winRate = lookup.getMatchupWinRate(hero.id, enemy.id);
        if (winRate !== null) {
          edges.push(winRate - 0.5);
          minePairs.push({
            hero: hero.name,
            heroId: hero.id,
            vs: enemy.name,
            vsId: enemy.id,
            winRate,
          });
        }
        const opponentWinRate = lookup.getMatchupWinRate(enemy.id, hero.id);
        if (opponentWinRate !== null) {
          opponentPairs.push({
            hero: enemy.name,
            heroId: enemy.id,
            vs: hero.name,
            vsId: hero.id,
            winRate: opponentWinRate,
          });
        }
      }
    }
    const averageEdge = edges.length > 0 ? edges.reduce((sum, edge) => sum + edge, 0) / edges.length : 0;
    const winRate = edges.length > 0 ? 0.5 + averageEdge : null;
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
    };
  });
}
