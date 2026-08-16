// Compare Evaluation Total Score vs Battle assessBattle on the same drafts.
// Read-only w.r.t. axis-weights. Writes server/data/eval-battle-divergence.json.
import * as fs from 'fs';
import * as path from 'path';
import { assessBattle, type BattlePick } from '../src/battle/battle-resolution';
import { HeroMetaService } from '../src/hero-meta/hero-meta.service';
import { createAxisAnalyzer } from '../src/evaluation/analyzers/axis.analyzer';
import { createSynergyAnalyzer } from '../src/evaluation/analyzers/synergy.analyzer';
import { createProSimilarityAnalyzer } from '../src/evaluation/analyzers/pro-similarity.analyzer';
import { counterAnalyzer } from '../src/evaluation/analyzers/counter.analyzer';
import { percentileFor } from '../src/evaluation/axis-percentiles';
import type { Analyzer, DraftPick } from '../src/evaluation/analyzer.interface';
import type { ProComposition } from '../src/pro-match/pro-match.service';
import { buildEvaluationScoreWeights } from '../src/common/axis-weights-config';
import { ROLES } from 'shared';
import type { Hero, DraftRole } from 'shared';

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'eval-battle-divergence.json');

const WEIGHTS: Record<string, number> = buildEvaluationScoreWeights();

const N = Number(process.env.CMP_MATCHES ?? 20000);
const SEED = Number(process.env.CMP_SEED ?? 1);
const EVAL_EVEN_EPS = 0.3; // on displayed 0-10 percentile totalScore

