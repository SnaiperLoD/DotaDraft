import * as fs from 'fs';
import * as path from 'path';
import type { PooledHeroRole } from 'shared';
import {
  fetchProPlayerNameMap,
  matchHasResolvedIdentities,
  opendotaUrl,
  pooledRolesForSide,
  trimTeamName,
  type OpenDotaMatchPlayerRow,
} from './opendota-pro-identity';

// Imports group-stage + playoff (main-event) matches from every past The
// International that OpenDota still has, and MERGES them into pro-matches.json.
//
// OpenDota has no stage flag — each TI's leagueid also holds regionals /
// wildcards weeks earlier. We keep the on-site cluster (groups + bracket),
// cross-checked against daily match density on /leagues/{id}/matches
// (group days spike to 20–50 games; playoff days sit around 5–12; quals
// are a separate earlier blob).
//
// Unavailable / skipped:
// - TI10 (league 11625): ghost id, 0 matches. Real TI 2021 is 13256.
// - TI 2026: live main-event import via fetch-pro-matches-ti.ts
// - Regional quals / wildcards sitting in the same leagueid
// - Fake / practice / DOGO leagues: excluded by the curated list below
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');
const MIN_DURATION_SECONDS = 600;
const REQUEST_GAP_MS = 900;

interface TiMainEventWindow {
  leagueId: number;
  name: string;
  // Inclusive UTC bounds for groups + playoffs (not regionals).
  startUtc: string;
  endUtc: string;
}

// End dates are end-of-day UTC so late-timezone grand finals still land inside.
const TI_MAIN_EVENTS: TiMainEventWindow[] = [
  {
    leagueId: 65001,
    name: 'The International 2012',
    startUtc: '2012-08-26T00:00:00.000Z',
    endUtc: '2012-09-03T23:59:59.999Z',
  },
  {
    leagueId: 65006,
    name: 'The International 2013',
    startUtc: '2013-08-02T00:00:00.000Z',
    endUtc: '2013-08-12T23:59:59.999Z',
  },
  {
    leagueId: 600,
    name: 'The International 2014',
    startUtc: '2014-07-08T00:00:00.000Z',
    endUtc: '2014-07-21T23:59:59.999Z',
  },
  {
    leagueId: 2733,
    name: 'The International 2015',
    startUtc: '2015-08-03T00:00:00.000Z',
    endUtc: '2015-08-09T23:59:59.999Z',
  },
  {
    leagueId: 4664,
    name: 'The International 2016',
    startUtc: '2016-08-02T00:00:00.000Z',
    endUtc: '2016-08-14T23:59:59.999Z',
  },
  {
    leagueId: 5401,
    name: 'The International 2017',
    startUtc: '2017-08-02T00:00:00.000Z',
    endUtc: '2017-08-13T23:59:59.999Z',
  },
  {
    leagueId: 9870,
    name: 'The International 2018',
    startUtc: '2018-08-15T00:00:00.000Z',
    endUtc: '2018-08-26T23:59:59.999Z',
  },
  {
    leagueId: 10749,
    name: 'The International 2019',
    startUtc: '2019-08-15T00:00:00.000Z',
    endUtc: '2019-08-25T23:59:59.999Z',
  },
  // TI10 (11625): ghost league id — use 13256 (The International 2021).
  {
    leagueId: 13256,
    name: 'The International 2021',
    startUtc: '2021-10-07T00:00:00.000Z',
    endUtc: '2021-10-17T23:59:59.999Z',
  },
  {
    leagueId: 14268,
    name: 'The International 2022',
    startUtc: '2022-10-15T00:00:00.000Z',
    endUtc: '2022-10-30T23:59:59.999Z',
  },
  {
    leagueId: 15728,
    name: 'The International 2023',
    startUtc: '2023-10-12T00:00:00.000Z',
    endUtc: '2023-10-29T23:59:59.999Z',
  },
  {
    leagueId: 16935,
    name: 'The International 2024',
    startUtc: '2024-09-04T00:00:00.000Z',
    endUtc: '2024-09-15T23:59:59.999Z',
  },
  {
    leagueId: 18324,
    name: 'The International 2025',
    startUtc: '2025-09-04T00:00:00.000Z',
    endUtc: '2025-09-14T23:59:59.999Z',
  },
];

