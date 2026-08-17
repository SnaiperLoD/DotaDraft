import * as fs from 'fs';
import * as path from 'path';
import { AXES } from '../src/battle/battle-resolution';
import { createAxisAnalyzer } from '../src/evaluation/analyzers/axis.analyzer';
import { createSynergyAnalyzer } from '../src/evaluation/analyzers/synergy.analyzer';
import { createProSimilarityAnalyzer } from '../src/evaluation/analyzers/pro-similarity.analyzer';
import { HeroMetaService } from '../src/hero-meta/hero-meta.service';
import { buildEvaluationScoreWeights } from '../src/common/axis-weights-config';
import { ROLES } from 'shared';
import type { Hero, HeroEvaluationValues } from 'shared';
import type { DraftPick } from '../src/evaluation/analyzer.interface';
import type { ProComposition } from '../src/pro-match/pro-match.service';

// Percentile calibration for Evaluation's "where does this draft rank"
// display. Scores unique Ancient+Divine 5-hero drafts from OpenDota
// `GET /api/publicMatches` through the REAL createAxisAnalyzer() plus
// synergy and proSimilarity — same Total Score ingredients as
// evaluation.service.ts (WEIGHTS from buildEvaluationScoreWeights()).
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const PRO_MATCHES_PATH = path.join(__dirname, '..', 'data', 'pro-matches.json');
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'axis-percentile-distributions.json');

const TARGET_UNIQUE = 50_000;
const TEAM_SIZE = 5;
const PUBLIC_MATCHES_URL = 'https://api.opendota.com/api/publicMatches';
// heroStats buckets 6+7 (Ancient + Divine). OpenDota rank_tier = medal*10 + stars;
// medal 6 = Ancient (~61–69), medal 7 = Divine (~71–79). Immortal (>=80) is empty.
const MIN_RANK = 60;
const MAX_RANK = 79;
const REQUEST_PAUSE_MS = 400;
const MAX_MATCHES_SCANNED = 80_000;
const MAX_CONSECUTIVE_FAILURES = 10;

const AXES_TO_SAMPLE: (keyof HeroEvaluationValues)[] = [...AXES];

const WEIGHTS: Record<string, number> = buildEvaluationScoreWeights();

interface PublicMatch {
  match_id: number;
  start_time?: number;
  duration?: number;
  avg_rank_tier?: number;
  radiant_team?: unknown;
  dire_team?: unknown;
}

