// Evidence table for Blueprint/hkb-review-2026-10.md (T3 outliers). No writes outside artifacts/lab.
//   cd server && npx ts-node scripts/lab/hkb-review-data.ts
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, ensureLabDir } from './lab-common';
import { STRATZ_ROOT } from './stratz-common';
import { mean, sd } from './lab-metrics';

const BR = ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'];
const rows = BR.flatMap((b) => JSON.parse(fs.readFileSync(path.join(STRATZ_ROOT, 'stats', 'w1789344000', 'stats', `${b}-all-allpos.json`), 'utf-8')).data as any[]);
const heroes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf-8')) as { id: number; name: string; evaluation_values: Record<string, number> }[];
const POS: Record<string, string> = { POSITION_1: 'pos1 Carry', POSITION_2: 'pos2 Mid', POSITION_3: 'pos3 Offlane', POSITION_4: 'pos4 Soft Support', POSITION_5: 'pos5 Hard Support' };
const main = new Map<number, { pos: string; g: number }>();
for (const r of rows) if (r.time === 0) {
  const cur = main.get(r.heroId);
  const g = rows.filter((x) => x.time === 0 && x.heroId === r.heroId && x.position === r.position).reduce((s, x) => s + x.matchCount, 0);
  if (!cur || g > cur.g) main.set(r.heroId, { pos: r.position, g });
}
const at = (id: number, t: number, f: string) => {
  const rs = rows.filter((r) => r.heroId === id && r.position === main.get(id)!.pos && r.time === t);
  const g = rs.reduce((s, r) => s + r.matchCount, 0);
  return { v: rs.reduce((s, r) => s + (r[f] ?? 0) * r.matchCount, 0) / g, g };
};
const SPEC: [string, string, (id: number) => { v: number; g: number }, number][] = [
  ['control', 'stun+disable duration (s), cumulative at minute 30', (id) => { const a = at(id, 30, 'stunDuration'); const b = at(id, 30, 'disableDuration'); return { v: a.v + b.v, g: a.g }; }, 1],
  ['tempo', 'networth at minute 10', (id) => at(id, 10, 'networth'), 1],
  ['skirmish_rate', '(kills+assists)/min, cumulative at minute 30', (id) => { const k = at(id, 30, 'kills'); const a = at(id, 30, 'assists'); return { v: (k.v + a.v) / 30, g: k.g }; }, 1],
  ['saving', 'ally healing, cumulative at minute 30', (id) => at(id, 30, 'healingAllies'), 1],
  ['durability', 'deaths, cumulative at minute 30 (inverse)', (id) => at(id, 30, 'deaths'), -1],
  ['burst', 'hero damage, cumulative at minute 30', (id) => at(id, 30, 'heroDamage'), 1],
  ['teamfight', 'hero damage, cumulative at minute 30', (id) => at(id, 30, 'heroDamage'), 1],
  ['scaling', 'networth growth minute 10→30', (id) => ({ v: at(id, 30, 'networth').v - at(id, 10, 'networth').v, g: at(id, 30, 'networth').g }), 1],
  ['objectives', 'tower damage, cumulative at minute 30', (id) => at(id, 30, 'towerDamage'), 1],
];
const out: unknown[] = [];
for (const [axis, label, fn, sign] of SPEC) {
  const vals = heroes.map((h) => ({ h, s: fn(h.id), a: h.evaluation_values[axis] ?? 0 }));
  const ok = vals.filter((x) => Number.isFinite(x.s.v));
  const ms = mean(ok.map((x) => x.s.v));
  const ss = sd(ok.map((x) => x.s.v));
  const ma = mean(ok.map((x) => x.a));
  const sa = sd(ok.map((x) => x.a));
  const rankOf = (v: number, arr: number[]) => arr.filter((x) => x > v).length + 1;
  for (const x of ok) {
    const zs = (x.s.v - ms) / ss;
    const za = (x.a - ma) / sa;
    const d = sign * zs - za;
    if (Math.abs(d) < 2) continue;
    out.push({
      hero: x.h.name,
      axis,
      axisValue: x.a,
      axisRank: rankOf(x.a, ok.map((o) => o.a)),
      stat: label,
      statValue: +x.s.v.toFixed(2),
      statRank: sign > 0 ? rankOf(x.s.v, ok.map((o) => o.s.v)) : ok.length + 1 - rankOf(x.s.v, ok.map((o) => o.s.v)),
      matchesAtMinute: x.s.g,
      mainPosition: POS[main.get(x.h.id)!.pos],
      direction: d > 0 ? 'stat higher than axis' : 'axis higher than stat',
      zGap: +d.toFixed(1),
    });
  }
}
fs.writeFileSync(path.join(ensureLabDir('kt6'), 'hkb-review-evidence.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
