import type {
  AdvantageDirection,
  BattleLaneResult,
  ConfidenceTier,
  Hero,
  HeroEvaluationValues,
  ResolvedOutcome,
} from 'shared';
import { activeCustomTagsForTeam } from 'shared';
import { isHardCarry } from '../common/hard-carry';
import { AXIS_LABEL, bestMatchupEdge, bestSynergyPair, type BattlePick, type MatchupLookup } from './battle-resolution';
import { LANE_LABEL } from './battle-lanes';
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

function pct(winRate: number): string {
  return String(Math.round(winRate * 100));
}

function describeAxis(axis: keyof HeroEvaluationValues, favorsA: boolean): string {
  return `${favorsA ? 'an edge in' : 'a deficit in'} ${AXIS_LABEL[axis]}`;
}

function heroesOf(picks: BattlePick[]): Hero[] {
  return picks.map((pick) => pick.hero);
}

function namesOf(picks: BattlePick[]): string[] {
  return picks.map((pick) => pick.hero.name);
}

function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
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

function frameLine(ctx: BattleExplanationContext): string {
  const { advantageDirection, confidenceTier, topAxisDelta } = ctx;
  if (advantageDirection === 'Even') {
    return `This is a close matchup with no clear favorite (${confidenceTier} confidence) — ${describeAxis(topAxisDelta.axis, topAxisDelta.delta > 0)} for your draft was the closest thing to an edge.`;
  }
  const favoredIsA = advantageDirection === 'A';
  const favoredLabel = favoredIsA ? 'Your draft' : "Opponent's draft";
  const axisFavorsFavoredSide = favoredIsA === topAxisDelta.delta > 0;
  return `${favoredLabel} leaned ahead overall (${confidenceTier} confidence), with ${describeAxis(topAxisDelta.axis, axisFavorsFavoredSide)} standing out.`;
}

function highSkillLine(hero: Hero): string {
  return `${hero.name}'s own play was the deciding swing here — real match data shows outcomes around this hero carry more variance than the stat sheet alone suggests, and this game landed on the wrong side of it for the favorite.`;
}

function clockLine(mine: BattlePick[], opponent: BattlePick[], winners: BattlePick[]): string | null {
  const myTempo = teamAvg(mine, 'tempo');
  const theirTempo = teamAvg(opponent, 'tempo');
  const myScaling = teamAvg(mine, 'scaling');
  const theirScaling = teamAvg(opponent, 'scaling');
  const faster =
    myTempo - theirTempo >= TEMPO_SPLIT_FLOOR
      ? 'Your draft'
      : theirTempo - myTempo >= TEMPO_SPLIT_FLOOR
        ? "The opponent's draft"
        : null;
  const scaler =
    myScaling - theirScaling >= TEMPO_SPLIT_FLOOR
      ? 'your draft'
      : theirScaling - myScaling >= TEMPO_SPLIT_FLOOR
        ? "the opponent's draft"
        : null;
  const { band, key } = roshanBand(winners);

  if (faster && scaler && faster.toLowerCase() !== scaler) {
    return `${faster} wants this over now; ${scaler} is the one that gets paid if the game lives. That split points at a ${band} minute window — whose clock this matchup is on, not a reconstructed Roshan take.`;
  }
  if (key === 'conversionRoshanEarly') {
    return `The winning side is a tempo draft, not a scaler — this matchup wants to be decided in the ${band} minute window, before the other roster's late game comes online.`;
  }
  if (key === 'conversionRoshanLate') {
    return `The winning side scales harder than it plays early — this matchup is playing for the ${band} minute window. If it gets there, the late game is the actual win condition.`;
  }
  return null;
}

