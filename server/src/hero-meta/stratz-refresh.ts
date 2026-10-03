// Pure building blocks of the post-patch STRATZ refresh
// (server/scripts/refresh-stratz.ts, Blueprint/13-deploy.md "After a patch:
// refresh real data"). No fs, no network: the script does the I/O and these
// functions do the math, so they are unit-tested with small fixtures.
//
// The pair construction is the frozen "CLEANED STRATZ pairs" (STZC) recipe of
// Blueprint/16-variance-lab.md (lab code: server/scripts/lab/stratz-pairs-build.ts):
// both brackets summed, mirror-averaged, then the logit-additive hero-strength
// expectation is removed and the rate re-centred on 0.5, stored as
// wins = rate × games so production shrinkage (K) applies unchanged.
import { shrinkTowardNeutral } from './hero-meta.service';

export const REFRESH_BRACKETS = ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'] as const;
export type RefreshBracket = (typeof REFRESH_BRACKETS)[number];

// ---------- weeks ----------
// STRATZ buckets `week` as a Unix week: floor(epochSeconds / 604800) × 604800,
// i.e. weeks start on Thursday 00:00 UTC (the payload rows carry the index,
// e.g. week 2958 = 1788998400 = Thu 2026-09-10). A `week` argument inside a
// bucket returns that bucket, so we always normalise to the bucket start.
export const WEEK_SECONDS = 7 * 24 * 3600;

export function stratzWeekStart(epochSeconds: number): number {
  return Math.floor(epochSeconds / WEEK_SECONDS) * WEEK_SECONDS;
}

/** Start of the last STRATZ week that has fully ended before `nowMs`. */
export function latestCompleteWeek(nowMs: number): number {
  return stratzWeekStart(Math.floor(nowMs / 1000)) - WEEK_SECONDS;
}

/** Accepts epoch seconds or YYYY-MM-DD (UTC); returns the STRATZ week start. */
export function parseWeekArg(arg: string): number {
  const trimmed = arg.trim();
  if (/^\d+$/.test(trimmed)) return stratzWeekStart(Number(trimmed));
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const ms = Date.parse(`${trimmed}T00:00:00Z`);
    if (!Number.isNaN(ms)) return stratzWeekStart(ms / 1000);
  }
  throw new Error(`--week must be epoch seconds or YYYY-MM-DD, got "${arg}"`);
}

export function weekRangeLabel(week: number): string {
  const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
  return `${day(week)} .. ${day(week + WEEK_SECONDS - 1)} (UTC)`;
}

// ---------- hero win / match counts (heroStats.stats, time = 0) ----------
export interface StatsRow {
  heroId: number;
  time: number;
  matchCount: number;
  winCount: number;
}

export interface Tally {
  g: number;
  w: number;
}

/** Sums the time = 0 rows (all positions) of every bracket into per-hero totals. */
export function heroTotalsFromStats(rowsPerBracket: StatsRow[][]): Map<number, Tally> {
  const out = new Map<number, Tally>();
  for (const rows of rowsPerBracket)
    for (const r of rows) {
      if (r.time !== 0) continue;
      const c = out.get(r.heroId) ?? { g: 0, w: 0 };
      c.g += r.matchCount;
      c.w += r.winCount;
      out.set(r.heroId, c);
    }
  return out;
}

// ---------- pairs (heroStats.heroVsHeroMatchup) ----------
export interface PairEntry {
  heroId2: number;
  matchCount: number;
  winCount: number;
}

export interface PairRaw {
  heroId: number;
  advantage: { with: PairEntry[]; vs: PairEntry[] } | null;
}

/** Key "h-o" (ordered) → tally. */
export type PairCounts = Map<string, Tally>;
export interface PairSet {
  with: PairCounts;
  vs: PairCounts;
}

const key = (a: number, b: number) => `${a}-${b}`;
const split = (k: string): [number, number] => {
  const [a, b] = k.split('-').map(Number);
  return [a, b];
};

/** Sums the per-hero payloads of all brackets. */
export function sumPairs(raws: PairRaw[]): PairSet {
  const set: PairSet = { with: new Map(), vs: new Map() };
  for (const r of raws) {
    if (!r.advantage) continue;
    for (const kind of ['with', 'vs'] as const)
      for (const e of r.advantage[kind]) {
        const k = key(r.heroId, e.heroId2);
        const c = set[kind].get(k) ?? { g: 0, w: 0 };
        c.g += e.matchCount;
        c.w += e.winCount;
        set[kind].set(k, c);
      }
  }
  return set;
}

