import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DraftService } from '../draft/draft.service';
import { ProMatchService } from '../pro-match/pro-match.service';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { createSynergyAnalyzer } from './analyzers/synergy.analyzer';
import { counterAnalyzer } from './analyzers/counter.analyzer';
import { createAxisAnalyzer } from './analyzers/axis.analyzer';
import { createProSimilarityAnalyzer } from './analyzers/pro-similarity.analyzer';
import { percentileBracket } from './score-narrative';
import { percentileFor } from './axis-percentiles';
import type { Analyzer, DraftPick } from './analyzer.interface';
import type { EvaluationResult, EvaluationSummary, AnalyzerResult } from 'shared';
import { classifyDraftArchetype } from './draft-archetype';
import { activeCustomTagsForTeam, heroNameSetForTag } from 'shared';
import { teamHasHiddenCalibrationTags } from '../common/calibration-tags';
import { buildEvaluationScoreWeights } from '../common/axis-weights-config';
import { AXES, AXIS_LABEL, axisAverage, type BattlePick } from '../battle/battle-resolution';
import { formatFundamentalsDescription, fundamentalsTargetAxes } from '../battle/custom-tags';

const FUNDAMENTALS = heroNameSetForTag('The Fundamentals');

function fundamentalsDescription(picks: DraftPick[]): string {
  const count = picks.filter((p) => FUNDAMENTALS.has(p.hero.name)).length;
  if (count < 2) {
    return formatFundamentalsDescription([], count);
  }
  const battlePicks: BattlePick[] = picks.map((p) => ({
    hero: p.hero,
    assignedRole: p.assignedRole,
  }));
  const raw = Object.fromEntries(AXES.map((axis) => [axis, axisAverage(battlePicks, axis)])) as Partial<
    Record<(typeof AXES)[number], number>
  >;
  const axes = fundamentalsTargetAxes(raw, count);
  return formatFundamentalsDescription(
    axes.map((axis) => AXIS_LABEL[axis]),
    count,
  );
}

// Categories eligible for the strengths/weaknesses summary. map_control and
// camp_stacking deliberately absent — see BASE_ANALYZERS below.
const SUMMARY_KEYS = [
  'synergy',
  'counter',
  'teamfight',
  'tempo',
  'scaling',
  'burst',
  'control',
  'durability',
  'mobility',
  'saving',
  'objectives',
  'initiating',
  'skirmish_rate',
  'resource_efficiency',
  'proSimilarity',
];

