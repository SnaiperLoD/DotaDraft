import * as fs from 'fs';
import * as path from 'path';

// One-off export for reviewing the four hand-tagged categories side by
// side. All four (control/saving/mobility/initiating) now come straight
// from evaluation_values — initiating is computed in
// calibrate-evaluation-values.ts same as the others, just not yet wired
// into Battle Engine/role-fit/UI.
const heroes: { id: number; name: string; evaluation_values: Record<string, number> }[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'heroes.json'), 'utf-8'),
);

const rows = heroes.map((h) => ({
  heroId: h.id,
  heroName: h.name,
  control: h.evaluation_values.control,
  saving: h.evaluation_values.saving,
  mobility: h.evaluation_values.mobility,
  initiating_scaled: h.evaluation_values.initiating,
}));

fs.writeFileSync(
  path.join(__dirname, '..', 'data', 'tag-rankings-export.json'),
  JSON.stringify(rows, null, 2),
);
console.log(`Wrote ${rows.length} rows.`);
