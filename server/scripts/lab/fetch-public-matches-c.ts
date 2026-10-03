// Variance Lab — window C pull for the BLIND check of cleaned STRATZ pairs
// (Blueprint/16-variance-lab.md, "Pre-registration: blind window C").
// Ancient+Divine ranked AP, 2026-10-01 00:00 UTC → now, sampled across the window with
// anchors (same scheme as fetch-public-matches-wide.ts). Writes ONLY to
// artifacts/lab/opendota-c/. Never touches server/data.
//
// Run ONLY under the author's explicit ok:
//   cd server && npx ts-node scripts/lab/fetch-public-matches-c.ts
// Plan without any network call:
//   cd server && LAB_OD_DRY_RUN=1 npx ts-node scripts/lab/fetch-public-matches-c.ts
//
// Design (differences from the wide script)
// - Window: LAB_OD_START (default 1790812800 = 2026-10-01 00:00 UTC) → newest match on
//   the head page. Anchors are evenly spaced inside that span; anchor k sits at
//   newest − k·span/ANCHORS, so the oldest anchor is one spacing above START.
// - Budget: BLOCK pages per anchor (default 8), ANCHORS = floor((LAB_OD_PLAN_CALLS−1)/BLOCK)
//   (default plan 960 → 119 anchors → 953 calls). Hard cap LAB_OD_MAX_CALLS = 1000,
//   retries included. 8 pages ≈ 5–10 min of matches on B, so ~25-min spacing never overlaps.
// - The id(t) model and the dry-run yield are seeded from local pages (wide pull B +
//   the 2026-10-01 8-hour pull). Matches already in B or in the 8-hour pull are NOT
//   skipped here; kt8-c-prepare.ts drops them by match_id (pre-registered).
// - Resumable via artifacts/lab/opendota-c/state.json; backoff on 429/5xx as in the wide script.
import * as fs from 'fs';
import * as path from 'path';
import { LAB_DIR, appendRun, ensureLabDir } from './lab-common';

const START = Number(process.env.LAB_OD_START ?? 1790812800);
const BLOCK = Number(process.env.LAB_OD_BLOCK ?? 8);
const PLAN_CALLS = Number(process.env.LAB_OD_PLAN_CALLS ?? 960);
const ANCHORS = Number(process.env.LAB_OD_ANCHORS ?? Math.floor((PLAN_CALLS - 1) / BLOCK));
const GAP_MS = Number(process.env.LAB_OD_GAP_MS ?? 1200);
const MAX_CALLS = Number(process.env.LAB_OD_MAX_CALLS ?? 1000);
const DRY = process.env.LAB_OD_DRY_RUN === '1';
const BASE = 'https://api.opendota.com/api/publicMatches?min_rank=60&max_rank=75';
const NAME = 'opendota-c';
const OUT = DRY ? path.join(LAB_DIR, NAME, 'pages') : ensureLabDir(NAME, 'pages');
const STATE = path.join(LAB_DIR, NAME, 'state.json');
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
export const usableC = (m: PM) =>
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

