// Variance Lab ONLY — author-approved 2026-10-02 (via coordinator): ~470 pages of
// OpenDota /api/publicMatches?min_rank=70 + ONE /api/heroStats call.
// Raw pages go to artifacts/lab/opendota/ (gitignored); nothing under server/data
// is read for writing or touched. Sequential, ≥1.2 s between calls, exponential
// backoff on 429/5xx, resumable (re-run continues below the lowest match_id seen).
//   cd server && npx ts-node scripts/lab/fetch-public-matches.ts
import * as fs from 'fs';
import * as path from 'path';
import { appendRun, ensureLabDir } from './lab-common';

const DIR = ensureLabDir('opendota', 'pages');
const ROOT = path.dirname(DIR);
const MAX_PAGES = Number(process.env.LAB_OD_MAX_PAGES ?? 480);
const TARGET_USABLE = Number(process.env.LAB_OD_TARGET ?? 25000);
const GAP_MS = 1200;
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
export const usable = (m: PM) =>
  m.game_mode === 22 &&
  m.lobby_type === 7 &&
  m.duration > 0 &&
  m.radiant_win != null &&
  m.radiant_team?.length === 5 &&
  m.dire_team?.length === 5 &&
  !m.radiant_team.includes(0) &&
  !m.dire_team.includes(0);

let calls = 0;
let n429 = 0;
async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 8; attempt++) {
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
  throw new Error(`gave up on ${url}`);
}

async function main() {
  const t0 = Date.now();
  // one heroStats call (pub pick/win counts per bracket) — only if not already saved
  const hsPath = path.join(ROOT, 'heroStats.json');
  if (!fs.existsSync(hsPath)) {
    fs.writeFileSync(hsPath, JSON.stringify(await getJson('https://api.opendota.com/api/heroStats')));
    console.log('heroStats saved');
    await sleep(GAP_MS);
  }
  const pages = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
  let usableN = 0;
  let minId = Infinity;
  for (const p of pages) {
    const arr = JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf-8')) as PM[];
    usableN += arr.filter(usable).length;
    for (const m of arr) minId = Math.min(minId, m.match_id);
  }
  let pageNo = pages.length;
  while (pageNo < MAX_PAGES && usableN < TARGET_USABLE) {
    const url = `https://api.opendota.com/api/publicMatches?min_rank=70${Number.isFinite(minId) ? `&less_than_match_id=${minId}` : ''}`;
    const arr = (await getJson(url)) as PM[];
    if (!Array.isArray(arr) || arr.length === 0) {
      console.log('empty page, stop');
      break;
    }
    fs.writeFileSync(path.join(DIR, `page-${String(pageNo).padStart(4, '0')}.json`), JSON.stringify(arr));
    usableN += arr.filter(usable).length;
    for (const m of arr) minId = Math.min(minId, m.match_id);
    pageNo++;
    if (pageNo % 25 === 0) console.log(`page ${pageNo}: usable=${usableN} minId=${minId} oldest=${new Date(Math.min(...arr.map((m) => m.start_time)) * 1000).toISOString()} 429s=${n429}`);
    await sleep(GAP_MS);
  }
  console.log(`done: pages=${pageNo} usable=${usableN} calls=${calls} 429=${n429} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  appendRun({ kind: 'opendota-pull', label: 'publicMatches+heroStats', config: { endpoint: '/api/publicMatches?min_rank=70', maxPages: MAX_PAGES, target: TARGET_USABLE, gapMs: GAP_MS }, seed: 0, nMatches: usableN, metrics: { pages: pageNo, usable: usableN, calls, n429 }, wallMs: Date.now() - t0 });
}
if (require.main === module) void main();