export interface SharePrecheck {
  medianMirrorRatio: number;
  rOwnOrientation: number;
  meanDeviationPp: number;
  pass: boolean;
}

/**
 * Amended share-level pre-check (author-approved 2026-10-02): mirror counts of a
 * matchup differ by sampling, but h's rate must agree with 1 − o's rate.
 * Pass: |median count ratio − 1| ≤ 0.02, r ≥ 0.9, mean |w_ho + w_oh − 1| ≤ 2.5 pp.
 */
export function sharePrecheck(vs: PairCounts): SharePrecheck {
  const ratios: number[] = [];
  const pairs: [number, number][] = [];
  const devs: number[] = [];
  for (const [k, v] of vs) {
    const [h, o] = split(k);
    if (h > o) continue;
    const r = vs.get(key(o, h));
    if (!r || !v.g || !r.g) continue;
    ratios.push(v.g / r.g);
    pairs.push([v.w / v.g, 1 - r.w / r.g]);
    devs.push(Math.abs(v.w / v.g + r.w / r.g - 1));
  }
  if (pairs.length === 0)
    return { medianMirrorRatio: NaN, rOwnOrientation: NaN, meanDeviationPp: NaN, pass: false };
  const medianMirrorRatio = [...ratios].sort((x, y) => x - y)[Math.floor(ratios.length / 2)];
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let c = 0;
  let sx = 0;
  let sy = 0;
  for (const [a, b] of pairs) {
    c += (a - mx) * (b - my);
    sx += (a - mx) ** 2;
    sy += (b - my) ** 2;
  }
  const rOwnOrientation = sx > 0 && sy > 0 ? c / Math.sqrt(sx * sy) : NaN;
  const meanDeviationPp = (devs.reduce((s, v) => s + v, 0) / devs.length) * 100;
  const pass = Math.abs(medianMirrorRatio - 1) <= 0.02 && rOwnOrientation >= 0.9 && meanDeviationPp <= 2.5;
  return { medianMirrorRatio, rOwnOrientation, meanDeviationPp, pass };
}

/**
 * Mirror averaging: synergy (h,a) = mean of (h,a) and (a,h); matchup (h,o) =
 * mean of h's view and the flipped o's view. A missing mirror falls back to the
 * row itself (same as the lab build).
 */
export function mirrorAverage(set: PairSet): PairSet {
  const withOut: PairCounts = new Map();
  for (const [k, v] of set.with) {
    const [h, a] = split(k);
    const r = set.with.get(key(a, h)) ?? v;
    withOut.set(k, { g: (v.g + r.g) / 2, w: (v.w + r.w) / 2 });
  }
  const vsOut: PairCounts = new Map();
  for (const [k, v] of set.vs) {
    const [h, o] = split(k);
    const r = set.vs.get(key(o, h)) ?? { g: v.g, w: v.g - v.w };
    vsOut.set(k, { g: (v.g + r.g) / 2, w: (v.w + (r.g - r.w)) / 2 });
  }
  return { with: withOut, vs: vsOut };
}

/** Unordered pairs (over `ids`) that have both a `with` and a `vs` sample. */
export function pairCoverage(
  set: PairSet,
  ids: number[],
): { pairs: number; coveredBoth: number; frac: number } {
  let covered = 0;
  let pairs = 0;
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      pairs++;
      if ((set.vs.get(key(ids[i], ids[j]))?.g ?? 0) > 0 && (set.with.get(key(ids[i], ids[j]))?.g ?? 0) > 0)
        covered++;
    }
  return { pairs, coveredBoth: covered, frac: pairs ? covered / pairs : 0 };
}

// ---------- cleaning ----------
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** No-interaction expectation for h vs o: σ(logit W_h − logit W_o). */
export function expectedMatchup(wh: number, wo: number): number {
  return sigmoid(logit(wh) - logit(wo));
}

/** No-interaction expectation for h with ally a: σ(logit W_h + logit W_a). */
export function expectedSynergy(wh: number, wa: number): number {
  return sigmoid(logit(wh) + logit(wa));
}

/** clamp(0.5 + (observed − expected), 0.01, 0.99). */
export function cleanRate(observed: number, expected: number): number {
  return Math.min(0.99, Math.max(0.01, 0.5 + (observed - expected)));
}

