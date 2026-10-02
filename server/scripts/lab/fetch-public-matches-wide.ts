// Variance Lab — WIDE public pull for the pre-registered pair-channel test
// (Blueprint/16-variance-lab.md, "Pre-registration: pair channels").
// Ancient+Divine, last 7 days, sampled across the match_id range — NOT contiguous
// paging. Writes ONLY to artifacts/lab/opendota-wide/. Never touches server/data.
//
// Run ONLY under the author's explicit ok:
//   cd server && npx ts-node scripts/lab/fetch-public-matches-wide.ts
// Plan without any network call:
//   cd server && LAB_OD_DRY_RUN=1 npx ts-node scripts/lab/fetch-public-matches-wide.ts
//
// Design
// - Rank filter: /api/publicMatches?min_rank=60&max_rank=75. OpenDota rank_tier is
//   10·medal + stars (Ancient 61–65, Divine 71–75, Immortal 80). ASSUMPTION: both
//   bounds are inclusive filters on avg_rank_tier. Verified at run time: the first
//   page is checked, and every stored match is re-filtered locally to 60 ≤ tier ≤ 75.
// - Sampling: ANCHORS evenly spaced in time over DAYS days (default 168 = hourly,
//   covers every hour of day). At each anchor a BLOCK of consecutive pages is read
//   with less_than_match_id paging. Anchor time → match_id via a linear id(t) model,
//   seeded from the local 2026-10-01 pull and refitted on every page fetched.
// - Budget ASSUMPTION: OpenDota free tier ≈ 60 calls/min and ≈ 2 000 calls/day
//   (unkeyed). Default plan = 1 + 168×8 = 1 345 calls, 1.2 s apart (≈ 50/min),
//   ≈ 27 min. If a daily cap is hit (persistent 429), stop; re-running resumes.
// - Backoff on 429/5xx: 5 s · 2^k, max 120 s, 8 attempts, then stop cleanly.
import * as fs from 'fs';
import * as path from 'path';
import { LAB_DIR, appendRun, ensureLabDir } from './lab-common';

const DAYS = Number(process.env.LAB_OD_DAYS ?? 7);
const ANCHORS = Number(process.env.LAB_OD_ANCHORS ?? 168);
const BLOCK = Number(process.env.LAB_OD_BLOCK ?? 8);
const GAP_MS = Number(process.env.LAB_OD_GAP_MS ?? 1200);
const MAX_CALLS = Number(process.env.LAB_OD_MAX_CALLS ?? 1500);
const DRY = process.env.LAB_OD_DRY_RUN === '1';
const BASE = 'https://api.opendota.com/api/publicMatches?min_rank=60&max_rank=75';
const OUT = DRY ? path.join(LAB_DIR, 'opendota-wide') : ensureLabDir('opendota-wide', 'pages');
const STATE = path.join(LAB_DIR, 'opendota-wide', 'state.json');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PM {
  match_id: number;
  radiant_win: boolean | null;
  start_time: number;
  duration: number;
  lobby_type: number;
  game_mode: number;
  avg_rank_tier: number;
  radiant_team: number[];
  dire_team: number[];
}
export const usableWide = (m: PM) =>
  m.game_mode === 22 &&
  m.lobby_type === 7 &&
  m.duration > 0 &&
  m.radiant_win != null &&
  m.avg_rank_tier >= 60 &&
  m.avg_rank_tier <= 75 &&
  m.radiant_team?.length === 5 &&
  m.dire_team?.length === 5 &&
  !m.radiant_team.includes(0) &&
  !m.dire_team.includes(0);

/** Least-squares match_id ≈ a + b·start_time from (t, id) points. */
function fitIdModel(pts: [number, number][]): { a: number; b: number } {
  const n = pts.length;
  const mt = pts.reduce((s, p) => s + p[0], 0) / n;
  const mi = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const [t, id] of pts) {
    sxy += (t - mt) * (id - mi);
    sxx += (t - mt) ** 2;
  }
  const b = sxy / sxx;
  return { a: mi - b * mt, b };
}

function localSeed(): { pts: [number, number][]; usableFrac: number; turboFrac: number } {
  // From the 2026-10-01 Divine pull (no network): id-vs-time slope and page yield.
  const dir = path.join(LAB_DIR, 'opendota', 'pages');
  const pts: [number, number][] = [];
  let all = 0;
  let ok = 0;
  let turbo = 0;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as PM[];
    for (const m of arr) {
      all++;
      if (m.game_mode === 23) turbo++;
      if (usableWide(m)) ok++;
      if (m.start_time) pts.push([m.start_time, m.match_id]);
    }
  }
  return { pts, usableFrac: all ? ok / all : 0.5, turboFrac: all ? turbo / all : 0.4 };
}

