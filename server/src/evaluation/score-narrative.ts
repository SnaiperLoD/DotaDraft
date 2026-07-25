export type ScoreBracket = 'low' | 'mid' | 'high';

// Percentile-driven, not a fixed 0-10 cutoff — "average" means "near the
// middle of how 10000 random 5-hero teams score on this specific axis"
// (server/data/axis-percentile-distributions.json), not a fixed number on
// the scale. Some axes (saving) cluster much lower by nature than others
// (durability), so a flat "7+ is high" threshold would call a genuinely
// above-average saving draft "mediocre" just because the axis itself
// rarely reaches 7. 30/70 split leaves a real 40-percentile-point "average"
// band in the middle rather than a razor's-edge midpoint.
export function percentileBracket(percentile: number): ScoreBracket {
  if (percentile < 30) return 'low';
  if (percentile < 70) return 'mid';
  return 'high';
}

export interface Contributor {
  name: string;
  value: number;
}

export interface NarrativeContext {
  percentile: number;
  bracket: ScoreBracket;
  top: Contributor[];
}

function percentileClause(label: string, ctx: NarrativeContext): string {
  const { percentile, bracket } = ctx;
  if (bracket === 'high') return `ranks in the top ${Math.max(1, 100 - percentile)}% of drafts for ${label.toLowerCase()}`;
  if (bracket === 'low') return `ranks in the bottom ${Math.max(1, percentile)}% of drafts for ${label.toLowerCase()}`;
  return `sits close to the median for ${label.toLowerCase()} (${percentile}th percentile)`;
}

function contributorClause(ctx: NarrativeContext): string {
  const { top } = ctx;
  if (top.length === 0) return '';
  if (top.length === 1) return `, carried by ${top[0].name}`;
  return `, led by ${top[0].name} and ${top[1].name}`;
}

function lede(label: string, ctx: NarrativeContext): string {
  return `This draft ${percentileClause(label, ctx)}${contributorClause(ctx)}.`;
}

type NarrativeFn = (ctx: NarrativeContext) => string;
type NarrativeSet = Record<ScoreBracket, NarrativeFn>;
// Synergy/Counter aren't axis-based (no evaluation_values score, so no
// percentile distribution from compute-axis-percentiles.ts to rank
// against) — kept on the older flat-string-per-bracket shape rather than
// the percentile-aware NarrativeFn the 13 axes below use.
type StaticNarrativeSet = Record<ScoreBracket, string>;

