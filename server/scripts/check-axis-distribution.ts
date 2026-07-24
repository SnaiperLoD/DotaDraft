import * as fs from 'fs';
import * as path from 'path';

// Research/backlog item (Blueprint/10-tech-debt-backlog.md, Research section):
// "Проверить, не занижены ли teamfight/scaling/mobility/map_control систематически".
// Two samples per axis:
//   1. RANDOM  — ~100 random 5-hero lineups, team score = avg(hero axis value).
//   2. MAXED   — ~100 lineups drawn from the top-20 heroes on that axis, to see
//      how close to the 0-10 ceiling a genuinely min-maxed draft actually lands.
// Reports mean/stdev/min/max plus skewness/excess kurtosis (0 = normal) for
// both samples, across all 10 evaluation_values axes (not just the 7 currently
// surfaced as breakdown analyzers — control/durability/burst are calibrated
// and worth checking now since they're the Role-fit regression target next).
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');

interface RawHero {
  id: number;
  name: string;
  evaluation_values: Record<string, number>;
}

const AXES = [
  'teamfight',
  'tempo',
  'scaling',
  'mobility',
  'objectives',
  'control',
  'durability',
  'burst',
  'map_control',
  'saving',
  'initiating',
  'aggression',
  'farm_priority',
] as const;

const SAMPLE_SIZE = 100;
const LINEUP_SIZE = 5;
const MAXED_POOL_SIZE = 20;

function loadHeroes(): RawHero[] {
  return JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8')) as RawHero[];
}

function sampleLineup(pool: RawHero[], size: number): RawHero[] {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, size);
}

function axisAverage(lineup: RawHero[], axis: string): number {
  return lineup.reduce((sum, h) => sum + h.evaluation_values[axis], 0) / lineup.length;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[], m: number): number {
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

// Standardized third/fourth moments. Skewness 0 = symmetric; excess kurtosis
// 0 = normal-like tails (Fisher's definition, subtracting 3).
function skewness(xs: number[], m: number, sd: number): number {
  if (sd === 0) return 0;
  return mean(xs.map((x) => ((x - m) / sd) ** 3));
}

function excessKurtosis(xs: number[], m: number, sd: number): number {
  if (sd === 0) return 0;
  return mean(xs.map((x) => ((x - m) / sd) ** 4)) - 3;
}

function histogram(xs: number[], buckets = 10): string {
  const counts = new Array(buckets).fill(0) as number[];
  for (const x of xs) {
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((x / 10) * buckets)));
    counts[idx]++;
  }
  return counts.map((c) => '#'.repeat(Math.round(c / 2)) + ` (${c})`).join('\n    ');
}

function report(label: string, xs: number[]) {
  const m = mean(xs);
  const sd = stdev(xs, m);
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const skew = skewness(xs, m, sd);
  const kurt = excessKurtosis(xs, m, sd);
  console.log(
    `  ${label.padEnd(8)} mean=${m.toFixed(2)} sd=${sd.toFixed(2)} min=${min.toFixed(2)} max=${max.toFixed(2)} skew=${skew.toFixed(2)} exKurt=${kurt.toFixed(2)}`,
  );
  console.log(`    ${histogram(xs)}`);
}

function main() {
  const heroes = loadHeroes();
  console.log(`Loaded ${heroes.length} heroes. Sample size ${SAMPLE_SIZE}, lineup size ${LINEUP_SIZE}.\n`);

  for (const axis of AXES) {
    console.log(`=== ${axis} ===`);

    const randomScores: number[] = [];
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      randomScores.push(axisAverage(sampleLineup(heroes, LINEUP_SIZE), axis));
    }
    report('RANDOM', randomScores);

    const topPool = [...heroes]
      .sort((a, b) => b.evaluation_values[axis] - a.evaluation_values[axis])
      .slice(0, MAXED_POOL_SIZE);
    const maxedScores: number[] = [];
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      maxedScores.push(axisAverage(sampleLineup(topPool, LINEUP_SIZE), axis));
    }
    report('MAXED', maxedScores);
    console.log('');
  }
}

main();
