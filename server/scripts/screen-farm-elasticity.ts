import * as fs from 'fs';
import * as path from 'path';

// Offline screen for farm-elasticity-data.json vs winRate, resource_efficiency,
// axisSum, and honest self-play divergence. Read-only — no weights / calibrate.
const DATA = path.join(__dirname, '..', 'data');
const ELASTICITY = path.join(DATA, 'farm-elasticity-data.json');
const HEROES = path.join(DATA, 'heroes.json');
const META = path.join(DATA, 'hero-meta.json');
const DN = path.join(DATA, 'damage-networth-share-data.json');
const SP = path.join(DATA, 'axis-regression-b0-selfplay-seed1.json');
const OUT = path.join(DATA, 'farm-elasticity-screen.json');

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let n = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    n += x * y;
    da += x * x;
    db += y * y;
  }
  const d = Math.sqrt(da * db);
  return d ? n / d : 0;
}

function olsResid(y: number[], Xs: number[][]): number[] {
  const n = y.length;
  const k = Xs[0].length + 1;
  const X = y.map((_, i) => [1, ...Xs[i]]);
  const XtX = Array.from({ length: k }, () => Array(k).fill(0));
  const XtY = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < k; a++) {
      XtY[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const A = XtX.map((r, i) => [...r, XtY[i]]);
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    [A[i], A[piv]] = [A[piv], A[i]];
    const div = A[i][i] || 1e-12;
    for (let c = i; c <= k; c++) A[i][c] /= div;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r][i];
      for (let c = i; c <= k; c++) A[r][c] -= f * A[i][c];
    }
  }
  const beta = A.map((r) => r[k]);
  return y.map((_, i) => {
    let pred = 0;
    for (let j = 0; j < k; j++) pred += beta[j] * X[i][j];
    return y[i] - pred;
  });
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function main() {
  if (!fs.existsSync(ELASTICITY)) {
    console.error(`Missing ${ELASTICITY} — run npm run fetch-farm-elasticity-data first`);
    process.exit(1);
  }

  const elasticity = JSON.parse(fs.readFileSync(ELASTICITY, 'utf-8')) as Array<{
    heroId: number;
    name: string;
    farmElasticity: number;
    avgNwShare: number;
    wrAll: number;
    games: number;
  }>;
  const heroes = JSON.parse(fs.readFileSync(HEROES, 'utf-8')) as Array<{
    id: number;
    name: string;
    evaluation_values: Record<string, number>;
  }>;
  const meta = JSON.parse(fs.readFileSync(META, 'utf-8')) as {
    heroes: Array<{ heroId: number; winRate: number; positions?: Array<{ position: string; share: number }> }>;
  };
  const dn = JSON.parse(fs.readFileSync(DN, 'utf-8')) as Array<{
    heroId: number;
    damagePerNetworthShare: number;
  }>;
  const sp = fs.existsSync(SP)
    ? (JSON.parse(fs.readFileSync(SP, 'utf-8')) as {
        heroTable: Array<{ name: string; divergenceFromReal: number }>;
      })
    : null;

  const elBy = new Map(elasticity.map((e) => [e.heroId, e]));
  const wrBy = new Map(meta.heroes.map((h) => [h.heroId, h.winRate]));
  const dnBy = new Map(dn.map((d) => [d.heroId, d.damagePerNetworthShare]));
  const divBy = new Map(sp?.heroTable.map((h) => [h.name, h.divergenceFromReal]) ?? []);
  const posBy = new Map(
    meta.heroes.map((h) => {
      const ps = h.positions ?? [];
      const dom = ps.length ? [...ps].sort((a, b) => b.share - a.share)[0].position : 'unknown';
      return [h.heroId, dom];
    }),
  );

  const rows = heroes
    .map((h) => {
      const el = elBy.get(h.id);
      if (!el) return null;
      const ev = h.evaluation_values;
      return {
        id: h.id,
        name: h.name,
        pos: posBy.get(h.id) ?? 'unknown',
        elasticity: el.farmElasticity,
        avgNwShare: el.avgNwShare,
        wr: wrBy.get(h.id)!,
        re: ev.resource_efficiency,
        dmgPerNw: dnBy.get(h.id) ?? null,
        axisSum: Object.values(ev).reduce((a, b) => a + b, 0),
        skirmish: ev.skirmish_rate,
        scaling: ev.scaling,
        tempo: ev.tempo,
        saving: ev.saving,
        obj: ev.objectives,
        div: divBy.get(h.name) ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null && r.wr != null);

  const el = rows.map((r) => r.elasticity);
  const wr = rows.map((r) => r.wr);
  const re = rows.map((r) => r.re);
  const nw = rows.map((r) => r.avgNwShare);
  const axisSum = rows.map((r) => r.axisSum);

  const controls = rows.map((r) => [r.re, r.skirmish, r.scaling, r.tempo, r.saving, r.obj]);
  const elResidAxes = olsResid(el, controls);
  const elResidReOnly = olsResid(el, rows.map((r) => [r.re]));
  const elResidNw = olsResid(el, rows.map((r) => [r.avgNwShare]));

  const withDiv = rows.filter((r) => r.div != null);
  const div = withDiv.map((r) => r.div as number);
  const elDiv = withDiv.map((r) => r.elasticity);
  const elDivResid = olsResid(
    elDiv,
    withDiv.map((r) => [r.re, r.skirmish, r.scaling, r.tempo, r.saving, r.obj]),
  );

  const byPos: Record<string, { n: number; rWr: number; rRe: number; meanEl: number }> = {};
  for (const r of rows) {
    (byPos[r.pos] ??= { n: 0, rWr: 0, rRe: 0, meanEl: 0 });
  }
  for (const [pos, list] of Object.entries(
    rows.reduce<Record<string, typeof rows>>((acc, r) => {
      (acc[r.pos] ??= []).push(r);
      return acc;
    }, {}),
  )) {
    byPos[pos] = {
      n: list.length,
      rWr: round(pearson(list.map((r) => r.elasticity), list.map((r) => r.wr))),
      rRe: round(pearson(list.map((r) => r.elasticity), list.map((r) => r.re))),
      meanEl: round(mean(list.map((r) => r.elasticity))),
    };
  }

  const ranked = [...rows].sort((a, b) => b.elasticity - a.elasticity);
  const out = {
    n: rows.length,
    correlations: {
      rElasticity_winRate: round(pearson(el, wr)),
      rElasticity_RE: round(pearson(el, re)),
      rElasticity_avgNwShare: round(pearson(el, nw)),
      rElasticity_axisSum: round(pearson(el, axisSum)),
      rAvgNwShare_RE: round(pearson(nw, re)),
      // hard stop: leftover after RE alone
      rElasticity_winRate_afterRE: round(pearson(elResidReOnly, wr)),
      rElasticity_winRate_afterNwShare: round(pearson(elResidNw, wr)),
      rElasticity_winRate_afterAxesInclRE: round(pearson(elResidAxes, wr)),
      rElasticity_divergence: withDiv.length ? round(pearson(elDiv, div)) : null,
      rElasticity_divergence_afterAxes: withDiv.length ? round(pearson(elDivResid, div)) : null,
    },
    stopCriteria: {
      // reject if essentially the same as RE
      redundantWithRE: Math.abs(pearson(el, re)) >= 0.7,
      // reject if no independent WR signal after RE
      noSignalAfterRE: Math.abs(pearson(elResidReOnly, wr)) < 0.08,
      // reject if doesn't touch divergence after axes (optional soft)
      noDivergenceSignal: withDiv.length ? Math.abs(pearson(elDivResid, div)) < 0.05 : null,
    },
    byPos,
    top15: ranked.slice(0, 15).map((r) => ({
      name: r.name,
      pos: r.pos,
      elasticityPp: round(r.elasticity * 100),
      re: r.re,
      wr: round(r.wr),
      nwShare: r.avgNwShare,
    })),
    bottom15: ranked
      .slice(-15)
      .reverse()
      .map((r) => ({
        name: r.name,
        pos: r.pos,
        elasticityPp: round(r.elasticity * 100),
        re: r.re,
        wr: round(r.wr),
        nwShare: r.avgNwShare,
      })),
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nWrote ${OUT}`);

  if (out.stopCriteria.redundantWithRE) {
    console.log('\nSTOP: |r(elasticity, RE)| ≥ 0.7 — redundant with resource_efficiency.');
  } else if (out.stopCriteria.noSignalAfterRE) {
    console.log('\nSTOP: residual vs WR after RE < 0.08 — no independent signal.');
  } else {
    console.log('\nPASS preliminary independence vs RE — candidate for nested validation (no wire yet).');
  }
}

main();
