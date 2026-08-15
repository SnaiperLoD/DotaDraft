import type { Hero } from 'shared';
import type { Analyzer } from '../analyzer.interface';
import { SYNERGY_NARRATIVE, scoreBracket } from '../score-narrative';

export interface SynergyLookup {
  getSynergyWinRate(heroId: number, allyHeroId: number): number | null;
  getWinRate(heroId: number): number | null;
}

// Below this drop (real co-pick win rate vs. expected), a tag-matched pair's
// archetype signal is treated as contradicted by data, not confirmed by it —
// halved rather than zeroed, since a hand-authored tag can still be
// pointing at something real even when the numbers are softer than assumed.
const UNDERPERFORM_THRESHOLD = -0.048;
const DAMPENING_FACTOR = 0.5;

// Minimum edge before real data is treated as its own positive signal,
// independent of any tag match — small deltas are noise.
const REAL_SYNERGY_SIGNIFICANCE = 0.035;

interface TagPairRule {
  tagA: string;
  tagB: string;
  weight: number;
  describe(a: Hero, b: Hero): string;
}

// Grounded in the synergy_tags taxonomy from Blueprint/09-hero-knowledge-base.md.
const TAG_PAIR_RULES: TagPairRule[] = [
  {
    tagA: 'needs_setup',
    tagB: 'enables_engage',
    weight: 2.5,
    describe: (a, b) =>
      `${a.name} (needs setup) + ${b.name} (enables engage): initiation sets up pick-off/burst combos.`,
  },
  {
    tagA: 'needs_space',
    tagB: 'creates_space',
    weight: 2,
    describe: (a, b) => `${b.name} (creates space) supports ${a.name} (needs space) to scale safely.`,
  },
  {
    tagA: 'needs_space',
    tagB: 'protects_allies',
    weight: 1.5,
    describe: (a, b) => `${b.name} (protects allies) helps keep ${a.name} (needs space) alive while farming.`,
  },
  {
    tagA: 'enables_engage',
    tagB: 'amplifies_magic_damage',
    weight: 1.5,
    describe: (a, b) =>
      `${a.name} (enables engage) sets up ${b.name} (amplifies magic damage) for burst follow-up.`,
  },
  {
    tagA: 'enables_engage',
    tagB: 'amplifies_physical_damage',
    weight: 1.5,
    describe: (a, b) =>
      `${a.name} (enables engage) sets up ${b.name} (amplifies physical damage) for follow-up.`,
  },
  {
    tagA: 'wave_clear_support',
    tagB: 'needs_space',
    weight: 1.5,
    describe: (a, b) => `${a.name} (wave clear support) frees up lanes for ${b.name} (needs space) to scale.`,
  },
];

function findPair(heroes: Hero[], tagA: string, tagB: string): [Hero, Hero] | null {
  for (const a of heroes) {
    if (!a.synergy_tags.includes(tagA)) continue;
    for (const b of heroes) {
      if (a.id === b.id) continue;
      if (b.synergy_tags.includes(tagB)) return [a, b];
    }
  }
  return null;
}

// Game-plan conflict rules (user 2026-08-13): unlike TAG_PAIR_RULES (which read
// synergy_tags), these read the archetype `tags` field and SUBTRACT — two
// heroes whose win conditions pull the game in opposite directions (an early
// tempo/push win-condition tag vs a late-scaling one, e.g. Lycan + Medusa).
//
// EXPLICITLY a hand-authored heuristic layer, NOT real-data-validated: the
// classic conflict pairs (Lycan+Medusa) are so rarely co-drafted that they have
// no co-pick winrate at all, and the split_push×late_scaling tag pairing across
// the whole roster shows only a near-zero mean real delta (~-0.006, coin-flip) —
// so realSynergyDelta below cannot carry this signal, and this is the flavour/
// draft-literacy layer instead (same posture as custom-tags). Magnitudes
// eyeballed. May also fire on a legitimate pusher-support + late-carry combo —
// treated as a mild note there, which is defensible ("these want different game
// states"), not a hard error.
interface AntiSynergyRule {
  tagA: string;
  tagB: string;
  weight: number;
  describe(a: Hero, b: Hero): string;
}
const ANTI_SYNERGY_RULES: AntiSynergyRule[] = [
  {
    tagA: 'split_push',
    tagB: 'late_game_scaling',
    weight: 1.5,
    describe: (a, b) =>
      `${a.name} (split-push/tempo) wants to press the map and end early, while ${b.name} (late-game scaling) needs the game to go long — conflicting game plans.`,
  },
  {
    tagA: 'deathball',
    tagB: 'late_game_scaling',
    weight: 2,
    describe: (a, b) =>
      `${a.name} (deathball) is built to group and end fast, pulling against ${b.name} (late-game scaling), whose payoff is a farm-heavy late game — conflicting timings.`,
  },
];

