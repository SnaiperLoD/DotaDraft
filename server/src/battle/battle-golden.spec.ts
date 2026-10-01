// Golden snapshot of the Battle math (Blueprint/15-dev-plan-2026-10.md, T0.2).
// Fixed-seed 5v5 drafts from the local heroes.json + hero-meta.json snapshot,
// scored by assessBattle. Any change to weights, tags, multipliers, phases or
// thresholds moves at least one row and fails this spec. Story/explanation text
// is deliberately not part of the snapshot.
//
// Regenerate only after an approved calibration change (Calibration Change Rule):
//   UPDATE_GOLDEN=1 npx jest src/battle/battle-golden.spec.ts
import * as fs from 'fs';
import * as path from 'path';
import type { DraftRole, Hero } from 'shared';
import { ROLES } from 'shared';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { assessBattle, type BattlePick } from './battle-resolution';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const GOLDEN_PATH = path.join(__dirname, '..', '..', 'test', 'golden', 'battle-outcomes.json');
const SEED = 20261001;
const PAIRS = 600;
const ROLES_LIST = [...ROLES] as DraftRole[];

interface GoldenRow {
  a: number[];
  b: number[];
  rolesA: DraftRole[];
  rolesB: DraftRole[];
  advantageDirection: string;
  confidenceTier: string;
  rawAdvantageDirection: string;
  diff: number;
  rawDiff: number;
  powerA: number;
  powerB: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

function loadHeroes(): Hero[] {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf8')) as Hero[];
  const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf8')) as {
    heroes: { heroId: number; positions: Hero['presumed_positions'] }[];
  };
  const positionsById = new Map(meta.heroes.map((h) => [h.heroId, h.positions ?? []]));
  return raw.map((hero) => ({
    ...hero,
    presumed_positions: positionsById.get(hero.id) ?? hero.presumed_positions ?? [],
    evaluation_values_by_role: hero.evaluation_values_by_role ?? {
      Carry: { no_info: true },
      Mid: { no_info: true },
      Offlane: { no_info: true },
      Support: { no_info: true },
    },
  }));
}

function buildRows(): GoldenRow[] {
  const heroes = loadHeroes();
  const lookup = new HeroMetaService();
  const rand = mulberry32(SEED);
  const rows: GoldenRow[] = [];

  for (let i = 0; i < PAIRS; i++) {
    const pool = shuffle(heroes, rand);
    // Shuffled role order so role-aware values are exercised, not only the
    // fixed Carry..Support slotting.
    const rolesA = shuffle(ROLES_LIST, rand);
    const rolesB = shuffle(ROLES_LIST, rand);
    const teamA: BattlePick[] = pool.slice(0, 5).map((hero, k) => ({ hero, assignedRole: rolesA[k] }));
    const teamB: BattlePick[] = pool.slice(5, 10).map((hero, k) => ({ hero, assignedRole: rolesB[k] }));
    const result = assessBattle(teamA, teamB, lookup);
    rows.push({
      a: teamA.map((p) => p.hero.id),
      b: teamB.map((p) => p.hero.id),
      rolesA,
      rolesB,
      advantageDirection: result.advantageDirection,
      confidenceTier: result.confidenceTier,
      rawAdvantageDirection: result.rawAdvantageDirection,
      diff: round(result.diff),
      rawDiff: round(result.rawDiff),
      powerA: round(result.powerA),
      powerB: round(result.powerB),
    });
  }
  return rows;
}

describe('Battle golden snapshot (assessBattle math is unchanged)', () => {
  const rows = buildRows();

  if (process.env.UPDATE_GOLDEN === '1') {
    it('writes the golden file', () => {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify({ seed: SEED, pairs: PAIRS, rows }, null, 0) + '\n');
      expect(rows).toHaveLength(PAIRS);
    });
    return;
  }

  it('matches every recorded outcome', () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as {
      seed: number;
      pairs: number;
      rows: GoldenRow[];
    };
    expect(golden.seed).toBe(SEED);
    expect(golden.pairs).toBe(PAIRS);
    const mismatches = rows
      .map((row, i) => ({ i, row, want: golden.rows[i] }))
      .filter(({ row, want }) => JSON.stringify(row) !== JSON.stringify(want));
    // Report only the first few so a formula change gives a readable diff.
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('covers every direction and tier', () => {
    expect(new Set(rows.map((r) => r.advantageDirection))).toEqual(new Set(['A', 'B', 'Even']));
    expect(new Set(rows.map((r) => r.confidenceTier))).toEqual(new Set(['Low', 'Moderate', 'High']));
  });
});
