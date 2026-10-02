// Variance Lab — public pair stats from the STRATZ GraphQL API
// (Blueprint/16 "Pre-registration: STRATZ pair stats"). Author ok via coordinator.
//
// Token: STRATZ_API_TOKEN from process.env, else parsed from <repo>/.env.
// It is NEVER printed, logged or written anywhere; error messages are sanitised.
//
// Calls: one per hero PER bracket (LEGEND_ANCIENT, DIVINE_IMMORTAL) = 2 × 127 = 254.
// Separate brackets (not one combined call) so the analysis can (a) build the
// pre-registered Ancient+Divine-like mix and (b) check Divine-only as a diagnostic,
// and so per-bracket counts are auditable. Pacing ≥ 1.5 s, backoff on 429/5xx,
// resumable (skips files already saved). Writes ONLY to artifacts/lab/stratz/.
//
//   cd server && LAB_DRY_RUN=1 npx ts-node scripts/lab/fetch-stratz-pairs.ts         # plan, no network
//   cd server && LAB_STRATZ_INTROSPECT=1 npx ts-node scripts/lab/fetch-stratz-pairs.ts # 1 call: arg docs for heroVsHeroMatchup (week semantics)
//   cd server && npx ts-node scripts/lab/fetch-stratz-pairs.ts                        # the pull (254 calls)
//   optional: LAB_STRATZ_WEEK=<value> to pass `week` (only after introspection says what it means)
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, REPO_ROOT, appendRun, ensureLabDir } from './lab-common';

const DRY = process.env.LAB_DRY_RUN === '1';
const INTROSPECT = process.env.LAB_STRATZ_INTROSPECT === '1';
const WEEK = process.env.LAB_STRATZ_WEEK; // passed verbatim as Long if set
const GAP_MS = Number(process.env.LAB_STRATZ_GAP_MS ?? 1500);
const BRACKETS = ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'];
const URL = 'https://api.stratz.com/graphql';
const ROOT = path.join(REPO_ROOT, 'artifacts', 'lab', 'stratz');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function token(): string | null {
  if (process.env.STRATZ_API_TOKEN) return process.env.STRATZ_API_TOKEN;
  const envPath = path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(envPath)) return null;
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*STRATZ_API_TOKEN\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^['"]|['"]$/g, '') || null;
  }
  return null;
}

const QUERY = `query Pairs($heroId: Short!, $brackets: [RankBracketBasicEnum]${WEEK ? ', $week: Long' : ''}) {
  heroStats {
    heroVsHeroMatchup(heroId: $heroId, bracketBasicIds: $brackets${WEEK ? ', week: $week' : ''}) {
      advantage {
        heroId matchCountWith matchCountVs
        with { heroId2 matchCount winCount synergy }
        vs { heroId2 matchCount winCount synergy }
      }
    }
  }
}`;

const INTROSPECTION = `{ __type(name: "HeroStatsQuery") { fields { name description args { name description type { name kind ofType { name } } } } } }`;

async function post(tok: string, body: unknown): Promise<any> {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res: Response;
    try {
      res = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'User-Agent': 'STRATZ_API', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      console.log('  network error, retry in 20s');
      await sleep(20000);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      const wait = Math.min(120000, 5000 * 2 ** attempt);
      console.log(`  HTTP ${res.status}, backoff ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // body/headers deliberately not echoed
    const json = await res.json();
    if (json.errors?.length) throw new Error(`GraphQL error: ${String(json.errors[0]?.message ?? 'unknown').slice(0, 200)}`);
    return json.data;
  }
  throw new Error('gave up after backoff');
}

async function main() {
  const heroes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf-8')) as { id: number }[];
  const ids = heroes.map((h) => h.id);
  // Week-aware layout: raw/<w<week>|current>/<bracket>/<id>.json. Legacy files from the first
  // run (raw/<bracket>/<id>.json) count as done when their stored `week` matches.
  const weekTag = WEEK ? `w${WEEK}` : 'current';
  const legacy = (b: string, id: number) => {
    const p = path.join(ROOT, 'raw', b, `${id}.json`);
    if (!fs.existsSync(p)) return false;
    try {
      return String(JSON.parse(fs.readFileSync(p, 'utf-8')).week ?? null) === String(WEEK ?? null);
    } catch {
      return false;
    }
  };
  const todo = BRACKETS.flatMap((b) => ids.map((id) => ({ b, id, file: path.join(ROOT, 'raw', weekTag, b, `${id}.json`) })));
  const remaining = todo.filter((t) => !fs.existsSync(t.file) && !legacy(t.b, t.id));
  const tok = token();
  const plan = {
    endpoint: URL,
    brackets: BRACKETS,
    heroes: ids.length,
    plannedCalls: todo.length,
    remainingCalls: remaining.length,
    week: WEEK ?? '(default window)',
    gapMs: GAP_MS,
    estMinutes: +((remaining.length * GAP_MS) / 60000).toFixed(1),
    tokenPresent: tok !== null,
    out: `artifacts/lab/stratz/raw/${weekTag}/<bracket>/<heroId>.json (legacy raw/<bracket>/ honoured)`,
  };
  if (DRY) {
    console.log('DRY RUN — no network calls.');
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!tok) throw new Error('STRATZ_API_TOKEN not found in env or .env');
  ensureLabDir('stratz', 'raw');
  if (INTROSPECT) {
    const data = await post(tok, { query: INTROSPECTION });
    const f = (data?.__type?.fields ?? []).filter((x: { name: string }) => /heroVsHeroMatchup/i.test(x.name));
    fs.writeFileSync(path.join(ROOT, 'introspection-heroVsHeroMatchup.json'), JSON.stringify(f, null, 2));
    console.log(JSON.stringify(f, null, 2));
    return;
  }
  const t0 = Date.now();
  let calls = 0;
  for (const t of remaining) {
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    const variables: Record<string, unknown> = { heroId: t.id, brackets: [t.b] };
    if (WEEK) variables.week = Number(WEEK);
    const data = await post(tok, { query: QUERY, variables });
    calls++;
    const adv = data?.heroStats?.heroVsHeroMatchup?.advantage?.[0];
    fs.writeFileSync(t.file, JSON.stringify({ heroId: t.id, bracket: t.b, week: WEEK ?? null, fetchedAt: new Date().toISOString(), advantage: adv ?? null }));
    if (calls % 25 === 0) console.log(`${calls}/${remaining.length} (${t.b} hero ${t.id}) with=${adv?.with?.length ?? 0} vs=${adv?.vs?.length ?? 0}`);
    await sleep(GAP_MS);
  }
  console.log(`done: ${calls} calls in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
  appendRun({ kind: 'stratz-pull', label: 'heroVsHeroMatchup per hero × bracket', config: { brackets: BRACKETS, week: WEEK ?? null }, seed: 0, nMatches: 0, metrics: { calls }, wallMs: Date.now() - t0 });
}
if (require.main === module)
  main().catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  });