interface LeagueMatchRow {
  match_id: number;
  duration: number;
  start_time: number;
  radiant_win: boolean;
  radiant_name: string | null;
  dire_name: string | null;
}

interface StoredProMatch {
  matchId: string;
  radiantName: string | null;
  direName: string | null;
  leagueName: string | null;
  radiantWin: boolean;
  radiantHeroIds: number[];
  direHeroIds: number[];
  radiantHeroRoles?: PooledHeroRole[];
  direHeroRoles?: PooledHeroRole[];
  startTime: string;
}

interface MatchDetail {
  match_id: number;
  radiant_win: boolean;
  start_time: number;
  duration: number;
  radiant_name?: string | null;
  dire_name?: string | null;
  radiant_team?: { name?: string | null } | null;
  dire_team?: { name?: string | null } | null;
  players: (OpenDotaMatchPlayerRow & { player_slot: number; gold_per_min?: number | null })[];
}

interface Candidate {
  row: LeagueMatchRow;
  leagueName: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, retries = 5): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (attempt === retries) {
        console.warn(`    failed after ${retries + 1} attempt(s): ${msg}`);
        return null;
      }
      const rateLimited = /\b429\b/.test(msg);
      await sleep(rateLimited ? 4000 * (attempt + 1) : 1500 * (attempt + 1));
    }
  }
  return null;
}

function loadExisting(): StoredProMatch[] {
  if (!fs.existsSync(OUTPUT_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as { matches?: StoredProMatch[] };
  return Array.isArray(parsed.matches) ? parsed.matches : [];
}

function hasCompleteRoles(m: StoredProMatch | undefined): boolean {
  return Boolean(
    m &&
      Array.isArray(m.radiantHeroRoles) &&
      m.radiantHeroRoles.length === 5 &&
      Array.isArray(m.direHeroRoles) &&
      m.direHeroRoles.length === 5 &&
      Array.isArray(m.radiantHeroIds) &&
      m.radiantHeroIds.length === 5 &&
      Array.isArray(m.direHeroIds) &&
      m.direHeroIds.length === 5,
  );
}

function writeSnapshot(byId: Map<string, StoredProMatch>): number {
  const matches = [...byId.values()].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), matches }, null, 2),
  );
  return matches.length;
}

async function collectCandidates(): Promise<{ candidates: Candidate[]; perLeague: Record<string, number> }> {
  const candidates: Candidate[] = [];
  const perLeague: Record<string, number> = {};

  for (const ti of TI_MAIN_EVENTS) {
    const startSec = Math.floor(Date.parse(ti.startUtc) / 1000);
    const endSec = Math.floor(Date.parse(ti.endUtc) / 1000);

    console.log(`Listing ${ti.name} (league ${ti.leagueId})...`);
    const rows = await withRetry(async () => {
      const res = await fetch(opendotaUrl(`leagues/${ti.leagueId}/matches`));
      if (!res.ok) throw new Error(`leagues/matches HTTP ${res.status}`);
      return (await res.json()) as LeagueMatchRow[];
    });

    if (!rows) {
      console.warn(`  could not fetch match list — skipping ${ti.name}`);
      perLeague[ti.name] = 0;
      await sleep(REQUEST_GAP_MS);
      continue;
    }

    const kept = rows.filter(
      (r) =>
        r.duration >= MIN_DURATION_SECONDS &&
        r.start_time >= startSec &&
        r.start_time <= endSec,
    );
    perLeague[ti.name] = kept.length;
    console.log(`  league total ${rows.length}, main-event window ${kept.length}`);

    for (const row of kept) {
      candidates.push({ row, leagueName: ti.name });
    }

    await sleep(REQUEST_GAP_MS);
  }

  // De-dupe by match_id (shouldn't overlap across leagues, but be safe).
  const byMatch = new Map<number, Candidate>();
  for (const c of candidates) byMatch.set(c.row.match_id, c);
  return { candidates: [...byMatch.values()].sort((a, b) => b.row.start_time - a.row.start_time), perLeague };
}

