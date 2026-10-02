// Diagnosis for the failed Н1.1 gate (not tuning): the frozen R0 rows
// (artifacts/self-play/r0-2026-09-21, 18:18 +0300) predate commit 74f517b
// (20:23 +0300). That commit set resource_efficiency weight 0.5/0.4/0.55 → 0 and
// retired Mirage Tax (hidden, Naga Siren + Terrorblade ×0.85 power).
// Naked+open has Mirage Tax off either way, so replaying the cache with the
// pre-74f517b RE weights must reproduce the old per-hero table if RE is the
// only difference there.
import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT, appendRun, kpi, type HeroRow } from './lab-common';
import { NA, cacheDir, favoredRates, loadCache, productionParams, replayCounts } from './feature-cache';
import { AXES } from '../../src/assessment-core/axes';

const RE = AXES.indexOf('resource_efficiency');
const OLD_RE = [0.4, 0.5, 0.55]; // early, mid, late before 74f517b

for (const label of ['naked-open', 'full']) {
  const c = loadCache(cacheDir(1, 100000, label));
  const old = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'artifacts', 'self-play', 'r0-2026-09-21', `${label}-heroTable.json`), 'utf-8')) as { heroTable: HeroRow[] }).heroTable;
  const oldById = new Map(old.map((h) => [h.heroId, h]));
  const prm = productionParams(0);
  for (let p = 0; p < 3; p++) prm.w[p * NA + RE] = OLD_RE[p];
  const t0 = Date.now();
  const fr = favoredRates(replayCounts(c, prm));
  const rows = c.meta.heroIds.map((id, h) => ({ heroId: id, name: c.meta.heroNames[h], favoredRate: fr[h], realWinRate: oldById.get(id)!.realWinRate }));
  const diffs = rows.map((r) => ({ name: r.name, d: (r.favoredRate - oldById.get(r.heroId)!.favoredRate) * 100 }));
  const maxAbs = Math.max(...diffs.map((x) => Math.abs(x.d)));
  const top = [...diffs].sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 4);
  const k = kpi(rows);
  console.log(`[${label}] RE weights restored: r=${k.r.toFixed(4)} MAE=${k.maePp.toFixed(2)} ±7=${k.coverage7Pct.toFixed(1)} ≥10=${k.flagged10}  max|Δfav vs 09-21|=${maxAbs.toFixed(4)}pp  top: ${top.map((t) => `${t.name} ${t.d.toFixed(2)}`).join(', ')}`);
  appendRun({ kind: 'r0-drift-diagnosis', label, config: { cache: label, seed: 1, nMatches: 100000, rwr: 0, reWeights: OLD_RE }, seed: 1, nMatches: 100000, metrics: { ...k, maxAbsFavDiffVsR0_0921_pp: maxAbs, top }, wallMs: Date.now() - t0 });
}
