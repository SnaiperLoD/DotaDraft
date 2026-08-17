import type {
  AdvantageDirection,
  BattleLaneResult,
  ConfidenceTier,
  Hero,
  HeroEvaluationValues,
  LocalizedLine,
  ResolvedOutcome,
} from 'shared';
import { activeCustomTagsForTeam, i18nLine } from 'shared';
import { isHardCarry } from '../common/hard-carry';
import { bestMatchupEdge, bestSynergyPair, type BattlePick, type MatchupLookup } from './battle-resolution';
import {
  INITIATING_FLOOR,
  MATCHUP_FLOOR,
  SAVING_FLOOR,
  axisOf,
  isBattleUpset,
  maxByAxes,
  pickByRole,
  roshanBand,
  teamAvg,
} from './battle-cast';

const AXIS_DELTA_FLOOR = 0.3;
const TEMPO_SPLIT_FLOOR = 0.75;
const TAG_SKIP = new Set(['High Skill', 'Mechanical']);

type Side = 'yours' | 'opponent';

function pct(winRate: number): string {
  return String(Math.round(winRate * 100));
}

function heroesOf(picks: BattlePick[]): Hero[] {
  return picks.map((pick) => pick.hero);
}

function namesOf(picks: BattlePick[]): string[] {
  return picks.map((pick) => pick.hero.name);
}

function pipeNames(names: string[]): string {
  return names.join('|');
}

function leaderOn(picks: BattlePick[], axis: keyof HeroEvaluationValues): BattlePick | undefined {
  return maxByAxes(picks, axis);
}

function usableCombo(
  pair: { heroA: string; heroB: string; winRate: number } | null,
): { heroA: string; heroB: string; winRate: number } | null {
  return pair && pair.winRate > MATCHUP_FLOOR ? pair : null;
}

function topMatchups(
  team: Hero[],
  opponent: Hero[],
  lookup: MatchupLookup,
  limit: number,
): { hero: string; vs: string; winRate: number }[] {
  const edges: { hero: string; vs: string; winRate: number }[] = [];
  for (const hero of team) {
    for (const vs of opponent) {
      const winRate = lookup.getMatchupWinRate(hero.id, vs.id);
      if (winRate !== null && winRate > MATCHUP_FLOOR) {
        edges.push({ hero: hero.name, vs: vs.name, winRate });
      }
    }
  }
  return edges.sort((a, b) => b.winRate - a.winRate).slice(0, limit);
}

function visibleTags(picks: BattlePick[]): string[] {
  return activeCustomTagsForTeam(namesOf(picks))
    .filter((tag) => !TAG_SKIP.has(tag.name))
    .map((tag) => tag.name)
    .slice(0, 3);
}

export interface BattleExplanationContext {
  advantageDirection: AdvantageDirection;
  confidenceTier: ConfidenceTier;
  resolvedOutcome: ResolvedOutcome;
  teamA: BattlePick[];
  teamB: BattlePick[];
  lookup: MatchupLookup;
  topAxisDelta: { axis: keyof HeroEvaluationValues; delta: number };
  axisDeltas: { axis: keyof HeroEvaluationValues; delta: number }[];
  highSkillSwingHero: Hero | null;
  lanes?: BattleLaneResult[];
  shutdownHeroesA?: Hero[];
  shutdownHeroesB?: Hero[];
  hardCarryCountA?: number;
  hardCarryCountB?: number;
}

function frameLine(ctx: BattleExplanationContext): LocalizedLine {
  const { advantageDirection, confidenceTier, topAxisDelta } = ctx;
  if (advantageDirection === 'Even') {
    return i18nLine('battle.explain.frame.even', {
      confidence: confidenceTier,
      axis: topAxisDelta.axis,
      edge: topAxisDelta.delta > 0 ? 'edge' : 'deficit',
    });
  }
  const favoredIsA = advantageDirection === 'A';
  const axisFavorsFavoredSide = favoredIsA === topAxisDelta.delta > 0;
  return i18nLine('battle.explain.frame.ahead', {
    side: favoredIsA ? 'yours' : 'opponent',
    confidence: confidenceTier,
    axis: topAxisDelta.axis,
    edge: axisFavorsFavoredSide ? 'edge' : 'deficit',
  });
}