// Same shape as findPair but reads the archetype `tags` field, and requires two
// DIFFERENT heroes (a hero that is both tagA and tagB doesn't conflict with
// itself).
function findArchetypePair(heroes: Hero[], tagA: string, tagB: string): [Hero, Hero] | null {
  for (const a of heroes) {
    if (!a.tags.includes(tagA)) continue;
    for (const b of heroes) {
      if (a.id === b.id) continue;
      if (b.tags.includes(tagB)) return [a, b];
    }
  }
  return null;
}

// Real co-pick win rate minus the expected rate (average of each hero's own
// individual win rate) — positive means the pair overperforms what you'd
// predict from their solo strength alone, negative means it underperforms.
// Null when either side of the comparison lacks enough real data. Exported
// for reuse by the live synergy-preview endpoint (HeroController,
// Blueprint/10-tech-debt-backlog.md "Живая подсветка синергичного пика") —
// same real-data formula, not a second hand-rolled copy of it.
//
// Checks both call directions on the lookup — hero-meta.json's per-hero
// `synergy` arrays are NOT symmetric (each hero's own list is whatever
// OpenDota returned for that specific hero query; Sven having a Lich entry
// doesn't guarantee Lich's own array lists Sven back). The underlying real
// games are the same regardless of which hero was queried, so falling back
// to the reverse direction when the forward one is missing is a genuine
// fix, not a new signal — found while building the synergy-preview
// endpoint, which hits this gap far more often than the 5-drafted-heroes
// case this function was originally written for (many more possible pairs
// once any of 127 pool candidates count, not just 10 pairs among 5 picks).
export function realSynergyDelta(heroA: Hero, heroB: Hero, lookup: SynergyLookup): number | null {
  const actual = lookup.getSynergyWinRate(heroA.id, heroB.id) ?? lookup.getSynergyWinRate(heroB.id, heroA.id);
  if (actual === null) return null;
  const winRateA = lookup.getWinRate(heroA.id);
  const winRateB = lookup.getWinRate(heroB.id);
  if (winRateA === null || winRateB === null) return null;
  return actual - (winRateA + winRateB) / 2;
}

function bestRealSynergyPair(
  heroes: Hero[],
  lookup: SynergyLookup,
): { heroA: Hero; heroB: Hero; delta: number } | null {
  let best: { heroA: Hero; heroB: Hero; delta: number } | null = null;
  for (let i = 0; i < heroes.length; i++) {
    for (let j = i + 1; j < heroes.length; j++) {
      const delta = realSynergyDelta(heroes[i], heroes[j], lookup);
      if (delta !== null && (!best || delta > best.delta)) {
        best = { heroA: heroes[i], heroB: heroes[j], delta };
      }
    }
  }
  return best;
}

// Symmetric to bestRealSynergyPair — by direct user request
// (Blueprint/10-tech-debt-backlog.md, "Показать худшую синергию в Synergy
// (Evaluation)"): the panel already surfaced the team's strongest real-data
// pairing but not its weakest, even though the same co-pick data trivially
// supports both directions.
function worstRealSynergyPair(
  heroes: Hero[],
  lookup: SynergyLookup,
): { heroA: Hero; heroB: Hero; delta: number } | null {
  let worst: { heroA: Hero; heroB: Hero; delta: number } | null = null;
  for (let i = 0; i < heroes.length; i++) {
    for (let j = i + 1; j < heroes.length; j++) {
      const delta = realSynergyDelta(heroes[i], heroes[j], lookup);
      if (delta !== null && (!worst || delta < worst.delta)) {
        worst = { heroA: heroes[i], heroB: heroes[j], delta };
      }
    }
  }
  return worst;
}

