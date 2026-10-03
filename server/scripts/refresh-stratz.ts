// Post-patch refresh of real data from STRATZ (author-approved 2026-10-02,
// Blueprint/13-deploy.md "After a patch: refresh real data"). Three steps:
//
//   fetch  — NETWORK (Real-Data Recompute: run only on the author's request).
//            For one STRATZ week and brackets LEGEND_ANCIENT + DIVINE_IMMORTAL:
//              stats          heroStats.stats time=0 (hero win / match counts)   2 calls
//              laneOutcome    heroStats.laneOutcome isWith=false (all pairs)     2 calls
//              pairs          heroStats.heroVsHeroMatchup per hero × bracket   254 calls
//            Raw responses go to artifacts/stratz-refresh/<week>/ (gitignored).
//            Resumable (existing files are skipped), paced (--gap-ms, default 1500),
//            backoff on 429/5xx via scripts/lab/stratz-common.ts. Stats are pulled
//            first: if STRATZ has no rows for the week yet, it stops before the
//            254 pair calls. --dry-run prints the plan and makes no calls.
//   build  — OFFLINE. From the staging dir:
//              server/data/lane-outcomes.json   (via build-lane-outcomes.ts; display only)
//              <staging>/hero-meta.proposed.json  refreshed winRate + CLEANED pairs (STZC recipe)
//              <staging>/summary.json, summary.md structural diff vs current hero-meta
//            Never writes server/data/hero-meta.json.
//   apply  — writes server/data/hero-meta.json from the proposal. Refuses without
//            --author-ok (the author's explicit Real-Data Recompute + Calibration
//            Change "ok"), if the build pre-checks failed, or if hero-meta.json
//            changed since the build. --parts winRate,pairs (default both).
//            Cleaned pairs are shares centred on 0.5 (hero strength removed);
//            every pair consumer reads them against 0.5 since 2026-10-03
//            (Blueprint/06-battle-engine.md "Pair data"). Expect golden changes.
//
//   cd server
//   npm run refresh-stratz:fetch -- --dry-run [--week <epoch|YYYY-MM-DD>]
//   npm run refresh-stratz:fetch -- [--week ...]
//   npm run refresh-stratz:build -- [--week ...] [--lanes-out <file>]
//   npx ts-node scripts/refresh-stratz.ts apply --week <week> --author-ok [--parts winRate|pairs|winRate,pairs]
//
// Token: STRATZ_API_TOKEN from env or <repo>/.env (stratz-common); never printed.
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { buildLaneOutcomes } from './build-lane-outcomes';
import { sleep, stratzPost, stratzToken } from './lab/stratz-common';
import {
  REFRESH_BRACKETS,
  buildProposedHeroMeta,
  cleanPairs,
  diffSummary,
  heroTotalsFromStats,
  latestCompleteWeek,
  mergeParts,
  mirrorAverage,
  pairCoverage,
  parseWeekArg,
  renderDiffMarkdown,
  sharePrecheck,
  sumPairs,
  weekRangeLabel,
  type ApplyPart,
  type HeroMetaFile,
  type PairRaw,
  type StatsRow,
} from '../src/hero-meta/stratz-refresh';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'server', 'data');
const HERO_META = path.join(DATA_DIR, 'hero-meta.json');
const STAGING_ROOT = path.join(REPO_ROOT, 'artifacts', 'stratz-refresh');
const MIN_HEROES_WITH_STATS = 120;
const MIN_PAIR_COVERAGE = 0.95;

const args = process.argv.slice(2);
const command = args[0];
const flag = (n: string) => args.includes(n);
const value = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

const stagingDir = (week: number) => path.join(STAGING_ROOT, String(week));
const statsFile = (week: number, b: string) => path.join(stagingDir(week), 'stats', `${b}.json`);
const lanesDir = (week: number) => path.join(stagingDir(week), 'laneOutcome');
const lanesFile = (week: number, b: string) => path.join(lanesDir(week), `${b}-all-allpos-vs.json`);
const pairFile = (week: number, b: string, id: number) =>
  path.join(stagingDir(week), 'pairs', b, `${id}.json`);

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf-8')) as T;

function heroIds(): number[] {
  return readJson<{ id: number }[]>(path.join(DATA_DIR, 'heroes.json'))
    .map((h) => h.id)
    .sort((a, b) => a - b);
}

