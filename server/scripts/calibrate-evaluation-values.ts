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
//   mobility   <- move-speed extremity + mobility_ability_tier + Blink/BoT purchase rank, rank-rescaled (see server/data/map-control-weights.json)
//   map_control <- see server/data/map-control-weights.json (vision + mobility + ability tags), rank-rescaled
//   saving     <- 40% hero_healing_per_min (benchmarks) + 60% protects_allies tag (binary, from synergy_tags)
// A hero missing a given input keeps its existing formula/prior value for
// that specific axis rather than being scored as an artificial 0 —
// weightedBlend() redistributes weight across whatever inputs are present.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');
const HERO_META_PATH = path.join(__dirname, '..', 'data', 'hero-meta.json');
const TEMPO_TREND_PATH = path.join(__dirname, '..', 'data', 'research-tempo-v3-output.json');
const EARLY_KILLS_PATH = path.join(__dirname, '..', 'data', 'research-tempo-mobility-output.json');
const CONTROL_DURABILITY_VISION_PATH = path.join(
  __dirname,
  '..',
  'data',
  'control-durability-vision-data.json',
);
const HERO_CONSTANTS_PATH = path.join(__dirname, '..', 'data', 'hero-constants.json');
const WEIGHTS_PATH = path.join(__dirname, '..', 'data', 'map-control-weights.json');

interface RawHero {
  id: number;
  name: string;
  synergy_tags: string[];
  vision_ability_tier?: number;
  mobility_ability_tier?: number;
  mobility_items_tier?: number;
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
  blinkRate: number;
  botRate: number;
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
  mobilityScore: {
    baseMoveSpeed: number;
    moveSpeedExtremityExponent: number;
    abilityMobilityBonus: number;
    itemsPurchaseBonus: number;
  };
  finalMobilityExtremityExponent: number;
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

  const constantsRaw: Record<string, HeroConstant> = JSON.parse(
    fs.readFileSync(HERO_CONSTANTS_PATH, 'utf-8'),
  );
  const constantsByHeroId = new Map(Object.values(constantsRaw).map((c) => [c.id, c]));

