// Variance Lab shared helpers (Blueprint/16-variance-lab.md).
// Lab rules: never write server/data/*; never patch axis-weights.json on disk.
// realWinRateWeight is toggled IN MEMORY only (battle-resolution.ts reads
// axisWeightsConfig.realWinRateWeight at call time, not at import time).
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { axisWeightsConfig } from '../../src/common/axis-weights-config';
import { BATTLE_SHADOW } from '../../src/battle/battle-shadow';
import { ROLES, CUSTOM_TAG_DEFINITIONS } from 'shared';
import type { Hero } from 'shared';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
export const DATA_DIR = path.join(REPO_ROOT, 'server', 'data');
export const LAB_DIR = path.join(REPO_ROOT, 'artifacts', 'lab');
export const RUNS_JSONL = path.join(LAB_DIR, 'runs.jsonl');

export function ensureLabDir(...seg: string[]): string {
  const d = path.join(LAB_DIR, ...seg);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export const HIDDEN_CALIBRATION_TAGS: string[] = CUSTOM_TAG_DEFINITIONS.filter(
  (d) => !d.visible && !d.revealable,
).map((d) => d.name);

/** In-process only. Never touches the file on disk. */
export function setRealWinRateWeightInMemory(w: number): void {
  axisWeightsConfig.realWinRateWeight = w;
}

export function assertLabPreconditions(): void {
  if (BATTLE_SHADOW !== 'off') throw new Error(`DOTADRAFT_BATTLE_SHADOW must be off, got ${BATTLE_SHADOW}`);
}

// ---------- hashing / run log ----------

export function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function fileHash(p: string): string {
  return sha256(fs.readFileSync(p)).slice(0, 16);
}

/** Hashes of every input that can move Battle math (data + code). */
export function inputFingerprint(): Record<string, string> {
  const files = [
    'server/data/axis-weights.json',
    'server/data/battle-diff-inputs.json',
    'server/data/heroes.json',
    'server/data/hero-meta.json',
    'server/src/battle/battle-resolution.ts',
    'server/src/battle/custom-tags.ts',
    'server/src/common/calibration-tags.ts',
    'server/src/assessment-core/axis-average.ts',
    'server/src/common/role-fit.ts',
    'shared/customTags.ts',
  ];
  return Object.fromEntries(
    files.map((f) => {
      const p = path.join(REPO_ROOT, f);
      return [f, fs.existsSync(p) ? fileHash(p) : 'missing'];
    }),
  );
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

export function configHash(config: unknown): string {
  return sha256(stableStringify(config)).slice(0, 16);
}

function gitHead(): string {
  try {
    const head = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT }).toString().trim();
    const dirty = execSync('git status --porcelain', { cwd: REPO_ROOT }).toString().trim().length > 0;
    return dirty ? `${head}+dirty` : head;
  } catch {
    return 'unknown';
  }
}

export function appendRun(entry: {
  kind: string;
  label: string;
  config: unknown;
  seed: number;
  nMatches: number;
  metrics: unknown;
  wallMs: number;
  notes?: string;
}): void {
  ensureLabDir();
  const row = {
    ts: new Date().toISOString(),
    git: gitHead(),
    configHash: configHash(entry.config),
    inputs: inputFingerprint(),
    ...entry,
  };
  fs.appendFileSync(RUNS_JSONL, JSON.stringify(row) + '\n');
}

// ---------- KPI (same definitions as run-r0-calibration.ts) ----------

export interface HeroRow {
  heroId: number;
  name: string;
  favoredRate: number;
  realWinRate: number | null;
}

export interface Kpi {
  n: number;
  r: number;
  maePp: number;
  coverage7Pct: number;
  flagged10: number;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
}

export function kpi(rows: HeroRow[]): Kpi {
  const ok = rows.filter((h) => h.realWinRate != null);
  const div = ok.map((h) => h.favoredRate - (h.realWinRate as number));
  return {
    n: ok.length,
    r: pearson(
      ok.map((h) => h.favoredRate),
      ok.map((h) => h.realWinRate as number),
    ),
    maePp: mean(div.map(Math.abs)) * 100,
    coverage7Pct: (div.filter((d) => Math.abs(d) <= 0.07).length / ok.length) * 100,
    flagged10: div.filter((d) => Math.abs(d) >= 0.1).length,
  };
}

