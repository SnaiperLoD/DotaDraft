import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient as LocalPrismaClient } from '@prisma/client';
import { PrismaClient as PoolPrismaClient, type Prisma } from '../generated/pool-client';
import { freezeLegacyCreatedAt } from '../src/opponent-pool/legacy-created-at';

// Host-SQLite COMPLETED drafts with ownerToken=null → opponent-pool player
// rows with spread createdAt (playtest 2026-08-20). Idempotent on sourceDraftId.
// Writes server/data/legacy-player-pool.json so Compose can seed without the
// host SQLite file. Upserts into Postgres when POOL_DATABASE_URL is set.

const SNAPSHOT_PATH = path.join(__dirname, '..', 'data', 'legacy-player-pool.json');
const LEGACY_TOKEN = null;

export interface LegacyPlayerDraft {
  sourceDraftId: string;
  heroIds: number[];
  heroRoles: { heroId: number; role: string }[];
  evaluationScore: number | null;
  createdAt: string;
}

interface LegacySnapshot {
  drafts: LegacyPlayerDraft[];
}

function parseCreatedAt(value: Date | string | number): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  const asNum = Number(value);
  if (Number.isFinite(asNum) && asNum > 1e11) return asNum > 1e12 ? asNum : asNum * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function parseEvalScore(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { totalScore?: number };
    return typeof parsed.totalScore === 'number' ? parsed.totalScore : null;
  } catch {
    return null;
  }
}

export async function collectLegacyDraftsFromSqlite(
  liveMaxMs?: number | null,
): Promise<LegacyPlayerDraft[] | null> {
  const local = new LocalPrismaClient();
  try {
    const rows = await local.draft.findMany({
      where: { status: 'COMPLETED', ownerToken: null },
      include: { heroes: true },
      orderBy: { createdAt: 'asc' },
    });
    const usable = rows.filter(
      (d) => d.heroes.length === 5 && d.heroes.every((h) => h.assignedRole != null),
    );
    const previous = new Map(loadLegacySnapshot().map((d) => [d.sourceDraftId, d.createdAt]));
    const createdAts = freezeLegacyCreatedAt(
      usable.map((d) => ({ id: d.id, originalMs: parseCreatedAt(d.createdAt) })),
      previous,
      Date.now(),
      liveMaxMs,
    );
    return usable.map((d, i) => {
      const heroes = [...d.heroes].sort((a, b) => a.pickOrder - b.pickOrder);
      return {
        sourceDraftId: d.id,
        heroIds: heroes.map((h) => h.heroId),
        heroRoles: heroes.map((h) => ({ heroId: h.heroId, role: h.assignedRole as string })),
        evaluationScore: parseEvalScore(d.evaluationResult),
        createdAt: createdAts[i],
      };
    });
  } catch (err) {
    console.warn(`SQLite legacy collect skipped: ${(err as Error).message}`);
    return null;
  } finally {
    await local.$disconnect().catch(() => undefined);
  }
}

export function loadLegacySnapshot(): LegacyPlayerDraft[] {
  if (!fs.existsSync(SNAPSHOT_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf-8')) as LegacySnapshot;
  return parsed.drafts ?? [];
}

export function writeLegacySnapshot(drafts: LegacyPlayerDraft[]): void {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify({ drafts }, null, 2) + '\n', 'utf-8');
}

export async function upsertLegacyPlayerDrafts(
  pool: PoolPrismaClient,
  drafts: LegacyPlayerDraft[],
): Promise<{ written: number }> {
  let written = 0;
  for (const draft of drafts) {
    const data = {
      source: 'player',
      submitterToken: LEGACY_TOKEN,
      heroIds: draft.heroIds,
      heroRoles: draft.heroRoles as unknown as Prisma.InputJsonValue,
      evaluationScore: draft.evaluationScore,
      teamName: null as string | null,
      leagueName: null as string | null,
      createdAt: new Date(draft.createdAt),
      sourceDraftId: draft.sourceDraftId,
    };
    await pool.pooledDraft.upsert({
      where: { sourceDraftId: draft.sourceDraftId },
      create: { id: draft.sourceDraftId, ...data },
      update: {
        heroIds: data.heroIds,
        heroRoles: data.heroRoles,
        evaluationScore: data.evaluationScore,
        createdAt: data.createdAt,
        source: 'player',
        submitterToken: LEGACY_TOKEN,
        teamName: null,
        leagueName: null,
      },
    });
    written++;
  }
  return { written };
}

async function liveTokenedPlayerMaxMs(pool: PoolPrismaClient): Promise<number | null> {
  const agg = await pool.pooledDraft.aggregate({
    where: { source: 'player', submitterToken: { not: null } },
    _max: { createdAt: true },
  });
  const max = agg._max.createdAt;
  return max ? max.getTime() : null;
}

async function main() {
  // Prisma dotenv-loads server/.env into process.env on first client init.
  const envProbe = new LocalPrismaClient();
  await envProbe.$disconnect().catch(() => undefined);

  const snapshot = loadLegacySnapshot();
  let liveMaxMs: number | null = null;
  let pool: PoolPrismaClient | null = null;
  if (process.env.POOL_DATABASE_URL && process.env.POOL_DATABASE_URL.trim()) {
    pool = new PoolPrismaClient();
    liveMaxMs = await liveTokenedPlayerMaxMs(pool);
  }
  const fromSqlite = await collectLegacyDraftsFromSqlite(liveMaxMs);
  // Docker sqlite is empty/unrelated — never clobber the committed snapshot
  // with a shorter host-less collect.
  const drafts =
    fromSqlite && fromSqlite.length > 0 && fromSqlite.length >= snapshot.length
      ? fromSqlite
      : snapshot;
  if (drafts === fromSqlite) {
    writeLegacySnapshot(fromSqlite);
    console.log(`Snapshot wrote ${fromSqlite.length} drafts → ${SNAPSHOT_PATH}`);
  } else {
    console.log(`Using existing snapshot (${drafts.length} drafts)`);
  }
  if (drafts.length === 0) {
    console.log('Nothing to backfill.');
    await pool?.$disconnect().catch(() => undefined);
    return;
  }

  if (!pool) {
    console.log('POOL_DATABASE_URL unset — snapshot is ready; start Compose to upsert into Postgres.');
    return;
  }

  try {
    const { written } = await upsertLegacyPlayerDrafts(pool, drafts);
    console.log(`Upserted ${written} legacy player drafts into the opponent pool.`);
  } finally {
    await pool.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
