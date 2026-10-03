import type {
  AdvantageDirection,
  BattleLaneResult,
  BattleStory,
  BattleStoryBeat,
  BattleStoryBeatKey,
  BattleStoryPhase,
  ConfidenceTier,
  HeroEvaluationValues,
  ResolvedOutcome,
} from 'shared';
import { bestMatchupEdge, bestSynergyPair, type BattlePick, type MatchupLookup } from './battle-resolution';
import {
  HUNT_FLOOR,
  INITIATING_FLOOR,
  LANE_HUNT_FLOOR,
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
import { laneRateSource } from './battle-lanes';

export { cameFromBehindLanes, isBattleUpset } from './battle-cast';

function standoutWonLane(
  lanes: BattleLaneResult[],
  resolvedOutcome: ResolvedOutcome,
): BattleLaneResult | undefined {
  const winner = resolvedOutcome === 'Win' ? 'mine' : 'opponent';
  // Only real lane win rates are quoted as a lane number; a lane that fell
  // back to the game-matchup proxy is never the standout.
  const won = lanes.filter(
    (lane) =>
      lane.winner === winner &&
      laneRateSource(lane) === 'lane' &&
      lane.topPair &&
      lane.topPair.winRate > MATCHUP_FLOOR,
  );
  if (won.length === 0) return undefined;
  return won.reduce((best, lane) =>
    (lane.topPair?.winRate ?? 0) > (best.topPair?.winRate ?? 0) ? lane : best,
  );
}

function pct(winRate: number | null | undefined): string {
  return typeof winRate === 'number' ? String(Math.round(winRate * 100)) : '';
}

// Game pair rates (hero-meta matchups/synergy) are CLEANED STRATZ shares
// (2026-10-03, Blueprint/06-battle-engine.md "Pair data"): 0.5 + how far the
// pair beats the expectation from both heroes' own strength. They are not
// game win rates, so copy quotes the edge over 0.5 in percentage points
// ("4.0"), never "54%". Lane rates (pct above) are real lane win rates.
function edgePp(share: number | null | undefined): string {
  return typeof share === 'number' ? (Math.round(Math.abs(share - 0.5) * 1000) / 10).toFixed(1) : '';
}

type SheetLead = 'yours' | 'theirs' | 'even';

function openingLeadFromLanes(lanes: BattleLaneResult[]): SheetLead {
  const mine = lanes.filter((lane) => lane.winner === 'mine').length;
  const opp = lanes.filter((lane) => lane.winner === 'opponent').length;
  if (mine > opp) return 'yours';
  if (opp > mine) return 'theirs';
  return 'even';
}

function sheetLeads(opening: SheetLead, final: 'yours' | 'theirs'): Record<BattleStoryPhase, SheetLead> {
  return {
    opening,
    turn: final,
    conversion: final,
    finish: final,
  };
}

export function buildBattleStory(input: {
  resolvedOutcome: ResolvedOutcome;
  advantageDirection: AdvantageDirection;
  confidenceTier?: ConfidenceTier;
  lanes: BattleLaneResult[];
  mine: BattlePick[];
  opponent: BattlePick[];
  lookup: MatchupLookup;
  highSkillSwingHeroName?: string | null;
  topAxis?: keyof HeroEvaluationValues | null;
  /** Signed gap of `topAxis` from your draft's side (>0 yours, <0 theirs). */
  topAxisDelta?: number | null;
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
  const huntMatchup = usableMatchup != null && usableMatchup.winRate >= HUNT_FLOOR;
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

  const driver = maxByAxes(winners, 'initiating');
  const theirDriverPick = maxByAxes(losers, 'initiating');
  const theirDriver =
    theirDriverPick && axisOf(theirDriverPick, 'initiating') >= INITIATING_FLOOR
      ? theirDriverPick.hero.name
      : '';
  const saver = maxByAxes(winners, 'saving');
  const saverHigh = saver && axisOf(saver, 'saving') >= SAVING_FLOOR ? saver : undefined;
  const swingHero = input.highSkillSwingHeroName ?? '';
  const turnerPick = swingHero ? (findByName(winners, swingHero) ?? saverHigh) : saverHigh;
  const turnerName =
    turnerPick && driver && turnerPick.hero.id === driver.hero.id ? '' : (turnerPick?.hero.name ?? swingHero);

  const myCarry = pickByRole(input.mine, 'Carry');
  const theirCarry = pickByRole(input.opponent, 'Carry');
  const carryMatchup =
    myCarry && theirCarry ? input.lookup.getMatchupWinRate(myCarry.hero.id, theirCarry.hero.id) : null;
  let lateMatchupWinner = '';
  let carryEdge = '';
  let carryTone = '';
  if (myCarry && theirCarry && carryMatchup !== null) {
    if (carryMatchup > 0.5) lateMatchupWinner = myCarry.hero.name;
    else if (carryMatchup < 0.5) lateMatchupWinner = theirCarry.hero.name;
    carryEdge = edgePp(carryMatchup);
    carryTone =
      Math.round(Math.max(carryMatchup, 1 - carryMatchup) * 100) >= HUNT_FLOOR * 100 ? 'hunt' : 'edge';
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
  const topAxisDelta = input.topAxisDelta ?? 0;
  const topAxisSide = topAxisDelta > 0 ? 'yours' : topAxisDelta < 0 ? 'opponent' : '';
  // The largest axis gap is winner-agnostic: on an upset it usually belongs to
  // the favorite. Name it as the winner's only when it really is theirs.
  const topAxisIsWinners = topAxisSide === (won ? 'yours' : 'opponent');
  const lanesEven = tally.winnerWins === tally.loserWins;
  const roshan = roshanBand(winners);
  const standout = standoutWonLane(input.lanes, input.resolvedOutcome);
  const openingLead = openingLeadFromLanes(input.lanes);
  const finalLead: 'yours' | 'theirs' = won ? 'yours' : 'theirs';
  const leads = sheetLeads(openingLead, finalLead);

  const openingKey: BattleStoryBeatKey = isUpset
    ? 'openingUpset'
    : cameFromBehind
      ? 'openingComeback'
      : lanesEven
        ? 'openingEven'
        : 'openingAhead';

  let turnKey: BattleStoryBeatKey;
  if (huntMatchup && usableCombo) turnKey = 'turningCatchCombo';
  else if (huntMatchup) turnKey = 'turningCatch';
  else if (usableMatchup && usableCombo) turnKey = 'turningEdgeCombo';
  else if (usableMatchup) turnKey = 'turningEdge';
  else if (usableCombo) turnKey = 'turningCombo';
  else if (isUpset && swingHero) turnKey = 'turningUpsetHighSkill';
  else turnKey = topAxisIsWinners ? 'turningAxis' : 'turningAxisSplit';

  const finishKey: BattleStoryBeatKey = isUpset
    ? 'finishUpset'
    : cameFromBehind
      ? 'finishComeback'
      : 'finishHeld';
  const posture = isUpset ? 'upset' : cameFromBehind ? 'behind' : lanesEven ? 'even' : 'ahead';

  const params: Record<string, string> = {
    matchupWinner: usableMatchup?.hero ?? '',
    matchupLoser: usableMatchup?.vs ?? '',
    matchupEdge: edgePp(usableMatchup?.winRate),
    winnerSide: won ? 'yours' : 'opponent',
    swingHero,
    topAxis,
    topAxisSide,
    winnerLanes: String(tally.winnerWins),
    loserLanes: String(tally.loserWins),
    driver: driver?.hero.name ?? '',
    theirDriver,
    turner: turnerName,
    comboA: usableCombo?.heroA ?? '',
    comboB: usableCombo?.heroB ?? '',
    comboEdge: edgePp(usableCombo?.winRate),
    posture,
    myCarry: myCarry?.hero.name ?? '',
    theirCarry: theirCarry?.hero.name ?? '',
    lateMatchupWinner,
    carryEdge,
    scaleLeader,
    roshanBand: roshan.band,
    openingLane: standout?.lane ?? '',
    openingPairHero: standout?.topPair?.hero ?? '',
    openingPairVs: standout?.topPair?.vs ?? '',
    openingPairWinRate: pct(standout?.topPair?.winRate),
    openingPairTone: (standout?.topPair?.winRate ?? 0) >= LANE_HUNT_FLOOR ? 'hunt' : 'edge',
    carryTone,
    openingLead: leads.opening,
    turnLead: leads.turn,
    conversionLead: leads.conversion,
    finishLead: leads.finish,
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
