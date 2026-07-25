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
const UNDERPERFORM_THRESHOLD = -0.045;
const DAMPENING_FACTOR = 0.5;

// Minimum edge before real data is treated as its own positive signal,
// independent of any tag match — small deltas are noise.
const REAL_SYNERGY_SIGNIFICANCE = 0.03;

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

// Real co-pick win rate minus the expected rate (average of each hero's own
// individual win rate) — positive means the pair overperforms what you'd
// predict from their solo strength alone, negative means it underperforms.
// Null when either side of the comparison lacks enough real data.
function realSynergyDelta(heroA: Hero, heroB: Hero, lookup: SynergyLookup): number | null {
  const actual = lookup.getSynergyWinRate(heroA.id, heroB.id);
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

      const finalScore = Math.min(10, Math.round(score * 10) / 10);
      explanation.push(SYNERGY_NARRATIVE[scoreBracket(finalScore)]);

      // Not axis-based (no evaluation_values score) — no percentile
      // distribution to rank against, see analyzer.interface.ts.
      return { score: finalScore, percentile: null, explanation };
    },
  };
}