async function main() {
  console.log(`Loading OpenDota proPlayers map...`);
  const proNameByAccountId = await fetchProPlayerNameMap();
  console.log(`  ${proNameByAccountId.size} curated account_id → name rows`);

  const { candidates, perLeague } = await collectCandidates();
  console.log(`\nMain-event candidates across all TIs: ${candidates.length}`);
  for (const [name, n] of Object.entries(perLeague)) {
    console.log(`  ${name}: ${n}`);
  }
  console.log('  The International 10: ghost league 11625 — imported as 2021 / 13256');
  console.log('  The International 2026: skipped here (live import via fetch-pro-matches-ti)\n');

  const existing = loadExisting();
  const byId = new Map(existing.map((m) => [m.matchId, m]));
  let added = 0;
  let updated = 0;
  let skippedDetail = 0;
  let reused = 0;

  for (const [index, candidate] of candidates.entries()) {
    const matchId = String(candidate.row.match_id);
    const existingRow = byId.get(matchId);

    if (hasCompleteRoles(existingRow) && matchHasResolvedIdentities(existingRow!)) {
      // Refresh league label if this is a TI playoff we just classified.
      if (existingRow!.leagueName !== candidate.leagueName) {
        byId.set(matchId, { ...existingRow!, leagueName: candidate.leagueName });
        updated++;
      } else {
        reused++;
      }
      if ((index + 1) % 25 === 0) {
        console.log(`[${index + 1}/${candidates.length}] reused cached details through ${matchId}`);
      }
      continue;
    }

    console.log(
      `[${index + 1}/${candidates.length}] ${candidate.leagueName} match ${candidate.row.match_id}`,
    );

    const detail = await withRetry(async () => {
      const res = await fetch(opendotaUrl(`matches/${candidate.row.match_id}`));
      if (!res.ok) throw new Error(`matches HTTP ${res.status}`);
      return (await res.json()) as MatchDetail;
    });

    if (!detail || !Array.isArray(detail.players) || detail.players.length !== 10) {
      console.warn('  incomplete match detail, skipping');
      skippedDetail++;
      await sleep(REQUEST_GAP_MS);
      continue;
    }

    const radiantPlayers = detail.players.filter((p) => p.player_slot < 128);
    const direPlayers = detail.players.filter((p) => p.player_slot >= 128);
    if (radiantPlayers.length !== 5 || direPlayers.length !== 5) {
      console.warn('  unexpected team sizes, skipping');
      skippedDetail++;
      await sleep(REQUEST_GAP_MS);
      continue;
    }

    const radiantHeroRoles = pooledRolesForSide(radiantPlayers, proNameByAccountId, { requireGpm: true });
    const direHeroRoles = pooledRolesForSide(direPlayers, proNameByAccountId, { requireGpm: true });
    if (!radiantHeroRoles || !direHeroRoles) {
      console.warn('  missing gold_per_min — storing without roles');
    }

    const had = byId.has(matchId);
    const stored: StoredProMatch = {
      matchId,
      radiantName: trimTeamName(
        detail.radiant_name ?? detail.radiant_team?.name ?? candidate.row.radiant_name,
      ),
      direName: trimTeamName(detail.dire_name ?? detail.dire_team?.name ?? candidate.row.dire_name),
      leagueName: candidate.leagueName,
      radiantWin: detail.radiant_win ?? candidate.row.radiant_win,
      radiantHeroIds: radiantPlayers.map((p) => p.hero_id),
      direHeroIds: direPlayers.map((p) => p.hero_id),
      radiantHeroRoles: radiantHeroRoles ?? undefined,
      direHeroRoles: direHeroRoles ?? undefined,
      startTime: new Date((detail.start_time ?? candidate.row.start_time) * 1000).toISOString(),
    };

    byId.set(matchId, stored);
    if (had) updated++;
    else added++;

    // Checkpoint every 25 fetches so a mid-run kill doesn't lose progress.
    if ((added + updated) % 25 === 0) {
      const total = writeSnapshot(byId);
      console.log(`  checkpoint — wrote ${total} matches to pro-matches.json`);
    }

    await sleep(REQUEST_GAP_MS);
  }

  const total = writeSnapshot(byId);
  console.log(`\nDone.`);
  console.log(`  candidates: ${candidates.length}`);
  console.log(`  added: ${added}, updated: ${updated}, reused cached: ${reused}, skipped: ${skippedDetail}`);
  console.log(`  pro-matches.json total: ${total} (was ${existing.length})`);
  console.log(`  wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
