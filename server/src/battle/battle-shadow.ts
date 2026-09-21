// Shadow overallPower variants for R1/R2 Battle-feature experiments.
// Production path is unchanged unless DOTADRAFT_BATTLE_SHADOW is set
// (baked at import, same pattern as DISABLED_TAGS). Eval radar is not
// consumed here. Do not write axis-weights.json from this module.
import * as fs from 'fs';
import * as path from 'path';
import type { HeroEvaluationValues } from 'shared';
import { axisWeightsConfig, type GamePhase } from '../common/axis-weights-config';
import { AXES } from '../assessment-core/axes';
import { axisAverage, pickAxisValue } from '../assessment-core/axis-average';
import type { CustomTagEffects } from '../assessment-core/analyzer-types';
import type { BattlePick } from '../assessment-core/team-pick';
import { medianBenchmarkValue, percentileRankScale } from '../hero-meta/benchmark-calibration';

export type BattleShadowMode =
  | 'off'
  | 'explicit'
  | 'combat_pc1'
  | 'skirmish_role'
  | 'farm_need'
  | 'body_integrity'
  | 'r2_f'
  | 'farm_need_v2'
  | 'r2_f_dis'
  | 'r2_f_farm'
  | 'r2_f_farm_save0';

const rawMode = (process.env.DOTADRAFT_BATTLE_SHADOW ?? 'off').trim();
const ALLOWED: BattleShadowMode[] = [
  'off',
  'explicit',
  'combat_pc1',
  'skirmish_role',
  'farm_need',
  'body_integrity',
  'r2_f',
  'farm_need_v2',
  'r2_f_dis',
  'r2_f_farm',
  'r2_f_farm_save0',
];
export const BATTLE_SHADOW: BattleShadowMode = ALLOWED.includes(rawMode as BattleShadowMode)
  ? (rawMode as BattleShadowMode)
  : 'off';

const COMBAT_AXES = ['burst', 'scaling', 'objectives', 'teamfight', 'durability'] as const;
type CombatAxis = (typeof COMBAT_AXES)[number];
const COMBAT_AXIS_SET = new Set<string>(COMBAT_AXES);

function isCombatAxis(axis: keyof HeroEvaluationValues): axis is CombatAxis {
  return COMBAT_AXIS_SET.has(axis);
}

// PC1 loadings from axis-structure-analysis.json (2026-08-15). Combat axes
// load negative — Battle wants combat strength, so we flip the sign.
const PC1_COMBAT_LOADING: Record<CombatAxis, number> = {
  burst: -0.843,
  scaling: -0.803,
  objectives: -0.795,
  teamfight: -0.758,
  durability: -0.668,
};
const PC1_ABS_SUM = COMBAT_AXES.reduce((s, a) => s + Math.abs(PC1_COMBAT_LOADING[a]), 0);

const BODY_INTEGRITY_MULT = 0.7;
const SUPPORT_ROLES = new Set(['Soft Support', 'Hard Support']);

function prodWeight(axis: keyof HeroEvaluationValues, phase: GamePhase): number {
  return axisWeightsConfig.phaseWeights?.[phase]?.[axis] ?? axisWeightsConfig.axisWeights[axis] ?? 1;
}

function explicitWeight(axis: keyof HeroEvaluationValues, phase: GamePhase): number {
  const phaseW = axisWeightsConfig.phaseWeights?.[phase]?.[axis];
  if (phaseW !== undefined) return phaseW;
  return axisWeightsConfig.axisWeights[axis] ?? 0;
}

function r2Weight(axis: keyof HeroEvaluationValues, phase: GamePhase): number {
  if (axis === 'resource_efficiency') return 0;
  return explicitWeight(axis, phase);
}

function r2FarmSave0Weight(axis: keyof HeroEvaluationValues, phase: GamePhase): number {
  if (axis === 'saving') return 0;
  return r2Weight(axis, phase);
}

// Restore control's production silent default (missing key → 1) as an
// explicit disable_presence budget. Not a new tuned coefficient; not written
// to axis-weights.json.
function r2DisWeight(axis: keyof HeroEvaluationValues, phase: GamePhase): number {
  if (axis === 'control') return 1;
  return r2Weight(axis, phase);
}