function fightShapeLine(mine: BattlePick[], opponent: BattlePick[]): string | null {
  const myDriver = maxByAxes(mine, 'initiating', 'skirmish_rate');
  const theirDriver = maxByAxes(opponent, 'initiating', 'skirmish_rate');
  const mySaver = maxByAxes(mine, 'saving');
  const theirSaver = maxByAxes(opponent, 'saving');
  const myInit = myDriver ? axisOf(myDriver, 'initiating') : 0;
  const theirInit = theirDriver ? axisOf(theirDriver, 'initiating') : 0;
  const parts: string[] = [];

  if (
    myDriver &&
    theirDriver &&
    myDriver.hero.id !== theirDriver.hero.id &&
    (myInit >= INITIATING_FLOOR || theirInit >= INITIATING_FLOOR)
  ) {
    parts.push(
      `${myDriver.hero.name} is the one who starts fights on your side; ${theirDriver.hero.name} is the one who has to answer.`,
    );
  } else if (myDriver && myInit >= INITIATING_FLOOR) {
    parts.push(`${myDriver.hero.name} is the one who actually starts fights on your side.`);
  } else if (theirDriver && theirInit >= INITIATING_FLOOR) {
    parts.push(`${theirDriver.hero.name} is the one who starts fights for the opponent.`);
  }

  const mySave = mySaver && axisOf(mySaver, 'saving') >= SAVING_FLOOR ? mySaver : undefined;
  const theirSave = theirSaver && axisOf(theirSaver, 'saving') >= SAVING_FLOOR ? theirSaver : undefined;
  if (mySave && theirSave && mySave.hero.id !== theirSave.hero.id) {
    parts.push(
      `${mySave.hero.name} is the save on your side; ${theirSave.hero.name} is theirs — both actually clear a real saving bar, not a token 3 on the sheet.`,
    );
  } else if (mySave) {
    parts.push(`${mySave.hero.name} is the only one on the board who actually saves people at a real level.`);
  } else if (theirSave) {
    parts.push(`${theirSave.hero.name} is the save the opponent brought — your side doesn't have one at that level.`);
  }

  return parts.length > 0 ? parts.join(' ') : null;
}

function axisPictureLine(
  axisDeltas: BattleExplanationContext['axisDeltas'],
  mine: BattlePick[],
  opponent: BattlePick[],
): string | null {
  const leads = axisDeltas.filter((delta) => Math.abs(delta.delta) >= AXIS_DELTA_FLOOR).slice(0, 3);
  if (leads.length === 0) return null;

  const yours = leads.filter((delta) => delta.delta > 0);
  const theirs = leads.filter((delta) => delta.delta < 0);
  const named = (delta: (typeof leads)[number], side: BattlePick[]): string => {
    const hero = leaderOn(side, delta.axis);
    const label = AXIS_LABEL[delta.axis];
    return hero ? `${label} (${hero.hero.name})` : label;
  };

  if (yours.length > 0 && theirs.length > 0) {
    return `On the sheet, your draft leads in ${yours.map((d) => named(d, mine)).join(' and ')}; the hole is ${theirs.map((d) => named(d, opponent)).join(' and ')}.`;
  }
  if (yours.length > 0) {
    return `On the sheet, your draft's real pull is ${yours.map((d) => named(d, mine)).join(' and ')}.`;
  }
  return `On the sheet, the opponent's draft is the one leading in ${theirs.map((d) => named(d, opponent)).join(' and ')}.`;
}

function laneLine(lanes: BattleLaneResult[] | undefined): string | null {
  if (!lanes || lanes.length === 0) return null;
  const decided = lanes
    .filter((lane) => lane.winner !== 'even' && lane.topPair)
    .slice()
    .sort(
      (a, b) => Math.abs((b.topPair?.winRate ?? 0.5) - 0.5) - Math.abs((a.topPair?.winRate ?? 0.5) - 0.5),
    )
    .slice(0, 3);
  if (decided.length === 0) return null;

  const bits = decided.map((lane) => {
    const pair = lane.topPair!;
    const label = LANE_LABEL[lane.lane];
    const chance =
      lane.winRate === null
        ? null
        : lane.winner === 'opponent'
          ? pct(1 - lane.winRate)
          : pct(lane.winRate);
    const pairPct = pct(pair.winRate);
    if (lane.winner === 'mine') {
      return chance
        ? `your ${label} was a ${chance}% lean because ${pair.hero} into ${pair.vs} (${pairPct}%) is a real matchup`
        : `your ${label} leans this way because ${pair.hero} into ${pair.vs} is a real matchup edge`;
    }
    return chance
      ? `the ${label} went the other way — ${pair.hero} into ${pair.vs} is a ${pairPct}% hole from your side`
      : `the ${label} went the other way because ${pair.hero} into ${pair.vs} is a real matchup edge`;
  });

  if (bits.length === 1) return `Lanes weren't a wash: ${bits[0]}.`;
  return `Lanes weren't even. ${bits[0].charAt(0).toUpperCase()}${bits[0].slice(1)}; ${bits.slice(1).join('; ')}.`;
}