function clockLine(mine: BattlePick[], opponent: BattlePick[], winners: BattlePick[]): LocalizedLine | null {
  const myTempo = teamAvg(mine, 'tempo');
  const theirTempo = teamAvg(opponent, 'tempo');
  const myScaling = teamAvg(mine, 'scaling');
  const theirScaling = teamAvg(opponent, 'scaling');
  const faster: Side | null =
    myTempo - theirTempo >= TEMPO_SPLIT_FLOOR
      ? 'yours'
      : theirTempo - myTempo >= TEMPO_SPLIT_FLOOR
        ? 'opponent'
        : null;
  const scaler: Side | null =
    myScaling - theirScaling >= TEMPO_SPLIT_FLOOR
      ? 'yours'
      : theirScaling - myScaling >= TEMPO_SPLIT_FLOOR
        ? 'opponent'
        : null;
  const { band, key } = roshanBand(winners);

  if (faster && scaler && faster !== scaler) {
    return i18nLine('battle.explain.clock.split', { faster, scaler, band });
  }
  if (key === 'conversionRoshanEarly') {
    return i18nLine('battle.explain.clock.early', { band });
  }
  if (key === 'conversionRoshanLate') {
    return i18nLine('battle.explain.clock.late', { band });
  }
  return null;
}

function fightShapeLines(mine: BattlePick[], opponent: BattlePick[]): LocalizedLine[] {
  const myDriver = maxByAxes(mine, 'initiating', 'skirmish_rate');
  const theirDriver = maxByAxes(opponent, 'initiating', 'skirmish_rate');
  const mySaver = maxByAxes(mine, 'saving');
  const theirSaver = maxByAxes(opponent, 'saving');
  const myInit = myDriver ? axisOf(myDriver, 'initiating') : 0;
  const theirInit = theirDriver ? axisOf(theirDriver, 'initiating') : 0;
  const lines: LocalizedLine[] = [];

  if (
    myDriver &&
    theirDriver &&
    myDriver.hero.id !== theirDriver.hero.id &&
    (myInit >= INITIATING_FLOOR || theirInit >= INITIATING_FLOOR)
  ) {
    lines.push(
      i18nLine('battle.explain.shape.duel', { mine: myDriver.hero.name, theirs: theirDriver.hero.name }),
    );
  } else if (myDriver && myInit >= INITIATING_FLOOR) {
    lines.push(i18nLine('battle.explain.shape.mineStarts', { hero: myDriver.hero.name }));
  } else if (theirDriver && theirInit >= INITIATING_FLOOR) {
    lines.push(i18nLine('battle.explain.shape.oppStarts', { hero: theirDriver.hero.name }));
  }

  const mySave = mySaver && axisOf(mySaver, 'saving') >= SAVING_FLOOR ? mySaver : undefined;
  const theirSave = theirSaver && axisOf(theirSaver, 'saving') >= SAVING_FLOOR ? theirSaver : undefined;
  if (mySave && theirSave && mySave.hero.id !== theirSave.hero.id) {
    lines.push(
      i18nLine('battle.explain.shape.savesBoth', { mine: mySave.hero.name, theirs: theirSave.hero.name }),
    );
  } else if (mySave) {
    lines.push(i18nLine('battle.explain.shape.saveMine', { hero: mySave.hero.name }));
  } else if (theirSave) {
    lines.push(i18nLine('battle.explain.shape.saveOpp', { hero: theirSave.hero.name }));
  }

  return lines;
}

function axisNamed(delta: { axis: keyof HeroEvaluationValues }, side: BattlePick[]): string {
  const hero = leaderOn(side, delta.axis);
  return hero ? `${delta.axis}:${hero.hero.name}` : delta.axis;
}

function axisPictureLine(
  axisDeltas: BattleExplanationContext['axisDeltas'],
  mine: BattlePick[],
  opponent: BattlePick[],
): LocalizedLine | null {
  const leads = axisDeltas.filter((delta) => Math.abs(delta.delta) >= AXIS_DELTA_FLOOR).slice(0, 3);
  if (leads.length === 0) return null;

  const yours = leads.filter((delta) => delta.delta > 0);
  const theirs = leads.filter((delta) => delta.delta < 0);

  if (yours.length > 0 && theirs.length > 0) {
    return i18nLine('battle.explain.sheet.both', {
      yours: yours.map((d) => axisNamed(d, mine)).join('|'),
      hole: theirs.map((d) => axisNamed(d, opponent)).join('|'),
    });
  }
  if (yours.length > 0) {
    return i18nLine('battle.explain.sheet.yours', {
      yours: yours.map((d) => axisNamed(d, mine)).join('|'),
    });
  }
  return i18nLine('battle.explain.sheet.theirs', {
    theirs: theirs.map((d) => axisNamed(d, opponent)).join('|'),
  });
}