function weightedMean(
  team: BattlePick[],
  phase: GamePhase,
  tagEffects: CustomTagEffects | undefined,
  weightFn: (axis: keyof HeroEvaluationValues, phase: GamePhase) => number,
  valueFn: (
    team: BattlePick[],
    axis: keyof HeroEvaluationValues,
    tagEffects: CustomTagEffects | undefined,
    phase: GamePhase,
  ) => number,
): number {
  let num = 0;
  let den = 0;
  for (const axis of AXES) {
    const w = weightFn(axis, phase);
    if (w === 0) continue;
    num += valueFn(team, axis, tagEffects, phase) * w;
    den += w;
  }
  return den === 0 ? 0 : num / den;
}

function combatAxisValue(
  pick: BattlePick,
  axis: CombatAxis,
  tagEffects: CustomTagEffects | undefined,
  phase: GamePhase,
  applyBody: boolean,
  applyFarmV2 = false,
): number {
  let v: number;
  if (applyFarmV2 && axis === 'scaling') {
    const scaling = pickAxisValue(pick, 'scaling', tagEffects, phase);
    const tempo = pickAxisValue(pick, 'tempo', tagEffects, phase);
    v = Math.max(0, Math.min(10, 5 + scaling - tempo));
  } else {
    v = pickAxisValue(pick, axis, tagEffects, phase);
  }
  if (
    applyBody &&
    (axis === 'durability' || axis === 'objectives') &&
    pick.hero.tags?.includes('summon_based')
  ) {
    v *= BODY_INTEGRITY_MULT;
  }
  return v;
}

function combatPc1ForPick(
  pick: BattlePick,
  tagEffects: CustomTagEffects | undefined,
  phase: GamePhase,
  applyBody = false,
  applyFarmV2 = false,
): number {
  let raw = 0;
  for (const axis of COMBAT_AXES) {
    const v = combatAxisValue(pick, axis, tagEffects, phase, applyBody, applyFarmV2);
    raw += -PC1_COMBAT_LOADING[axis] * (v - 5);
  }
  return Math.max(0, Math.min(10, 5 + raw / PC1_ABS_SUM));
}

function combatPc1Team(
  team: BattlePick[],
  tagEffects: CustomTagEffects | undefined,
  phase: GamePhase,
  applyBody = false,
  applyFarmV2 = false,
): number {
  if (team.length === 0) return 5;
  const mean =
    team.reduce((s, p) => s + combatPc1ForPick(p, tagEffects, phase, applyBody, applyFarmV2), 0) /
    team.length;
  const axisMult = COMBAT_AXES.reduce((m, axis) => m * (tagEffects?.axisMultiplier[axis] ?? 1), 1);
  return mean * axisMult;
}

function collapseCombatPower(
  team: BattlePick[],
  phase: GamePhase,
  tagEffects: CustomTagEffects | undefined,
  weightFn: (axis: keyof HeroEvaluationValues, phase: GamePhase) => number,
  applyBody: boolean,
  valueFn: (
    team: BattlePick[],
    axis: keyof HeroEvaluationValues,
    tagEffects: CustomTagEffects | undefined,
    phase: GamePhase,
  ) => number = axisAverage,
  applyFarmV2 = false,
): number {
  let num = 0;
  let den = 0;
  let combatBudget = 0;
  for (const axis of AXES) {
    const w = weightFn(axis, phase);
    if (isCombatAxis(axis)) {
      combatBudget += w;
      continue;
    }
    if (w === 0) continue;
    num += valueFn(team, axis, tagEffects, phase) * w;
    den += w;
  }
  if (combatBudget !== 0) {
    num += combatPc1Team(team, tagEffects, phase, applyBody, applyFarmV2) * combatBudget;
    den += combatBudget;
  }
  return den === 0 ? 0 : num / den;
}

