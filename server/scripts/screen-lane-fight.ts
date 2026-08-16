import * as fs from 'fs';
import * as path from 'path';

// Offline screen for research-lane-fight-output.json vs winRate, existing
// axes (esp. skirmish/tempo), prior gold lane-delta, and honest divergence.
const DATA = path.join(__dirname, '..', 'data');
const FIGHT = path.join(DATA, 'research-lane-fight-output.json');
const GOLD = path.join(DATA, 'research-lane-matchup-output.json');
const HEROES = path.join(DATA, 'heroes.json');
const META = path.join(DATA, 'hero-meta.json');
const SP = path.join(DATA, 'axis-regression-b0-selfplay-seed1.json');
const OUT = path.join(DATA, 'lane-fight-screen.json');

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
  if (!fs.existsSync(FIGHT)) {
    console.error(`Missing ${FIGHT} — run npm run fetch-lane-fight-data first`);
    process.exit(1);
  }

  const fight = JSON.parse(fs.readFileSync(FIGHT, 'utf-8')) as Array<{
    heroId: number;
    name: string;
    avgXpDelta: number;
    avgLhDelta: number;
    avgDnDelta: number;
    games: number;
  }>;
  const gold = fs.existsSync(GOLD)
    ? (JSON.parse(fs.readFileSync(GOLD, 'utf-8')) as Array<{ heroId: number; avgDelta: number }>)
    : [];
  const heroes = JSON.parse(fs.readFileSync(HEROES, 'utf-8')) as Array<{
    id: number;
    name: string;
    evaluation_values: Record<string, number>;
  }>;
  const meta = JSON.parse(fs.readFileSync(META, 'utf-8')) as {
    heroes: Array<{ heroId: number; winRate: number }>;
  };
  const sp = fs.existsSync(SP)
    ? (JSON.parse(fs.readFileSync(SP, 'utf-8')) as {
        heroTable: Array<{ name: string; divergenceFromReal: number }>;
      })
    : null;

  const fightBy = new Map(fight.map((f) => [f.heroId, f]));
  const goldBy = new Map(gold.map((g) => [g.heroId, g.avgDelta]));
  const wrBy = new Map(meta.heroes.map((h) => [h.heroId, h.winRate]));
  const divBy = new Map(sp?.heroTable.map((h) => [h.name, h.divergenceFromReal]) ?? []);

  const rows = heroes
    .map((h) => {
      const f = fightBy.get(h.id);
      if (!f) return null;
      const ev = h.evaluation_values;
      return {
        name: h.name,
        xp: f.avgXpDelta,
        lh: f.avgLhDelta,
        dn: f.avgDnDelta,
        goldDelta: goldBy.get(h.id) ?? null,
        wr: wrBy.get(h.id)!,
        skirmish: ev.skirmish_rate,
        tempo: ev.tempo,
        scaling: ev.scaling,
        saving: ev.saving,
        re: ev.resource_efficiency,
        axisSum: Object.values(ev).reduce((a, b) => a + b, 0),
        div: divBy.get(h.name) ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null && r.wr != null);

  function screen(label: string, getter: (r: (typeof rows)[0]) => number) {
    const xs = rows.map(getter);
    const wr = rows.map((r) => r.wr);
    const axisSum = rows.map((r) => r.axisSum);
    const controls = rows.map((r) => [r.skirmish, r.tempo, r.scaling, r.saving, r.re]);
    const residAxes = olsResid(xs, controls);
    const residSum = olsResid(xs, rows.map((r) => [r.axisSum]));
    const withDiv = rows.filter((r) => r.div != null);
    const divResid =
      withDiv.length >= 50
        ? olsResid(
            withDiv.map(getter),
            withDiv.map((r) => [r.skirmish, r.tempo, r.scaling, r.saving, r.re]),
          )
        : null;
    return {
      label,
      rWin: round(pearson(xs, wr)),
      rWin_afterAxisSum: round(pearson(residSum, wr)),
      rWin_afterAxes: round(pearson(residAxes, wr)),
      rSkirmish: round(pearson(xs, rows.map((r) => r.skirmish))),
      rTempo: round(pearson(xs, rows.map((r) => r.tempo))),
      rGoldLaneDelta:
        rows.filter((r) => r.goldDelta != null).length >= 50
          ? round(
              pearson(
                rows.filter((r) => r.goldDelta != null).map(getter),
                rows.filter((r) => r.goldDelta != null).map((r) => r.goldDelta as number),
              ),
            )
          : null,
      rDiv: withDiv.length >= 50 ? round(pearson(withDiv.map(getter), withDiv.map((r) => r.div as number))) : null,
      rDiv_afterAxes:
        divResid && withDiv.length >= 50
          ? round(pearson(divResid, withDiv.map((r) => r.div as number)))
          : null,
    };
  }

  const screens = [screen('xpDelta', (r) => r.xp), screen('lhDelta', (r) => r.lh), screen('dnDelta', (r) => r.dn)];

  const xp = screens[0];
  const stopCriteria = {
    // same failure mode as closed gold lane work
    redundantWithGoldLane: xp.rGoldLaneDelta != null && Math.abs(xp.rGoldLaneDelta) >= 0.85,
    redundantWithSkirmish: Math.abs(xp.rSkirmish) >= 0.7,
    noIndependentWr: Math.abs(xp.rWin_afterAxes) < 0.08,
    noDivergenceSignal: xp.rDiv_afterAxes != null && Math.abs(xp.rDiv_afterAxes) < 0.05,
  };

  const ranked = [...rows].sort((a, b) => b.xp - a.xp);
  const out = {
    n: rows.length,
    screens,
    stopCriteria,
    top15Xp: ranked.slice(0, 15).map((r) => ({
      name: r.name,
      xp: r.xp,
      lh: r.lh,
      dn: r.dn,
      wr: round(r.wr),
    })),
    bottom15Xp: ranked
      .slice(-15)
      .reverse()
      .map((r) => ({
        name: r.name,
        xp: r.xp,
        lh: r.lh,
        dn: r.dn,
        wr: round(r.wr),
      })),
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  const fails = Object.entries(stopCriteria)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (fails.length) {
    console.log(`\nSTOP: ${fails.join(', ')}`);
  } else {
    console.log('\nPASS preliminary — candidate for nested validation (no wire yet).');
  }
}

main();