function catchAndComboLine(
  winners: Hero[],
  losers: Hero[],
  lookup: MatchupLookup,
  winnerLabel: string,
  loserLabel: string,
  lanePairKeys: Set<string>,
): string | null {
  const catches = topMatchups(winners, losers, lookup, 3).filter(
    (row) => !lanePairKeys.has(`${row.hero}|${row.vs}`),
  );
  const combo = usableCombo(bestSynergyPair(winners, lookup));
  const leftoverCombo = usableCombo(bestSynergyPair(losers, lookup));
  const parts: string[] = [];

  if (catches.length > 0) {
    const first = catches[0];
    parts.push(
      `The catch that actually matters for ${winnerLabel} is ${first.hero} into ${first.vs} (${pct(first.winRate)}%)`,
    );
    if (catches[1]) {
      parts.push(`${catches[1].hero} into ${catches[1].vs} (${pct(catches[1].winRate)}%) is a second real hole`);
    }
  }
  if (combo) {
    parts.push(
      `${combo.heroA} + ${combo.heroB} is a real pairing on the winning side (${pct(combo.winRate)}%) — not a vibe, a co-pick that actually wins games together`,
    );
  }
  if (
    leftoverCombo &&
    (!combo || leftoverCombo.heroA !== combo.heroA || leftoverCombo.heroB !== combo.heroB)
  ) {
    parts.push(
      `${loserLabel} still had ${leftoverCombo.heroA} + ${leftoverCombo.heroB} (${pct(leftoverCombo.winRate)}%) — a real combo that didn't carry the rest of the sheet`,
    );
  }

  if (parts.length === 0) return null;
  return `${parts.join('; ')}.`;
}

function carryLateLine(mine: BattlePick[], opponent: BattlePick[], lookup: MatchupLookup): string | null {
  const myCarry = pickByRole(mine, 'Carry');
  const theirCarry = pickByRole(opponent, 'Carry');
  if (!myCarry || !theirCarry) return null;
  const carryMatchup = lookup.getMatchupWinRate(myCarry.hero.id, theirCarry.hero.id);
  const myScale = axisOf(myCarry, 'scaling');
  const theirScale = axisOf(theirCarry, 'scaling');
  const scaleLeader =
    myScale !== theirScale ? (myScale > theirScale ? myCarry.hero.name : theirCarry.hero.name) : '';

  let matchupClause: string;
  if (carryMatchup === null) {
    matchupClause = `there isn't a real individual matchup row for ${myCarry.hero.name} into ${theirCarry.hero.name}`;
  } else if (carryMatchup > MATCHUP_FLOOR) {
    matchupClause = `${myCarry.hero.name} owns that matchup at ${pct(carryMatchup)}%`;
  } else if (carryMatchup < 1 - MATCHUP_FLOOR) {
    matchupClause = `${theirCarry.hero.name} owns that matchup at ${pct(1 - carryMatchup)}%`;
  } else {
    matchupClause = `the individual matchup is a coin flip (${pct(carryMatchup)}%)`;
  }

  let scaleClause = '';
  if (scaleLeader && carryMatchup !== null) {
    const matchupWinner =
      carryMatchup > MATCHUP_FLOOR
        ? myCarry.hero.name
        : carryMatchup < 1 - MATCHUP_FLOOR
          ? theirCarry.hero.name
          : '';
    if (matchupWinner && scaleLeader === matchupWinner) {
      scaleClause = ', and they scale harder on the sheet too';
    } else if (matchupWinner && scaleLeader !== matchupWinner) {
      scaleClause = `, but ${scaleLeader} is the one who actually scales harder — if this lives, that tension is the late game`;
    } else {
      scaleClause = `, and ${scaleLeader} is the one who scales harder`;
    }
  } else if (scaleLeader) {
    scaleClause = ` — ${scaleLeader} is still the one who scales harder on the sheet`;
  }

  return `Late, it's ${myCarry.hero.name} against ${theirCarry.hero.name}. ${matchupClause.charAt(0).toUpperCase()}${matchupClause.slice(1)}${scaleClause}.`;
}

