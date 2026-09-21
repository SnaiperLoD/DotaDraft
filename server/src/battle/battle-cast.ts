import type {
  AdvantageDirection,
  BattleLaneResult,
  BattleStoryBeatKey,
  HeroEvaluationValues,
  ResolvedOutcome,
} from 'shared';
import { roleAwareAxisValue } from '../common/role-fit';
import type { BattlePick } from './battle-resolution';

// Same floor as topMatchupEdges in battle-resolution.ts: only narrate a
// catch/combo if the pair is actually above 50%. bestMatchupEdge itself still
// returns the max even when it's a losing matchup — that's useful for
// upsets, but stuffing it into "X gets onto Y" is fanfic.
export const MATCHUP_FLOOR = 0.5;
// Above a coin flip is "a bit ahead in the pair". Hunt language ("gets on",
// "catches") starts here. 54% is not a pickoff.
export const HUNT_FLOOR = 0.6;
// Don't call someone a fight-turner at saving 3 (or 1.2). Axes are ~1–10;
// 6 is actually high.
export const SAVING_FLOOR = 6;
export const INITIATING_FLOOR = 6;

export function pickByRole(picks: BattlePick[], role: string): BattlePick | undefined {
  return picks.find((pick) => pick.assignedRole === role);
}

export function idOf(pick: BattlePick | undefined): number | undefined {
  return pick?.hero.id;
}

export function idsOf(...picks: Array<BattlePick | undefined>): number[] {
  const ids: number[] = [];
  for (const pick of picks) {
    const id = idOf(pick);
    if (typeof id === 'number' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function axisOf(pick: BattlePick, axis: keyof HeroEvaluationValues): number {
  return roleAwareAxisValue(axis, pick.hero, pick.assignedRole);
}

export function teamAvg(picks: BattlePick[], axis: keyof HeroEvaluationValues): number {
  if (picks.length === 0) return 0;
  return picks.reduce((sum, pick) => sum + axisOf(pick, axis), 0) / picks.length;
}

export function maxByAxes(
  picks: BattlePick[],
  primary: keyof HeroEvaluationValues,
  tiebreak?: keyof HeroEvaluationValues,
): BattlePick | undefined {
  if (picks.length === 0) return undefined;
  return picks.reduce((best, pick) => {
    const value = axisOf(pick, primary);
    const bestValue = axisOf(best, primary);
    if (value > bestValue) return pick;
    if (value < bestValue) return best;
    if (tiebreak && axisOf(pick, tiebreak) > axisOf(best, tiebreak)) return pick;
    return best;
  });
}

export function findByName(picks: BattlePick[], name: string): BattlePick | undefined {
  return picks.find((pick) => pick.hero.name === name);
}

export function roshanBand(winners: BattlePick[]): { key: BattleStoryBeatKey; band: string } {
  const tempo = teamAvg(winners, 'tempo');
  const scaling = teamAvg(winners, 'scaling');
  if (tempo - scaling >= 1) return { key: 'conversionRoshanEarly', band: '15–20' };
  if (scaling - tempo >= 1) return { key: 'conversionRoshanLate', band: '30+' };
  return { key: 'conversionRoshanMid', band: '20–30' };
}

export function isBattleUpset(
  advantageDirection: AdvantageDirection,
  resolvedOutcome: ResolvedOutcome,
): boolean {
  return (
    (advantageDirection === 'A' && resolvedOutcome === 'Lose') ||
    (advantageDirection === 'B' && resolvedOutcome === 'Win')
  );
}

export function cameFromBehindLanes(lanes: BattleLaneResult[], resolvedOutcome: ResolvedOutcome): boolean {
  const winnerLane = resolvedOutcome === 'Win' ? 'mine' : 'opponent';
  const loserLane = resolvedOutcome === 'Win' ? 'opponent' : 'mine';
  const winnerLaneWins = lanes.filter((lane) => lane.winner === winnerLane).length;
  const loserLaneWins = lanes.filter((lane) => lane.winner === loserLane).length;
  return winnerLaneWins < loserLaneWins;
}

export function laneTally(
  lanes: BattleLaneResult[],
  resolvedOutcome: ResolvedOutcome,
): {
  winnerWins: number;
  loserWins: number;
} {
  const winnerLane = resolvedOutcome === 'Win' ? 'mine' : 'opponent';
  const loserLane = resolvedOutcome === 'Win' ? 'opponent' : 'mine';
  return {
    winnerWins: lanes.filter((lane) => lane.winner === winnerLane).length,
    loserWins: lanes.filter((lane) => lane.winner === loserLane).length,
  };
}
