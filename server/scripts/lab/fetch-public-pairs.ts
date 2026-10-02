// Variance Lab — WINDOW A pull for public pair stats (Blueprint/16
// "Pre-registration: public pair stats"). Author ok 2026-10-02 (~3600 calls).
// Window A = the 14 days immediately BEFORE the 7-day wide pull (window B,
// artifacts/lab/opendota-wide), so B stays a later, disjoint check window and
// costs no new calls. Same sampling as the wide script: hourly anchors, a block
// of contiguous pages per anchor, anchor time → match_id via a linear id(t)
// model seeded from the wide pull's own (t, id) points and refitted as we go.
//
// Limits (ASSUMED, OpenDota free/unkeyed): ≈60/min, ≈2000/day. We send one call
// per 1.2 s. If backoff on 429 is exhausted (daily cap), the run SLEEPS until the
// next UTC midnight + 10 min and continues — one background run can span ~2 days.
// Hard cap LAB_OD_MAX_CALLS (3800). Resumable (state + per-page files).
// Writes ONLY to artifacts/lab/opendota-pairsA/.
//
//   cd server && LAB_OD_DRY_RUN=1 npx ts-node scripts/lab/fetch-public-pairs.ts   # plan, no network
//   cd server && npx ts-node scripts/lab/fetch-public-pairs.ts                     # the pull (author ok)
import * as fs from 'fs';
import * as path from 'path';
import { LAB_DIR, appendRun, ensureLabDir } from './lab-common';

const DAYS = Number(process.env.LAB_OD_DAYS ?? 14);
const ANCHORS = Number(process.env.LAB_OD_ANCHORS ?? 336); // hourly
const BLOCK = Number(process.env.LAB_OD_BLOCK ?? 11);
const GAP_MS = Number(process.env.LAB_OD_GAP_MS ?? 1200);
const GAP_BEFORE_B_S = 3600; // 1 h buffer between A and B
const MAX_CALLS = Number(process.env.LAB_OD_MAX_CALLS ?? 3800);
const DRY = process.env.LAB_OD_DRY_RUN === '1';
const BASE = 'https://api.opendota.com/api/publicMatches?min_rank=60&max_rank=75';
const WIDE = path.join(LAB_DIR, 'opendota-wide', 'pages');
const ROOT = path.join(LAB_DIR, 'opendota-pairsA');
const PAGES = path.join(ROOT, 'pages');
const STATE = path.join(ROOT, 'state.json');
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
const usable = (m: PM) =>
  m.game_mode === 22 && m.lobby_type === 7 && m.duration > 0 && m.radiant_win != null && m.avg_rank_tier >= 60 && m.avg_rank_tier <= 75 &&
  m.radiant_team?.length === 5 && m.dire_team?.length === 5 && !m.radiant_team.includes(0) && !m.dire_team.includes(0);

function fit(pts: [number, number][]): { a: number; b: number } {
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

function wideSeed() {
  const pts: [number, number][] = [];
  let pages = 0;
  let ok = 0;
  let oldest = { t: Infinity, id: Infinity };
  for (const f of fs.readdirSync(WIDE).filter((x) => x.endsWith('.json'))) {
    const arr = JSON.parse(fs.readFileSync(path.join(WIDE, f), 'utf-8')) as PM[];
    if (f.startsWith('a')) pages++;
    for (const m of arr) {
      if (usable(m)) ok++;
      if (m.start_time && m.match_id % 7 === 0) pts.push([m.start_time, m.match_id]);
      if (m.start_time < oldest.t) oldest = { t: m.start_time, id: m.match_id };
    }
  }
  return { pts, usablePerPage: ok / Math.max(1, pages), oldest };
}

let calls = 0;
let n429 = 0;
let dailySleeps = 0;
async function getJson(url: string): Promise<unknown> {
  for (;;) {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (calls >= MAX_CALLS) throw new Error(`hard cap ${MAX_CALLS} reached`);
      calls++;
      let res: Response;
      try {
        res = await fetch(url);
      } catch (e) {
        console.log(`  network error ${String(e)}, retry in 30s`);
        await sleep(30000);
        continue;
      }
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
    // backoff exhausted → assume the daily cap; sleep to next UTC midnight + 10 min
    const now = new Date();
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 10);
    dailySleeps++;
    console.log(`  daily limit assumed; sleeping until ${new Date(next).toISOString()} (calls so far ${calls})`);
    await sleep(next - now.getTime());
  }
}

