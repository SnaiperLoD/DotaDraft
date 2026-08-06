import * as fs from 'fs';
import * as path from 'path';
import {
  percentileRankScale,
  anchoredGroupScale,
  zScoreExtremityScale,
  weightedBlend,
} from '../src/hero-meta/benchmark-calibration';

// Fills heroes.json's evaluation_values_by_role (Blueprint/12-next-session-
// priorities.md item 6), using the two role-split data collections
// (fetch-role-split-axis-data.ts, fetch-role-split-tempo-data.ts, both
// bucketed by the validated per-match classifier — research-role-
// classification-final.ts) plus the >8%-of-hero's-games threshold
// (research-role-threshold-coverage.json).
//
// Mirrors calibrate-evaluation-values.ts's formulas axis-by-axis, with one
// structural difference: every percentile-ranked input goes through
// anchoredGroupScale (benchmark-calibration.ts), not plain percentileRankScale
// across the whole roster or plain percentileRankScaleByGroup. History: pure
// within-role-group ranking (percentileRankScaleByGroup) was tried first —
// comparing a Support's damage/min only against other Supports so a
// dedicated healer doesn't read as "weak" purely for not out-damaging
// carries — but a self-play regression showed it measurably WORSENED the
// model (favoredRate-vs-real-winRate r: 0.085 -> 0.032, no-crutch test),
// because ranking-within-group always centers a group's mean at ~5,
// silently erasing the real cross-role signal that e.g. Supports genuinely
// deal less damage than Carries — anchoredGroupScale keeps the within-group
// relative order but rescales it onto the [min,max] GLOBAL score that
// group's members actually occupy, so that real cross-role gap survives.
//
// Which components are role-split vs stay hero-level-shared (per this
// session's explicit scope decisions):
//   role-split: damage/min, kills/min, tower dmg/min, gpm, xpm, stuns/min,
//     damage_taken/death, healing/min, deaths/min, last_hits/min,
//     camps_stacked/min, damage-per-networth-share, wards/min, tempo/scaling
//     TREND (duration gap, win-rate-by-duration, early kills)
//   stays hero-level (shared across all 4 roles for a hero): every
//     hand-tagged ability input (mobility/saving/control_strength/
//     damage_mitigation/initiating), move_speed, innate vision, Blink/BoT
//     purchase rate — so `mobility` and `initiating` end up IDENTICAL across
//     a hero's 4 roles (every one of their inputs is hero-level), which is
//     expected given the scope decision, not a bug.
//
// A role only gets real values if role-split-axis-data.json/role-split-
// tempo-data.json both have a bucket for it AND research-role-threshold-
// coverage.json marks it `pass: true` (>8% of the hero's total classified
// games) — otherwise the role is written as `{ no_info: true }`.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const AXIS_DATA_PATH = path.join(__dirname, '..', 'data', 'role-split-axis-data.json');
const TEMPO_DATA_PATH = path.join(__dirname, '..', 'data', 'role-split-tempo-data.json');
const THRESHOLD_PATH = path.join(__dirname, '..', 'data', 'research-role-threshold-coverage.json');
const ABILITY_TAG_AGGREGATES_PATH = path.join(__dirname, '..', 'data', 'ability-tag-aggregates.json');
const ABILITY_TAG_WEIGHTS_PATH = path.join(__dirname, '..', 'data', 'ability-tag-weights.json');
const HERO_CONSTANTS_PATH = path.join(__dirname, '..', 'data', 'hero-constants.json');
const MAP_CONTROL_WEIGHTS_PATH = path.join(__dirname, '..', 'data', 'map-control-weights.json');

type Position = 'Carry' | 'Mid' | 'Offlane' | 'Support';
const POSITIONS: Position[] = ['Carry', 'Mid', 'Offlane', 'Support'];

interface RawHero {
  id: number;
  name: string;
  evaluation_values: Record<string, number>;
  mobility_items_tier?: number;
  vision_ability_tier?: number;
  [key: string]: unknown;
}