// Order matches Blueprint/05-evaluation-engine.md's Output breakdown list.
// Synergy and Pro Similarity are built per-evaluate() call since both
// depend on data fetched at request time (see evaluate()) — everything
// else is static. Burst/Control/Durability were added alongside the
// Role-fit modifier (10-tech-debt-backlog.md) — they were already
// calibrated in evaluation_values but not previously surfaced as their own
// breakdown rows, which meant role-fit had nothing to boost for
// Carry/Mid/Offlane. Initiating (same backlog doc) was calibrated even
// earlier than that but stayed unsurfaced until now for the same reason.
// Skirmish Rate/Camp Stacking are new (regress-composite-clusters-v2.ts
// findings) — the first two axes in this project's history validated
// directly against real OpenDota winRate via simple correlation before
// being wired in, rather than hand-authored and calibrated after the fact.
// Renamed from aggression/farm_priority (Blueprint/10-tech-debt-backlog.md,
// self-play outlier investigation) — those names implied "this hero plays
// aggressively" / "this hero prioritizes personal farm," but the underlying
// signals are deaths_per_min+inverted_last_hits (skirmish involvement, not
// combat aggression per se) and camps_stacked_per_min (a support/utility
// behavior — stacking FOR someone else — not personal farm optimization).
// The old names actively misled: a hard-carry split-pusher like Phantom
// Lancer scored near-zero on "farm_priority" despite being maximally
// farm-dependent, because he doesn't stack camps, he just farms efficiently
// himself. New names describe the actual measured behavior.
const BASE_ANALYZERS: Analyzer[] = [
  counterAnalyzer,
  // Label "Damage Output", not "Teamfight" — see score-narrative.ts's
  // AXIS_NARRATIVE.teamfight comment for why (real per-minute personal
  // damage, not overall fight-winning potential). Key stays `teamfight`.
  createAxisAnalyzer('teamfight', 'Damage Output'),
  createAxisAnalyzer('tempo', 'Tempo'),
  createAxisAnalyzer('scaling', 'Scaling'),
  createAxisAnalyzer('burst', 'Burst'),
  createAxisAnalyzer('control', 'Control'),
  createAxisAnalyzer('durability', 'Durability'),
  createAxisAnalyzer('initiating', 'Initiating'),
  createAxisAnalyzer('skirmish_rate', 'Skirmish Rate'),
  // camp_stacking deliberately NOT in this list — muted artifact (Battle
  // weight 0, no Eval card/note). Data still calibrated into heroes.json
  // for a possible future return.
  createAxisAnalyzer('mobility', 'Mobility'),
  // map_control deliberately NOT in this list — same dead-artifact posture
  // as camp_stacking (Battle weight 0; not shown as a strength axis).
  createAxisAnalyzer('saving', 'Saving'),
  createAxisAnalyzer('objectives', 'Objectives'),
  // Damage per team-networth-share — also in Battle AXES/axis-weights now.
  createAxisAnalyzer('resource_efficiency', 'Resource Efficiency'),
];

// Mid-axis proportions come from server/data/axis-weights.json via
// common/axis-weights-config.ts (shared skeleton with Battle mid). Synergy /
// proSimilarity stay Evaluation-only. weightedTotal() still normalizes by
// available weight sum. counter / map_control / camp_stacking stay out of
// Total Score.
const WEIGHTS: Record<string, number> = buildEvaluationScoreWeights();

// Mirrors EvaluationPanel.tsx's percentileLabel() exactly (same 30/70
// split as score-narrative.ts's percentileBracket()) — used only for the
// compact strengths/weaknesses list, not the breakdown cards (which get
// their percentile pill text formatted client-side, unchanged).
function formatPercentile(percentile: number): string {
  if (percentile < 30) return `bottom ${Math.max(1, percentile)}%`;
  if (percentile < 70) return `${percentile}th percentile`;
  return `top ${Math.max(1, 100 - percentile)}%`;
}

@Injectable()
export class EvaluationService {
  constructor(
    private readonly draftService: DraftService,
    private readonly proMatchService: ProMatchService,
    private readonly heroMetaService: HeroMetaService,
  ) {}

  async evaluate(draftId: string): Promise<EvaluationResult> {
    const draft = await this.draftService.getById(draftId);
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.heroes.length < 5) {
      throw new BadRequestException('Draft must have all 5 heroes picked before evaluation');
    }

    const picks: DraftPick[] = draft.heroes.map((dh) => ({ hero: dh.hero, assignedRole: dh.assignedRole }));
    const compositions = await this.proMatchService.getWinningCompositions();
    const analyzers: Analyzer[] = [
      createSynergyAnalyzer(this.heroMetaService),
      ...BASE_ANALYZERS,
      createProSimilarityAnalyzer(compositions),
    ];
    const breakdown: AnalyzerResult[] = analyzers.map((analyzer) => {
      const result = analyzer.analyze(picks);
      return {
        key: analyzer.key,
        label: analyzer.label,
        score: result.score,
        percentile: result.percentile,
        explanation: result.explanation,
        matchUrl: result.matchUrl ?? null,
        topContributorHeroId: result.topContributorHeroId ?? null,
      };
    });

    const totalScore = this.weightedTotal(breakdown);
    const summary = this.buildSummary(breakdown);