function latestStagedWeek(): number {
  const weeks = fs.existsSync(STAGING_ROOT)
    ? fs
        .readdirSync(STAGING_ROOT)
        .filter((d) => /^\d+$/.test(d))
        .map(Number)
        .sort((a, b) => a - b)
    : [];
  if (!weeks.length)
    throw new Error(`no staged week under ${path.relative(REPO_ROOT, STAGING_ROOT)}; run fetch first`);
  return weeks[weeks.length - 1];
}

function resolveWeek(defaultWeek: () => number): number {
  const w = value('--week');
  return w ? parseWeekArg(w) : defaultWeek();
}

// ---------------- fetch ----------------
const STATS_QUERY = `query Stats($week: Long, $brackets: [RankBracketBasicEnum]) {
  heroStats { stats(week: $week, bracketBasicIds: $brackets, groupByTime: true, groupByPosition: true) {
    heroId time position matchCount winCount
  } }
}`;
const LANES_QUERY = `query Lanes($week: Long, $brackets: [RankBracketBasicEnum]) {
  heroStats { laneOutcome(isWith: false, week: $week, bracketBasicIds: $brackets) {
    heroId1 heroId2 week position matchCount drawCount winCount lossCount stompWinCount stompLossCount
  } }
}`;
const PAIRS_QUERY = `query Pairs($heroId: Short!, $week: Long, $brackets: [RankBracketBasicEnum]) {
  heroStats { heroVsHeroMatchup(heroId: $heroId, week: $week, bracketBasicIds: $brackets) {
    advantage { heroId matchCountWith matchCountVs
      with { heroId2 matchCount winCount synergy }
      vs { heroId2 matchCount winCount synergy } }
  } }
}`;

interface Job {
  kind: 'stats' | 'laneOutcome' | 'pairs';
  bracket: string;
  heroId?: number;
  file: string;
}