function tagsLine(mine: BattlePick[], opponent: BattlePick[]): string | null {
  const mineTags = visibleTags(mine);
  const theirTags = visibleTags(opponent);
  if (mineTags.length === 0 && theirTags.length === 0) return null;
  if (mineTags.length > 0 && theirTags.length > 0) {
    return `On the board: your side is running ${joinNames(mineTags)}; theirs has ${joinNames(theirTags)}.`;
  }
  if (mineTags.length > 0) {
    return `On the board, your side is running ${joinNames(mineTags)} — that's a real draft mechanic, not flavor text.`;
  }
  return `On the board, the opponent is running ${joinNames(theirTags)} — that's a real draft mechanic, not flavor text.`;
}

function shutdownLine(mine: Hero[] | undefined, opponent: Hero[] | undefined): string | null {
  const myNames = (mine ?? []).map((hero) => hero.name);
  const theirNames = (opponent ?? []).map((hero) => hero.name);
  const parts: string[] = [];
  if (myNames.length > 0) {
    parts.push(
      `${joinNames(myNames)} ${myNames.length === 1 ? 'is' : 'are'} in shutdown into this lineup — every individual matchup sits below their own average`,
    );
  }
  if (theirNames.length > 0) {
    parts.push(
      `${joinNames(theirNames)} on the other side ${theirNames.length === 1 ? 'is' : 'are'} similarly boxed in`,
    );
  }
  if (parts.length === 0) return null;
  return `${parts.join('; ')}.`;
}

function hardCarryLine(countA: number | undefined, countB: number | undefined): string | null {
  const mine = countA ?? 0;
  const theirs = countB ?? 0;
  const parts: string[] = [];
  if (mine >= 3) {
    parts.push(
      `${mine === 3 ? 'Three' : String(mine)} hard-carries on your side is a farm-split the sheet already discounts — more late-game bodies, less of everything else`,
    );
  }
  if (theirs >= 3) {
    parts.push(
      `the opponent stacked ${theirs} hard-carries, same tax`,
    );
  }
  if (parts.length === 0) return null;
  return `${parts.join('; ')}.`;
}

function closingLine(
  advantageDirection: AdvantageDirection,
  resolvedOutcome: ResolvedOutcome,
): string {
  const favoredIsA = advantageDirection === 'A';
  const userWon = resolvedOutcome === 'Win';
  if (advantageDirection === 'Even') {
    return userWon
      ? 'Your draft came out on top in what was essentially a coin flip.'
      : 'Your draft came up just short in what was essentially a coin flip.';
  }
  if (favoredIsA) {
    return userWon
      ? 'That advantage held up.'
      : 'That advantage should have held up — this loss runs against the grain.';
  }
  return userWon
    ? "The opponent's edge should have held up — this win runs against the grain."
    : 'That edge held up here.';
}

