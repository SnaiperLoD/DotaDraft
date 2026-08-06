import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DraftService } from '../draft/draft.service';
import { ProMatchService } from '../pro-match/pro-match.service';
import { HeroMetaService } from '../hero-meta/hero-meta.service';
import { createSynergyAnalyzer } from './analyzers/synergy.analyzer';
import { counterAnalyzer } from './analyzers/counter.analyzer';
import { createAxisAnalyzer } from './analyzers/axis.analyzer';
import { createProSimilarityAnalyzer } from './analyzers/pro-similarity.analyzer';
import { percentileBracket } from './score-narrative';
import type { Analyzer, DraftPick } from './analyzer.interface';
import type { EvaluationResult, EvaluationSummary, AnalyzerResult } from 'shared';
import { activeCustomTagsForTeam } from 'shared';

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

// camp_stacking's percentile threshold for the standalone note (evaluate()
// below) — same 70 the rest of the app already uses for "top X%" framing
// (score-narrative.ts's percentileBracket, EvaluationPanel.tsx's
// percentileLabel).
const CAMP_STACKING_NOTE_THRESHOLD = 70;

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
  // camp_stacking deliberately NOT in this list — 2026-08-06, by explicit
  // user request. Not the same treatment as map_control below (that one's
  // a "weak signal, hide it" call) — camp_stacking is real-data-validated
  // and stays fully weighted; it just doesn't earn a full breakdown card
  // for every draft. Still computed (see evaluate()'s campStackingNote)
  // and surfaced as a single sentence when the team's percentile clears
  // CAMP_STACKING_NOTE_THRESHOLD, same narrative text the card used to
  // show, just not promoted to a whole category when it isn't notable.
  createAxisAnalyzer('mobility', 'Mobility'),
  // map_control deliberately NOT in this list — 2026-08-03, by explicit
  // user request. Blueprint/10-tech-debt-backlog.md: this axis's real-data
  // component (vision_ability_tier) is still the old coarse per-hero tag,
  // never migrated to the per-ability CSV pipeline the way mobility/saving/
  // initiating/control were — the underlying signal is weak enough that
  // showing it as a breakdown row (even at 0 weight) read as more
  // authoritative than it is. Still computed by evaluation_values/
  // calibrate-evaluation-values.ts and consumed by Battle Engine's AXES
  // list (server/data/axis-weights.json, weight 0 there too) — this only
  // removes it from Evaluation Engine's user-facing breakdown, not the
  // underlying data or Battle Engine.
  createAxisAnalyzer('saving', 'Saving'),
  createAxisAnalyzer('objectives', 'Objectives'),
  // Damage per team-networth-share (Blueprint/10-tech-debt-backlog.md,
  // user research request 2026-08-05) — distinct from Damage Output
  // (teamfight, raw hero_damage_per_min): rewards damage that didn't need
  // much of the team's economy to produce. Evaluation Engine-only — not in
  // Battle Engine's AXES/axis-weights.json, so it doesn't affect Total
  // Score's role-fit/hard-carry/utility-stacking modifiers or the Battle
  // Engine's win-probability calc at all, only this breakdown row.
  createAxisAnalyzer('resource_efficiency', 'Resource Efficiency'),
];