export const AXIS_NARRATIVE: Record<string, NarrativeSet> = {
  teamfight: {
    high: (ctx) => `${lede('Teamfight', ctx)} Expect this team to look for 5v5 fights around Roshan, high ground, and objective clusters rather than split-pushing.`,
    mid: (ctx) => `${lede('Teamfight', ctx)} It can hold its own in an even fight but shouldn't force a 5-man engagement blindly.`,
    low: (ctx) => `${lede('Teamfight', ctx)} Avoid grouping for even fights — pick-offs, split pushes, and disengaging from bad fights are the safer path here.`,
  },
  tempo: {
    high: (ctx) => `${lede('Tempo', ctx)} This is a fast-start draft that wants to contest the first Rune, force early lane swaps, and close the game before the 25-minute mark — real match data shows drafts like this see their win rate fall the longer the game runs.`,
    mid: (ctx) => `${lede('Tempo', ctx)} It can play either an early skirmish game or settle into a patient one depending on how the laning stage goes.`,
    low: (ctx) => `${lede('Tempo', ctx)} Avoid forcing early confrontations — this team wants to reach the 30+ minute mark, where real match data shows drafts like this actually turn their win rate around.`,
  },
  scaling: {
    high: (ctx) => `${lede('Scaling', ctx)} This team gets meaningfully stronger every ten minutes it survives — real match data shows drafts like this often start behind on win rate before 25 minutes and pull ahead past 40, so the priority is farming safely and denying Roshan/high-ground pushes rather than forcing action early.`,
    mid: (ctx) => `${lede('Scaling', ctx)} It scales reasonably but isn't a guaranteed late-game powerhouse — neither rushing nor stalling the game is a clear win condition on its own.`,
    low: (ctx) => `${lede('Scaling', ctx)} This team doesn't get much stronger with time and should look to end the game early — real match data shows the win-rate gap for drafts like this tends to widen the longer the game goes.`,
  },
  mobility: {
    high: (ctx) => `${lede('Mobility', ctx)} High mobility lets this team roam between lanes, collapse on isolated targets, and reposition out of bad fights quickly.`,
    mid: (ctx) => `${lede('Mobility', ctx)} It has some mobility tools but isn't especially map-mobile — rotations will be telegraphed.`,
    low: (ctx) => `${lede('Mobility', ctx)} Low mobility makes this team vulnerable to being caught out of position and slow to answer ganks on other lanes.`,
  },
  map_control: {
    high: (ctx) => `${lede('Map control', ctx)} Strong warding and roaming presence should let this team see enemy rotations coming and set up their own ganks on the river and jungle entrances.`,
    mid: (ctx) => `${lede('Map control', ctx)} Vision is about average — standard warding discipline on the high-ground cliffs will be needed to avoid getting caught.`,
    low: (ctx) => `${lede('Map control', ctx)} Weak map control leaves this team blind to rotations — expect to get ganked in lane more than a typical draft.`,
  },
  objectives: {
    high: (ctx) => `${lede('Objectives', ctx)} This team pushes towers and barracks efficiently and should look to close games through map pressure rather than waiting for a decisive teamfight.`,
    mid: (ctx) => `${lede('Objectives', ctx)} It can take a tower when the opportunity is there but isn't built to siege on its own.`,
    low: (ctx) => `${lede('Objectives', ctx)} Weak at taking structures — this team should convert kills into picks rather than trying to push lanes after a fight.`,
  },
  saving: {
    high: (ctx) => `${lede('Saving', ctx)} Strong healing and defensive tools should keep the team's priority targets alive through a bad initiation.`,
    mid: (ctx) => `${lede('Saving', ctx)} Some saving tools are available, but this team can't bail out every bad engagement — good positioning matters more than usual.`,
    low: (ctx) => `${lede('Saving', ctx)} Little in the way of healing or defensive cooldowns — a bad engagement or a blink initiation onto a core is likely to end in a death.`,
  },
  burst: {
    high: (ctx) => `${lede('Burst', ctx)} This team can delete a priority target out of a fog-of-war initiation — a clean pick-off window is often lethal.`,
    mid: (ctx) => `${lede('Burst', ctx)} Some burst potential is there, but this team can't reliably one-shot a priority target through defensive items.`,
    low: (ctx) => `${lede('Burst', ctx)} Low burst damage means this team relies on sustained fighting and kiting rather than quick kills — expect longer fights.`,
  },
  control: {
    high: (ctx) => `${lede('Control', ctx)} Heavy disable chains let this team lock down a target through Black King Bar and dictate exactly when fights happen.`,
    mid: (ctx) => `${lede('Control', ctx)} Some disable is available, but not enough to fully control a fight on its own — timing initiations around cooldowns matters.`,
    low: (ctx) => `${lede('Control', ctx)} Light on disables — this team will struggle to lock down mobile or spell-immune targets and may lose fights to a clean BKB play.`,
  },
  durability: {
    high: (ctx) => `${lede('Durability', ctx)} This team is tanky and hard to burst down, and can afford to front-line and body-block for the rest of the team in fights.`,
    mid: (ctx) => `${lede('Durability', ctx)} Moderate durability — this team can still be burst down by a focused-fire initiation.`,
    low: (ctx) => `${lede('Durability', ctx)} Fragile and vulnerable to burst — bad positioning near the enemy's initiators is likely to get someone deleted.`,
  },
  initiating: {
    high: (ctx) => `${lede('Initiating', ctx)} Strong initiation tools let this team pick exactly when and where a fight starts, catching the enemy team out of position on rotations.`,
    mid: (ctx) => `${lede('Initiating', ctx)} It can start some fights on its own terms, but lacks a single dedicated initiation threat to build a play around.`,
    low: (ctx) => `${lede('Initiating', ctx)} Weak initiation means this team will usually be reacting to the enemy's engage rather than dictating the fight themselves.`,
  },
  skirmish_rate: {
    high: (ctx) => `${lede('Skirmish rate', ctx)} This team leans into risk — trading and dying for river/jungle skirmishes rather than playing it safe, which real match data links to a better actual win rate than a pure stat sheet would suggest.`,
    mid: (ctx) => `${lede('Skirmish rate', ctx)} A moderate risk appetite — not purely passive, but not built around constant early trades either.`,
    low: (ctx) => `${lede('Skirmish rate', ctx)} This team plays it safe and prioritizes efficient farm over trades — real data suggests that safety can come at the cost of actually winning.`,
  },
  camp_stacking: {
    high: (ctx) => `${lede('Camp stacking', ctx)} This team stacks jungle camps for each other — a supportive, resource-sharing playstyle real data links to a better actual win rate than a pure stat sheet would suggest.`,
    mid: (ctx) => `${lede('Camp stacking', ctx)} Camps get stacked occasionally, without a game plan built around it.`,
    low: (ctx) => `${lede('Camp stacking', ctx)} This team doesn't stack camps for each other — not necessarily a problem (efficient personal farmers score low here too), but the team isn't generating this kind of shared resource.`,
  },
};

export const SYNERGY_NARRATIVE: StaticNarrativeSet = {
  high: "This is a well-connected draft — the heroes' kits actively support one another.",
  mid: "This draft has some hero synergy, but the picks don't form a tightly connected game plan.",
  low: "This draft is fairly disconnected — the heroes don't strongly support each other's game plans.",
};

export const COUNTER_NARRATIVE: StaticNarrativeSet = {
  high: 'This team is well-equipped to answer a wide range of common threats.',
  mid: 'This team covers some common threats but has notable gaps.',
  low: 'This team has little in the way of specialized counters and may struggle against common threats like illusions or invisibility.',
};

// scoreBracket kept for Synergy/Counter's plain-score usage — the 13
// axes below use percentileBracket() instead (see axis.analyzer.ts).
export function scoreBracket(score: number): ScoreBracket {
  if (score < 4) return 'low';
  if (score < 7) return 'mid';
  return 'high';
}