export interface SynergyEntry {
  allyHeroId: number;
  games: number;
  wins: number;
}
export interface MatchupEntry {
  opponentHeroId: number;
  games: number;
  wins: number;
}
export interface CleanedPairs {
  synergy: Map<number, SynergyEntry[]>;
  matchups: Map<number, MatchupEntry[]>;
  /** ordered entries dropped because a hero had no base win rate */
  droppedNoBase: number;
}

/** Builds per-hero cleaned entries (sorted by the other hero's id) from mirror-averaged counts. */
export function cleanPairs(avg: PairSet, baseWinRate: (heroId: number) => number | undefined): CleanedPairs {
  const synergy = new Map<number, SynergyEntry[]>();
  const matchups = new Map<number, MatchupEntry[]>();
  let droppedNoBase = 0;
  for (const [k, v] of avg.with) {
    const [h, a] = split(k);
    const wh = baseWinRate(h);
    const wa = baseWinRate(a);
    if (wh === undefined || wa === undefined || v.g <= 0) {
      droppedNoBase++;
      continue;
    }
    const rate = cleanRate(v.w / v.g, expectedSynergy(wh, wa));
    const list = synergy.get(h) ?? [];
    list.push({ allyHeroId: a, games: v.g, wins: rate * v.g });
    synergy.set(h, list);
  }
  for (const [k, v] of avg.vs) {
    const [h, o] = split(k);
    const wh = baseWinRate(h);
    const wo = baseWinRate(o);
    if (wh === undefined || wo === undefined || v.g <= 0) {
      droppedNoBase++;
      continue;
    }
    const rate = cleanRate(v.w / v.g, expectedMatchup(wh, wo));
    const list = matchups.get(h) ?? [];
    list.push({ opponentHeroId: o, games: v.g, wins: rate * v.g });
    matchups.set(h, list);
  }
  for (const list of synergy.values()) list.sort((x, y) => x.allyHeroId - y.allyHeroId);
  for (const list of matchups.values()) list.sort((x, y) => x.opponentHeroId - y.opponentHeroId);
  return { synergy, matchups, droppedNoBase };
}

// ---------- proposed hero-meta ----------
export interface HeroMetaHero {
  heroId: number;
  winRate: number | null;
  synergy: SynergyEntry[];
  matchups: MatchupEntry[];
  [field: string]: unknown;
}
export interface HeroMetaFile {
  generatedAt?: string;
  heroes: HeroMetaHero[];
  [field: string]: unknown;
}

export interface ProposalInput {
  week: number;
  totals: Map<number, Tally>;
  cleaned: CleanedPairs;
  generatedAt: string;
}

/**
 * Copy of `current` with winRate (raw wins / matches, as fetch-hero-meta stores
 * it) and synergy / matchups replaced. Everything else (positions, benchmarks,
 * coefficients) is untouched. Heroes absent from the STRATZ stats keep their
 * old winRate and get empty pair lists only if the pull had none for them.
 */
export function buildProposedHeroMeta(current: HeroMetaFile, input: ProposalInput): HeroMetaFile {
  const copy = JSON.parse(JSON.stringify(current)) as HeroMetaFile;
  const brackets = REFRESH_BRACKETS.join('+');
  copy.generatedAt = input.generatedAt;
  copy.winRateSource = `STRATZ heroStats.stats time=0, ${brackets}, week ${input.week}`;
  copy.pairSource = `STRATZ heroVsHeroMatchup CLEANED (logit-additive base WR removed), ${brackets}, week ${input.week}`;
  for (const h of copy.heroes) {
    const t = input.totals.get(h.heroId);
    if (t && t.g > 0) h.winRate = t.w / t.g;
    h.synergy = input.cleaned.synergy.get(h.heroId) ?? [];
    h.matchups = input.cleaned.matchups.get(h.heroId) ?? [];
  }
  return copy;
}

/** Which parts of a proposal `apply` copies over the current file. */
export type ApplyPart = 'winRate' | 'pairs';

export function mergeParts(current: HeroMetaFile, proposed: HeroMetaFile, parts: ApplyPart[]): HeroMetaFile {
  const out = JSON.parse(JSON.stringify(current)) as HeroMetaFile;
  const byId = new Map(proposed.heroes.map((h) => [h.heroId, h]));
  out.generatedAt = proposed.generatedAt;
  if (parts.includes('winRate')) out.winRateSource = proposed.winRateSource;
  if (parts.includes('pairs')) out.pairSource = proposed.pairSource;
  for (const h of out.heroes) {
    const p = byId.get(h.heroId);
    if (!p) continue;
    if (parts.includes('winRate')) h.winRate = p.winRate;
    if (parts.includes('pairs')) {
      h.synergy = p.synergy;
      h.matchups = p.matchups;
    }
  }
  return out;
}