// Real co-pick win rate (Blueprint/06-battle-engine.md's data, already used
// by Battle Engine) as an equal signal alongside the hand-authored tag
// pairs, per the Milestone-6-adjacent design agreed for this analyzer —
// not a fallback for when tags are absent, and not purely a dampener:
// data can confirm a tag pairing, contradict it (dampens that pair's
// weight), or surface a genuine synergy the tag taxonomy never captured.
export function createSynergyAnalyzer(lookup: SynergyLookup): Analyzer {
  return {
    key: 'synergy',
    label: 'Synergy',
    analyze(picks) {
      const heroes = picks.map((p) => p.hero);
      let score = 0;
      const explanation: string[] = [];

      for (const rule of TAG_PAIR_RULES) {
        const pair = findPair(heroes, rule.tagA, rule.tagB);
        if (!pair) continue;

        const delta = realSynergyDelta(pair[0], pair[1], lookup);
        const dampened = delta !== null && delta <= UNDERPERFORM_THRESHOLD;
        const weight = dampened ? rule.weight * DAMPENING_FACTOR : rule.weight;

        score += weight;
        explanation.push(
          dampened
            ? `${rule.describe(pair[0], pair[1])} (real data shows this pairing underperforms expectations, weighted down)`
            : rule.describe(pair[0], pair[1]),
        );
      }

      const realPair = bestRealSynergyPair(heroes, lookup);
      if (realPair && realPair.delta >= REAL_SYNERGY_SIGNIFICANCE) {
        const bonus = Math.min(3, realPair.delta * 15);
        score += bonus;
        explanation.push(
          `${realPair.heroA.name} + ${realPair.heroB.name} have a strong real win rate together — ` +
            `outperforming what their individual strength alone would predict.`,
        );
      }

      // Game-plan conflicts (archetype tags) — surfaced even when the pair has
      // no co-pick data at all (the common case for these, see ANTI_SYNERGY_RULES).
      for (const rule of ANTI_SYNERGY_RULES) {
        const pair = findArchetypePair(heroes, rule.tagA, rule.tagB);
        if (!pair) continue;
        score -= rule.weight;
        explanation.push(rule.describe(pair[0], pair[1]));
      }

      // Worst real-data pair: now SHOWN whenever it's genuinely negative (user:
      // "I didn't see bad pairs displayed" — the old code only surfaced it above
      // the -0.035 significance line, which a measured 5000-draft check found
      // fires in just ~37% of drafts). The SCORE penalty still only applies at
      // the significance threshold; a marginally-negative pair is reported but
      // not punished.
      const worstPair = worstRealSynergyPair(heroes, lookup);
      if (worstPair && worstPair.delta < 0) {
        if (worstPair.delta <= -REAL_SYNERGY_SIGNIFICANCE) {
          score -= Math.min(3, Math.abs(worstPair.delta) * 15);
        }
        explanation.push(
          `${worstPair.heroA.name} + ${worstPair.heroB.name} have a below-average real win rate together — ` +
            `underperforming what their individual strength alone would predict.`,
        );
      }

      const highMobilityHeroes = heroes.filter((h) => h.evaluation_values.mobility >= 5);
      if (highMobilityHeroes.length >= 2) {
        score += 1;
        explanation.push(
          `Multiple high-mobility heroes (${highMobilityHeroes.map((h) => h.name).join(', ')}) enable pick-off plays.`,
        );
      }

      const teamfightHeroes = heroes.filter((h) => h.tags.includes('teamfight'));
      if (teamfightHeroes.length >= 3) {
        score += 1;
        explanation.push(`Strong teamfight-oriented core (${teamfightHeroes.map((h) => h.name).join(', ')}).`);
      }

      if (explanation.length === 0) {
        explanation.push('No strong hero-to-hero synergies detected in this composition.');
      }

      // Floor added alongside the worst-pair penalty above — score had no
      // lower bound before because nothing in this analyzer could push it
      // below 0 (every other term is additive-only).
      const finalScore = Math.max(0, Math.min(10, Math.round(score * 10) / 10));
      explanation.push(SYNERGY_NARRATIVE[scoreBracket(finalScore)]);

      // Not axis-based (no evaluation_values score) — no percentile
      // distribution to rank against, see analyzer.interface.ts.
      return { score: finalScore, percentile: null, explanation };
    },
  };
}
