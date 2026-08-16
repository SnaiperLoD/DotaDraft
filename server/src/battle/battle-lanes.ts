import type { BattleLaneId, BattleLaneResult, BattleLaneTopPair, DraftRole, Hero } from 'shared';
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
    const winner = averageEdge > 0 ? 'mine' : averageEdge < 0 ? 'opponent' : 'even';
    const topPair =
      winner === 'mine' ? bestPair(minePairs) : winner === 'opponent' ? bestPair(opponentPairs) : null;
    return {
      lane: spec.lane,
      mine: mine.map((hero) => hero.name),
      opponent: opponent.map((hero) => hero.name),
      winner,
      winRate: edges.length > 0 ? 0.5 + averageEdge : null,
      mineIds: mine.map((hero) => hero.id),
      opponentIds: opponent.map((hero) => hero.id),
      topPair,
    };
  });
}

export function buildLaneExplanation(lanes: BattleLaneResult[]): string[] {
  const won = lanes
    .filter((lane) => lane.winner !== 'even' && lane.topPair)
    .slice()
    .sort(
      (a, b) => Math.abs((b.topPair?.winRate ?? 0.5) - 0.5) - Math.abs((a.topPair?.winRate ?? 0.5) - 0.5),
    );
  return won.slice(0, 3).map((lane) => {
    const side = lane.winner === 'mine' ? 'Your' : "The opponent's";
    const pair = lane.topPair!;
    return `${side} ${LANE_LABEL[lane.lane]} leans this way because ${pair.hero} into ${pair.vs} is a real matchup edge.`;
  });
}
