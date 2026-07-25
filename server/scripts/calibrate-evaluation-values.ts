import * as fs from 'fs';
import * as path from 'path';
import {
  percentileRankScale,
  percentileRankScaleByGroup,
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
//   control    <- 50% stuns per minute + 50% hand-tagged control_strength (see server/data/ability-tag-weights.json)
//   durability <- damage_taken / deaths (summed across matches, not averaged per-match)
//   mobility   <- move-speed extremity (20%) + hand-tagged mobility (70%, per-ability, summed per hero) + Blink/BoT purchase rank (10%) (see server/data/map-control-weights.json)
//   map_control <- see server/data/map-control-weights.json (vision + mobility + ability tags), rank-rescaled
//   saving     <- 40% hero_healing_per_min (benchmarks, skipped for heroes with zero hand-tagged saving abilities — see below) + 60% hand-tagged saving (per-ability, summed per hero, see server/data/ability-tag-weights.json)
//   initiating <- 85% hand-tagged initiating (per-ability, summed per hero) + 15% Blink Dagger purchase rank — stored on
//                 evaluation_values for reference, NOT yet wired into Battle Engine/role-fit/UI (separate scope)
//   skirmish_rate <- 50% deaths_per_min (higher = dies more often) + 50% inverted last_hits_per_min (lower CS/min = higher
//                 score) — Blueprint/10-tech-debt-backlog.md: both validated on real-data simple correlation with real
//                 winRate on their own (not just inside a multi-predictor regression), and nearly mirror each other
//                 (r=-0.726) — a hero who trades/fights a lot naturally farms less efficiently, and vice versa.
//                 Renamed from "aggression" (self-play outlier investigation) — the old name implied combat
//                 aggressiveness; what it actually measures is fight/skirmish involvement vs. farm efficiency.
//   camp_stacking <- camps_stacked_per_min, rank-scaled — kept as its own axis rather than folded into skirmish_rate:
//                 weakly correlated with the deaths/last-hits pair (|r|<0.17), so it captures something distinct.
//                 Renamed from "farm_priority" — that name implied "personal farm optimization," but stacking camps
//                 is a support/utility action done FOR an ally's farm, not a measure of the hero's own farm need.
//                 A carry who farms efficiently alone (e.g. Phantom Lancer) scores near-zero here despite being
//                 maximally farm-dependent — this axis does not capture "needs time to scale," nothing currently does.
//
// The hand-tagged mobility/saving/control_strength inputs come from
// server/data/ability-tagging.csv (manual, per-ability, 0-10) via
// aggregate-ability-tags.ts: summed per hero per category (an untagged
// ability contributes 0, not missing data — see Blueprint discussion),
// then zScoreExtremityScale'd here exactly like every other raw input, so a
// hero with one standout ability isn't diluted by an average over mostly-
// irrelevant abilities, and the large all-zero majority doesn't get spread
// across the full range the way percentileRankScale would.
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
const ABILITY_TAG_AGGREGATES_PATH = path.join(__dirname, '..', 'data', 'ability-tag-aggregates.json');
const ABILITY_TAG_WEIGHTS_PATH = path.join(__dirname, '..', 'data', 'ability-tag-weights.json');
const DEATHS_CAMPS_PATH = path.join(__dirname, '..', 'data', 'deaths-camps-data.json');

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
  positions: { position: string; share: number }[];
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

interface AbilityTagAggregate {
  heroId: number;
  mobility: number;
  saving: number;
  initiating: number;
  control_strength: number;
}

interface DeathsCampsEntry {
  heroId: number;
  deathsPerMin: number | null;
  campsStackedPerMin: number | null;
}

interface AbilityTagWeights {
  extremityExponents: { mobility: number; saving: number; initiating: number; control_strength: number };
  blend: {
    saving: { healingWeight: number; abilityTagWeight: number };
    control: { stunsWeight: number; abilityTagWeight: number };
    initiating: { abilityTagWeight: number; blinkWeight: number };
  };
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
  const abilityTagByHeroId = byHeroId<AbilityTagAggregate>(ABILITY_TAG_AGGREGATES_PATH);
  const tagWeights: AbilityTagWeights = JSON.parse(fs.readFileSync(ABILITY_TAG_WEIGHTS_PATH, 'utf-8'));
  const deathsCampsByHeroId = byHeroId<DeathsCampsEntry>(DEATHS_CAMPS_PATH);

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
  const stunsScores = percentileRankScale(stunsRaw);

  // control_strength (hand-tagged, per-ability, summed per hero) supplements
  // stuns: OpenDota's `stuns` stat only counts hard disables (stun/hex/root)
  // — silences and slows don't set that flag, so control-heavy heroes built
  // around them (Silencer, Doom, Death Prophet) were undercounted by stuns
  // alone. Weighted below real stuns data per the same "manual counts less"
  // principle as everywhere else (see server/data/ability-tag-weights.json)
  // — deliberately not tuned further yet; the thing worth checking after a
  // run is whether Silencer/Doom/Death Prophet actually climb, not just
  // whether already-top stun heroes climb further (they were never the
  // heroes this was meant to fix).
  const controlStrengthTagRaw = heroes.map((h) => abilityTagByHeroId.get(h.id)?.control_strength ?? 0);
  const controlStrengthTagScores = zScoreExtremityScale(
    controlStrengthTagRaw,
    tagWeights.extremityExponents.control_strength,
  );
  const controlScores = heroes.map((_, i) =>
    weightedBlend([
      { value: stunsScores[i], weight: tagWeights.blend.control.stunsWeight },
      { value: controlStrengthTagScores[i], weight: tagWeights.blend.control.abilityTagWeight },
    ]),
  );

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

  // initiating (preview axis, see header comment): pure ability-tag sum
  // undercounted the classic "Blink Dagger + one ultimate" initiators
  // (Tidehunter, Mars, Sven, Dragon Knight...) relative to multi-spell kit
  // heroes (Invoker, Tusk, Earth Spirit), since they only ever have 1-2
  // tagged abilities to sum. Blink Dagger rate alone (not BoT — BoT isn't an
  // initiation tool) is blended in, weighted higher than mobility's combined
  // item signal (0.15 vs mobility's 0.1) precisely because for this axis
  // itemization *is* a primary signal for a whole class of initiators, not
  // a minor supplement.
  const initiatingTagRaw = heroes.map((h) => abilityTagByHeroId.get(h.id)?.initiating ?? 0);
  const initiatingTagScores = zScoreExtremityScale(initiatingTagRaw, tagWeights.extremityExponents.initiating);
  const initiatingScores = heroes.map((_, i) =>
    weightedBlend([
      { value: initiatingTagScores[i], weight: tagWeights.blend.initiating.abilityTagWeight },
      { value: blinkScores[i], weight: tagWeights.blend.initiating.blinkWeight },
    ]),
  );

  // --- skirmish_rate / camp_stacking (formerly aggression / farm_priority): new axes (Blueprint/10-tech-debt-backlog.md,
  // "regress-composite-clusters-v2" findings) — deaths_per_min and
  // camps_stacked_per_min (server/scripts/fetch-deaths-camps-data.ts) plus
  // last_hits_per_min (already fetched into hero-meta.json's benchmarks,
  // previously unused). Simple correlation with real winRate validated each
  // one individually before wiring them in (see commit history/Blueprint) —
  // not just inside a multi-predictor regression, which this session
  // already caught giving false positives (burst, movement).
  const deathsPerMinRaw = heroes.map((h) => deathsCampsByHeroId.get(h.id)?.deathsPerMin ?? null);
  const deathsScores = percentileRankScale(deathsPerMinRaw);

  const lastHitsPerMinRaw = heroes.map((h) =>
    medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.last_hits_per_min),
  );
  // Ranked within each hero's dominant real position (presumed_positions),
  // not the whole population (Blueprint/10-tech-debt-backlog.md,
  // "skirmish_rate систематически завышает Support") — a Support's
  // near-zero CS is structural to the role, not a skill signal; ranking
  // against the whole population (dominated by Carry/Mid) read every
  // Support as "extreme" regardless of how they actually farm relative to
  // other Supports. Inverted before rank-scaling (same idiom as
  // trendScoresForTempo above): skirmish_rate should score high for a hero
  // who farms *less* efficiently than their positional peers, not more.
  const topPositionByHeroId = new Map(meta.heroes.map((h) => [h.heroId, h.positions[0]?.position ?? null]));
  const positionGroups = heroes.map((h) => topPositionByHeroId.get(h.id) ?? null);
  const invertedLastHitsScores = percentileRankScaleByGroup(
    lastHitsPerMinRaw.map((v) => (v === null ? null : -v)),
    positionGroups,
  );
  const skirmishRateScores = heroes.map((_, i) =>
    weightedBlend([
      { value: deathsScores[i], weight: 1 },
      { value: invertedLastHitsScores[i], weight: 1 },
    ]),
  );

  const campsStackedRaw = heroes.map((h) => deathsCampsByHeroId.get(h.id)?.campsStackedPerMin ?? null);
  const campStackingScores = percentileRankScale(campsStackedRaw);

  // mobility: real move-speed extremity + hand-tagged mobility abilities +
  // item-purchase signal above. The hand-tagged input used to be a single
  // coarse per-hero tier (apply-ability-tags.ts, 0/3/6/10 buckets); it's now
  // the per-ability CSV tags summed per hero and zScoreExtremityScale'd —
  // same reasoning as before still applies (percentileRankScale was tried
  // and rejected: even within the large all-zero cluster someone always
  // ranks "above 70% of the league," which pushed clearly non-mobile heroes
  // like Legion Commander/Sven/Chaos Knight up to 7-9/10 — zScoreExtremityScale
  // keeps the flat majority near 5 and only pushes real outliers toward 10),
  // it's just fed by a richer input now.
  const mobilityTagRaw = heroes.map((h) => abilityTagByHeroId.get(h.id)?.mobility ?? 0);
  const mobilityTagScores = zScoreExtremityScale(mobilityTagRaw, tagWeights.extremityExponents.mobility);
  const mobilityRaw = heroes.map((h, i) =>
    weightedBlend([
      { value: moveSpeedScores[i], weight: weights.mobilityScore.baseMoveSpeed },
      { value: mobilityTagScores[i] ?? 0, weight: weights.mobilityScore.abilityMobilityBonus },
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

  // --- saving: real healing data + hand-tagged saving abilities ---
  const healingRaw = heroes.map((h) =>
    medianBenchmarkValue(metaByHeroId.get(h.id)?.benchmarks?.hero_healing_per_min),
  );
  const healingScores = percentileRankScale(healingRaw);

  // Replaces the old binary protects_allies tag (had it or didn't, 10/0)
  // with the per-ability CSV saving scores summed per hero — same
  // "standout ability keeps its weight" reasoning as mobility/control_strength
  // above, and strictly more information than a single yes/no flag.
  const savingTagRaw = heroes.map((h) => abilityTagByHeroId.get(h.id)?.saving ?? 0);
  const savingTagScores = zScoreExtremityScale(savingTagRaw, tagWeights.extremityExponents.saving);

  // hero_healing_per_min (OpenDota benchmark) is blind in both directions —
  // counts self-sustain/lifesteal, not just ally-directed healing
  // (Necrophos/Lifestealer/Morphling score highly despite no ally-heal
  // ability), and misses saves that don't restore HP at all (Bane's
  // Nightmare, Pudge's Meat Hook, Mirana's Moonlight Shadow all have real,
  // nonzero hand tags but healingRaw=0 — the stat structurally can't see
  // non-HP protection, same blind spot as `stuns` missing silences for
  // Control). Per the user: a missing/zero real value is NOT excluded from
  // the blend (which would renormalize the tag up to 100% weight) — it's a
  // literal 0 at its normal weight, and the tag's weight stays fixed at
  // abilityTagWeight regardless. This still doesn't fully fix
  // Necrophos-style contamination (his tag is small but nonzero, e.g.
  // Death Pulse, so his inflated healingRaw still contributes) — that
  // needs the tag itself corrected, not this rule.
  const savingHealingInput = heroes.map((_, i) => (healingRaw[i] ? healingScores[i] : 0));

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
    initiating: 0,
    skirmishRate: 0,
    campStacking: 0,
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

    setOrFallback(
      'saving',
      weightedBlend([
        { value: savingHealingInput[i], weight: tagWeights.blend.saving.healingWeight },
        { value: savingTagScores[i] ?? 0, weight: tagWeights.blend.saving.abilityTagWeight },
      ]),
      'saving',
    );

    setOrFallback('initiating', initiatingScores[i], 'initiating');
    setOrFallback('skirmish_rate', skirmishRateScores[i], 'skirmishRate');
    setOrFallback('camp_stacking', campStackingScores[i], 'campStacking');
  });

  fs.writeFileSync(HEROES_PATH, JSON.stringify(heroes, null, 2) + '\n');

  console.log(`Calibrated ${heroes.length} heroes:`);
  Object.entries(counts).forEach(([key, count]) => {
    if (key !== 'fallback') console.log(`  ${key}: ${count}/${heroes.length}`);
  });
  console.log(`  (${counts.fallback} axis-values kept on prior fallback due to missing data)`);
}

main();