function laneLines(lanes: BattleLaneResult[] | undefined): LocalizedLine[] {
  if (!lanes || lanes.length === 0) return [];
  const decided = lanes
    .filter((lane) => lane.winner !== 'even' && lane.topPair)
    .slice()
    .sort((a, b) => Math.abs((b.topPair?.winRate ?? 0.5) - 0.5) - Math.abs((a.topPair?.winRate ?? 0.5) - 0.5))
    .slice(0, 3);
  if (decided.length === 0) return [];

  const intro = i18nLine(decided.length === 1 ? 'battle.explain.lanes.wash' : 'battle.explain.lanes.uneven');
  const bits = decided.map((lane) => {
    const pair = lane.topPair!;
    const chance =
      lane.winRate === null ? '' : lane.winner === 'opponent' ? pct(1 - lane.winRate) : pct(lane.winRate);
    const pairPct = pct(pair.winRate);
    const params: Record<string, string> = {
      lane: lane.lane,
      hero: pair.hero,
      vs: pair.vs,
      pairPct,
    };
    if (chance) params.chance = chance;
    if (lane.winner === 'mine') {
      return i18nLine(chance ? 'battle.explain.lane.mineLean' : 'battle.explain.lane.mineEdge', params);
    }
    return i18nLine(chance ? 'battle.explain.lane.oppHole' : 'battle.explain.lane.oppEdge', params);
  });

  return [intro, ...bits];
}

function catchAndComboLines(
  winners: Hero[],
  losers: Hero[],
  lookup: MatchupLookup,
  winner: Side,
  loser: Side,
  lanePairKeys: Set<string>,
): LocalizedLine[] {
  const catches = topMatchups(winners, losers, lookup, 3).filter(
    (row) => !lanePairKeys.has(`${row.hero}|${row.vs}`),
  );
  const combo = usableCombo(bestSynergyPair(winners, lookup));
  const leftoverCombo = usableCombo(bestSynergyPair(losers, lookup));
  const lines: LocalizedLine[] = [];

  if (catches.length > 0) {
    const first = catches[0];
    lines.push(
      i18nLine('battle.explain.catch.first', {
        winner,
        hero: first.hero,
        vs: first.vs,
        pct: pct(first.winRate),
      }),
    );
    if (catches[1]) {
      lines.push(
        i18nLine('battle.explain.catch.second', {
          hero: catches[1].hero,
          vs: catches[1].vs,
          pct: pct(catches[1].winRate),
        }),
      );
    }
  }
  if (combo) {
    lines.push(
      i18nLine('battle.explain.combo.win', {
        heroA: combo.heroA,
        heroB: combo.heroB,
        pct: pct(combo.winRate),
      }),
    );
  }
  if (
    leftoverCombo &&
    (!combo || leftoverCombo.heroA !== combo.heroA || leftoverCombo.heroB !== combo.heroB)
  ) {
    lines.push(
      i18nLine('battle.explain.combo.leftover', {
        loser,
        heroA: leftoverCombo.heroA,
        heroB: leftoverCombo.heroB,
        pct: pct(leftoverCombo.winRate),
      }),
    );
  }

  return lines;
}