// Initial Weights from Blueprint/05-evaluation-engine.md, plus `initiating`
// at the same 0.05 given to the other minor axes (mobility/map_control/
// saving/proSimilarity) — the blueprint's original weight list predates
// this axis. weightedTotal() normalizes by the sum of available weights
// rather than assuming they sum to 1, so this doesn't need to displace any
// existing weight; it just makes every other axis's effective share
// slightly smaller. `counter` is deliberately absent: the blueprint's
// weight list omits it, so it's shown as an informational breakdown item
// only and doesn't affect Total Score.
// teamfight/scaling/objectives/burst/durability scaled by 0.3 (2026-07-25,
// Blueprint/10-tech-debt-backlog.md, "Поворотный момент"/axis composite
// fix) — these 5 are highly cross-correlated on real hero data (the same
// "battle/core-impact spectrum" counted ~5 times, not 5 independent
// signals; pairwise |r| up to 0.78, see backlog for the full matrix).
// Combined weight target: ~0.15, matching tempo (the one other axis already
// deliberately boosted above the 0.05 default) — the whole cluster now
// counts for about as much as ONE well-weighted independent axis, not five.
// Original values before scaling: teamfight 0.2, scaling 0.1, objectives
// 0.1, burst 0.05, durability 0.05 (sum 0.5).
const WEIGHTS: Record<string, number> = {
  synergy: 0.3,
  teamfight: 0.06,
  tempo: 0.15,
  scaling: 0.03,
  objectives: 0.03,
  burst: 0.015,
  control: 0.05,
  durability: 0.015,
  mobility: 0.05,
  // map_control entry intentionally removed (not just zeroed) — see
  // BASE_ANALYZERS above, the axis isn't in breakdown at all anymore.
  saving: 0.05,
  initiating: 0.05,
  // Default weight, same as every other axis when first introduced
  // (initiating included) — deliberately NOT elevated just because they're
  // real-data-validated; that's a separate tuning decision for later, not
  // bundled into "add the axis" (Blueprint/10-tech-debt-backlog.md).
  skirmish_rate: 0.05,
  // camp_stacking entry intentionally removed (not just zeroed) — see
  // BASE_ANALYZERS above, the axis isn't in breakdown at all anymore, so
  // it can't contribute to weightedTotal() either.
  proSimilarity: 0.05,
  // resource_efficiency deliberately absent, same treatment as `counter`
  // above — shown as an informational breakdown/strengths-weaknesses item
  // only, doesn't move Total Score. Unlike skirmish_rate/camp_stacking,
  // this axis hasn't been validated against real winRate yet (see
  // BASE_ANALYZERS comment) — that's a prerequisite this project applies
  // before an axis gets scoring weight, not just before it's calibrated.
};

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

    // camp_stacking: computed the same way as any other axis card, just
    // not added to `breakdown` — only surfaces as a note when it's
    // actually notable (percentile > threshold), per user request (see
    // BASE_ANALYZERS comment above for why this axis specifically gets
    // this treatment rather than being dropped like map_control).
    const campStackingResult = createAxisAnalyzer('camp_stacking', 'Camp Stacking').analyze(picks);
    const campStackingNote =
      campStackingResult.percentile !== null && campStackingResult.percentile > CAMP_STACKING_NOTE_THRESHOLD
        ? campStackingResult.explanation[campStackingResult.explanation.length - 1]
        : null;

    // Custom Tags active for this exact 5-hero team (shared/customTags.ts)
    // — Blueprint/10-tech-debt-backlog.md, "Новая категория Custom Tags в
    // Evaluation breakdown". Reads the same neutral/shared tag roster the
    // client already uses for hero-card badges, not server/src/battle's
    // numeric magnitudes (Core Rules Separation — Evaluation Engine stays
    // independent of Battle Engine's actual math, this only surfaces
    // WHICH combos are active and what they do, not a computed value).
    const customTags = activeCustomTagsForTeam(picks.map((p) => p.hero.name)).map((t) => ({
      name: t.name,
      rarity: t.rarity,
      description: t.description,
    }));

    const result: EvaluationResult = {
      draftId,
      totalScore,
      breakdown,
      summary,
      customTags,
      campStackingNote,
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

  private weightedTotal(breakdown: AnalyzerResult[]): number {
    const weighable = breakdown.filter((b) => b.key in WEIGHTS);
    const available = weighable.filter((b) => b.score !== null);
    const availableWeight = available.reduce((sum, b) => sum + WEIGHTS[b.key], 0);

    if (availableWeight === 0) return 0;

    // Redistribute weight from unavailable analyzers (e.g. Pro Similarity before
    // Milestone 3) proportionally across the ones that did produce a score.
    const total = available.reduce(
      (sum, b) => sum + (b.score as number) * (WEIGHTS[b.key] / availableWeight),
      0,
    );

    return Math.round(total * 10) / 10;
  }
}