async function fetchStep(): Promise<void> {
  const week = resolveWeek(() => latestCompleteWeek(Date.now()));
  const gapMs = Number(value('--gap-ms') ?? 1500);
  const ids = heroIds();
  const jobs: Job[] = [
    ...REFRESH_BRACKETS.map((b): Job => ({ kind: 'stats', bracket: b, file: statsFile(week, b) })),
    ...REFRESH_BRACKETS.map((b): Job => ({ kind: 'laneOutcome', bracket: b, file: lanesFile(week, b) })),
    ...REFRESH_BRACKETS.flatMap((b) =>
      ids.map((id): Job => ({ kind: 'pairs', bracket: b, heroId: id, file: pairFile(week, b, id) })),
    ),
  ];
  const remaining = jobs.filter((j) => !fs.existsSync(j.file));
  const tok = stratzToken();
  const plan = {
    week,
    weekRange: weekRangeLabel(week),
    brackets: REFRESH_BRACKETS,
    heroes: ids.length,
    plannedCalls: jobs.length,
    remainingCalls: remaining.length,
    byKind: Object.fromEntries(
      (['stats', 'laneOutcome', 'pairs'] as const).map((k) => [
        k,
        remaining.filter((j) => j.kind === k).length,
      ]),
    ),
    gapMs,
    estMinutes: +((remaining.length * gapMs) / 60000).toFixed(1),
    tokenPresent: tok !== null,
    staging: path.relative(REPO_ROOT, stagingDir(week)),
  };
  if (flag('--dry-run')) {
    console.log('DRY RUN — no network calls.');
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (!tok) throw new Error('STRATZ_API_TOKEN not found in env or .env');
  console.log(JSON.stringify(plan, null, 2));
  const t0 = Date.now();
  let made = 0;
  let emptyPairs = 0;
  for (const j of remaining) {
    const vars: Record<string, unknown> = { week, brackets: [j.bracket] };
    let payload: unknown;
    if (j.kind === 'stats') {
      const data = await stratzPost(tok, { query: STATS_QUERY, variables: vars });
      const rows = (data?.heroStats?.stats ?? []) as StatsRow[];
      const heroes = new Set(rows.filter((r) => r.time === 0 && r.matchCount > 0).map((r) => r.heroId)).size;
      if (heroes < MIN_HEROES_WITH_STATS)
        throw new Error(
          `stats for week ${week} (${j.bracket}) cover only ${heroes} heroes — STRATZ has not aggregated this week yet? Try an earlier --week.`,
        );
      payload = { field: 'stats', vars, week, fetchedAt: new Date().toISOString(), data: rows };
    } else if (j.kind === 'laneOutcome') {
      const data = await stratzPost(tok, { query: LANES_QUERY, variables: vars });
      const rows = data?.heroStats?.laneOutcome ?? [];
      if (!rows.length) throw new Error(`laneOutcome for week ${week} (${j.bracket}) is empty`);
      payload = {
        field: 'laneOutcome',
        vars: { isWith: false, ...vars },
        week,
        fetchedAt: new Date().toISOString(),
        data: rows,
      };
    } else {
      const data = await stratzPost(tok, { query: PAIRS_QUERY, variables: { ...vars, heroId: j.heroId } });
      const adv = data?.heroStats?.heroVsHeroMatchup?.advantage?.[0] ?? null;
      if (!adv) {
        // not saved, so a re-run retries it
        emptyPairs++;
        console.log(`  no pair data for hero ${j.heroId} (${j.bracket})`);
      } else
        payload = {
          heroId: j.heroId,
          bracket: j.bracket,
          week,
          fetchedAt: new Date().toISOString(),
          advantage: adv,
        };
    }
    made++;
    if (payload !== undefined) writeAtomic(j.file, JSON.stringify(payload));
    if (made % 25 === 0)
      console.log(`${made}/${remaining.length} (${j.kind} ${j.bracket} ${j.heroId ?? ''})`);
    await sleep(gapMs);
  }
  console.log(
    `done: ${made} calls in ${((Date.now() - t0) / 60000).toFixed(1)} min; pair heroes without data: ${emptyPairs}`,
  );
  console.log(`next: npm run refresh-stratz:build -- --week ${week}`);
}

// ---------------- build ----------------
function shrinkageK(): number {
  const p = path.join(DATA_DIR, 'battle-diff-inputs.json');
  const k = fs.existsSync(p) ? readJson<{ shrinkageK?: number }>(p).shrinkageK : undefined;
  return typeof k === 'number' ? k : 20;
}

function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function buildStep(): void {
  const week = resolveWeek(latestStagedWeek);
  const dir = stagingDir(week);
  const current = readJson<HeroMetaFile>(HERO_META);
  const ids = current.heroes.map((h) => h.heroId);

  const missing: string[] = [];
  const need = (f: string) => {
    if (!fs.existsSync(f)) missing.push(path.relative(dir, f));
    return fs.existsSync(f);
  };
  const statsRows = REFRESH_BRACKETS.filter((b) => need(statsFile(week, b))).map(
    (b) => readJson<{ data: StatsRow[] }>(statsFile(week, b)).data,
  );
  REFRESH_BRACKETS.forEach((b) => need(lanesFile(week, b)));
  const raws: PairRaw[] = [];
  for (const b of REFRESH_BRACKETS)
    for (const id of ids)
      if (need(pairFile(week, b, id))) raws.push(readJson<PairRaw>(pairFile(week, b, id)));
  if (missing.length)
    throw new Error(
      `staging for week ${week} is incomplete (${missing.length} files, e.g. ${missing.slice(0, 5).join(', ')}); re-run fetch (resumable)`,
    );

  // (a) lane outcomes — display-only data, written to server/data unless redirected
  const lanesOut = value('--lanes-out');
  const lanes = buildLaneOutcomes(
    lanesDir(week),
    week,
    lanesOut ? path.resolve(lanesOut) : path.join(DATA_DIR, 'lane-outcomes.json'),
  );

  // (b) proposed hero-meta
  const totals = heroTotalsFromStats(statsRows);
  const summed = sumPairs(raws);
  const precheck = sharePrecheck(summed.vs);
  const avg = mirrorAverage(summed);
  const coverage = pairCoverage(avg, ids);
  const base = (id: number) => {
    const t = totals.get(id);
    return t && t.g > 0 ? t.w / t.g : undefined;
  };
  const cleaned = cleanPairs(avg, base);
  const proposed = buildProposedHeroMeta(current, {
    week,
    totals,
    cleaned,
    generatedAt: new Date().toISOString(),
  });
  const k = shrinkageK();
  const summary = diffSummary(current, proposed, totals, k);
  const heroesWithoutStats = ids.filter((id) => base(id) === undefined);
  const checks = {
    week,
    weekRange: weekRangeLabel(week),
    sharePrecheck: precheck,
    coverage,
    heroesWithoutStats,
    droppedPairEntriesNoBase: cleaned.droppedNoBase,
    prechecksPass: precheck.pass && coverage.frac >= MIN_PAIR_COVERAGE && heroesWithoutStats.length === 0,
  };

  const names = new Map(
    readJson<{ id: number; name: string }[]>(path.join(DATA_DIR, 'heroes.json')).map((h) => [h.id, h.name]),
  );
  const name = (id: number) => names.get(id) ?? `#${id}`;
  writeAtomic(path.join(dir, 'hero-meta.proposed.json'), `${JSON.stringify(proposed, null, 2)}\n`);
  writeAtomic(
    path.join(dir, 'summary.json'),
    JSON.stringify(
      {
        checks,
        lanes,
        shrinkageK: k,
        baseHeroMetaSha256: sha256(HERO_META),
        builtAt: new Date().toISOString(),
        summary,
      },
      null,
      2,
    ),
  );
  writeAtomic(path.join(dir, 'summary.md'), renderDiffMarkdown(week, summary, checks, name));
  console.log(
    JSON.stringify(
      {
        checks,
        lanes: { keptPairs: lanes.keptPairs, out: lanes.out },
        winRate: {
          updated: summary.winRate.updated,
          movedOver1pp: summary.winRate.movedOver1pp,
          meanAbsDeltaPp: summary.winRate.meanAbsDeltaPp,
        },
        pairs: summary.pairs.matchupEntries,
        proposal: path.relative(REPO_ROOT, path.join(dir, 'hero-meta.proposed.json')),
        report: path.relative(REPO_ROOT, path.join(dir, 'summary.md')),
      },
      null,
      2,
    ),
  );
  console.log("server/data/hero-meta.json NOT changed. Applying needs the author's ok (see header: apply).");
}

// ---------------- apply ----------------
function applyStep(): void {
  if (!flag('--author-ok'))
    throw new Error(
      "refusing: applying hero-meta.json is a Real-Data Recompute + Calibration Change; pass --author-ok only with the author's explicit ok",
    );
  const week = value('--week') ? parseWeekArg(value('--week')!) : NaN;
  if (Number.isNaN(week)) throw new Error('apply needs an explicit --week');
  const parts = (value('--parts') ?? 'winRate,pairs').split(',').map((p) => p.trim()) as ApplyPart[];
  if (!parts.length || parts.some((p) => p !== 'winRate' && p !== 'pairs'))
    throw new Error('--parts must be winRate, pairs or winRate,pairs');
  const dir = stagingDir(week);
  const proposedPath = path.join(dir, 'hero-meta.proposed.json');
  const summaryPath = path.join(dir, 'summary.json');
  if (!fs.existsSync(proposedPath) || !fs.existsSync(summaryPath))
    throw new Error(`no proposal for week ${week}; run refresh-stratz:build first`);
  const s = readJson<{ checks: { prechecksPass: boolean }; baseHeroMetaSha256: string }>(summaryPath);
  if (!s.checks.prechecksPass) throw new Error('refusing: build pre-checks failed (see summary.md)');
  if (s.baseHeroMetaSha256 !== sha256(HERO_META))
    throw new Error(
      'refusing: server/data/hero-meta.json changed since the build; re-run refresh-stratz:build',
    );
  const current = readJson<HeroMetaFile>(HERO_META);
  const merged = mergeParts(current, readJson<HeroMetaFile>(proposedPath), parts);
  fs.copyFileSync(HERO_META, path.join(dir, 'hero-meta.before-apply.json'));
  writeAtomic(HERO_META, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`applied parts [${parts.join(', ')}] of week ${week} to server/data/hero-meta.json`);
  console.log(`backup: ${path.relative(REPO_ROOT, path.join(dir, 'hero-meta.before-apply.json'))}`);
  if (parts.includes('pairs'))
    console.log(
      'REMINDER: pairs changed — review the golden snapshot (UPDATE_GOLDEN=1) and run audit-battle-story.',
    );
}

async function main(): Promise<void> {
  if (command === 'fetch') await fetchStep();
  else if (command === 'build') buildStep();
  else if (command === 'apply') applyStep();
  else throw new Error('usage: refresh-stratz.ts fetch|build|apply [--week <epoch|YYYY-MM-DD>] (see header)');
}

if (require.main === module)
  main().catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exitCode = 1;
  });