function carryLateLines(mine: BattlePick[], opponent: BattlePick[], lookup: MatchupLookup): LocalizedLine[] {
  const myCarry = pickByRole(mine, 'Carry');
  const theirCarry = pickByRole(opponent, 'Carry');
  if (!myCarry || !theirCarry) return [];
  const carryMatchup = lookup.getMatchupWinRate(myCarry.hero.id, theirCarry.hero.id);
  const myScale = axisOf(myCarry, 'scaling');
  const theirScale = axisOf(theirCarry, 'scaling');
  const scaleLeader =
    myScale !== theirScale ? (myScale > theirScale ? myCarry.hero.name : theirCarry.hero.name) : '';

  const lines: LocalizedLine[] = [
    i18nLine('battle.explain.carry.late', { mine: myCarry.hero.name, theirs: theirCarry.hero.name }),
  ];

  if (carryMatchup === null) {
    lines.push(
      i18nLine('battle.explain.carry.noRow', { mine: myCarry.hero.name, theirs: theirCarry.hero.name }),
    );
  } else if (carryMatchup > MATCHUP_FLOOR) {
    lines.push(
      i18nLine('battle.explain.carry.mineOwns', { hero: myCarry.hero.name, pct: pct(carryMatchup) }),
    );
  } else if (carryMatchup < 1 - MATCHUP_FLOOR) {
    lines.push(
      i18nLine('battle.explain.carry.oppOwns', { hero: theirCarry.hero.name, pct: pct(1 - carryMatchup) }),
    );
  } else {
    lines.push(i18nLine('battle.explain.carry.flip', { pct: pct(carryMatchup) }));
  }

  if (scaleLeader && carryMatchup !== null) {
    const matchupWinner =
      carryMatchup > MATCHUP_FLOOR
        ? myCarry.hero.name
        : carryMatchup < 1 - MATCHUP_FLOOR
          ? theirCarry.hero.name
          : '';
    if (matchupWinner && scaleLeader === matchupWinner) {
      lines.push(i18nLine('battle.explain.carry.scaleSame'));
    } else if (matchupWinner && scaleLeader !== matchupWinner) {
      lines.push(i18nLine('battle.explain.carry.scaleTension', { scaler: scaleLeader }));
    } else {
      lines.push(i18nLine('battle.explain.carry.scaleAlso', { scaler: scaleLeader }));
    }
  } else if (scaleLeader) {
    lines.push(i18nLine('battle.explain.carry.scaleOnly', { scaler: scaleLeader }));
  }

  return lines;
}

function tagsLine(mine: BattlePick[], opponent: BattlePick[]): LocalizedLine | null {
  const mineTags = visibleTags(mine);
  const theirTags = visibleTags(opponent);
  if (mineTags.length === 0 && theirTags.length === 0) return null;
  if (mineTags.length > 0 && theirTags.length > 0) {
    return i18nLine('battle.explain.tags.both', { mine: pipeNames(mineTags), theirs: pipeNames(theirTags) });
  }
  if (mineTags.length > 0) {
    return i18nLine('battle.explain.tags.mine', { tags: pipeNames(mineTags) });
  }
  return i18nLine('battle.explain.tags.opp', { tags: pipeNames(theirTags) });
}

function shutdownLines(mine: Hero[] | undefined, opponent: Hero[] | undefined): LocalizedLine[] {
  const myNames = (mine ?? []).map((hero) => hero.name);
  const theirNames = (opponent ?? []).map((hero) => hero.name);
  const lines: LocalizedLine[] = [];
  if (myNames.length > 0) {
    lines.push(
      i18nLine('battle.explain.shutdown.mine', { names: pipeNames(myNames), count: String(myNames.length) }),
    );
  }
  if (theirNames.length > 0) {
    lines.push(
      i18nLine('battle.explain.shutdown.opp', {
        names: pipeNames(theirNames),
        count: String(theirNames.length),
      }),
    );
  }
  return lines;
}

function hardCarryLines(countA: number | undefined, countB: number | undefined): LocalizedLine[] {
  const mine = countA ?? 0;
  const theirs = countB ?? 0;
  const lines: LocalizedLine[] = [];
  if (mine >= 3) {
    lines.push(i18nLine('battle.explain.hardCarry.mine', { count: String(mine) }));
  }
  if (theirs >= 3) {
    lines.push(i18nLine('battle.explain.hardCarry.opp', { count: String(theirs) }));
  }
  return lines;
}

function closingLine(
  advantageDirection: AdvantageDirection,
  resolvedOutcome: ResolvedOutcome,
): LocalizedLine {
  const favoredIsA = advantageDirection === 'A';
  const userWon = resolvedOutcome === 'Win';
  if (advantageDirection === 'Even') {
    return i18nLine(userWon ? 'battle.explain.close.evenWin' : 'battle.explain.close.evenLose');
  }
  if (favoredIsA) {
    return i18nLine(userWon ? 'battle.explain.close.favoredHeld' : 'battle.explain.close.favoredUpset');
  }
  return i18nLine(userWon ? 'battle.explain.close.underdogWin' : 'battle.explain.close.underdogHeld');
}