function skirmishTeamValue(
  team: BattlePick[],
  tagEffects: CustomTagEffects | undefined,
  phase: GamePhase,
): number {
  if (team.length === 0) return 5;
  const raw =
    team.reduce((sum, p) => {
      const isSupport = p.assignedRole != null && SUPPORT_ROLES.has(p.assignedRole);
      const v = isSupport ? 5 : pickAxisValue(p, 'skirmish_rate', tagEffects, phase);
      return sum + v;
    }, 0) / team.length;
  return raw * (tagEffects?.axisMultiplier.skirmish_rate ?? 1);
}

function bodyPickValue(
  pick: BattlePick,
  axis: keyof HeroEvaluationValues,
  tagEffects: CustomTagEffects | undefined,
  phase: GamePhase,
): number {
  const v = pickAxisValue(pick, axis, tagEffects, phase);
  if ((axis === 'durability' || axis === 'objectives') && pick.hero.tags?.includes('summon_based')) {
    return v * BODY_INTEGRITY_MULT;
  }
  return v;
}

const farmNeedByHeroId = loadFarmNeedByHeroId();
const disableByHeroId = loadDisableByHeroId();

function loadDisableByHeroId(): Map<number, number> {
  const out = new Map<number, number>();
  const aggPath = path.join(__dirname, '..', '..', 'data', 'ability-tag-aggregates.json');
  if (!fs.existsSync(aggPath)) return out;
  try {
    const rows = JSON.parse(fs.readFileSync(aggPath, 'utf-8')) as {
      heroId: number;
      control_strength: number;
    }[];
    const ids = rows.map((r) => r.heroId);
    const scaled = percentileRankScale(rows.map((r) => r.control_strength));
    ids.forEach((id, i) => {
      if (scaled[i] != null) out.set(id, scaled[i] as number);
    });
  } catch {
    return out;
  }
  return out;
}

function loadFarmNeedByHeroId(): Map<number, number> {
  const out = new Map<number, number>();
  const metaPath = path.join(__dirname, '..', '..', 'data', 'hero-meta.json');
  if (!fs.existsSync(metaPath)) return out;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as {
      heroes: {
        heroId: number;
        benchmarks?: Record<string, { percentile: number; value: number }[] | null> | null;
      }[];
    };
    const ids = meta.heroes.map((h) => h.heroId);
    const lh = meta.heroes.map((h) => medianBenchmarkValue(h.benchmarks?.last_hits_per_min));
    const scaled = percentileRankScale(lh);
    ids.forEach((id, i) => {
      if (scaled[i] != null) out.set(id, scaled[i] as number);
    });
  } catch {
    return out;
  }
  return out;
}

function farmNeedTeam(
  team: BattlePick[],
  tagEffects: CustomTagEffects | undefined,
  phase: GamePhase,
): number {
  if (team.length === 0) return 5;
  const raw =
    team.reduce((sum, p) => {
      const fallback = pickAxisValue(p, 'scaling', tagEffects, phase);
      const scored = farmNeedByHeroId.get(p.hero.id) ?? fallback;
      const heroMult = tagEffects?.heroPowerMultiplier.get(p.hero.id) ?? 1;
      const phaseHeroMult = (phase && tagEffects?.phaseHeroPowerMultiplier.get(phase)?.get(p.hero.id)) ?? 1;
      return sum + scored * heroMult * phaseHeroMult;
    }, 0) / team.length;
  return raw * (tagEffects?.axisMultiplier.scaling ?? 1);
}

// Late minus early: high scaling / low tempo = needs time. Not LH/min.
function farmNeedV2Team(
  team: BattlePick[],
  tagEffects: CustomTagEffects | undefined,
  phase: GamePhase,
): number {
  if (team.length === 0) return 5;
  const raw =
    team.reduce((sum, p) => {
      const scaling = pickAxisValue(p, 'scaling', tagEffects, phase);
      const tempo = pickAxisValue(p, 'tempo', tagEffects, phase);
      return sum + Math.max(0, Math.min(10, 5 + scaling - tempo));
    }, 0) / team.length;
  return raw * (tagEffects?.axisMultiplier.scaling ?? 1);
}