interface HeroConstant {
  id: number;
  move_speed: number;
  day_vision: number;
  night_vision: number;
}

interface MapControlWeights {
  topLevel: { visionScore: number; mobilityScore: number; abilityVisionBonus: number };
  visionScore: { wardScore: number; innateVisionRange: number };
  mobilityScore: {
    baseMoveSpeed: number;
    moveSpeedExtremityExponent: number;
    abilityMobilityBonus: number;
    itemsPurchaseBonus: number;
  };
}

interface AxisBucket {
  position: Position;
  games: number;
  damagePerMin: number | null;
  killsPerMin: number | null;
  avgGpm: number | null;
  avgXpm: number | null;
  towerDamagePerMin: number | null;
  stunsPerMin: number | null;
  healingPerMin: number | null;
  damageTakenPerDeath: number | null;
  deathsPerMin: number | null;
  lastHitsPerMin: number | null;
  campsStackedPerMin: number | null;
  avgDamagePerNetworthShare: number | null;
  wardsPerMin: number | null;
}
interface AxisHero {
  heroId: number;
  buckets: AxisBucket[];
}

interface TempoBucket {
  position: Position;
  games: number;
  gapSeconds: number | null;
  wrShort: number | null;
  wrLong: number | null;
  earlyKillsPerGame: number | null;
}
interface TempoHero {
  heroId: number;
  buckets: TempoBucket[];
}

interface ThresholdEntry {
  heroId: number;
  Carry: { pass: boolean };
  Mid: { pass: boolean };
  Offlane: { pass: boolean };
  Support: { pass: boolean };
}

interface AbilityTagAggregate {
  heroId: number;
  saving: number;
  control_strength: number;
  damage_mitigation: number;
}
interface AbilityTagWeights {
  extremityExponents: { control_strength: number; damage_mitigation: number; saving: number; mobility: number };
  blend: {
    saving: { healingWeight: number; abilityTagWeight: number };
    control: { stunsWeight: number; abilityTagWeight: number };
    durability: { damageTakenWeight: number; abilityTagWeight: number };
  };
}

