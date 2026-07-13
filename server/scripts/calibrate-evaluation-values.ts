import * as fs from 'fs';
import * as path from 'path';
import {
  percentileRankScale,
  medianBenchmarkValue,
  zScoreExtremityScale,
  weightedBlend,
} from '../src/hero-meta/benchmark-calibration';

// Replaces all 10 evaluation_values axes with scores grounded in real
// OpenDota data, per the mapping agreed in Blueprint/09-hero-knowledge-base.md:
//   teamfight  <- hero_damage_per_min (benchmarks)
//   burst      <- kills_per_min (benchmarks)
//   scaling    <- 60% avg(gold_per_min, xp_per_min) + 40% win-rate-rises-with-duration trend
//   objectives <- tower_damage (benchmarks)
//   tempo      <- 37.5% win/loss duration gap + 37.5% win-rate-falls-with-duration trend + 25% early kills/game
//   control    <- stuns per minute
//   durability <- damage_taken / deaths (summed across matches, not averaged per-match)
//   map_control <- see server/data/map-control-weights.json (vision + mobility + ability tags)
//   saving     <- 40% hero_healing_per_min (benchmarks) + 60% protects_allies tag (binary, from synergy_tags)
// A hero missing a given input keeps its existing formula/prior value for
// that specific axis rather than being scored as an artificial 0 —
// weightedBlend() redistributes weight across whatever inputs are present.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const TEMPO_TREND_PATH = path.join(__dirname, '..', 'data', 'research-tempo-v3-output.json');
const EARLY_KILLS_PATH = path.join(__dirname, '..', 'data', 'research-tempo-mobility-output.json');
const CONTROL_DURABILITY_VISION_PATH = path.join(__dirname, '..', 'data', 'control-durability-vision-data.json');
const HERO_CONSTANTS_PATH = path.join(__dirname, '..', 'data', 'hero-constants.json');
const WEIGHTS_PATH = path.join(__dirname, '..', 'data', 'map-control-weights.json');

interface RawHero {
  id: number;
  name: string;
  synergy_tags: string[];
  vision_ability_tier?: number;
  mobility_ability_tier?: number;
  evaluation_values: Record<string, number>;
  [key: string]: unknown;
}

interface HeroMetaEntry {
  heroId: number;
  benchmarks: Record<string, { percentile: number; value: number }[]> | null;
}

interface TempoTrendEntry {
  heroId: number;
  gapSeconds: number | null;
  wrShort: number | null;
  wrLong: number | null;
}

interface EarlyKillsEntry {
  heroId: number;
  earlyKillsPerGame: number;
}

interface ControlDurabilityVisionEntry {
  heroId: number;
  stunsPerMin: number | null;
  wardsPerMin: number | null;
  durability: number | null;
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
  mobilityScore: { baseMoveSpeed: number; moveSpeedExtremityExponent: number; abilityMobilityBonus: number };
}