    // Public tags plus revealable-hidden tags whose composition gate was
    // reached during drafting. Permanently hidden tags never enter this
    // collection; Battle still applies their effects normally.
    const customTags = activeCustomTagsForTeam(picks.map((p) => p.hero.name)).map((t) => ({
      name: t.name,
      rarity: t.rarity,
      description: t.name === 'The Fundamentals' ? fundamentalsDescription(picks) : t.description,
    }));
    const hiddenCalibrationApplied = teamHasHiddenCalibrationTags(picks.map((p) => p.hero));

    const archetype = classifyDraftArchetype(
      picks.map((p) => p.hero),
      breakdown,
    );

    const result: EvaluationResult = {
      draftId,
      totalScore,
      breakdown,
      summary,
      customTags,
      campStackingNote: null,
      hiddenCalibrationApplied,
      archetype,
    };

    // Persisted for History (Blueprint/10-tech-debt-backlog.md, "Сохранять
    // в истории результаты боёв") — best-effort, not on the critical path:
    // Evaluate Draft should still work even if this write fails for some
    // reason (e.g. draft already deleted between getById above and now,
    // which shouldn't happen in practice but isn't worth failing the whole
    // request over).
    await this.draftService.saveEvaluationResult(draftId, JSON.stringify(result)).catch(() => undefined);

