export type ScoreBracket = 'low' | 'mid' | 'high';

// The axis-narrative bracket adds two EXTREME bands on top of the 3-value
// ScoreBracket: a draft below the 10th percentile on an axis, or above the
// 90th, gets a distinctly more critical / more emphatic description than a
// merely low/high one (user request, 2026-08-13). Kept SEPARATE from
// ScoreBracket on purpose — evaluation.service.ts's win-condition summary
// branches on `tempoBracket === 'high'` etc., and must keep seeing the 3-value
// bracket, so percentileBracket() below is unchanged and only the axis
// narrative (axis.analyzer.ts) switches to this 5-value one.
export type AxisBracket = 'veryLow' | 'low' | 'mid' | 'high' | 'veryHigh';

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

// 5-value variant for axis descriptions: the extreme <10 / >90 bands read as a
// serious weakness / defining strength (see percentileClause). The inner
// 30/70 boundaries match percentileBracket so mid/low/high stay consistent
// between the summary logic and the narrative.
export function axisNarrativeBracket(percentile: number): AxisBracket {
  if (percentile < 10) return 'veryLow';
  if (percentile < 30) return 'low';
  if (percentile < 70) return 'mid';
  if (percentile < 90) return 'high';
  return 'veryHigh';
}

export interface Contributor {
  name: string;
  value: number;
}

export interface NarrativeContext {
  percentile: number;
  bracket: AxisBracket;
  top: Contributor[];
}

function percentileClause(label: string, ctx: NarrativeContext): string {
  const { percentile, bracket } = ctx;
  const l = label.toLowerCase();
  // The extreme bands get a deliberately stronger frame — a >90th-percentile
  // axis is called out as a defining strength, a <10th as a serious weakness —
  // which is what makes the whole description read more positive/critical at
  // the tails (user request); the tactical body reused from high/low stays the
  // same underneath.
  if (bracket === 'veryHigh')
    return `ranks in the top ${Math.max(1, 100 - percentile)}% of all drafts for ${l} — one of this draft's defining strengths`;
  if (bracket === 'high') return `ranks in the top ${Math.max(1, 100 - percentile)}% of drafts for ${l}`;
  if (bracket === 'veryLow')
    return `ranks in the bottom ${Math.max(1, percentile)}% of all drafts for ${l} — one of this draft's most serious weaknesses`;
  if (bracket === 'low') return `ranks in the bottom ${Math.max(1, percentile)}% of drafts for ${l}`;
  return `sits close to the median for ${l} (${percentile}th percentile)`;
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
// Authored with the three core brackets; the two extreme bands (veryLow/
// veryHigh) reuse the low/high tactical body — the extra emphasis lives in
// percentileClause's lede, not in a separate paragraph (see withExtremes).
type BaseNarrativeSet = { low: NarrativeFn; mid: NarrativeFn; high: NarrativeFn };
type NarrativeSet = Record<AxisBracket, NarrativeFn>;
// Synergy/Counter aren't axis-based (no evaluation_values score, so no
// percentile distribution from compute-axis-percentiles.ts to rank
// against) — kept on the older flat-string-per-bracket shape rather than
// the percentile-aware NarrativeFn the 13 axes below use. Still the 3-value
// ScoreBracket (they use scoreBracket(), not the percentile axis path).
type StaticNarrativeSet = Record<ScoreBracket, string>;

const AXIS_NARRATIVE_BASE: Record<string, BaseNarrativeSet> = {
  // Labeled "Damage Output" as of 2026-07-25 (Blueprint/10-tech-debt-backlog.md,
  // "Teamfight axis misnamed") — the underlying signal is real
  // hero_damage_per_min (personal damage dealt), not overall fight-winning
  // potential. Control-heavy initiators (Magnus/Crystal Maiden/Tidehunter)
  // score low here despite being the exact kind of hero a player calls
  // "great in teamfights" — that strength shows up in control/initiating
  // instead. Label-only rename ("пока", provisional) — key stays
  // `teamfight` (HeroEvaluationValues, evaluation_values on all 127 heroes,
  // AXES arrays) since that's a much larger, more invasive rename to
  // revisit separately if this sticks.
  teamfight: {
    high: (ctx) => `${lede('Damage Output', ctx)} Expect this team to look for 5v5 fights around Roshan, high ground, and objective clusters rather than split-pushing.`,
    mid: (ctx) => `${lede('Damage Output', ctx)} It can hold its own in an even fight but shouldn't force a 5-man engagement blindly.`,
    low: (ctx) => `${lede('Damage Output', ctx)} Avoid grouping for even fights — pick-offs, split pushes, and disengaging from bad fights are the safer path here.`,
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
  resource_efficiency: {
    high: (ctx) => `${lede('Resource efficiency', ctx)} This team deals real damage without needing a large share of the team's gold to do it — priority farm can go to whichever hero needs it most instead of being locked to whoever hits hardest.`,
    mid: (ctx) => `${lede('Resource efficiency', ctx)} Damage output is reasonably proportionate to farm priority — no strong efficiency edge either way.`,
    low: (ctx) => `${lede('Resource efficiency', ctx)} This team's damage is expensive — it depends on a hero (or heroes) getting a large share of the team's resources first, so a slow start or contested farm hits harder here than for a more efficient draft.`,
  },
};

// veryLow/veryHigh reuse the low/high tactical advice — the tail emphasis comes
// from percentileClause's stronger lede (a defining strength / a serious
// weakness), so a >90th or <10th axis reads more positive/critical without a
// separately authored paragraph per axis. Swap an entry's veryLow/veryHigh for
// bespoke copy here if a given axis ever needs it.
function withExtremes(set: BaseNarrativeSet): NarrativeSet {
  return { veryLow: set.low, low: set.low, mid: set.mid, high: set.high, veryHigh: set.high };
}

export const AXIS_NARRATIVE: Record<string, NarrativeSet> = Object.fromEntries(
  Object.entries(AXIS_NARRATIVE_BASE).map(([key, set]) => [key, withExtremes(set)]),
);

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