function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const axisData: AxisHero[] = JSON.parse(fs.readFileSync(AXIS_DATA_PATH, 'utf-8'));
  const tempoData: TempoHero[] = JSON.parse(fs.readFileSync(TEMPO_DATA_PATH, 'utf-8'));
  const thresholds: ThresholdEntry[] = JSON.parse(fs.readFileSync(THRESHOLD_PATH, 'utf-8'));
  const abilityTags: AbilityTagAggregate[] = JSON.parse(fs.readFileSync(ABILITY_TAG_AGGREGATES_PATH, 'utf-8'));
  const tagWeights: AbilityTagWeights = JSON.parse(fs.readFileSync(ABILITY_TAG_WEIGHTS_PATH, 'utf-8'));

  const axisByHero = new Map(axisData.map((h) => [h.heroId, h]));
  const tempoByHero = new Map(tempoData.map((h) => [h.heroId, h]));
  const thresholdByHero = new Map(thresholds.map((t) => [t.heroId, t]));
  const abilityTagByHero = new Map(abilityTags.map((a) => [a.heroId, a]));

  // Flatten to one row per (heroId, position) so every real-stat input can be
  // percentile-ranked WITHIN its role group in one pass.
  interface Row {
    heroId: number;
    position: Position;
    damagePerMin: number | null;
    killsPerMin: number | null;
    avgGpm: number | null;
    avgXpm: number | null;
    towerDamagePerMin: number | null;
    stunsPerMin: number | null;
    healingPerMin: number | null;
    damageTakenPerDeath: number | null;
    deathsPerMin: number | null;
    lastHitsPerMin: number | null;
    campsStackedPerMin: number | null;
    avgDamagePerNetworthShare: number | null;
    wardsPerMin: number | null;
    gapSeconds: number | null;
    trendRaw: number | null; // wrLong - wrShort
    earlyKillsPerGame: number | null;
  }

  const rows: Row[] = [];
  for (const hero of axisData) {
    const tempoHero = tempoByHero.get(hero.heroId);
    for (const b of hero.buckets) {
      const t = tempoHero?.buckets.find((tb) => tb.position === b.position);
      const trendRaw = t && t.wrShort !== null && t.wrLong !== null ? t.wrLong - t.wrShort : null;
      rows.push({
        heroId: hero.heroId,
        position: b.position,
        damagePerMin: b.damagePerMin,
        killsPerMin: b.killsPerMin,
        avgGpm: b.avgGpm,
        avgXpm: b.avgXpm,
        towerDamagePerMin: b.towerDamagePerMin,
        stunsPerMin: b.stunsPerMin,
        healingPerMin: b.healingPerMin,
        damageTakenPerDeath: b.damageTakenPerDeath,
        deathsPerMin: b.deathsPerMin,
        lastHitsPerMin: b.lastHitsPerMin,
        campsStackedPerMin: b.campsStackedPerMin,
        avgDamagePerNetworthShare: b.avgDamagePerNetworthShare,
        wardsPerMin: b.wardsPerMin,
        gapSeconds: t?.gapSeconds ?? null,
        trendRaw,
        earlyKillsPerGame: t?.earlyKillsPerGame ?? null,
      });
    }
  }

  const groups = rows.map((r) => r.position as string);
  const scale = (values: (number | null)[]) => anchoredGroupScale(values, groups);

  const teamfightScores = scale(rows.map((r) => r.damagePerMin));
  const burstScores = scale(rows.map((r) => r.killsPerMin));
  const objectivesScores = scale(rows.map((r) => r.towerDamagePerMin));
  const gpmScores = scale(rows.map((r) => r.avgGpm));
  const xpmScores = scale(rows.map((r) => r.avgXpm));
  const trendScoresForScaling = scale(rows.map((r) => r.trendRaw));
  const trendScoresForTempo = scale(rows.map((r) => (r.trendRaw === null ? null : -r.trendRaw)));
  const gapScores = scale(rows.map((r) => r.gapSeconds));
  const earlyKillsScores = scale(rows.map((r) => r.earlyKillsPerGame));
  const stunsScores = scale(rows.map((r) => r.stunsPerMin));
  const damageTakenScores = scale(rows.map((r) => r.damageTakenPerDeath));
  const healingScores = scale(rows.map((r) => r.healingPerMin));
  const deathsScores = scale(rows.map((r) => r.deathsPerMin));
  const lastHitsInvertedScores = scale(rows.map((r) => (r.lastHitsPerMin === null ? null : -r.lastHitsPerMin)));
  const campStackingScores = scale(rows.map((r) => r.campsStackedPerMin));
  const resourceEfficiencyScores = scale(rows.map((r) => r.avgDamagePerNetworthShare));
  const wardScores = scale(rows.map((r) => r.wardsPerMin));

  // Hand-tagged shared components (control_strength, damage_mitigation,
  // saving tag) — ranked once across the WHOLE hero population, exactly as
  // calibrate-evaluation-values.ts already does; these don't vary by role.
  const controlStrengthTagRaw = heroes.map((h) => abilityTagByHero.get(h.id)?.control_strength ?? 0);
  const controlStrengthTagScores = zScoreExtremityScale(
    controlStrengthTagRaw,
    tagWeights.extremityExponents.control_strength,
  );
  const damageMitigationTagRaw = heroes.map((h) => abilityTagByHero.get(h.id)?.damage_mitigation ?? 0);
  const damageMitigationTagScores = zScoreExtremityScale(
    damageMitigationTagRaw,
    tagWeights.extremityExponents.damage_mitigation,
  );
  const savingTagRaw = heroes.map((h) => abilityTagByHero.get(h.id)?.saving ?? 0);
  const savingTagScores = zScoreExtremityScale(savingTagRaw, tagWeights.extremityExponents.saving);
  const heroIndexById = new Map(heroes.map((h, i) => [h.id, i]));

  // map_control's non-ward components (mobility contribution, innate vision,
  // hand-tagged ability-vision-bonus) are hero-level constants — recomputed
  // here exactly as calibrate-evaluation-values.ts does (moveSpeedScores +
  // mobilityTagScores + mobility_items_tier, the last already stored on the
  // hero from that same script rather than re-derived from purchase rates,
  // which stay unsplit-by-role per this session's scope decision), so ward
  // score is the only role-varying input into map_control below.
  const mapWeights: MapControlWeights = JSON.parse(fs.readFileSync(MAP_CONTROL_WEIGHTS_PATH, 'utf-8'));
  const constantsRaw: Record<string, HeroConstant> = JSON.parse(fs.readFileSync(HERO_CONSTANTS_PATH, 'utf-8'));
  const constantsByHeroId = new Map(Object.values(constantsRaw).map((c) => [c.id, c]));
  const mobilityTagAggregates: { heroId: number; mobility: number }[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'data', 'ability-tag-aggregates.json'), 'utf-8'),
  );
  const mobilityTagByHero = new Map(mobilityTagAggregates.map((a) => [a.heroId, a.mobility]));
  const mobilityTagRaw = heroes.map((h) => mobilityTagByHero.get(h.id) ?? 0);
  const mobilityTagScoresConst = zScoreExtremityScale(mobilityTagRaw, tagWeights.extremityExponents.mobility);
  const moveSpeedRaw = heroes.map((h) => constantsByHeroId.get(h.id)?.move_speed ?? null);
  const moveSpeedScoresConst = zScoreExtremityScale(moveSpeedRaw, mapWeights.mobilityScore.moveSpeedExtremityExponent);
  const mobilityRawConst = heroes.map((h, i) =>
    weightedBlend([
      { value: moveSpeedScoresConst[i], weight: mapWeights.mobilityScore.baseMoveSpeed },
      { value: mobilityTagScoresConst[i] ?? 0, weight: mapWeights.mobilityScore.abilityMobilityBonus },
      { value: h.mobility_items_tier ?? 0, weight: mapWeights.mobilityScore.itemsPurchaseBonus },
    ]),
  );
  const innateVisionRaw = heroes.map((h) => {
    const c = constantsByHeroId.get(h.id);
    return c ? c.day_vision + c.night_vision : null;
  });
  const innateVisionScoresConst = percentileRankScale(innateVisionRaw);

  const mapControlRawPerRow = rows.map((r, i) => {
    const heroIdx = heroIndexById.get(r.heroId)!;
    const hero = heroes[heroIdx];
    const visionScoreRaw = weightedBlend([
      { value: wardScores[i], weight: mapWeights.visionScore.wardScore },
      { value: innateVisionScoresConst[heroIdx], weight: mapWeights.visionScore.innateVisionRange },
    ]);
    return weightedBlend([
      { value: visionScoreRaw, weight: mapWeights.topLevel.visionScore },
      { value: mobilityRawConst[heroIdx], weight: mapWeights.topLevel.mobilityScore },
      { value: hero.vision_ability_tier ?? 0, weight: mapWeights.topLevel.abilityVisionBonus },
    ]);
  });
  const mapControlScoresFinal = anchoredGroupScale(mapControlRawPerRow, groups);

  let filled = 0;
  let noInfo = 0;

  for (const hero of heroes) {
    const byRole: Record<Position, Record<string, unknown>> = {} as any;
    const heroIdx = heroIndexById.get(hero.id)!;

    for (const position of POSITIONS) {
      const pass = thresholdByHero.get(hero.id)?.[position]?.pass ?? false;
      const rowIdx = rows.findIndex((r) => r.heroId === hero.id && r.position === position);

      if (!pass || rowIdx === -1) {
        (byRole as any)[position] = { no_info: true };
        noInfo++;
        continue;
      }

      const savingHealingInput = healingScores[rowIdx]; // 0 real value handled same as hero-level calc (literal 0 at weight, not excluded)
      const controlValue = weightedBlend([
        { value: stunsScores[rowIdx], weight: tagWeights.blend.control.stunsWeight },
        { value: controlStrengthTagScores[heroIdx], weight: tagWeights.blend.control.abilityTagWeight },
      ]);
      const savingValue = weightedBlend([
        { value: savingHealingInput ?? 0, weight: tagWeights.blend.saving.healingWeight },
        { value: savingTagScores[heroIdx] ?? 0, weight: tagWeights.blend.saving.abilityTagWeight },
      ]);
      const tempoValue = weightedBlend([
        { value: gapScores[rowIdx], weight: 0.375 },
        { value: trendScoresForTempo[rowIdx], weight: 0.375 },
        { value: earlyKillsScores[rowIdx], weight: 0.25 },
      ]);
      const skirmishRateValue = weightedBlend([
        { value: deathsScores[rowIdx], weight: 1 },
        { value: lastHitsInvertedScores[rowIdx], weight: 1 },
      ]);

      const mapControlValue = mapControlScoresFinal[rowIdx];

      if (
        teamfightScores[rowIdx] === null &&
        burstScores[rowIdx] === null &&
        objectivesScores[rowIdx] === null
      ) {
        (byRole as any)[position] = { no_info: true };
        noInfo++;
        continue;
      }

      (byRole as any)[position] = {
        // Reverted to the hero-level aggregate (option 3, on top of
        // anchoredGroupScale — Blueprint/12-next-session-priorities.md item
        // 6, self-play regression 2026-08-06): these 5 axes still showed a
        // residual systematic shift even after anchoring (objectives +0.33,
        // durability +0.94 average delta vs aggregate across the 56
        // real-Support-data heroes) and the self-play r-correlation with
        // real winRate stayed below the pre-role-split baseline (0.085) even
        // with anchoring (0.016). Rather than keep tuning the scaling
        // formula for axes whose real-stat inputs (raw damage, kills, tower
        // damage, gpm/xpm+trend, damage_taken/death) may just be weak
        // role-quality predictors regardless of normalization, they stay
        // unsplit — same value across a hero's 4 roles, like mobility/
        // initiating below.
        teamfight: hero.evaluation_values.teamfight,
        burst: hero.evaluation_values.burst,
        scaling: hero.evaluation_values.scaling,
        objectives: hero.evaluation_values.objectives,
        durability: hero.evaluation_values.durability,
        tempo: tempoValue ?? hero.evaluation_values.tempo,
        control: controlValue ?? hero.evaluation_values.control,
        // Fully hero-level/shared — every input (move_speed, hand tag, item
        // purchase rate) stays constant across roles per this session's scope
        // decision, so these two are intentionally identical across a hero's
        // 4 roles.
        mobility: hero.evaluation_values.mobility,
        map_control: mapControlValue ?? hero.evaluation_values.map_control,
        saving: savingValue ?? hero.evaluation_values.saving,
        initiating: hero.evaluation_values.initiating,
        skirmish_rate: skirmishRateValue ?? hero.evaluation_values.skirmish_rate,
        camp_stacking: campStackingScores[rowIdx] ?? hero.evaluation_values.camp_stacking,
        resource_efficiency: resourceEfficiencyScores[rowIdx] ?? hero.evaluation_values.resource_efficiency,
      };
      filled++;
    }

    (hero as any).evaluation_values_by_role = byRole;
  }

  fs.writeFileSync(HEROES_PATH, JSON.stringify(heroes, null, 2) + '\n');
  console.log(`Calibrated evaluation_values_by_role for ${heroes.length} heroes.`);
  console.log(`  Filled (real data): ${filled} / ${heroes.length * 4}`);
  console.log(`  no_info: ${noInfo} / ${heroes.length * 4}`);
}

main();