function byHeroId<T extends { heroId: number }>(filePath: string): Map<number, T> {
  const rows: T[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return new Map(rows.map((r) => [r.heroId, r]));
}

function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const meta: { heroes: HeroMetaEntry[] } = JSON.parse(fs.readFileSync(HERO_META_PATH, 'utf-8'));
  const metaByHeroId = new Map(meta.heroes.map((h) => [h.heroId, h]));
  const tempoTrendByHeroId = byHeroId<TempoTrendEntry>(TEMPO_TREND_PATH);
  const earlyKillsByHeroId = byHeroId<EarlyKillsEntry>(EARLY_KILLS_PATH);
  const cdvByHeroId = byHeroId<ControlDurabilityVisionEntry>(CONTROL_DURABILITY_VISION_PATH);
  const weights: MapControlWeights = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf-8'));

  const constantsRaw: Record<string, HeroConstant> = JSON.parse(fs.readFileSync(HERO_CONSTANTS_PATH, 'utf-8'));
  const constantsByHeroId = new Map(Object.values(constantsRaw).map((c) => [c.id, c]));

  // --- teamfight / burst / objectives: unchanged from the first calibration pass ---
  const heroDamage = heroes.map((h) => medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.hero_damage_per_min));
  const killsPerMin = heroes.map((h) => medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.kills_per_min));
  const goldPerMin = heroes.map((h) => medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.gold_per_min));
  const xpPerMin = heroes.map((h) => medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.xp_per_min));
  const towerDamage = heroes.map((h) => medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.tower_damage));

  const teamfightScores = percentileRankScale(heroDamage);
  const burstScores = percentileRankScale(killsPerMin);
  const goldScores = percentileRankScale(goldPerMin);
  const xpScores = percentileRankScale(xpPerMin);
  const objectivesScores = percentileRankScale(towerDamage);
  const gpmXpmScaling = heroes.map((_, i) => weightedBlend([
    { value: goldScores[i], weight: 1 },
    { value: xpScores[i], weight: 1 },
  ]));

  // --- tempo / scaling trend components ---
  const gapSecondsRaw = heroes.map((h) => tempoTrendByHeroId.get(h.id)?.gapSeconds ?? null);
  const gapScores = percentileRankScale(gapSecondsRaw); // higher gap (loses slower than it wins) = higher tempo

  const trendRaw = heroes.map((h) => {
    const t = tempoTrendByHeroId.get(h.id);
    if (!t || t.wrShort === null || t.wrLong === null) return null;
    return t.wrLong - t.wrShort; // positive = win rate rises with duration (scaling); negative = falls (tempo)
  });
  const trendScoresForScaling = percentileRankScale(trendRaw); // rising trend -> high score
  const trendScoresForTempo = percentileRankScale(trendRaw.map((v) => (v === null ? null : -v))); // falling trend -> high score

  const earlyKillsRaw = heroes.map((h) => earlyKillsByHeroId.get(h.id)?.earlyKillsPerGame ?? null);
  const earlyKillsScores = percentileRankScale(earlyKillsRaw);

  // --- control / durability ---
  const stunsRaw = heroes.map((h) => cdvByHeroId.get(h.id)?.stunsPerMin ?? null);
  const controlScores = percentileRankScale(stunsRaw);

  const durabilityRaw = heroes.map((h) => cdvByHeroId.get(h.id)?.durability ?? null);
  const durabilityScores = percentileRankScale(durabilityRaw);

  // --- map control: vision + mobility + ability tags ---
  const wardsRaw = heroes.map((h) => cdvByHeroId.get(h.id)?.wardsPerMin ?? null);
  const wardScores = percentileRankScale(wardsRaw);

  const innateVisionRaw = heroes.map((h) => {
    const c = constantsByHeroId.get(h.id);
    return c ? c.day_vision + c.night_vision : null;
  });
  const innateVisionScores = percentileRankScale(innateVisionRaw);

  const moveSpeedRaw = heroes.map((h) => constantsByHeroId.get(h.id)?.move_speed ?? null);
  const moveSpeedScores = zScoreExtremityScale(moveSpeedRaw, weights.mobilityScore.moveSpeedExtremityExponent);

  // --- saving: real healing data + hand-tagged protects_allies ---
  const healingRaw = heroes.map((h) => medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.hero_healing_per_min));
  const healingScores = percentileRankScale(healingRaw);

  const counts = {
    teamfight: 0,
    burst: 0,
    scaling: 0,
    objectives: 0,
    tempo: 0,
    control: 0,
    durability: 0,
    mapControl: 0,
    saving: 0,
    fallback: 0,
  };

  heroes.forEach((hero, i) => {
    const setOrFallback = (axis: string, value: number | null, counterKey: keyof typeof counts) => {
      if (value !== null) {
        hero.evaluation_values[axis] = value;
        counts[counterKey]++;
      } else {
        counts.fallback++;
      }
    };

    setOrFallback('teamfight', teamfightScores[i], 'teamfight');
    setOrFallback('burst', burstScores[i], 'burst');
    setOrFallback('objectives', objectivesScores[i], 'objectives');

    setOrFallback(
      'scaling',
      weightedBlend([
        { value: gpmXpmScaling[i], weight: 0.6 },
        { value: trendScoresForScaling[i], weight: 0.4 },
      ]),
      'scaling',
    );

    setOrFallback(
      'tempo',
      weightedBlend([
        { value: gapScores[i], weight: 0.375 },
        { value: trendScoresForTempo[i], weight: 0.375 },
        { value: earlyKillsScores[i], weight: 0.25 },
      ]),
      'tempo',
    );

    setOrFallback('control', controlScores[i], 'control');
    setOrFallback('durability', durabilityScores[i], 'durability');

    const visionScore = weightedBlend([
      { value: wardScores[i], weight: weights.visionScore.wardScore },
      { value: innateVisionScores[i], weight: weights.visionScore.innateVisionRange },
    ]);

    // Ability tag components use 0 (not null) when a hero simply has no
    // tagged ability — that's a real "no bonus" data point, not missing
    // data, so it should pull the blend down rather than being skipped.
    const abilityVisionForBlend = hero.vision_ability_tier ?? 0;
    const mobilityAbilityForBlend = hero.mobility_ability_tier ?? 0;
    const mobilityScore = weightedBlend([
      { value: moveSpeedScores[i], weight: weights.mobilityScore.baseMoveSpeed },
      { value: mobilityAbilityForBlend, weight: weights.mobilityScore.abilityMobilityBonus },
    ]);

    const mapControl = weightedBlend([
      { value: visionScore, weight: weights.topLevel.visionScore },
      { value: mobilityScore, weight: weights.topLevel.mobilityScore },
      { value: abilityVisionForBlend, weight: weights.topLevel.abilityVisionBonus },
    ]);

    if (mapControl !== null) {
      hero.evaluation_values.map_control = mapControl;
      counts.mapControl++;
    } else {
      counts.fallback++;
    }
    delete hero.evaluation_values.vision;

    // protects_allies is a binary tag (has it or doesn't) — like the ability
    // tiers above, absence is a real "no bonus" data point, not missing data.
    const protectsAlliesForBlend = hero.synergy_tags.includes('protects_allies') ? 10 : 0;
    setOrFallback(
      'saving',
      weightedBlend([
        { value: healingScores[i], weight: 0.4 },
        { value: protectsAlliesForBlend, weight: 0.6 },
      ]),
      'saving',
    );
  });

  fs.writeFileSync(HEROES_PATH, JSON.stringify(heroes, null, 2) + '\n');

  console.log(`Calibrated ${heroes.length} heroes:`);
  Object.entries(counts).forEach(([key, count]) => {
    if (key !== 'fallback') console.log(`  ${key}: ${count}/${heroes.length}`);
  });
  console.log(`  (${counts.fallback} axis-values kept on prior fallback due to missing data)`);
}

main();
