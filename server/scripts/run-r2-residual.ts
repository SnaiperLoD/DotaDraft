// R2.2 residual diagnostic on a Naked+open Battle-f heroTable.
// Does not write tags, multipliers, or axis-weights.json.
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TAG_DEFINITIONS } from 'shared';
import { ensureArtifactDir } from './lib/artifact-paths';

const TABLE = process.env.R2_RESIDUAL_TABLE ?? path.join(ensureArtifactDir('self-play', 'r2-2026-09-21'), 'r2_f-heroTable.json');
const RUN_ID = process.env.R2_RESIDUAL_RUN_ID ?? 'r2-residual-2026-09-21';

const HIDDEN = CUSTOM_TAG_DEFINITIONS.filter((d) => !d.visible && !d.revealable);
const HIDDEN_NAMES = new Set(HIDDEN.map((d) => d.name));

// Documented production flat-power hidden magnitudes (custom-tags.ts).
// Sign: >1 buff (expect underrate on naked f), <1 penalty (expect overrate).
const HIDDEN_FLAT: Record<string, number> = {
  'Disable Battery': 1.25,
  'Haunt Absolute': 1.12,
  'Paper Utility': 0.75,
  'Raid Boss': 1.18,
  'Showstopper Tax': 0.75,
  'False Immortal': 0.82,
  'Siege Voltage': 1.12,
  'Summoning Sickness': 0.7,
};

interface HeroRow {
  name: string;
  favoredRate: number;
  realWinRate: number | null;
  divergenceFromReal?: number | null;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function main(): void {
  const outDir = ensureArtifactDir('self-play', RUN_ID);
  const table = (JSON.parse(fs.readFileSync(TABLE, 'utf-8')) as { heroTable: HeroRow[] }).heroTable;
  const rows = table
    .filter((h) => h.realWinRate != null)
    .map((h) => {
      const div = h.divergenceFromReal != null ? h.divergenceFromReal : h.favoredRate - (h.realWinRate as number);
      const hidden = HIDDEN.filter((d) => d.heroNames.includes(h.name)).map((d) => d.name);
      return { name: h.name, favored: h.favoredRate, real: h.realWinRate as number, div, hidden };
    });

  const withHidden = rows.filter((h) => h.hidden.length > 0);
  const without = rows.filter((h) => h.hidden.length === 0);

  const tagRows: {
    tag: string;
    n: number;
    meanDivPp: number;
    maePp: number;
    flat: number | null;
    signMatch: string;
  }[] = [];
  for (const def of HIDDEN) {
    const members = rows.filter((h) => h.hidden.includes(def.name));
    if (!members.length) continue;
    const meanDiv = mean(members.map((h) => h.div));
    const mae = mean(members.map((h) => Math.abs(h.div)));
    const flat = HIDDEN_FLAT[def.name] ?? null;
    let signMatch = 'n/a (not flat power)';
    if (flat != null) {
      const expectOver = flat < 1;
      const stillOver = meanDiv > 0.02;
      const stillUnder = meanDiv < -0.02;
      if (expectOver && stillOver) signMatch = 'still overrated — tag still earns its keep';
      else if (expectOver && stillUnder) signMatch = 'now underrated — tag may be too hot / f overcorrected';
      else if (!expectOver && stillUnder) signMatch = 'still underrated — tag still earns its keep';
      else if (!expectOver && stillOver) signMatch = 'now overrated — tag may be too hot / f overcorrected';
      else signMatch = 'near zero — candidate to retire';
    }
    tagRows.push({
      tag: def.name,
      n: members.length,
      meanDivPp: meanDiv * 100,
      maePp: mae * 100,
      flat,
      signMatch,
    });
  }
  tagRows.sort((a, b) => Math.abs(b.meanDivPp) - Math.abs(a.meanDivPp));

  const holes = without
    .slice()
    .sort((a, b) => Math.abs(b.div) - Math.abs(a.div))
    .slice(0, 15);
  const taggedTail = withHidden
    .slice()
    .sort((a, b) => Math.abs(b.div) - Math.abs(a.div))
    .slice(0, 15);

  const retire = tagRows.filter((t) => t.signMatch.includes('retire') || t.signMatch.includes('too hot'));
  const keep = tagRows.filter((t) => t.signMatch.includes('earns'));

  const lines = [
    `# Residual vs hidden tags — ${RUN_ID}`,
    '',
    `Source table: ${TABLE}`,
    'Naked+open Battle f (hidden OFF). div = favoredRate − realWR. Positive = overrated.',
    'Does not write tags or multipliers.',
    '',
    '## Roster split',
    '',
    `| Group | n | mean div п.п. | MAE п.п. |`,
    `|---|---:|---:|---:|`,
    `| any hidden tag | ${withHidden.length} | ${(mean(withHidden.map((h) => h.div)) * 100).toFixed(2)} | ${(mean(withHidden.map((h) => Math.abs(h.div))) * 100).toFixed(2)} |`,
    `| no hidden tag | ${without.length} | ${(mean(without.map((h) => h.div)) * 100).toFixed(2)} | ${(mean(without.map((h) => Math.abs(h.div))) * 100).toFixed(2)} |`,
    '',
    'If MAE of tagged >> untagged, hidden still mops structured error. If close, f ate the crutch.',
    '',
    '## Per hidden tag',
    '',
    `| Tag | n | flat | mean div п.п. | MAE | vs tag intent |`,
    `|---|---:|---:|---:|---:|---|`,
    ...tagRows.map(
      (t) =>
        `| ${t.tag} | ${t.n} | ${t.flat == null ? 'complex' : t.flat.toFixed(2)} | ${t.meanDivPp.toFixed(1)} | ${t.maePp.toFixed(1)} | ${t.signMatch} |`,
    ),
    '',
    `Still earns keep (${keep.length}): ${keep.map((t) => t.tag).join(', ') || '—'}`,
    `Retire / too hot (${retire.length}): ${retire.map((t) => `${t.tag} (${t.signMatch})`).join('; ') || '—'}`,
    '',
    '## Biggest |div| with no hidden tag (holes in f)',
    '',
    `| Hero | div п.п. | favored | real |`,
    `|---|---:|---:|---:|`,
    ...holes.map((h) => `| ${h.name} | ${(h.div * 100).toFixed(1)} | ${(h.favored * 100).toFixed(1)}% | ${(h.real * 100).toFixed(1)}% |`),
    '',
    '## Biggest |div| still wearing a hidden tag',
    '',
    `| Hero | div п.п. | hidden |`,
    `|---|---:|---|`,
    ...taggedTail.map((h) => `| ${h.name} | ${(h.div * 100).toFixed(1)} | ${h.hidden.join(', ')} |`),
    '',
    'No multipliers written. Next: freeze f, then approve before shrinking a named hidden tag.',
  ];
  fs.writeFileSync(path.join(outDir, 'kpi.md'), lines.join('\n') + '\n');
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        runId: RUN_ID,
        createdAt: new Date().toISOString(),
        table: TABLE,
        hiddenTagNames: [...HIDDEN_NAMES],
        split: {
          withHidden: withHidden.length,
          without: without.length,
        },
        tagRows,
        holes,
        taggedTail,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(lines.join('\n'));
  console.log(`\nwrote ${outDir}`);
}

main();