function disableTeamValue(
  team: BattlePick[],
  tagEffects: CustomTagEffects | undefined,
  phase: GamePhase,
): number {
  if (team.length === 0) return 5;
  const raw =
    team.reduce((sum, p) => {
      const mapped = disableByHeroId.get(p.hero.id);
      if (mapped == null) return sum + pickAxisValue(p, 'control', tagEffects, phase);
      const heroMult = tagEffects?.heroPowerMultiplier.get(p.hero.id) ?? 1;
      const heroAxisMult = tagEffects?.heroAxisMultiplier.get(p.hero.id)?.control ?? 1;
      const phaseHeroMult = (phase && tagEffects?.phaseHeroPowerMultiplier.get(phase)?.get(p.hero.id)) ?? 1;
      return sum + mapped * heroMult * heroAxisMult * phaseHeroMult;
    }, 0) / team.length;
  return raw * (tagEffects?.axisMultiplier.control ?? 1);
}

function replaceScalingPower(
  team: BattlePick[],
  phase: GamePhase,
  tagEffects: CustomTagEffects | undefined,
  weightFn: (axis: keyof HeroEvaluationValues, phase: GamePhase) => number,
  scalingValue: number,
): number {
  let num = 0;
  let den = 0;
  let scalingBudget = 0;
  for (const axis of AXES) {
    const w = weightFn(axis, phase);
    if (axis === 'scaling') {
      scalingBudget += w;
      continue;
    }
    if (w === 0) continue;
    num += axisAverage(team, axis, tagEffects, phase) * w;
    den += w;
  }
  if (scalingBudget !== 0) {
    num += scalingValue * scalingBudget;
    den += scalingBudget;
  }
  return den === 0 ? 0 : num / den;
}

export function shadowOverallPowerForPhase(
  team: BattlePick[],
  phase: GamePhase,
  tagEffects: CustomTagEffects | undefined,
  mode: BattleShadowMode = BATTLE_SHADOW,
): number {
  if (mode === 'off') {
    return weightedMean(team, phase, tagEffects, prodWeight, axisAverage);
  }

  if (mode === 'explicit') {
    return weightedMean(team, phase, tagEffects, explicitWeight, axisAverage);
  }

  if (mode === 'skirmish_role') {
    return weightedMean(team, phase, tagEffects, prodWeight, (t, axis, tags, ph) =>
      axis === 'skirmish_rate' ? skirmishTeamValue(t, tags, ph) : axisAverage(t, axis, tags, ph),
    );
  }

  if (mode === 'body_integrity') {
    return weightedMean(team, phase, tagEffects, prodWeight, (t, axis, tags, ph) => {
      if (axis !== 'durability' && axis !== 'objectives') return axisAverage(t, axis, tags, ph);
      if (t.length === 0) return 5;
      const raw = t.reduce((s, p) => s + bodyPickValue(p, axis, tags, ph), 0) / t.length;
      return raw * (tags?.axisMultiplier[axis] ?? 1);
    });
  }

  if (mode === 'combat_pc1') {
    return collapseCombatPower(team, phase, tagEffects, prodWeight, false);
  }

  if (mode === 'r2_f') {
    return collapseCombatPower(team, phase, tagEffects, r2Weight, true);
  }

  if (mode === 'r2_f_farm') {
    return collapseCombatPower(team, phase, tagEffects, r2Weight, true, axisAverage, true);
  }

  if (mode === 'r2_f_farm_save0') {
    return collapseCombatPower(team, phase, tagEffects, r2FarmSave0Weight, true, axisAverage, true);
  }

  if (mode === 'r2_f_dis') {
    return collapseCombatPower(team, phase, tagEffects, r2DisWeight, true, (t, axis, tags, ph) =>
      axis === 'control' ? disableTeamValue(t, tags, ph) : axisAverage(t, axis, tags, ph),
    );
  }

  if (mode === 'farm_need') {
    return replaceScalingPower(team, phase, tagEffects, prodWeight, farmNeedTeam(team, tagEffects, phase));
  }

  if (mode === 'farm_need_v2') {
    return replaceScalingPower(team, phase, tagEffects, prodWeight, farmNeedV2Team(team, tagEffects, phase));
  }

  return weightedMean(team, phase, tagEffects, prodWeight, axisAverage);
}
