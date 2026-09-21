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
import { HUNT_FLOOR, INITIATING_FLOOR, SAVING_FLOOR, axisOf, isBattleUpset, maxByAxes } from './battle-cast';

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

function heroFactLine(mine: BattlePick[], opponent: BattlePick[]): LocalizedLine | null {
  const mySaver = maxByAxes(mine, 'saving');
  const theirSaver = maxByAxes(opponent, 'saving');
  const mySave = mySaver && axisOf(mySaver, 'saving') >= SAVING_FLOOR ? mySaver : undefined;
  const theirSave = theirSaver && axisOf(theirSaver, 'saving') >= SAVING_FLOOR ? theirSaver : undefined;
  if (mySave && theirSave && mySave.hero.id !== theirSave.hero.id) {
    return i18nLine('battle.explain.shape.savesBoth', {
      mine: mySave.hero.name,
      theirs: theirSave.hero.name,
    });
  }
  if (mySave) return i18nLine('battle.explain.shape.saveMine', { hero: mySave.hero.name });
  if (theirSave) return i18nLine('battle.explain.shape.saveOpp', { hero: theirSave.hero.name });

  const myDriver = maxByAxes(mine, 'initiating');
  const theirDriver = maxByAxes(opponent, 'initiating');
  const myInit = myDriver ? axisOf(myDriver, 'initiating') : 0;
  const theirInit = theirDriver ? axisOf(theirDriver, 'initiating') : 0;
  if (
    myDriver &&
    theirDriver &&
    myDriver.hero.id !== theirDriver.hero.id &&
    myInit >= INITIATING_FLOOR &&
    theirInit >= INITIATING_FLOOR
  ) {
    return i18nLine('battle.explain.shape.duel', { mine: myDriver.hero.name, theirs: theirDriver.hero.name });
  }
  if (myDriver && myInit >= INITIATING_FLOOR) {
    return i18nLine('battle.explain.shape.mineStarts', { hero: myDriver.hero.name });
  }
  if (theirDriver && theirInit >= INITIATING_FLOOR) {
    return i18nLine('battle.explain.shape.oppStarts', { hero: theirDriver.hero.name });
  }
  return null;
}

/** A lane score within 3.5pp of 50% reads as even on the card. */
const LANE_COPY_EVEN_SPREAD_PP = 3.5;

function isLaneCopyEven(lane: BattleLaneResult): boolean {
  if (lane.winRate === null) return false;
  return Math.abs(lane.winRate - 0.5) * 100 <= LANE_COPY_EVEN_SPREAD_PP + 1e-9;
}

function laneLines(lanes: BattleLaneResult[] | undefined): LocalizedLine[] {
  if (!lanes || lanes.length === 0) return [];
  const numeric = lanes.filter((lane) => lane.winRate !== null);
  const allNumericEven = numeric.length > 0 && numeric.every(isLaneCopyEven);
  const decided = lanes
    .filter((lane) => lane.winner !== 'even' && lane.topPair && !isLaneCopyEven(lane))
    .slice()
    .sort(
      (a, b) => Math.abs((b.topPair?.winRate ?? 0.5) - 0.5) - Math.abs((a.topPair?.winRate ?? 0.5) - 0.5),
    );
  if (allNumericEven && decided.length === 0) {
    return [i18nLine('battle.explain.lanes.even')];
  }
  const lane = decided[0];
  if (!lane?.topPair) return [];

  const pair = lane.topPair;
  const chance =
    lane.winRate === null ? '' : lane.winner === 'opponent' ? pct(1 - lane.winRate) : pct(lane.winRate);
  const params: Record<string, string> = {
    lane: lane.lane,
    hero: pair.hero,
    vs: pair.vs,
    pairPct: pct(pair.winRate),
  };
  if (chance) params.chance = chance;
  const hunt = pair.winRate >= HUNT_FLOOR;
  if (lane.winner === 'mine') {
    if (hunt) return [i18nLine('battle.explain.lane.mineHunt', params)];
    return [i18nLine(chance ? 'battle.explain.lane.mineLean' : 'battle.explain.lane.mineEdge', params)];
  }
  if (hunt) return [i18nLine('battle.explain.lane.oppHunt', params)];
  return [i18nLine(chance ? 'battle.explain.lane.oppHole' : 'battle.explain.lane.oppEdge', params)];
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
  const isUpset = isBattleUpset(ctx.advantageDirection, ctx.resolvedOutcome);

  const lines: LocalizedLine[] = [frameLine(ctx)];

  if (ctx.highSkillSwingHero) {
    lines.push(i18nLine('battle.explain.highSkill', { hero: ctx.highSkillSwingHero.name }));
  }

  const heroFact = heroFactLine(mine, opponent);
  if (heroFact) lines.push(heroFact);

  lines.push(...laneLines(ctx.lanes));

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