function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(SEED);
function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function pearson(a: number[], b: number[]) {
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
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

function blendedRoleWeights(positions: { position: string; share: number }[]): number[] {
  const byPos = new Map(positions.map((p) => [p.position, p.share]));
  const weights = ROLES.map((r) => {
    if (r === 'Carry') return byPos.get('Carry') ?? 0;
    if (r === 'Mid') return byPos.get('Mid') ?? 0;
    if (r === 'Offlane') return byPos.get('Offlane') ?? 0;
    if (r === 'Soft Support' || r === 'Hard Support') return (byPos.get('Support') ?? 0) / 2;
    return 0;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return ROLES.map(() => 1 / ROLES.length);
  const leftover = Math.max(0, 1 - sum);
  return weights.map((w) => w + leftover / ROLES.length);
}

function assignRoles(heroes: Hero[], roleWeightsById: Map<number, number[]>): DraftRole[] {
  const order = shuffle(heroes.map((_, i) => i));
  const used = new Set<DraftRole>();
  const roles: DraftRole[] = new Array(heroes.length);
  for (const i of order) {
    const weights = roleWeightsById.get(heroes[i].id)!;
    const available = ROLES.map((r, idx) => ({ r, w: used.has(r) ? 0 : weights[idx] }));
    const sum = available.reduce((s, x) => s + x.w, 0);
    let pick: DraftRole = available.find((x) => x.w > 0)?.r ?? ROLES[0];
    if (sum > 0) {
      let t = rng() * sum;
      for (const x of available) {
        t -= x.w;
        if (t <= 0) {
          pick = x.r;
          break;
        }
      }
    }
    used.add(pick);
    roles[i] = pick;
  }
  return roles;
}

function scoreEvaluation(
  picks: DraftPick[],
  analyzers: Analyzer[],
): { display: number; raw: number; byKey: Record<string, number | null> } {
  const breakdown = analyzers.map((a) => {
    const r = a.analyze(picks);
    return { key: a.key, score: r.score };
  });
  const byKey = Object.fromEntries(breakdown.map((b) => [b.key, b.score]));
  const weighable = breakdown.filter((b) => b.key in WEIGHTS && b.score !== null);
  const availableWeight = weighable.reduce((s, b) => s + WEIGHTS[b.key], 0);
  const raw =
    availableWeight === 0
      ? 0
      : weighable.reduce((s, b) => s + (b.score as number) * (WEIGHTS[b.key] / availableWeight), 0);
  const rawRounded = Math.round(raw * 10) / 10;
  const percentile = percentileFor('totalScore', rawRounded);
  const display = percentile !== null ? Math.round(percentile) / 10 : rawRounded;
  return { display, raw: rawRounded, byKey };
}

function dirFromDiff(diff: number, eps: number): 'A' | 'B' | 'Even' {
  if (diff > eps) return 'A';
  if (diff < -eps) return 'B';
  return 'Even';
}

function loadProCompositions(): ProComposition[] {
  const raw = JSON.parse(fs.readFileSync(path.join(DATA, 'pro-matches.json'), 'utf-8')) as {
    matches: Array<{
      matchId: string;
      radiantWin: boolean;
      radiantHeroIds: number[];
      direHeroIds: number[];
    }>;
  };
  const comps: ProComposition[] = [];
  for (const m of raw.matches) {
    const ids = m.radiantWin ? m.radiantHeroIds : m.direHeroIds;
    if (ids.length === 5) {
      comps.push({
        matchId: m.matchId,
        heroIds: ids,
        teamName: null,
        leagueName: null,
      });
    }
  }
  return comps;
}

function main() {
  console.log(`Eval↔Battle divergence: ${N} random 5v5, seed=${SEED}\n`);
  const heroes: Hero[] = JSON.parse(fs.readFileSync(path.join(DATA, 'heroes.json'), 'utf-8'));
  const metaFile = JSON.parse(fs.readFileSync(path.join(DATA, 'hero-meta.json'), 'utf-8')) as {
    heroes: Array<{ heroId: number; positions: { position: string; share: number }[] }>;
  };
  const positionsById = new Map(metaFile.heroes.map((e) => [e.heroId, e.positions]));
  for (const h of heroes) h.presumed_positions = (positionsById.get(h.id) ?? []) as Hero['presumed_positions'];
  const roleWeightsById = new Map(
    heroes.map((h) => [h.id, blendedRoleWeights(positionsById.get(h.id) ?? [])]),
  );

  const heroMeta = new HeroMetaService();
  const compositions = loadProCompositions();
  const analyzers: Analyzer[] = [
    createSynergyAnalyzer(heroMeta),
    counterAnalyzer,
    createAxisAnalyzer('teamfight', 'Damage Output'),
    createAxisAnalyzer('tempo', 'Tempo'),
    createAxisAnalyzer('scaling', 'Scaling'),
    createAxisAnalyzer('burst', 'Burst'),
    createAxisAnalyzer('control', 'Control'),
    createAxisAnalyzer('durability', 'Durability'),
    createAxisAnalyzer('initiating', 'Initiating'),
    createAxisAnalyzer('skirmish_rate', 'Skirmish Rate'),
    createAxisAnalyzer('mobility', 'Mobility'),
    createAxisAnalyzer('saving', 'Saving'),
    createAxisAnalyzer('objectives', 'Objectives'),
    createAxisAnalyzer('resource_efficiency', 'Resource Efficiency'),
    createProSimilarityAnalyzer(compositions),
  ];

  const structural = {
    evaluationOnlyInScore: ['synergy (team)', 'proSimilarity', 'axes in WEIGHTS'],
    evaluationInformationalOnly: ['counter', 'resource_efficiency', 'camp_stacking note', 'customTags display'],
    battleOnly: [
      'phase-aware overallPower (early/mid/late)',
      'axis-weights.json / phaseWeights (Battle)',
      'custom tag numeric effects + curses',
      'matchupEdge vs opponent',
      'synergy as multiplicative power (not Eval synergy card)',
      'realWinRateWeight blend',
      'shutdown',
      'manual power overrides',
      'camp_stacking in AXES (Eval excludes from Total)',
      'map_control in AXES at weight 0',
    ],
    shared: ['evaluation_values axes', 'role-fit', 'hard-carry stacking', 'utility stacking', 'miscast'],
  };

  let bothDecisive = 0;
  let agree = 0;
  let disagree = 0;
  let evalEven = 0;
  let battleEven = 0;
  let finalFlippedFromRawAmongDisagree = 0;

  const evalDiffsDisplay: number[] = [];
  const evalDiffsRaw: number[] = [];
  const battleDiffs: number[] = [];
  const battleRawDiffs: number[] = [];

  const disagreeSamples: Array<Record<string, unknown>> = [];
  const layerFlipCounts = {
    alreadyDisagreedOnRawAxesPhaseWeights: 0,
    rawAgreedEvalButPostRawFlippedBattle: 0,
    other: 0,
  };

  // Pro-match slice
  const proRaw = JSON.parse(fs.readFileSync(path.join(DATA, 'pro-matches.json'), 'utf-8')) as {
    matches: Array<{
      matchId: string;
      radiantHeroIds: number[];
      direHeroIds: number[];
      radiantHeroRoles?: Array<{ heroId: number; role: string }>;
      direHeroRoles?: Array<{ heroId: number; role: string }>;
    }>;
  };
  const byId = new Map(heroes.map((h) => [h.id, h]));

  function comparePair(teamA: BattlePick[], teamB: BattlePick[], label: string) {
    const evalA = scoreEvaluation(teamA, analyzers);
    const evalB = scoreEvaluation(teamB, analyzers);
    const evalDiffDisplay = evalA.display - evalB.display;
    const evalDiffRaw = evalA.raw - evalB.raw;
    const evalDir = dirFromDiff(evalDiffDisplay, EVAL_EVEN_EPS);
    const battle = assessBattle(teamA, teamB, heroMeta);

    evalDiffsDisplay.push(evalDiffDisplay);
    evalDiffsRaw.push(evalDiffRaw);
    battleDiffs.push(battle.diff);
    battleRawDiffs.push(battle.rawDiff);

    if (evalDir === 'Even') evalEven++;
    if (battle.advantageDirection === 'Even') battleEven++;

    if (evalDir !== 'Even' && battle.advantageDirection !== 'Even') {
      bothDecisive++;
      if (evalDir === battle.advantageDirection) agree++;
      else {
        disagree++;
        const rawDir = battle.rawAdvantageDirection;
        const rawMatchesEval =
          (evalDir === 'A' && battle.rawDiff > 0) || (evalDir === 'B' && battle.rawDiff < 0);
        const finalMatchesEval = evalDir === battle.advantageDirection;
        if (!rawMatchesEval) {
          layerFlipCounts.alreadyDisagreedOnRawAxesPhaseWeights++;
        } else if (!finalMatchesEval) {
          layerFlipCounts.rawAgreedEvalButPostRawFlippedBattle++;
          finalFlippedFromRawAmongDisagree++;
        } else {
          layerFlipCounts.other++;
        }

        if (disagreeSamples.length < 25) {
          disagreeSamples.push({
            label,
            evalDir,
            battleDir: battle.advantageDirection,
            rawBattleDir: battle.rawAdvantageDirection,
            evalA: evalA.display,
            evalB: evalB.display,
            evalRawA: evalA.raw,
            evalRawB: evalB.raw,
            battleDiff: Math.round(battle.diff * 1000) / 1000,
            battleRawDiff: Math.round(battle.rawDiff * 1000) / 1000,
            synergyA: battle.synergyBonusA,
            synergyB: battle.synergyBonusB,
            matchupEdge: battle.edgeA,
            winRateEdgeA: battle.winRateEdgeA,
            winRateEdgeB: battle.winRateEdgeB,
            tier: battle.confidenceTier,
            teamA: teamA.map((p) => `${p.hero.name}/${p.assignedRole}`),
            teamB: teamB.map((p) => `${p.hero.name}/${p.assignedRole}`),
            topBattleAxis: battle.axisDeltas[0]?.axis,
          });
        }
      }
    }
  }

  // Random drafts
  for (let i = 0; i < N; i++) {
    const drawn = shuffle(heroes).slice(0, 10);
    const heroesA = drawn.slice(0, 5);
    const heroesB = drawn.slice(5);
    const rolesA = assignRoles(heroesA, roleWeightsById);
    const rolesB = assignRoles(heroesB, roleWeightsById);
    const teamA: BattlePick[] = heroesA.map((h, idx) => ({ hero: h, assignedRole: rolesA[idx] }));
    const teamB: BattlePick[] = heroesB.map((h, idx) => ({ hero: h, assignedRole: rolesB[idx] }));
    comparePair(teamA, teamB, 'random');
  }

  const randomSummary = {
    n: N,
    bothDecisive,
    agree,
    disagree,
    agreementRate: bothDecisive ? agree / bothDecisive : null,
    evalEvenRate: evalEven / N,
    battleEvenRate: battleEven / N,
    rEvalDisplayVsBattleDiff: pearson(evalDiffsDisplay, battleDiffs),
    rEvalRawVsBattleDiff: pearson(evalDiffsRaw, battleDiffs),
    rEvalRawVsBattleRawDiff: pearson(evalDiffsRaw, battleRawDiffs),
    disagreeLayerHints: layerFlipCounts,
    finalFlippedFromRawAmongDisagree,
  };

  // Reset counters for pro slice reporting separately
  const proEvalDiffs: number[] = [];
  const proBattleDiffs: number[] = [];
  let proBoth = 0;
  let proAgree = 0;
  let proDisagree = 0;
  let proSkipped = 0;
  const proDisagreeSamples: Array<Record<string, unknown>> = [];

  for (const m of proRaw.matches) {
    const ha = m.radiantHeroIds.map((id) => byId.get(id)).filter(Boolean) as Hero[];
    const hb = m.direHeroIds.map((id) => byId.get(id)).filter(Boolean) as Hero[];
    if (ha.length !== 5 || hb.length !== 5) {
      proSkipped++;
      continue;
    }
    const roleMapA = new Map((m.radiantHeroRoles ?? []).map((r) => [r.heroId, r.role as DraftRole]));
    const roleMapB = new Map((m.direHeroRoles ?? []).map((r) => [r.heroId, r.role as DraftRole]));
    const teamA: BattlePick[] = ha.map((h) => ({
      hero: h,
      assignedRole: roleMapA.get(h.id) ?? null,
    }));
    const teamB: BattlePick[] = hb.map((h) => ({
      hero: h,
      assignedRole: roleMapB.get(h.id) ?? null,
    }));
    const evalA = scoreEvaluation(teamA, analyzers);
    const evalB = scoreEvaluation(teamB, analyzers);
    const evalDiff = evalA.display - evalB.display;
    const evalDir = dirFromDiff(evalDiff, EVAL_EVEN_EPS);
    const battle = assessBattle(teamA, teamB, heroMeta);
    proEvalDiffs.push(evalDiff);
    proBattleDiffs.push(battle.diff);
    if (evalDir !== 'Even' && battle.advantageDirection !== 'Even') {
      proBoth++;
      if (evalDir === battle.advantageDirection) proAgree++;
      else {
        proDisagree++;
        if (proDisagreeSamples.length < 15) {
          proDisagreeSamples.push({
            matchId: m.matchId,
            evalDir,
            battleDir: battle.advantageDirection,
            rawBattleDir: battle.rawAdvantageDirection,
            evalA: evalA.display,
            evalB: evalB.display,
            battleDiff: Math.round(battle.diff * 1000) / 1000,
            battleRawDiff: Math.round(battle.rawDiff * 1000) / 1000,
            radiant: ha.map((h) => h.name),
            dire: hb.map((h) => h.name),
          });
        }
      }
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    seed: SEED,
    evalEvenEpsilon: EVAL_EVEN_EPS,
    structural,
    weightInventory: {
      evaluationWeights: WEIGHTS,
      note: 'Battle uses axis-weights.json + phaseWeights; different scale and set',
    },
    randomDrafts: {
      ...randomSummary,
      disagreeSamples,
    },
    proMatches: {
      n: proRaw.matches.length - proSkipped,
      skipped: proSkipped,
      bothDecisive: proBoth,
      agree: proAgree,
      disagree: proDisagree,
      agreementRate: proBoth ? proAgree / proBoth : null,
      rEvalDisplayVsBattleDiff: pearson(proEvalDiffs, proBattleDiffs),
      disagreeSamples: proDisagreeSamples,
    },
  };

  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log('=== Structural (always true) ===');
  console.log('Battle-only:', structural.battleOnly.join('; '));
  console.log('\n=== Random drafts ===');
  console.log(
    `decisive pairs=${bothDecisive}  agree=${agree} (${((agree / Math.max(1, bothDecisive)) * 100).toFixed(1)}%)  disagree=${disagree}`,
  );
  console.log(
    `r(evalDisplayΔ, battle.diff)=${randomSummary.rEvalDisplayVsBattleDiff.toFixed(3)}  r(evalRawΔ, battle.diff)=${randomSummary.rEvalRawVsBattleDiff.toFixed(3)}  r(evalRawΔ, battle.rawDiff)=${randomSummary.rEvalRawVsBattleRawDiff.toFixed(3)}`,
  );
  console.log('\n=== Pro matches ===');
  console.log(
    `decisive=${proBoth} agree=${proAgree} (${((proAgree / Math.max(1, proBoth)) * 100).toFixed(1)}%) disagree=${proDisagree}  r=${payload.proMatches.rEvalDisplayVsBattleDiff.toFixed(3)}`,
  );
  console.log(`\nWrote ${OUT}`);
}

main();
