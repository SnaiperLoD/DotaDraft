import * as fs from 'fs';
import * as path from 'path';
import { AXES, AXIS_LABEL } from '../src/battle/battle-resolution';
import type { Hero } from 'shared';

// Follow-up to simulate-self-play.ts: pulls every hero whose in-system
// favoredRate diverges from their real OpenDota winRate by >=10pp (either
// direction) and cross-references each against their own evaluation_values
// — sum across all 11 axes (raw, not role-fit-adjusted, since this is meant
// to be an intrinsic per-hero read, not tied to one role) and the single
// axis carrying them the most. Output is a CSV for spreadsheet review, not
// a conclusion by itself — a hero showing up here is a candidate for manual
// inspection (same posture as flagging Meepo/Necrophos previously), not a
// confirmed bug.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const SIMULATION_OUTPUT_PATH = path.join(__dirname, '..', 'data', 'self-play-simulation-output.json');
const CSV_OUTPUT_PATH = path.join(__dirname, '..', 'data', 'winrate-divergence-report.csv');

const DIVERGENCE_THRESHOLD = 0.10;

interface HeroTableRow {
  heroId: number;
  name: string;
  appearances: number;
  favoredRate: number;
  avgContribution: number;
  realWinRate: number | null;
  divergenceFromReal: number | null;
}

interface SimulationOutput {
  heroTable: HeroTableRow[];
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function main() {
  const heroes: Hero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const heroById = new Map(heroes.map((h) => [h.id, h]));
  const sim: SimulationOutput = JSON.parse(fs.readFileSync(SIMULATION_OUTPUT_PATH, 'utf-8'));

  const flagged = sim.heroTable
    .filter((h) => h.divergenceFromReal !== null && Math.abs(h.divergenceFromReal) >= DIVERGENCE_THRESHOLD)
    .sort((a, b) => (b.divergenceFromReal ?? 0) - (a.divergenceFromReal ?? 0));

  const rows = flagged.map((row) => {
    const hero = heroById.get(row.heroId);
    if (!hero) throw new Error(`Unknown heroId ${row.heroId} — heroes.json out of date vs simulation output?`);

    const axisValues = AXES.map((axis) => ({ axis, value: hero.evaluation_values[axis] }));
    const axisSum = axisValues.reduce((sum, a) => sum + a.value, 0);
    const top = [...axisValues].sort((a, b) => b.value - a.value)[0];

    return {
      heroId: row.heroId,
      name: row.name,
      direction: (row.divergenceFromReal ?? 0) > 0 ? 'overperforms' : 'underperforms',
      divergencePP: ((row.divergenceFromReal ?? 0) * 100).toFixed(1),
      favoredRatePct: (row.favoredRate * 100).toFixed(1),
      realWinRatePct: ((row.realWinRate ?? 0) * 100).toFixed(1),
      axisSum: axisSum.toFixed(1),
      topAxis: AXIS_LABEL[top.axis],
      topAxisValue: top.value.toFixed(1),
    };
  });

  const header = [
    'heroId',
    'name',
    'direction',
    'divergence_pp',
    'favoredRate_pct',
    'realWinRate_pct',
    'axisSum_of_11',
    'topAxis',
    'topAxisValue',
  ];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.heroId,
        csvEscape(r.name),
        r.direction,
        r.divergencePP,
        r.favoredRatePct,
        r.realWinRatePct,
        r.axisSum,
        csvEscape(r.topAxis),
        r.topAxisValue,
      ].join(','),
    ),
  ];

  fs.writeFileSync(CSV_OUTPUT_PATH, lines.join('\n') + '\n');
  console.log(`${rows.length} heroes with |divergence| >= ${DIVERGENCE_THRESHOLD * 100}pp written to ${CSV_OUTPUT_PATH}`);

  console.log('\nTop axis frequency among flagged heroes (which axis most often "carries" a divergent hero):');
  const topAxisCounts = new Map<string, number>();
  for (const r of rows) topAxisCounts.set(r.topAxis, (topAxisCounts.get(r.topAxis) ?? 0) + 1);
  for (const [axis, count] of [...topAxisCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${axis}: ${count}`);
  }
}

main();