async function main() {
  const seed = wideSeed();
  const m0 = fit(seed.pts);
  const tB0 = seed.oldest.t;
  const tEndA = tB0 - GAP_BEFORE_B_S;
  const tStartA = tEndA - DAYS * 86400;
  const planned = ANCHORS * BLOCK;
  const plan = {
    endpoint: BASE,
    windowB: `wide pull, oldest match ${new Date(tB0 * 1000).toISOString()} (no new calls)`,
    windowA: [new Date(tStartA * 1000).toISOString(), new Date(tEndA * 1000).toISOString()],
    anchors: ANCHORS,
    anchorSpacingMin: (DAYS * 1440) / ANCHORS,
    pagesPerAnchor: BLOCK,
    plannedCalls: planned,
    hardCap: MAX_CALLS,
    gapMs: GAP_MS,
    activeMinutes: +((planned * GAP_MS) / 60000).toFixed(1),
    assumedLimits: '≈60/min, ≈2000/day → ≥2 UTC days; sleeps through the daily cap',
    usablePerPageFromWide: +seed.usablePerPage.toFixed(1),
    expectedUsableMatches: Math.round(planned * seed.usablePerPage),
    idPerSecond: +m0.b.toFixed(2),
    out: 'artifacts/lab/opendota-pairsA/pages/a<anchor>-p<page>.json + state.json',
  };
  if (DRY) {
    console.log('DRY RUN — no network calls.');
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  ensureLabDir('opendota-pairsA', 'pages');
  const t0 = Date.now();
  const state: { pts: [number, number][]; done: string[]; empty: string[] } = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf-8')) : { pts: [], done: [], empty: [] };
  const save = () => fs.writeFileSync(STATE, JSON.stringify(state));
  let usableN = 0;
  for (let k = 0; k < ANCHORS; k++) {
    const tAnchor = tEndA - (k * DAYS * 86400) / ANCHORS;
    const mdl = fit([...seed.pts, ...state.pts]);
    // re-anchor on B's oldest known match, keep the fitted slope
    let below = Math.round(seed.oldest.id - mdl.b * (tB0 - tAnchor)) + 1;
    for (let p = 0; p < BLOCK; p++) {
      const key = `a${String(k).padStart(3, '0')}-p${String(p).padStart(2, '0')}`;
      const file = path.join(PAGES, `${key}.json`);
      if (state.done.includes(key) && fs.existsSync(file)) {
        const arr = JSON.parse(fs.readFileSync(file, 'utf-8')) as PM[];
        if (arr.length) below = Math.min(...arr.map((x) => x.match_id));
        usableN += arr.filter(usable).length;
        continue;
      }
      const arr = (await getJson(`${BASE}&less_than_match_id=${below}`)) as PM[];
      fs.writeFileSync(file, JSON.stringify(arr));
      state.done.push(key);
      if (!arr.length) {
        state.empty.push(key); // retention edge: older ids may be gone — logged, block skipped
        save();
        await sleep(GAP_MS);
        break;
      }
      below = Math.min(...arr.map((x) => x.match_id));
      for (const x of arr.filter((_, i) => i % 20 === 0)) state.pts.push([x.start_time, x.match_id]);
      usableN += arr.filter(usable).length;
      save();
      await sleep(GAP_MS);
    }
    if ((k + 1) % 24 === 0) console.log(`anchor ${k + 1}/${ANCHORS} (day ${(k + 1) / 24}) calls=${calls} usable≈${usableN} 429=${n429} sleeps=${dailySleeps} empty=${state.empty.length}`);
  }
  console.log(`done: calls=${calls} usable≈${usableN} 429=${n429} dailySleeps=${dailySleeps} empty=${state.empty.length} in ${((Date.now() - t0) / 3600000).toFixed(1)} h`);
  appendRun({ kind: 'opendota-pull-pairsA', label: 'publicMatches 60–75, window A 14d', config: plan, seed: 0, nMatches: usableN, metrics: { calls, n429, dailySleeps, empty: state.empty.length }, wallMs: Date.now() - t0 });
}
if (require.main === module)
  main().catch((e) => {
    console.error(String(e));
    process.exitCode = 1;
  });
