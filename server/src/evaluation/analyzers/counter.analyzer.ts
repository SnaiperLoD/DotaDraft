import type { Analyzer } from '../analyzer.interface';
import { COUNTER_NARRATIVE, scoreBracket } from '../score-narrative';

// The full counter_tags taxonomy from Blueprint/09-hero-knowledge-base.md.
const THREAT_CATEGORIES = [
  'counters_illusions',
  'counters_summons',
  'counters_invisibility',
  'counters_channeled_ultimates',
  'counters_low_mobility',
  'counters_high_mobility',
  'counters_squishy_backline',
  'counters_mana_reliant',
  'counters_tanky_durable',
];

// A 5-hero draft realistically covers a handful of categories; treat 6/9 as full breadth.
const FULL_COVERAGE_THRESHOLD = 6;

function humanize(tag: string): string {
  return tag.replace('counters_', '').replace(/_/g, ' ');
}

export const counterAnalyzer: Analyzer = {
  key: 'counter',
  label: 'Counter',
  analyze(picks) {
    const heroes = picks.map((p) => p.hero);
    const coverage = THREAT_CATEGORIES.map((tag) => ({
      tag,
      heroes: heroes.filter((h) => h.counter_tags.includes(tag)),
    })).filter((c) => c.heroes.length > 0);

    const score = Math.round(Math.min(10, (coverage.length / FULL_COVERAGE_THRESHOLD) * 10) * 10) / 10;

    const explanation =
      coverage.length > 0
        ? coverage.map((c) => `Counters ${humanize(c.tag)}: ${c.heroes.map((h) => h.name).join(', ')}.`)
        : [
            'This draft has no specialized counters against common threat types (illusions, summons, invisibility, etc.).',
          ];
    explanation.push(COUNTER_NARRATIVE[scoreBracket(score)]);

    return { score, explanation };
  },
};