// ---------- diff summary ----------
export interface Mover {
  heroId: number;
  otherHeroId?: number;
  before: number | null;
  after: number | null;
  deltaPp: number;
  games?: number;
}

export interface DiffSummary {
  heroes: number;
  winRate: {
    updated: number;
    keptOld: number[];
    movedOver1pp: number;
    meanAbsDeltaPp: number;
    topMovers: Mover[];
  };
  picks: {
    totalHeroMatches: number;
    minHero: { heroId: number; matches: number } | null;
    medianMatches: number;
  };
  pairs: {
    synergyEntries: { before: number; after: number };
    matchupEntries: { before: number; after: number };
    medianGames: { synergyBefore: number; synergyAfter: number; matchupBefore: number; matchupAfter: number };
    topMatchupMovers: Mover[];
    topSynergyMovers: Mover[];
  };
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function shrunk(e: { games: number; wins: number } | undefined, k: number): number | null {
  return e && e.games > 0 ? shrinkTowardNeutral(e.wins / e.games, e.games, k) : null;
}

function pairMovers(
  current: HeroMetaFile,
  proposed: HeroMetaFile,
  pick: (h: HeroMetaHero) => { other: number; games: number; wins: number }[],
  k: number,
  top: number,
): Mover[] {
  const before = new Map<string, { games: number; wins: number }>();
  for (const h of current.heroes) for (const e of pick(h)) before.set(key(h.heroId, e.other), e);
  const after = new Map<string, { games: number; wins: number }>();
  for (const h of proposed.heroes) for (const e of pick(h)) after.set(key(h.heroId, e.other), e);
  const movers: Mover[] = [];
  for (const k2 of new Set([...before.keys(), ...after.keys()])) {
    const [h, o] = split(k2);
    const b = shrunk(before.get(k2), k);
    const a = shrunk(after.get(k2), k);
    movers.push({
      heroId: h,
      otherHeroId: o,
      before: b,
      after: a,
      deltaPp: round(((a ?? 0.5) - (b ?? 0.5)) * 100),
    });
  }
  movers.sort((x, y) => Math.abs(y.deltaPp) - Math.abs(x.deltaPp) || x.heroId - y.heroId);
  return movers.slice(0, top);
}

/** Structural diff of a proposed hero-meta vs the current one (pair rates shrunk with K, as served). */
export function diffSummary(
  current: HeroMetaFile,
  proposed: HeroMetaFile,
  totals: Map<number, Tally>,
  shrinkageK: number,
  top = 10,
): DiffSummary {
  const curById = new Map(current.heroes.map((h) => [h.heroId, h]));
  const wrMovers: Mover[] = [];
  const keptOld: number[] = [];
  for (const p of proposed.heroes) {
    const t = totals.get(p.heroId);
    if (!t || t.g <= 0) {
      keptOld.push(p.heroId);
      continue;
    }
    const before = curById.get(p.heroId)?.winRate ?? null;
    const after = p.winRate;
    wrMovers.push({
      heroId: p.heroId,
      before,
      after,
      deltaPp: round(((after ?? 0) - (before ?? after ?? 0)) * 100),
      games: t.g,
    });
  }
  const abs = wrMovers.map((m) => Math.abs(m.deltaPp));
  const sortedWr = [...wrMovers].sort(
    (x, y) => Math.abs(y.deltaPp) - Math.abs(x.deltaPp) || x.heroId - y.heroId,
  );
  const matches = proposed.heroes.map((h) => ({ heroId: h.heroId, matches: totals.get(h.heroId)?.g ?? 0 }));
  const minHero = matches.length ? matches.reduce((m, x) => (x.matches < m.matches ? x : m)) : null;
  const syn = (f: HeroMetaFile) => f.heroes.flatMap((h) => h.synergy);
  const mat = (f: HeroMetaFile) => f.heroes.flatMap((h) => h.matchups);
  return {
    heroes: proposed.heroes.length,
    winRate: {
      updated: wrMovers.length,
      keptOld,
      movedOver1pp: abs.filter((x) => x > 1).length,
      meanAbsDeltaPp: abs.length ? round(abs.reduce((s, x) => s + x, 0) / abs.length) : 0,
      topMovers: sortedWr.slice(0, top),
    },
    picks: {
      // each match counts 10 hero appearances; this is the sum of hero rows
      totalHeroMatches: matches.reduce((s, x) => s + x.matches, 0),
      minHero,
      medianMatches: median(matches.map((x) => x.matches)),
    },
    pairs: {
      synergyEntries: { before: syn(current).length, after: syn(proposed).length },
      matchupEntries: { before: mat(current).length, after: mat(proposed).length },
      medianGames: {
        synergyBefore: round(median(syn(current).map((e) => e.games)), 1),
        synergyAfter: round(median(syn(proposed).map((e) => e.games)), 1),
        matchupBefore: round(median(mat(current).map((e) => e.games)), 1),
        matchupAfter: round(median(mat(proposed).map((e) => e.games)), 1),
      },
      topMatchupMovers: pairMovers(
        current,
        proposed,
        (h) => h.matchups.map((e) => ({ other: e.opponentHeroId, games: e.games, wins: e.wins })),
        shrinkageK,
        top,
      ),
      topSynergyMovers: pairMovers(
        current,
        proposed,
        (h) => h.synergy.map((e) => ({ other: e.allyHeroId, games: e.games, wins: e.wins })),
        shrinkageK,
        top,
      ),
    },
  };
}

/** Markdown rendering of the diff summary (names resolved by the caller). */
export function renderDiffMarkdown(
  week: number,
  summary: DiffSummary,
  checks: Record<string, unknown>,
  name: (heroId: number) => string,
): string {
  const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
  const lines: string[] = [];
  lines.push(`# STRATZ refresh — week ${week} (${weekRangeLabel(week)}) — PROPOSED, not applied`, '');
  lines.push('`server/data/hero-meta.json` is untouched. Applying needs the author\'s explicit "ok".', '');
  lines.push('## Pre-checks', '', '```json', JSON.stringify(checks, null, 2), '```', '');
  const w = summary.winRate;
  lines.push('## winRate', '');
  lines.push(
    `- updated ${w.updated}/${summary.heroes}; kept old (no STRATZ rows): ${w.keptOld.length ? w.keptOld.map(name).join(', ') : 'none'}`,
  );
  lines.push(`- moved by > 1 pp: **${w.movedOver1pp}**; mean |Δ| ${w.meanAbsDeltaPp} pp`);
  const p = summary.picks;
  lines.push(
    `- hero rows: ${p.totalHeroMatches}; median per hero ${p.medianMatches}; lowest ${p.minHero ? `${name(p.minHero.heroId)} (${p.minHero.matches})` : '—'}`,
    '',
  );
  lines.push('| hero | before | after | Δ pp | matches |', '|---|---:|---:|---:|---:|');
  for (const m of w.topMovers)
    lines.push(
      `| ${name(m.heroId)} | ${pct(m.before)} | ${pct(m.after)} | ${m.deltaPp} | ${m.games ?? ''} |`,
    );
  const pr = summary.pairs;
  lines.push('', '## Pairs', '', '| scope | before | after |', '|---|---:|---:|');
  lines.push(`| synergy entries | ${pr.synergyEntries.before} | ${pr.synergyEntries.after} |`);
  lines.push(`| matchup entries | ${pr.matchupEntries.before} | ${pr.matchupEntries.after} |`);
  lines.push(
    `| median games / synergy entry | ${pr.medianGames.synergyBefore} | ${pr.medianGames.synergyAfter} |`,
  );
  lines.push(
    `| median games / matchup entry | ${pr.medianGames.matchupBefore} | ${pr.medianGames.matchupAfter} |`,
  );
  for (const [title, movers] of [
    ['matchups', pr.topMatchupMovers],
    ['synergy', pr.topSynergyMovers],
  ] as const) {
    lines.push(
      '',
      `### Top |Δ shrunk rate| — ${title}`,
      '',
      '| hero | other | before | after | Δ pp |',
      '|---|---|---:|---:|---:|',
    );
    for (const m of movers)
      lines.push(
        `| ${name(m.heroId)} | ${name(m.otherHeroId ?? 0)} | ${pct(m.before)} | ${pct(m.after)} | ${m.deltaPp} |`,
      );
  }
  lines.push('');
  return lines.join('\n');
}
