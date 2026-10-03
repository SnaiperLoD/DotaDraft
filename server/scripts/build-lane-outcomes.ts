// Builds server/data/lane-outcomes.json — real hero-vs-hero LANE results for
// the Battle lane cards (Blueprint/06-battle-engine.md, "Lane cards: real lane
// win rates"). Display/story only: nothing here feeds the Battle roll.
//
// Source: the Variance Lab STRATZ pull of `heroStats.laneOutcome`
// (isWith=false, i.e. heroId1 laned AGAINST heroId2), already on disk under
// artifacts/lab/stratz/lanes/w<week>/laneOutcome/<BRACKET>-all-allpos-vs.json
// (fetched by server/scripts/lab/fetch-stratz-tables.ts, LAB_STRATZ_TABLE=lanes).
// This script NEVER calls the network — it only converts that payload.
//
// Payload facts (checked 2026-10-02, Blueprint/16-variance-lab.md T2):
// - one row per (heroId1, heroId2) per bracket; `position` is constant, so the
//   data is pair-level only (no per-role split);
// - matchCount = winCount + stompWinCount + drawCount + lossCount + stompLossCount,
//   so a lane WIN here is winCount + stompWinCount (same for losses);
// - (a, b) and (b, a) are near-mirrors (r = 0.998 of a's rate vs 1 − b's rate,
//   counts differ by ~4%), so each unordered pair stores the mean of both
//   perspectives, from the lower hero id's side.
//
// Output policy:
// - brackets LEGEND_ANCIENT + DIVINE_IMMORTAL summed;
// - pairs with fewer than MIN_LANES lanes (wins + draws + losses) are dropped,
//   so the server falls back to the old matchup proxy for them;
// - counts are stored raw as [wins, draws, losses]; the loader
//   (server/src/battle/lane-outcomes.ts) shrinks the decided-lane rate toward
//   0.5 with K = meta.shrinkageK pseudo-lanes: (wins + K/2) / (wins + losses + K).
//   K = 20 is ~2× the empirical-Bayes estimate this script prints
//   (binomial noise vs between-pair variance), i.e. deliberately conservative.
//
// Refresh: `npm run refresh-stratz:fetch` + `refresh-stratz:build` (see
// scripts/refresh-stratz.ts; Real-Data Recompute "ok" needed for the fetch),
// which calls buildLaneOutcomes() on the staging dir. Standalone:
// `npm run build-lane-outcomes --workspace server [-- <week>] [--dir <laneOutcome dir>] [--out <file>]`
// (default dir: the lab pull under artifacts/lab/stratz/lanes/w<week>/laneOutcome).
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');
const LANES_ROOT = path.join(REPO_ROOT, 'artifacts', 'lab', 'stratz', 'lanes');
const OUT_PATH = path.join(__dirname, '..', 'data', 'lane-outcomes.json');
const BRACKETS = ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'] as const;
export const MIN_LANES = 30;
export const SHRINKAGE_K = 20;

interface LaneRow {
  heroId1: number;
  heroId2: number;
  matchCount: number;
  winCount: number;
  stompWinCount: number;
  drawCount: number;
  lossCount: number;
  stompLossCount: number;
}

interface Counts {
  w: number;
  d: number;
  l: number;
}

function latestWeek(): number {
  const weeks = fs
    .readdirSync(LANES_ROOT)
    .map((name) => /^w(\d+)$/.exec(name)?.[1])
    .filter((w): w is string => w != null)
    .map(Number)
    .sort((a, b) => a - b);
  if (weeks.length === 0) throw new Error(`No w<week> folders under ${LANES_ROOT}`);
  return weeks[weeks.length - 1];
}

export interface LaneOutcomesReport {
  week: number;
  rows: number;
  orderedPairs: number;
  keptPairs: number;
  droppedBelowMinLanes: number;
  drawShare: number;
  decidedRateSdPp: number;
  empiricalBayesK: number;
  usedK: number;
  bytes: number;
  out: string;
}

/**
 * Converts `<dir>/<BRACKET>-all-allpos-vs.json` (laneOutcome, isWith=false) into
 * the lane-outcomes.json format and writes it to `outPath`.
 */