/** Local seed, no network: id(t) points from the newest local pages, page yield from B (same endpoint). */
function localSeed() {
  const pts: [number, number][] = [];
  let all = 0;
  let ok = 0;
  let pages = 0;
  const window8h = { min: Infinity, max: 0 };
  const wideDir = path.join(LAB_DIR, 'opendota-wide', 'pages');
  for (const f of fs.existsSync(wideDir) ? fs.readdirSync(wideDir) : []) {
    const arr = JSON.parse(fs.readFileSync(path.join(wideDir, f), 'utf-8')) as PM[];
    pages++;
    for (const [i, m] of arr.entries()) {
      all++;
      if (usableC(m)) ok++;
      // the id(t) slope drifts slowly; fit on the last ~3 days of B only
      if (i % 20 === 0 && m.start_time > START - 3 * 86400) pts.push([m.start_time, m.match_id]);
    }
  }
  const dir8 = path.join(LAB_DIR, 'opendota', 'pages');
  for (const f of fs.existsSync(dir8) ? fs.readdirSync(dir8) : []) {
    const arr = JSON.parse(fs.readFileSync(path.join(dir8, f), 'utf-8')) as PM[];
    for (const [i, m] of arr.entries()) {
      window8h.min = Math.min(window8h.min, m.start_time);
      window8h.max = Math.max(window8h.max, m.start_time);
      if (i % 20 === 0) pts.push([m.start_time, m.match_id]);
    }
  }
  return { pts, usablePerPage: pages ? ok / pages : 74, window8h };
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
  const model = seed.pts.length > 10 ? fitIdModel(seed.pts) : null;
  const nowEst = Math.floor(Date.now() / 1000);
  const spanH = (nowEst - START) / 3600;
  const spacingMin = (spanH * 60) / ANCHORS;
  const anchorTimes = Array.from({ length: ANCHORS }, (_, k) => nowEst - k * spacingMin * 60);
  const in8h = anchorTimes.filter((t) => t >= seed.window8h.min && t <= seed.window8h.max).length;
  const plannedCalls = 1 + ANCHORS * BLOCK;
  const expectedUsableRaw = Math.round(ANCHORS * BLOCK * seed.usablePerPage);
  const plan = {
    endpoint: BASE,
    windowStartUtc: new Date(START * 1000).toISOString(),
    windowEndUtcEstimate: new Date(nowEst * 1000).toISOString() + ' (real end = newest match on the head page)',
    spanHours: +spanH.toFixed(1),
    anchors: ANCHORS,
    anchorSpacingMin: +spacingMin.toFixed(1),
    pagesPerAnchor: BLOCK,
    plannedCalls,
    callCap: MAX_CALLS,
    gapMs: GAP_MS,
    estMinutes: +((plannedCalls * GAP_MS) / 60000).toFixed(1),
    usablePerPageFromB: +seed.usablePerPage.toFixed(1),
    expectedUsableBeforeExclusions: expectedUsableRaw,
    anchorsInside8hPull: `${in8h} of ${ANCHORS} (${new Date(seed.window8h.min * 1000).toISOString()} → ${new Date(seed.window8h.max * 1000).toISOString()}; Divine matches there will be dropped by match_id)`,
    idPerSecondFit: model ? +model.b.toFixed(2) : null,
    out: `artifacts/lab/${NAME}/pages/a<anchor>-p<page>.json + state.json`,
  };
  if (DRY) {
    console.log('DRY RUN — no network calls.');
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!model) throw new Error('need local pages (wide pull / 2026-10-01 pull) to seed the id(t) model');
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
  const spacing = (state.newestTime! - START) / ANCHORS;
  const usable = { n: 0 };
  for (let k = 0; k < ANCHORS; k++) {
    const tAnchor = state.newestTime! - k * spacing;
    const m = fitIdModel(state.pts.length > 200 ? state.pts : [...seed.pts, ...state.pts]);
    let below = Math.round(state.newestId! - m.b * (state.newestTime! - tAnchor)) + 1;
    for (let p = 0; p < BLOCK; p++) {
      const key = `a${String(k).padStart(3, '0')}-p${p}`;
      const file = path.join(OUT, `${key}.json`);
      if (state.done.includes(key) && fs.existsSync(file)) {
        const arr = JSON.parse(fs.readFileSync(file, 'utf-8')) as PM[];
        if (arr.length) below = Math.min(...arr.map((x) => x.match_id));
        usable.n += arr.filter(usableC).length;
        continue;
      }
      const arr = (await getJson(`${BASE}&less_than_match_id=${below}`)) as PM[];
      fs.writeFileSync(file, JSON.stringify(arr));
      state.done.push(key);
      if (arr.length) {
        below = Math.min(...arr.map((x) => x.match_id));
        for (const x of arr.filter((_, i) => i % 20 === 0)) state.pts.push([x.start_time, x.match_id]);
      }
      usable.n += arr.filter(usableC).length;
      save();
      await sleep(GAP_MS);
    }
    if ((k + 1) % 12 === 0) console.log(`anchor ${k + 1}/${ANCHORS} calls=${calls} usable≈${usable.n} 429=${n429}`);
  }
  console.log(`done: calls=${calls} usable=${usable.n} 429=${n429} in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  appendRun({ kind: 'opendota-pull-c', label: 'publicMatches 60–75 window C (2026-10-01 → now)', config: plan, seed: 0, nMatches: usable.n, metrics: { calls, n429 }, wallMs: Date.now() - t0 });
}
if (require.main === module)
  main().catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  });