    return result;
  }

  private buildSummary(breakdown: AnalyzerResult[]): EvaluationSummary {
    // Ranked by percentile (population-relative), not raw score — an axis
    // like saving that clusters low across the whole population (see
    // axis-percentile-distributions.json) shouldn't look like a bigger
    // "weakness" than a genuinely below-average axis just because its raw
    // number is smaller. Synergy/Counter/Pro Similarity have no percentile
    // (not axis-based) — score*10 puts their 0-10 scale on the same rough
    // footing as a 0-100 percentile for ranking purposes only.
    const rankValue = (b: AnalyzerResult) => b.percentile ?? (b.score as number) * 10;
    const ranked = breakdown
      .filter((b) => SUMMARY_KEYS.includes(b.key) && b.score !== null)
      .sort((a, b) => rankValue(b) - rankValue(a));

    // Compact "Label — percentile" line, NOT the full narrative sentence
    // (2026-08-03, by explicit user request — the previous version quoted
    // the same narrative sentence here, in this axis's breakdown card
    // below, AND in the gameplan paragraph for whichever item ranks #1,
    // up to 3x duplication of one sentence). The breakdown grid remains
    // the one place the full narrative lives; this list is now purely a
    // fast-scan index into it. Same percentile-bucket phrasing as the
    // client's percentile pill labels (EvaluationPanel.tsx's
    // percentileLabel()) — kept in sync by hand, same as that comment
    // already documents for the 30/70 split itself.
    const describe = (item: AnalyzerResult) => {
      const detail = item.percentile !== null ? formatPercentile(item.percentile) : `${item.score}/10`;
      return `${item.label} — ${detail}`;
    };

    const strengths = ranked.slice(0, 3).map(describe);
    const weaknesses = ranked.slice(-3).reverse().map(describe);
    const gameplan = this.buildGameplan(breakdown, ranked[0], ranked[ranked.length - 1]);

    return { strengths, weaknesses, gameplan };
  }

  // A short synthesized paragraph on top of the strengths/weaknesses list —
  // those are independent per-axis fragments, this ties tempo+scaling
  // (the two axes that actually drive game *length*, per their own
  // real-data-backed narratives in score-narrative.ts) into a single win
  // condition, then names the standout strength/weakness to lean on or
  // cover for. Recombines already-calibrated axis narratives rather than
  // introducing a new signal.
  private buildGameplan(
    breakdown: AnalyzerResult[],
    topStrength: AnalyzerResult,
    topWeakness: AnalyzerResult,
  ): string {
    const tempo = breakdown.find((b) => b.key === 'tempo');
    const scaling = breakdown.find((b) => b.key === 'scaling');
    const tempoBracket = tempo?.percentile != null ? percentileBracket(tempo.percentile) : 'mid';
    const scalingBracket = scaling?.percentile != null ? percentileBracket(scaling.percentile) : 'mid';

    const winConditionLine = ((): string => {
      if (tempoBracket === 'high' && scalingBracket !== 'high') {
        return 'This is a draft that wants to win fast: force early lane swaps and skirmishes, take fights before 25 minutes, and avoid letting the game drag — it does not get meaningfully stronger with time.';
      }
      if (tempoBracket !== 'high' && scalingBracket === 'high') {
        return 'This is a patient draft: farm safely, avoid unnecessary risk in the laning stage, and let the game run past 35-40 minutes, where its late-game power actually shows up.';
      }
      if (tempoBracket === 'high' && scalingBracket === 'high') {
        return 'This draft has real flexibility in how the game is played — it can force an early lead off a fast start, or fall back on genuine late-game scaling if the opening does not go to plan.';
      }
      if (tempoBracket === 'low' && scalingBracket === 'low') {
        return 'This draft has no strong forcing function in either direction — it does not want to rush the early game or stall for a late-game payoff, so small edges and picks have to be manufactured rather than relied on.';
      }
      return 'This draft sits in the middle on both game speed and scaling — the win condition depends more on execution and picks than on a built-in early or late-game plan.';
    })();

    const strengthLine = `Lean on this: ${topStrength.explanation[topStrength.explanation.length - 1]}`;
    const weaknessLine = `Cover for this: ${topWeakness.explanation[topWeakness.explanation.length - 1]}`;

    return `${winConditionLine} ${strengthLine} ${weaknessLine}`;
  }

  // By direct user request (2026-08-06, Blueprint/10-tech-debt-backlog.md,
  // "Оценка драфта — сравнение с другими драфтами, не средневзвешенное по
  // осям"): a straight weighted average of ~12 already-somewhat-independent
  // 0-10 axis scores regresses hard toward the middle by the same logic a
  // sum of independent random variables does — a 100k-draft simulation
  // found totalScore clustering tightly around 4.9 (sd 0.73), never once
  // reaching above 7.2 or below 2.1 in 100,000 random drafts, out of a
  // nominal 0-10 scale. The raw weighted average below (`rawTotal`) is now
  // only an intermediate value — the number actually returned is
  // `rawTotal`'s PERCENTILE against `axis-percentile-distributions.json`'s
  // `totalScore` reference population (10,000 random drafts scored the
  // same way, computed by `compute-axis-percentiles.ts`), the same
  // population-relative treatment every individual axis's breakdown
  // percentile already got — just applied one more time on top of the
  // combined score instead of stopping at the per-axis level. This
  // guarantees the displayed score is uniformly spread across the full
  // range for the population of possible drafts, by construction of a
  // percentile transform, rather than however narrow the underlying
  // weighted-average happens to cluster.
  private weightedTotal(breakdown: AnalyzerResult[]): number {
    const weighable = breakdown.filter((b) => b.key in WEIGHTS);
    const available = weighable.filter((b) => b.score !== null);
    const availableWeight = available.reduce((sum, b) => sum + WEIGHTS[b.key], 0);

    if (availableWeight === 0) return 0;

    // Redistribute weight from unavailable analyzers (e.g. Pro Similarity before
    // Milestone 3) proportionally across the ones that did produce a score.
    const rawTotal = available.reduce(
      (sum, b) => sum + (b.score as number) * (WEIGHTS[b.key] / availableWeight),
      0,
    );
    const rawRounded = Math.round(rawTotal * 10) / 10;

    // Fallback to the raw weighted average if the reference distribution is
    // missing 'totalScore' for some reason (e.g. a stale
    // axis-percentile-distributions.json from before this feature) —
    // degrades to the old behavior rather than crashing or returning null.
    const percentile = percentileFor('totalScore', rawRounded);
    return percentile !== null ? Math.round(percentile) / 10 : rawRounded;
  }
}