export function buildLaneOutcomes(dir: string, week: number, outPath: string = OUT_PATH): LaneOutcomesReport {
  const ordered = new Map<string, Counts>();
  const fetchedAt: string[] = [];
  let rows = 0;
  for (const bracket of BRACKETS) {
    const file = path.join(dir, `${bracket}-all-allpos-vs.json`);
    const payload = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      field: string;
      vars: { isWith: boolean };
      fetchedAt: string;
      data: LaneRow[];
    };
    if (payload.field !== 'laneOutcome' || payload.vars.isWith !== false) {
      throw new Error(`${file}: expected laneOutcome with isWith=false`);
    }
    fetchedAt.push(payload.fetchedAt);
    for (const r of payload.data) {
      rows += 1;
      const w = r.winCount + r.stompWinCount;
      const l = r.lossCount + r.stompLossCount;
      if (w + l + r.drawCount !== r.matchCount) {
        throw new Error(`${file}: counts do not add up for ${r.heroId1}-${r.heroId2}`);
      }
      const key = `${r.heroId1}-${r.heroId2}`;
      const c = ordered.get(key) ?? { w: 0, d: 0, l: 0 };
      c.w += w;
      c.d += r.drawCount;
      c.l += l;
      ordered.set(key, c);
    }
  }

  // Merge (a, b) with the mirrored (b, a) into one row from min(a, b)'s side.
  const merged = new Map<number, Map<number, [number, number, number]>>();
  let dropped = 0;
  let kept = 0;
  const rates: number[] = [];
  const noise: number[] = [];
  for (const [key, ab] of ordered) {
    const [a, b] = key.split('-').map(Number);
    if (a > b && ordered.has(`${b}-${a}`)) continue; // handled from the lower id
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const fromLo = a === lo ? ab : { w: ab.l, d: ab.d, l: ab.w };
    const mirror = ordered.get(`${b}-${a}`);
    const fromLoMirror = mirror ? (a === lo ? { w: mirror.l, d: mirror.d, l: mirror.w } : mirror) : null;
    const pick = (k: keyof Counts) =>
      fromLoMirror ? Math.round((fromLo[k] + fromLoMirror[k]) / 2) : fromLo[k];
    const w = pick('w');
    const d = pick('d');
    const l = pick('l');
    if (w + d + l < MIN_LANES) {
      dropped += 1;
      continue;
    }
    kept += 1;
    if (w + l > 0) {
      rates.push(w / (w + l));
      noise.push(0.25 / (w + l));
    }
    const row = merged.get(lo) ?? new Map<number, [number, number, number]>();
    row.set(hi, [w, d, l]);
    merged.set(lo, row);
  }

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const m = mean(rates);
  const totalVar = mean(rates.map((x) => (x - m) ** 2));
  const trueVar = Math.max(totalVar - mean(noise), 1e-6);
  const ebK = 0.25 / trueVar;
  let drawSum = 0;
  let laneSum = 0;
  for (const row of merged.values())
    for (const [w, d, l] of row.values()) {
      drawSum += d;
      laneSum += w + d + l;
    }

  const pairs: Record<string, Record<string, [number, number, number]>> = {};
  for (const lo of [...merged.keys()].sort((x, y) => x - y)) {
    const row = merged.get(lo)!;
    pairs[String(lo)] = Object.fromEntries([...row.keys()].sort((x, y) => x - y).map((hi) => [String(hi), row.get(hi)!]));
  }

  const out = {
    meta: {
      source: 'STRATZ heroStats.laneOutcome (isWith=false: heroId1 laned against heroId2)',
      week,
      weekStart: new Date(week * 1000).toISOString().slice(0, 10),
      brackets: [...BRACKETS],
      fetchedAt: fetchedAt.sort()[fetchedAt.length - 1],
      counts: '[wins, draws, losses] from the LOWER hero id’s side; wins include stomps; mean of both perspectives',
      rate: 'decided-lane win rate shrunk toward 0.5: (wins + K/2) / (wins + losses + K); draws excluded',
      minLanes: MIN_LANES,
      shrinkageK: SHRINKAGE_K,
      pairs: kept,
      droppedBelowMinLanes: dropped,
      drawShare: +(drawSum / laneSum).toFixed(4),
      builtBy: 'server/scripts/build-lane-outcomes.ts',
    },
    pairs,
  };

  // One hero per line keeps the file diffable without pretty-printing 8k rows.
  const body = Object.entries(pairs)
    .map(([lo, row]) => `    ${JSON.stringify(lo)}: ${JSON.stringify(row)}`)
    .join(',\n');
  const text = `{\n  "meta": ${JSON.stringify(out.meta, null, 2).replace(/\n/g, '\n  ')},\n  "pairs": {\n${body}\n  }\n}\n`;
  JSON.parse(text); // sanity
  fs.writeFileSync(outPath, text);

  return {
        week,
        rows,
        orderedPairs: ordered.size,
        keptPairs: kept,
        droppedBelowMinLanes: dropped,
        drawShare: out.meta.drawShare,
        decidedRateSdPp: +(Math.sqrt(totalVar) * 100).toFixed(1),
        empiricalBayesK: +ebK.toFixed(1),
        usedK: SHRINKAGE_K,
        bytes: Buffer.byteLength(text),
        out: path.relative(REPO_ROOT, outPath),
  };
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
  const dirArg = argValue('--dir');
  const weekArg = positional[0] ?? argValue('--week');
  const week = weekArg ? Number(weekArg) : latestWeek();
  const dir = dirArg ? path.resolve(dirArg) : path.join(LANES_ROOT, `w${week}`, 'laneOutcome');
  const out = argValue('--out');
  console.log(JSON.stringify(buildLaneOutcomes(dir, week, out ? path.resolve(out) : OUT_PATH), null, 2));
}

if (require.main === module) main();