let calls = 0;
let n429 = 0;
async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (calls >= MAX_CALLS) throw new Error(`call budget ${MAX_CALLS} reached`);
    calls++;
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      if (res.status === 429) n429++;
      const wait = Math.min(120000, 5000 * 2 ** attempt);
      console.log(`  HTTP ${res.status}, backoff ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  throw new Error(`gave up on ${url} (likely daily cap) — re-run later to resume`);
}

async function main() {
  const seed = localSeed();
  const plannedCalls = 1 + ANCHORS * BLOCK;
  const expectedUsable = Math.round(ANCHORS * BLOCK * 100 * seed.usableFrac);
  const model = seed.pts.length > 10 ? fitIdModel(seed.pts) : null;
  const plan = {
    endpoint: BASE,
    days: DAYS,
    anchors: ANCHORS,
    anchorSpacingMin: (DAYS * 24 * 60) / ANCHORS,
    pagesPerAnchor: BLOCK,
    plannedCalls,
    callCap: MAX_CALLS,
    gapMs: GAP_MS,
    estMinutes: +((plannedCalls * GAP_MS) / 60000).toFixed(1),
    assumedLimits: '≈60 calls/min, ≈2000 calls/day (OpenDota free, unkeyed)',
    usableFracFromLocalDivinePull: +seed.usableFrac.toFixed(3),
    turboFracFromLocalPull: +seed.turboFrac.toFixed(3),
    expectedUsableMatches: expectedUsable,
    expectedUsablePerDay: Math.round(expectedUsable / DAYS),
    idPerSecondFromLocal: model ? +model.b.toFixed(2) : null,
    idSpanFor7Days: model ? Math.round(model.b * DAYS * 86400) : null,
    out: 'artifacts/lab/opendota-wide/pages/a<anchor>-p<page>.json + state.json',
  };
  if (DRY) {
    console.log('DRY RUN — no network calls.');
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!model) throw new Error('need the local 2026-10-01 pull to seed the id(t) model');
  const t0 = Date.now();
  const state: { newestId?: number; newestTime?: number; pts: [number, number][]; done: string[] } = fs.existsSync(STATE)
    ? JSON.parse(fs.readFileSync(STATE, 'utf-8'))
    : { pts: [], done: [] };
  const save = () => fs.writeFileSync(STATE, JSON.stringify(state));
  if (!state.newestId) {
    const first = (await getJson(BASE)) as PM[];
    const tiers = first.map((m) => m.avg_rank_tier);
    console.log(`first page: ${first.length} rows, avg_rank_tier ${Math.min(...tiers)}–${Math.max(...tiers)}`);
    if (Math.min(...tiers) < 60 || Math.max(...tiers) > 75) console.log('  WARNING: rank bounds not applied as assumed; local filter 60–75 still enforced');
    fs.writeFileSync(path.join(OUT, 'head.json'), JSON.stringify(first));
    state.newestId = Math.max(...first.map((m) => m.match_id));
    state.newestTime = Math.max(...first.map((m) => m.start_time));
    state.pts.push(...first.map((m) => [m.start_time, m.match_id] as [number, number]));
    save();
    await sleep(GAP_MS);
  }
  const usable = { n: 0 };
  for (let k = 0; k < ANCHORS; k++) {
    // anchor k: k·spacing before the newest match (k=0 is "now")
    const tAnchor = state.newestTime! - (k * DAYS * 86400) / ANCHORS;
    const pts = state.pts.length > 200 ? state.pts : [...seed.pts, ...state.pts];
    const m = fitIdModel(pts);
    // keep the slope, re-anchor the intercept on the newest observed point
    let below = Math.round(state.newestId! - m.b * (state.newestTime! - tAnchor)) + 1;
    for (let p = 0; p < BLOCK; p++) {
      const key = `a${String(k).padStart(3, '0')}-p${p}`;
      const file = path.join(OUT, `${key}.json`);
      if (state.done.includes(key) && fs.existsSync(file)) {
        const arr = JSON.parse(fs.readFileSync(file, 'utf-8')) as PM[];
        if (arr.length) below = Math.min(...arr.map((x) => x.match_id));
        usable.n += arr.filter(usableWide).length;
        continue;
      }
      const arr = (await getJson(`${BASE}&less_than_match_id=${below}`)) as PM[];
      fs.writeFileSync(file, JSON.stringify(arr));
      state.done.push(key);
      if (arr.length) {
        below = Math.min(...arr.map((x) => x.match_id));
        // thin the fit points: 5 per page is plenty
        for (const x of arr.filter((_, i) => i % 20 === 0)) state.pts.push([x.start_time, x.match_id]);
      }
      usable.n += arr.filter(usableWide).length;
      save();
      await sleep(GAP_MS);
    }
    if ((k + 1) % 12 === 0) console.log(`anchor ${k + 1}/${ANCHORS} calls=${calls} usable≈${usable.n} 429=${n429}`);
  }
  console.log(`done: calls=${calls} usable=${usable.n} 429=${n429} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  appendRun({ kind: 'opendota-pull-wide', label: 'publicMatches 60–75 sampled 7d', config: plan, seed: 0, nMatches: usable.n, metrics: { calls, n429 }, wallMs: Date.now() - t0 });
}
if (require.main === module)
  main().catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  });