function upsetReasonLines(
  ctx: BattleExplanationContext,
  underdog: Hero[],
  favorite: Hero[],
): LocalizedLine[] {
  const favoredIsA = ctx.advantageDirection === 'A';
  const underdogSide: Side = favoredIsA ? 'opponent' : 'yours';
  const matchup = bestMatchupEdge(underdog, favorite, ctx.lookup);
  const synergy = bestSynergyPair(underdog, ctx.lookup);
  const underdogBestAxis = [...ctx.axisDeltas]
    .filter((delta) => (favoredIsA ? delta.delta < 0 : delta.delta > 0))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  const params: Record<string, string> = {
    lead: ctx.highSkillSwingHero ? 'top' : 'but',
    underdog: underdogSide,
  };
  if (matchup) {
    params.matchupHero = matchup.hero;
    params.matchupVs = matchup.vs;
  }
  if (synergy) {
    params.comboA = synergy.heroA;
    params.comboB = synergy.heroB;
  }
  if (underdogBestAxis) {
    params.axis = underdogBestAxis.axis;
  }

  if (matchup || synergy || underdogBestAxis) {
    return [i18nLine('battle.explain.upset.reasons', params)];
  }
  if (!ctx.highSkillSwingHero) {
    return [
      i18nLine('battle.explain.upset.odds', {
        confidence: ctx.confidenceTier,
        underdog: underdogSide,
      }),
    ];
  }
  return [];
}

export function buildExplanation(ctx: BattleExplanationContext): LocalizedLine[] {
  const mine = ctx.teamA;
  const opponent = ctx.teamB;
  const won = ctx.resolvedOutcome === 'Win';
  const winners = won ? mine : opponent;
  const losers = won ? opponent : mine;
  const winnerHeroes = heroesOf(winners);
  const loserHeroes = heroesOf(losers);
  const isUpset = isBattleUpset(ctx.advantageDirection, ctx.resolvedOutcome);
  const winner: Side = won ? 'yours' : 'opponent';
  const loser: Side = won ? 'opponent' : 'yours';

  const lanePairKeys = new Set(
    (ctx.lanes ?? [])
      .filter((lane) => lane.topPair)
      .map((lane) => `${lane.topPair!.hero}|${lane.topPair!.vs}`),
  );
  const myCarry = pickByRole(mine, 'Carry');
  const theirCarry = pickByRole(opponent, 'Carry');
  if (myCarry && theirCarry) {
    lanePairKeys.add(`${myCarry.hero.name}|${theirCarry.hero.name}`);
    lanePairKeys.add(`${theirCarry.hero.name}|${myCarry.hero.name}`);
  }

  const lines: LocalizedLine[] = [frameLine(ctx)];

  if (ctx.highSkillSwingHero) {
    lines.push(i18nLine('battle.explain.highSkill', { hero: ctx.highSkillSwingHero.name }));
  }

  const clock = clockLine(mine, opponent, winners);
  if (clock) lines.push(clock);

  lines.push(...fightShapeLines(mine, opponent));

  const axes = axisPictureLine(ctx.axisDeltas, mine, opponent);
  if (axes) lines.push(axes);

  lines.push(...laneLines(ctx.lanes));

  lines.push(...catchAndComboLines(winnerHeroes, loserHeroes, ctx.lookup, winner, loser, lanePairKeys));

  lines.push(...carryLateLines(mine, opponent, ctx.lookup));

  const tags = tagsLine(mine, opponent);
  if (tags) lines.push(tags);

  lines.push(...shutdownLines(ctx.shutdownHeroesA, ctx.shutdownHeroesB));

  lines.push(
    ...hardCarryLines(
      ctx.hardCarryCountA ?? heroesOf(mine).filter(isHardCarry).length,
      ctx.hardCarryCountB ?? heroesOf(opponent).filter(isHardCarry).length,
    ),
  );

  if (isUpset) {
    const favoredIsA = ctx.advantageDirection === 'A';
    const underdogHeroes = favoredIsA ? heroesOf(opponent) : heroesOf(mine);
    const favoriteHeroes = favoredIsA ? heroesOf(mine) : heroesOf(opponent);
    lines.push(...upsetReasonLines(ctx, underdogHeroes, favoriteHeroes));
  } else {
    lines.push(closingLine(ctx.advantageDirection, ctx.resolvedOutcome));
  }

  return lines;
}
