import type {
  AdvantageDirection,
  BattleLaneResult,
  BattleStory,
  BattleStoryBeat,
  BattleStoryBeatKey,
  HeroEvaluationValues,
  ResolvedOutcome,
} from 'shared';
import { bestMatchupEdge, bestSynergyPair, type BattlePick, type MatchupLookup } from './battle-resolution';
import {
  INITIATING_FLOOR,
  MATCHUP_FLOOR,
  SAVING_FLOOR,
  axisOf,
  cameFromBehindLanes,
  findByName,
  idsOf,
  isBattleUpset,
  laneTally,
  maxByAxes,
  pickByRole,
  roshanBand,
} from './battle-cast';

export { cameFromBehindLanes, isBattleUpset } from './battle-cast';

function standoutWonLane(
  lanes: BattleLaneResult[],
  resolvedOutcome: ResolvedOutcome,
): BattleLaneResult | undefined {
  const winner = resolvedOutcome === 'Win' ? 'mine' : 'opponent';
  const won = lanes.filter((lane) => lane.winner === winner && lane.topPair && lane.topPair.winRate > MATCHUP_FLOOR);
  if (won.length === 0) return undefined;
  return won.reduce((best, lane) =>
    (lane.topPair?.winRate ?? 0) > (best.topPair?.winRate ?? 0) ? lane : best,
  );
}

function pct(winRate: number | null | undefined): string {
  return typeof winRate === 'number' ? String(Math.round(winRate * 100)) : '';
}