  // --- teamfight / burst / objectives: unchanged from the first calibration pass ---
  const heroDamage = heroes.map((h) =>
    medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.hero_damage_per_min),
  );
  const killsPerMin = heroes.map((h) =>
    medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.kills_per_min),
  );
  const goldPerMin = heroes.map((h) =>
    medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.gold_per_min),
  );
  const xpPerMin = heroes.map((h) => medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.xp_per_min));
  const towerDamage = heroes.map((h) =>
    medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.tower_damage),
  );

  const teamfightScores = percentileRankScale(heroDamage);
  const burstScores = percentileRankScale(killsPerMin);
  const goldScores = percentileRankScale(goldPerMin);
  const xpScores = percentileRankScale(xpPerMin);
  const objectivesScores = percentileRankScale(towerDamage);
  const gpmXpmScaling = heroes.map((_, i) =>
    weightedBlend([
      { value: goldScores[i], weight: 1 },
      { value: xpScores[i], weight: 1 },
    ]),
  );

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

  // --- map control / mobility: vision + mobility + ability tags ---
  const wardsRaw = heroes.map((h) => cdvByHeroId.get(h.id)?.wardsPerMin ?? null);
  const wardScores = percentileRankScale(wardsRaw);

  const innateVisionRaw = heroes.map((h) => {
    const c = constantsByHeroId.get(h.id);
    return c ? c.day_vision + c.night_vision : null;
  });
  const innateVisionScores = percentileRankScale(innateVisionRaw);

  const moveSpeedRaw = heroes.map((h) => constantsByHeroId.get(h.id)?.move_speed ?? null);
  const moveSpeedScores = zScoreExtremityScale(
    moveSpeedRaw,
    weights.mobilityScore.moveSpeedExtremityExponent,
  );

  // mobility_items_tier: Blink Dagger / Boots of Travel purchase rate
  // (server/scripts/research-tempo-mobility-data.ts), rank-scaled rather
  // than threshold-tagged — blinkRate has no natural gap in the data (a
  // smooth decline from 99% to under 50%, dominated by pure initiators
  // like Sand King/Axe/Legion Commander, not mobile heroes), so a fixed
  // rate cutoff would either miss real signal or over-tag initiators.
  // Rank-based scoring sidesteps that: a hero's score depends only on
  // relative purchase frequency vs. the rest of the roster, not on where
  // the raw rate happens to sit. botRate does have a clean gap (28.7% ->
  // 11.6%) but is scored the same way for consistency. Blink is capped at
  // 4 and BoT at 2 (Blink is the stronger positioning tool) via linear
  // rescale of the 0-10 rank score, and the two are combined with max()
  // rather than summed to avoid double-rewarding a hero who buys both.
  const blinkRateRaw = heroes.map((h) => earlyKillsByHeroId.get(h.id)?.blinkRate ?? null);
  const blinkScores = percentileRankScale(blinkRateRaw);
  const botRateRaw = heroes.map((h) => earlyKillsByHeroId.get(h.id)?.botRate ?? null);
  const botScores = percentileRankScale(botRateRaw);
  const mobilityItemsRaw = heroes.map((_, i) => {
    const blinkComponent = blinkScores[i] === null ? 0 : (blinkScores[i] / 10) * 4;
    const botComponent = botScores[i] === null ? 0 : (botScores[i] / 10) * 2;
    return Math.round(Math.max(blinkComponent, botComponent) * 10) / 10;
  });

  // mobility: real move-speed extremity + hand-tagged mobility abilities +
  // item-purchase signal above. mobility_ability_tier is 0 for 90% of
  // heroes (no tagged mobility ability) — that flat majority needs a
  // FINAL pass that does NOT spread them across the full 0-10 range.
  // percentileRankScale was tried first and rejected: it measures relative
  // rank, so even within a 90%-flat cluster someone always ranks "above
  // 70% of the league," which pushed clearly non-mobile heroes (Legion
  // Commander, Sven, Chaos Knight — zero ability tier, average move speed)
  // up to 7-9/10. zScoreExtremityScale instead keeps values near the
  // population mean close to 5 and only pushes genuine outliers (ability
  // tier 10 heroes) toward 10 — the right shape for a bimodal population
  // (small genuinely-mobile cluster + large non-mobile majority) rather
  // than a smooth continuum. This replaces the old hardcoded 3/6
  // role-based stub (see Blueprint/10-tech-debt-backlog.md).
  const mobilityRaw = heroes.map((h, i) =>
    weightedBlend([
      { value: moveSpeedScores[i], weight: weights.mobilityScore.baseMoveSpeed },
      { value: h.mobility_ability_tier ?? 0, weight: weights.mobilityScore.abilityMobilityBonus },
      { value: mobilityItemsRaw[i], weight: weights.mobilityScore.itemsPurchaseBonus },
    ]),
  );
  const mobilityScores = zScoreExtremityScale(mobilityRaw, weights.finalMobilityExtremityExponent);

  // map_control: same compression problem as mobility — vision_ability_tier
  // is 0 for ~80% of heroes and carries direct blend weight — so the
  // composite gets the same final percentileRankScale pass.
  const mapControlRaw = heroes.map((h, i) => {
    const visionScore = weightedBlend([
      { value: wardScores[i], weight: weights.visionScore.wardScore },
      { value: innateVisionScores[i], weight: weights.visionScore.innateVisionRange },
    ]);
    return weightedBlend([
      { value: visionScore, weight: weights.topLevel.visionScore },
      { value: mobilityRaw[i], weight: weights.topLevel.mobilityScore },
      { value: h.vision_ability_tier ?? 0, weight: weights.topLevel.abilityVisionBonus },
    ]);
  });
  const mapControlScores = percentileRankScale(mapControlRaw);

  // --- saving: real healing data + hand-tagged protects_allies ---
  const healingRaw = heroes.map((h) =>
    medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.hero_healing_per_min),
  );
  const healingScores = percentileRankScale(healingRaw);

  const counts = {
    teamfight: 0,
    burst: 0,
    scaling: 0,
    objectives: 0,
    tempo: 0,
    control: 0,
    durability: 0,
    mobility: 0,
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
    hero.mobility_items_tier = mobilityItemsRaw[i];
    setOrFallback('mobility', mobilityScores[i], 'mobility');
    setOrFallback('map_control', mapControlScores[i], 'mapControl');
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
