import type { Hero } from 'shared';
import type { Analyzer } from '../analyzer.interface';
import { SYNERGY_NARRATIVE, scoreBracket } from '../score-narrative';

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

export const synergyAnalyzer: Analyzer = {
  key: 'synergy',
  label: 'Synergy',
  analyze(heroes: Hero[]) {
    let score = 0;
    const explanation: string[] = [];

    for (const rule of TAG_PAIR_RULES) {
      const pair = findPair(heroes, rule.tagA, rule.tagB);
      if (pair) {
        score += rule.weight;
        explanation.push(rule.describe(pair[0], pair[1]));
      }
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

    return { score: finalScore, explanation };
  },
};