function upsetReasonsLine(ctx: BattleExplanationContext, underdog: Hero[], favorite: Hero[]): string | null {
  const favoredIsA = ctx.advantageDirection === 'A';
  const underdogLabel = favoredIsA ? "opponent's draft" : 'your draft';
  const matchup = bestMatchupEdge(underdog, favorite, ctx.lookup);
  const synergy = bestSynergyPair(underdog, ctx.lookup);
  const underdogBestAxis = [...ctx.axisDeltas]
    .filter((delta) => (favoredIsA ? delta.delta < 0 : delta.delta > 0))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  const dataReasons: string[] = [];
  if (matchup) {
    dataReasons.push(
      `${matchup.hero}'s individual matchup into ${matchup.vs} favored ${underdogLabel} directly`,
    );
  }
  if (synergy) {
    dataReasons.push(
      `the ${synergy.heroA} + ${synergy.heroB} combination gave ${underdogLabel} a real, data-backed edge`,
    );
  }
  if (underdogBestAxis) {
    dataReasons.push(
      `${underdogLabel} actually led in ${AXIS_LABEL[underdogBestAxis.axis]} despite trailing on the overall picture`,
    );
  }

  if (dataReasons.length > 0) {
    const lead = ctx.highSkillSwingHero ? 'On top of that, ' : 'But ';
    return `${lead}${underdogLabel} had real advantages of its own — ${dataReasons.join('; ')} — enough to make this upset plausible even against a stronger overall draft.`;
  }
  if (!ctx.highSkillSwingHero) {
    return `Every draft carries some risk even in a clear matchup, and at ${ctx.confidenceTier} confidence the odds still had to break exactly right for ${underdogLabel} — this time they did.`;
  }
  return null;
}

export function buildExplanation(ctx: BattleExplanationContext): string[] {
  const mine = ctx.teamA;
  const opponent = ctx.teamB;
  const won = ctx.resolvedOutcome === 'Win';
  const winners = won ? mine : opponent;
  const losers = won ? opponent : mine;
  const winnerHeroes = heroesOf(winners);
  const loserHeroes = heroesOf(losers);
  const isUpset = isBattleUpset(ctx.advantageDirection, ctx.resolvedOutcome);
  const winnerLabel = won ? 'your draft' : 'the opponent';
  const loserLabel = won ? 'the opponent' : 'your draft';

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

  const lines: string[] = [frameLine(ctx)];

  if (ctx.highSkillSwingHero) {
    lines.push(highSkillLine(ctx.highSkillSwingHero));
  }

  const clock = clockLine(mine, opponent, winners);
  if (clock) lines.push(clock);

  const shape = fightShapeLine(mine, opponent);
  if (shape) lines.push(shape);

  const axes = axisPictureLine(ctx.axisDeltas, mine, opponent);
  if (axes) lines.push(axes);

  const lanes = laneLine(ctx.lanes);
  if (lanes) lines.push(lanes);

  const catchCombo = catchAndComboLine(
    winnerHeroes,
    loserHeroes,
    ctx.lookup,
    winnerLabel,
    loserLabel,
    lanePairKeys,
  );
  if (catchCombo) lines.push(catchCombo);

  const carry = carryLateLine(mine, opponent, ctx.lookup);
  if (carry) lines.push(carry);

  const tags = tagsLine(mine, opponent);
  if (tags) lines.push(tags);

  const shutdown = shutdownLine(ctx.shutdownHeroesA, ctx.shutdownHeroesB);
  if (shutdown) lines.push(shutdown);

  const stacked = hardCarryLine(
    ctx.hardCarryCountA ?? heroesOf(mine).filter(isHardCarry).length,
    ctx.hardCarryCountB ?? heroesOf(opponent).filter(isHardCarry).length,
  );
  if (stacked) lines.push(stacked);

  if (isUpset) {
    const favoredIsA = ctx.advantageDirection === 'A';
    const underdog = favoredIsA ? heroesOf(opponent) : heroesOf(mine);
    const favorite = favoredIsA ? heroesOf(mine) : heroesOf(opponent);
    const reasons = upsetReasonsLine(ctx, underdog, favorite);
    if (reasons) lines.push(reasons);
  } else {
    lines.push(closingLine(ctx.advantageDirection, ctx.resolvedOutcome));
  }

  return lines;
}
