import { i18nLine } from 'shared';
import type { LocalizedLine } from 'shared';
import type { Analyzer } from '../analyzer.interface';
import { scoreBracket } from '../score-narrative';

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

    const explanation: LocalizedLine[] =
      coverage.length > 0
        ? coverage.map((c) =>
            i18nLine('eval.counter.covers', {
              threat: c.tag.replace(/^counters_/, ''),
              heroes: c.heroes.map((h) => h.name).join(', '),
            }),
          )
        : [i18nLine('eval.counter.none')];
    explanation.push(i18nLine(`eval.counter.summary.${scoreBracket(score)}`));

    // Not axis-based (no evaluation_values score) — no percentile
    // distribution to rank against, see analyzer.interface.ts.
    return { score, percentile: null, explanation };
  },
};