interface StoredProMatch {
  matchId: string;
  radiantName: string | null;
  direName: string | null;
  leagueName: string | null;
  radiantWin: boolean;
  radiantHeroIds: number[];
  direHeroIds: number[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roleWeights(positions: { position: string; share: number }[]): Record<string, number> {
  const w: Record<string, number> = { Carry: 0, Mid: 0, Offlane: 0, 'Soft Support': 0, 'Hard Support': 0 };
  let allocated = 0;
  for (const p of positions) {
    if (p.position === 'Carry') { w.Carry += p.share; allocated += p.share; }
    else if (p.position === 'Mid') { w.Mid += p.share; allocated += p.share; }
    else if (p.position === 'Offlane') { w.Offlane += p.share; allocated += p.share; }
    else if (p.position === 'Support') { w['Soft Support'] += p.share / 2; w['Hard Support'] += p.share / 2; allocated += p.share; }
  }
  const leftover = Math.max(0, 1 - allocated);
  for (const role of ROLES) w[role] += leftover / ROLES.length;
  return w;
}

function assignWeightedRoles(heroes: Hero[], weightsById: Map<number, Record<string, number>>): string[] {
  const order = shuffle(heroes.map((_, i) => i));
  const rolesLeft = [...ROLES] as string[];
  const assigned: string[] = new Array(heroes.length);
  for (const idx of order) {
    const w = weightsById.get(heroes[idx].id) ?? Object.fromEntries(ROLES.map((r) => [r, 1]));
    const weights = rolesLeft.map((r) => Math.max(0.001, w[r] ?? 0.001));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let pick = rolesLeft.length - 1;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { pick = i; break; }
    }
    assigned[idx] = rolesLeft[pick];
    rolesLeft.splice(pick, 1);
  }
  return assigned;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentileOf(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function weightedTotal(scoresByKey: Record<string, number | null>): number {
  const entries = Object.entries(WEIGHTS).filter(([key]) => scoresByKey[key] != null);
  const availableWeight = entries.reduce((sum, [key]) => sum + WEIGHTS[key], 0);
  if (availableWeight === 0) return 0;
  const total = entries.reduce((sum, [key, weight]) => sum + (scoresByKey[key] as number) * (weight / availableWeight), 0);
  return Math.round(total * 10) / 10;
}

function isAncientOrDivine(avgRankTier: number | undefined): boolean {
  if (!Number.isFinite(avgRankTier)) return false;
  const medal = Math.floor(avgRankTier as number / 10);
  return medal === 6 || medal === 7;
}

function parseTeam(raw: unknown, validHeroIds: Set<number>): number[] | null {
  let ids: number[] = [];
  if (Array.isArray(raw)) ids = raw.map(Number);
  else if (typeof raw === 'string') ids = raw.split(',').map((s) => Number(s.trim()));
  else return null;
  if (ids.length !== TEAM_SIZE) return null;
  if (ids.some((id) => !Number.isInteger(id) || id <= 0 || !validHeroIds.has(id))) return null;
  if (new Set(ids).size !== TEAM_SIZE) return null;
  return ids;
}

function draftKey(ids: number[]): string {
  return [...ids].sort((a, b) => a - b).join(',');
}

function publicMatchesUrl(lessThanMatchId?: number): string {
  const params = new URLSearchParams({
    min_rank: String(MIN_RANK),
    max_rank: String(MAX_RANK),
  });
  if (lessThanMatchId != null) params.set('less_than_match_id', String(lessThanMatchId));
  return `${PUBLIC_MATCHES_URL}?${params}`;
}

function loadWinningCompositions(): ProComposition[] {
  if (!fs.existsSync(PRO_MATCHES_PATH)) return [];
  const { matches } = JSON.parse(fs.readFileSync(PRO_MATCHES_PATH, 'utf-8')) as { matches: StoredProMatch[] };
  return (matches ?? []).map((m) => ({
    matchId: m.matchId,
    heroIds: m.radiantWin ? m.radiantHeroIds : m.direHeroIds,
    teamName: m.radiantWin ? m.radiantName : m.direName,
    leagueName: m.leagueName,
  }));
}

async function fetchPublicMatchesPage(
  url: string,
  stats: { apiCalls: number; http429s: number },
): Promise<PublicMatch[]> {
  let backoffMs = 2000;
  for (let attempt = 1; attempt <= 12; attempt++) {
    stats.apiCalls += 1;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      if (attempt === 12) throw new Error(`OpenDota network error: ${(err as Error).message}`);
      console.warn(`  network error, retry in ${backoffMs}ms: ${(err as Error).message}`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 60_000);
      continue;
    }
    if (res.status === 429) {
      stats.http429s += 1;
      console.warn(`  HTTP 429, backing off ${backoffMs}ms (attempt ${attempt})`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 60_000);
      continue;
    }
    if (res.status >= 500) {
      if (attempt === 12) throw new Error(`OpenDota HTTP ${res.status}`);
      console.warn(`  HTTP ${res.status}, retry in ${backoffMs}ms`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 60_000);
      continue;
    }
    if (!res.ok) throw new Error(`OpenDota HTTP ${res.status}`);
    const json: unknown = await res.json();
    if (!Array.isArray(json)) {
      throw new Error(`OpenDota returned non-array: ${JSON.stringify(json).slice(0, 200)}`);
    }
    return json as PublicMatch[];
  }
  throw new Error('OpenDota retries exhausted');
}

async function collectUniqueDrafts(
  validHeroIds: Set<number>,
): Promise<{
  drafts: number[][];
  metadata: Record<string, unknown>;
}> {
  const unique = new Map<string, number[]>();
  const stats = {
    apiCalls: 0,
    http429s: 0,
    matchesScanned: 0,
    ancientDivineMatches: 0,
    incompleteSkipped: 0,
    duplicateDrafts: 0,
  };
  let minMatchId = Number.POSITIVE_INFINITY;
  let maxMatchId = 0;
  let minStartTime = Number.POSITIVE_INFINITY;
  let maxStartTime = 0;
  let lessThan: number | undefined;
  let consecutiveFailures = 0;
  let emptyPages = 0;

  console.log(
    `Fetching unique Ancient+Divine 5-sets from OpenDota publicMatches (target ${TARGET_UNIQUE})...`,
  );

  while (unique.size < TARGET_UNIQUE && stats.matchesScanned < MAX_MATCHES_SCANNED) {
    const url = publicMatchesUrl(lessThan);
    let page: PublicMatch[];
    try {
      page = await fetchPublicMatchesPage(url, stats);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      console.warn(`  page failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${(err as Error).message}`);
      if (stats.apiCalls <= 1 || consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw err;
      }
      await sleep(5000);
      continue;
    }

    if (page.length === 0) {
      emptyPages += 1;
      console.warn(`  empty page (emptyPages=${emptyPages}), stopping pagination`);
      break;
    }

    let pageMinId = Number.POSITIVE_INFINITY;
    for (const match of page) {
      stats.matchesScanned += 1;
      const matchId = Number(match.match_id);
      if (Number.isFinite(matchId) && matchId > 0) {
        pageMinId = Math.min(pageMinId, matchId);
        minMatchId = Math.min(minMatchId, matchId);
        maxMatchId = Math.max(maxMatchId, matchId);
      }
      const start = Number(match.start_time);
      if (Number.isFinite(start) && start > 0) {
        minStartTime = Math.min(minStartTime, start);
        maxStartTime = Math.max(maxStartTime, start);
      }

      if (!isAncientOrDivine(match.avg_rank_tier)) continue;
      stats.ancientDivineMatches += 1;

      for (const raw of [match.radiant_team, match.dire_team]) {
        const ids = parseTeam(raw, validHeroIds);
        if (!ids) {
          stats.incompleteSkipped += 1;
          continue;
        }
        const key = draftKey(ids);
        if (unique.has(key)) {
          stats.duplicateDrafts += 1;
          continue;
        }
        unique.set(key, ids);
        if (unique.size >= TARGET_UNIQUE) break;
      }
      if (unique.size >= TARGET_UNIQUE) break;
    }

    if (!Number.isFinite(pageMinId) || pageMinId === lessThan) {
      console.warn('  pagination did not advance match_id, stopping');
      break;
    }
    lessThan = pageMinId;

    if (stats.apiCalls % 25 === 0 || unique.size >= TARGET_UNIQUE) {
      console.log(
        `  calls=${stats.apiCalls} 429s=${stats.http429s} scanned=${stats.matchesScanned} AD=${stats.ancientDivineMatches} unique=${unique.size}`,
      );
    }

    await sleep(REQUEST_PAUSE_MS);
  }

  const drafts = [...unique.values()].slice(0, TARGET_UNIQUE);
  const metadata = {
    source: 'opendota publicMatches',
    endpoint: 'GET /api/publicMatches',
    bracket: 'Ancient+Divine (heroStats 6+7; avg_rank_tier medal 6–7, typically 61–69 and 71–79)',
    uniqueness: 'sorted 5-hero-id tuple',
    rankFilter: { minRank: MIN_RANK, maxRank: MAX_RANK, clientMedals: [6, 7] },
    matchWindow: {
      minMatchId: Number.isFinite(minMatchId) ? minMatchId : null,
      maxMatchId: maxMatchId || null,
      minStartTime: Number.isFinite(minStartTime) ? new Date(minStartTime * 1000).toISOString() : null,
      maxStartTime: maxStartTime ? new Date(maxStartTime * 1000).toISOString() : null,
    },
    stats: {
      ...stats,
      uniqueDrafts: drafts.length,
      emptyPages,
    },
  };

  return { drafts, metadata };
}

function loadOldMeans(): Record<string, number> | null {
  if (!fs.existsSync(OUTPUT_PATH)) return null;
  try {
    const old = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8')) as {
      distributions?: Record<string, number[]>;
    };
    if (!old.distributions) return null;
    return Object.fromEntries(
      Object.entries(old.distributions).map(([k, xs]) => [k, mean(xs)]),
    );
  } catch {
    return null;
  }
}

async function main() {
  const heroes: Hero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const { heroes: rawMetaEntries }: { heroes: any[] } = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8'));
  const positionsById = new Map(rawMetaEntries.map((e) => [e.heroId, e.positions]));
  for (const h of heroes) h.presumed_positions = (positionsById.get(h.id) ?? []) as Hero['presumed_positions'];
  const weightsById = new Map(heroes.map((h) => [h.id, roleWeights(positionsById.get(h.id) ?? [])]));
  const heroById = new Map(heroes.map((h) => [h.id, h]));
  const validHeroIds = new Set(heroById.keys());
  const oldMeans = loadOldMeans();

  const { drafts, metadata } = await collectUniqueDrafts(validHeroIds);
  const stats = metadata.stats as { uniqueDrafts: number; matchesScanned: number };

  if (drafts.length < TARGET_UNIQUE) {
    console.error(
      `\nSHORTFALL: ${drafts.length} unique Ancient+Divine 5-sets (target ${TARGET_UNIQUE}) after scanning ${stats.matchesScanned} matches.`,
    );
    console.error('Not padding with lower brackets. Not falling back to uniform random.');
    console.error('Metadata:', JSON.stringify(metadata, null, 2));
    if (drafts.length < TARGET_UNIQUE * 0.8) {
      process.exit(1);
    }
    console.warn(`Proceeding with ${drafts.length} samples (>=80% of target).`);
  }

  const heroMeta = new HeroMetaService();
  const synergyAnalyzer = createSynergyAnalyzer(heroMeta);
  const proSimilarityAnalyzer = createProSimilarityAnalyzer(loadWinningCompositions());
  const axisAnalyzers = new Map(AXES_TO_SAMPLE.map((axis) => [axis, createAxisAnalyzer(axis, axis)]));

  const SAMPLE_KEYS = [...AXES_TO_SAMPLE, 'totalScore'] as const;
  const scoresByAxis: Record<string, number[]> = Object.fromEntries(SAMPLE_KEYS.map((a) => [a, []]));

  console.log(`Scoring ${drafts.length} unique drafts (weighted-role assignment, live Total Score weights)...`);
  for (let i = 0; i < drafts.length; i++) {
    const team = drafts[i].map((id) => heroById.get(id)!);
    const roles = assignWeightedRoles(team, weightsById);
    const picks: DraftPick[] = team.map((h, idx) => ({ hero: h, assignedRole: roles[idx] }));

    const scoresByKey: Record<string, number | null> = {};
    for (const axis of AXES_TO_SAMPLE) {
      const score = axisAnalyzers.get(axis)!.analyze(picks).score;
      scoresByAxis[axis].push(score as number);
      scoresByKey[axis] = score;
    }
    scoresByKey.synergy = synergyAnalyzer.analyze(picks).score;
    scoresByKey.proSimilarity = proSimilarityAnalyzer.analyze(picks).score;
    scoresByAxis.totalScore.push(weightedTotal(scoresByKey));

    if ((i + 1) % 5000 === 0) console.log(`  scored ${i + 1}/${drafts.length}`);
  }

  console.log(`\nSampled ${drafts.length} unique Ancient+Divine 5-hero drafts from OpenDota.\n`);
  console.log('axis            mean   p10   p25   p50   p75   p90   Δmean vs old random');
  const distributions: Record<string, number[]> = {};
  for (const axis of SAMPLE_KEYS) {
    const sorted = [...scoresByAxis[axis]].sort((a, b) => a - b);
    distributions[axis] = sorted;
    const m = mean(sorted);
    const old = oldMeans?.[axis];
    const delta = old != null ? (m - old).toFixed(3) : 'n/a';
    console.log(
      `  ${axis.padEnd(14)}${m.toFixed(2).padStart(5)} ${percentileOf(sorted, 10).toFixed(1).padStart(5)} ${percentileOf(sorted, 25).toFixed(1).padStart(5)} ${percentileOf(sorted, 50).toFixed(1).padStart(5)} ${percentileOf(sorted, 75).toFixed(1).padStart(5)} ${percentileOf(sorted, 90).toFixed(1).padStart(5)}   ${delta}`,
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    nSamples: drafts.length,
    metadata,
    distributions,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload) + '\n');
  console.log(`\nWritten to ${OUTPUT_PATH}`);
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
