import * as fs from 'fs';
import * as path from 'path';

// Rolls up the per-ability hand tags (hero-abilities.json's categoryScores,
// filled in via export/import-ability-tagging.ts) into one raw number per
// hero per category — the input calibrate-evaluation-values.ts scales with
// zScoreExtremityScale and blends into evaluation_values, same two-stage
// pattern every other raw research-*.json input already follows here.
//
// Aggregation is a straight sum across a hero's abilities, not an average:
// an ability that was never scored contributes 0 rather than diluting a
// hero's total the way an average over all-abilities-including-irrelevant-
// ones would. This is deliberate (see the conversation that led here) — a
// hero with one standout ability shouldn't lose to population noise, and a
// hero with several good ones in the same category should be credited for
// kit depth rather than capped at their single best ability.
const HERO_ABILITIES_PATH = path.join(__dirname, '..', 'data', 'hero-abilities.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'ability-tag-aggregates.json');

const CATEGORIES = ['mobility', 'saving', 'initiating', 'control_strength'] as const;

interface AbilityRecord {
  abilityKey: string;
  categoryScores: Record<string, number>;
}

interface HeroAbilitiesFile {
  heroId: number;
  heroName: string;
  abilities: AbilityRecord[];
}

interface HeroAggregate {
  heroId: number;
  heroName: string;
  mobility: number;
  saving: number;
  initiating: number;
  control_strength: number;
}

function main() {
  const heroes: HeroAbilitiesFile[] = JSON.parse(fs.readFileSync(HERO_ABILITIES_PATH, 'utf-8'));

  const aggregates: HeroAggregate[] = heroes.map((hero) => {
    const sums = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
      (typeof CATEGORIES)[number],
      number
    >;
    for (const ability of hero.abilities) {
      for (const cat of CATEGORIES) {
        sums[cat] += ability.categoryScores[cat] ?? 0;
      }
    }
    return {
      heroId: hero.heroId,
      heroName: hero.heroName,
      mobility: Math.round(sums.mobility * 10) / 10,
      saving: Math.round(sums.saving * 10) / 10,
      initiating: Math.round(sums.initiating * 10) / 10,
      control_strength: Math.round(sums.control_strength * 10) / 10,
    };
  });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(aggregates, null, 2) + '\n');

  console.log(`Aggregated ${aggregates.length} heroes to ${OUTPUT_PATH}.`);
  for (const cat of CATEGORIES) {
    const values = aggregates.map((a) => a[cat]).filter((v) => v > 0);
    const max = Math.max(...values, 0);
    const top = aggregates.slice().sort((a, b) => b[cat] - a[cat])[0];
    console.log(
      `  ${cat}: ${values.length}/${aggregates.length} heroes with a nonzero sum, max=${max} (${top.heroName})`,
    );
  }
}

main();