// ---------- pool (verbatim copy of simulate-self-play.ts draw order) ----------
// Copied, not imported: those helpers are module-private there. Equivalence
// is gated, not assumed — build-feature-cache.ts checks per-hero appearances
// and favoredRate against runSimulation()'s own heroTable.

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RawHeroMetaEntry {
  heroId: number;
  positions: { position: string; share: number }[];
  winRate: number | null;
}

export function loadHeroes(): { heroes: Hero[]; winRateById: Map<number, number | null>; positionsById: Map<number, { position: string; share: number }[]> } {
  const heroes: Hero[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'heroes.json'), 'utf-8'));
  const { heroes: meta }: { heroes: RawHeroMetaEntry[] } = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'hero-meta.json'), 'utf-8'),
  );
  const positionsById = new Map(meta.map((e) => [e.heroId, e.positions]));
  for (const h of heroes) h.presumed_positions = (positionsById.get(h.id) ?? []) as Hero['presumed_positions'];
  return { heroes, winRateById: new Map(meta.map((e) => [e.heroId, e.winRate])), positionsById };
}

export function blendedRoleWeights(positions: { position: string; share: number }[]): Record<string, number> {
  const w: Record<string, number> = { Carry: 0, Mid: 0, Offlane: 0, 'Soft Support': 0, 'Hard Support': 0 };
  let allocated = 0;
  for (const p of positions) {
    if (p.position === 'Carry') {
      w.Carry += p.share;
      allocated += p.share;
    } else if (p.position === 'Mid') {
      w.Mid += p.share;
      allocated += p.share;
    } else if (p.position === 'Offlane') {
      w.Offlane += p.share;
      allocated += p.share;
    } else if (p.position === 'Support') {
      w['Soft Support'] += p.share / 2;
      w['Hard Support'] += p.share / 2;
      allocated += p.share;
    }
  }
  const leftover = Math.max(0, 1 - allocated);
  for (const role of ROLES) w[role] += leftover / ROLES.length;
  return w;
}

export interface PoolMatch {
  heroIdx: number[]; // 10 indices into heroes[]; 0-4 team A, 5-9 team B
  roles: string[]; // 10 assigned roles
}

/** Generates the blended-role pool exactly like runSimulation(roleMode='blended'). */
export function* generatePool(heroes: Hero[], positionsById: Map<number, { position: string; share: number }[]>, seed: number, n: number): Generator<PoolMatch> {
  const rng = mulberry32(seed);
  const shuffle = <T>(arr: readonly T[]): T[] => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const weightsById = new Map(heroes.map((h) => [h.id, blendedRoleWeights(positionsById.get(h.id) ?? [])]));
  const assign = (team: Hero[]): string[] => {
    const order = shuffle(team.map((_, i) => i));
    const rolesLeft = [...ROLES] as string[];
    const assigned: string[] = new Array(team.length);
    for (const idx of order) {
      const w = weightsById.get(team[idx].id) ?? Object.fromEntries(ROLES.map((r) => [r, 1]));
      const weights = rolesLeft.map((r) => Math.max(0.001, w[r] ?? 0.001));
      const total = weights.reduce((a, b) => a + b, 0);
      let roll = rng() * total;
      let pick = rolesLeft.length - 1;
      for (let i = 0; i < weights.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          pick = i;
          break;
        }
      }
      assigned[idx] = rolesLeft[pick];
      rolesLeft.splice(pick, 1);
    }
    return assigned;
  };
  const indexById = new Map(heroes.map((h, i) => [h.id, i]));
  for (let m = 0; m < n; m++) {
    const drawn = shuffle(heroes).slice(0, 10);
    const a = drawn.slice(0, 5);
    const b = drawn.slice(5);
    const ra = assign(a);
    const rb = assign(b);
    yield { heroIdx: drawn.map((h) => indexById.get(h.id)!), roles: [...ra, ...rb] };
  }
}