export function buildBattleStory(input: {
  resolvedOutcome: ResolvedOutcome;
  advantageDirection: AdvantageDirection;
  lanes: BattleLaneResult[];
  mine: BattlePick[];
  opponent: BattlePick[];
  lookup: MatchupLookup;
  highSkillSwingHeroName?: string | null;
  topAxis?: keyof HeroEvaluationValues | null;
}): BattleStory {
  const won = input.resolvedOutcome === 'Win';
  const winners = won ? input.mine : input.opponent;
  const losers = won ? input.opponent : input.mine;
  const tally = laneTally(input.lanes, input.resolvedOutcome);

  const matchup = bestMatchupEdge(
    winners.map((pick) => pick.hero),
    losers.map((pick) => pick.hero),
    input.lookup,
  );
  const usableMatchup = matchup && matchup.winRate > MATCHUP_FLOOR ? matchup : null;
  const matchupWinnerHero = usableMatchup
    ? winners.find((pick) => pick.hero.name === usableMatchup.hero)
    : undefined;
  const matchupLoserHero = usableMatchup
    ? losers.find((pick) => pick.hero.name === usableMatchup.vs)
    : undefined;

  const synergy = bestSynergyPair(
    winners.map((pick) => pick.hero),
    input.lookup,
  );
  const usableCombo = synergy && synergy.winRate > MATCHUP_FLOOR ? synergy : null;
  const comboAHero = usableCombo ? findByName(winners, usableCombo.heroA) : undefined;
  const comboBHero = usableCombo ? findByName(winners, usableCombo.heroB) : undefined;

  const driver = maxByAxes(winners, 'initiating', 'skirmish_rate');
  const theirDriverPick = maxByAxes(losers, 'initiating', 'skirmish_rate');
  const theirDriver =
    theirDriverPick && axisOf(theirDriverPick, 'initiating') >= INITIATING_FLOOR
      ? theirDriverPick.hero.name
      : '';
  const saver = maxByAxes(winners, 'saving');
  const saverHigh = saver && axisOf(saver, 'saving') >= SAVING_FLOOR ? saver : undefined;
  const swingHero = input.highSkillSwingHeroName ?? '';
  const turnerPick = swingHero ? findByName(winners, swingHero) ?? saverHigh : saverHigh;
  const turnerName =
    turnerPick && driver && turnerPick.hero.id === driver.hero.id ? '' : (turnerPick?.hero.name ?? swingHero);

  const myCarry = pickByRole(input.mine, 'Carry');
  const theirCarry = pickByRole(input.opponent, 'Carry');
  const carryMatchup =
    myCarry && theirCarry ? input.lookup.getMatchupWinRate(myCarry.hero.id, theirCarry.hero.id) : null;
  let lateMatchupWinner = '';
  let carryWinRate = '';
  if (myCarry && theirCarry && carryMatchup !== null) {
    if (carryMatchup > 0.5) {
      lateMatchupWinner = myCarry.hero.name;
      carryWinRate = String(Math.round(carryMatchup * 100));
    } else if (carryMatchup < 0.5) {
      lateMatchupWinner = theirCarry.hero.name;
      carryWinRate = String(Math.round((1 - carryMatchup) * 100));
    } else {
      carryWinRate = '50';
    }
  }
  const myScale = myCarry ? axisOf(myCarry, 'scaling') : 0;
  const theirScale = theirCarry ? axisOf(theirCarry, 'scaling') : 0;
  const scaleLeader =
    myCarry && theirCarry && myScale !== theirScale
      ? myScale > theirScale
        ? myCarry.hero.name
        : theirCarry.hero.name
      : '';

  const cameFromBehind = cameFromBehindLanes(input.lanes, input.resolvedOutcome);
  const isUpset = isBattleUpset(input.advantageDirection, input.resolvedOutcome);
  const topAxis = input.topAxis ?? '';
  const lanesEven = tally.winnerWins === tally.loserWins;
  const roshan = roshanBand(winners);
  const standout = standoutWonLane(input.lanes, input.resolvedOutcome);

  const openingKey: BattleStoryBeatKey = isUpset
    ? 'openingUpset'
    : cameFromBehind
      ? 'openingComeback'
      : lanesEven
        ? 'openingEven'
        : 'openingAhead';

  let turnKey: BattleStoryBeatKey;
  if (usableMatchup && usableCombo) turnKey = 'turningCatchCombo';
  else if (usableMatchup) turnKey = 'turningCatch';
  else if (usableCombo) turnKey = 'turningCombo';
  else if (isUpset && swingHero) turnKey = 'turningUpsetHighSkill';
  else turnKey = 'turningAxis';

  const finishKey: BattleStoryBeatKey = isUpset ? 'finishUpset' : cameFromBehind ? 'finishComeback' : 'finishHeld';
  const posture = isUpset ? 'upset' : cameFromBehind ? 'behind' : lanesEven ? 'even' : 'ahead';

  const params: Record<string, string> = {
    matchupWinner: usableMatchup?.hero ?? '',
    matchupLoser: usableMatchup?.vs ?? '',
    matchupWinRate: pct(usableMatchup?.winRate),
    winnerSide: won ? 'yours' : 'opponent',
    swingHero,
    topAxis,
    winnerLanes: String(tally.winnerWins),
    loserLanes: String(tally.loserWins),
    driver: driver?.hero.name ?? '',
    theirDriver,
    turner: turnerName,
    comboA: usableCombo?.heroA ?? '',
    comboB: usableCombo?.heroB ?? '',
    comboWinRate: pct(usableCombo?.winRate),
    posture,
    myCarry: myCarry?.hero.name ?? '',
    theirCarry: theirCarry?.hero.name ?? '',
    lateMatchupWinner,
    carryWinRate,
    scaleLeader,
    roshanBand: roshan.band,
    openingLane: standout?.lane ?? '',
    openingPairHero: standout?.topPair?.hero ?? '',
    openingPairVs: standout?.topPair?.vs ?? '',
    openingPairWinRate: pct(standout?.topPair?.winRate),
  };

  const heroIds = idsOf(
    driver,
    theirDriverPick,
    turnerPick,
    comboAHero,
    comboBHero,
    matchupWinnerHero,
    matchupLoserHero,
    myCarry,
    theirCarry,
  );
  const matchupEvidence =
    matchupWinnerHero && matchupLoserHero
      ? { winnerId: matchupWinnerHero.hero.id, loserId: matchupLoserHero.hero.id }
      : undefined;
  const laneEvidence = input.lanes.map((lane) => ({ lane: lane.lane, winner: lane.winner }));

  const beats: BattleStoryBeat[] = [
    {
      phase: 'opening',
      key: openingKey,
      params,
      evidence: { heroIds, lanes: laneEvidence },
    },
    {
      phase: 'turn',
      key: turnKey,
      params,
      evidence: { heroIds, matchup: matchupEvidence },
    },
    {
      phase: 'conversion',
      key: roshan.key,
      params,
      evidence: { heroIds, matchup: matchupEvidence },
    },
    {
      phase: 'finish',
      key: finishKey,
      params,
      evidence: { heroIds },
    },
  ];

  return { cameFromBehind, isUpset, beats };
}
