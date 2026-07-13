import * as fs from 'fs';
import * as path from 'path';

// Applies the manually-curated ability tier lists for Map Control (agreed
// during the Tempo/Map Control design discussion) as new fields on each
// hero: `vision_ability_tier` and `mobility_ability_tier`. Draft/black-box
// like the rest of the hand-authored tags in this file — reviewed against
// kit knowledge and, for mobility, cross-checked against Blink
// Dagger/Boots of Travel purchase-rate data (see
// server/data/research-tempo-mobility-output.json), not purely guessed.
const HEROES_PATH = path.join(__dirname, '..', 'data', 'heroes.json');

// Direct reveal / true sight / dedicated scouting.
const VISION_TIER_10 = [
  'Zeus',
  'Spectre',
  'Bounty Hunter',
  'Clockwerk',
  'Bloodseeker',
  'Slark',
  "Nature's Prophet",
];
const VISION_TIER_6 = ['Beastmaster'];
// Mobile summon-based heroes — map presence via patrolling units.
const VISION_TIER_5 = [
  'Enigma',
  'Warlock',
  'Broodmother',
  'Chen',
  'Lycan',
  'Visage',
  'Ringmaster',
  'Lone Druid',
  'Invoker',
];
// Invisibility-based stealth intel gathering + narrow reveal effects.
const VISION_TIER_3 = [
  'Riki',
  'Clinkz',
  'Templar Assassin',
  'Treant Protector',
  'Nyx Assassin',
  'Slardar',
  'Shadow Demon',
];
const VISION_TIER_2 = ['Muerta'];
// Static ward-like summon — minimal extra credit over just buying wards.
const VISION_TIER_1 = ['Shadow Shaman'];

const MOBILITY_TIER_10 = [
  'Spirit Breaker',
  'Queen of Pain',
  'Morphling',
  'Anti-Mage',
  'Ember Spirit',
  'Weaver',
  "Nature's Prophet",
];
const MOBILITY_TIER_6 = ['Storm Spirit', 'Puck', 'Void Spirit', 'Earth Spirit', 'Windranger'];
// Boots of Travel-driven map presence (purchase-rate data supported these).
const MOBILITY_TIER_3 = ['Invoker', 'Lina', 'Necrophos', 'Keeper of the Light', 'Viper', 'Brewmaster'];

function buildTierMap(tiers: [string[], number][]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [names, tier] of tiers) {
    for (const name of names) map.set(name, tier);
  }
  return map;
}

const visionTiers = buildTierMap([
  [VISION_TIER_10, 10],
  [VISION_TIER_6, 6],
  [VISION_TIER_5, 5],
  [VISION_TIER_3, 3],
  [VISION_TIER_2, 2],
  [VISION_TIER_1, 1],
]);
const mobilityTiers = buildTierMap([
  [MOBILITY_TIER_10, 10],
  [MOBILITY_TIER_6, 6],
  [MOBILITY_TIER_3, 3],
]);

interface RawHero {
  id: number;
  name: string;
  vision_ability_tier?: number;
  mobility_ability_tier?: number;
  [key: string]: unknown;
}

function main() {
  const heroes: RawHero[] = JSON.parse(fs.readFileSync(HEROES_PATH, 'utf-8'));
  const unmatchedVision = new Set(visionTiers.keys());
  const unmatchedMobility = new Set(mobilityTiers.keys());

  for (const hero of heroes) {
    hero.vision_ability_tier = visionTiers.get(hero.name) ?? 0;
    hero.mobility_ability_tier = mobilityTiers.get(hero.name) ?? 0;
    unmatchedVision.delete(hero.name);
    unmatchedMobility.delete(hero.name);
  }

  if (unmatchedVision.size > 0) {
    console.warn('WARNING: vision tier names not found in heroes.json:', [...unmatchedVision]);
  }
  if (unmatchedMobility.size > 0) {
    console.warn('WARNING: mobility tier names not found in heroes.json:', [...unmatchedMobility]);
  }

  fs.writeFileSync(HEROES_PATH, JSON.stringify(heroes, null, 2) + '\n');
  console.log(`Applied ability tags to ${heroes.length} heroes.`);
  console.log(
    `  vision_ability_tier: ${heroes.filter((h) => h.vision_ability_tier! > 0).length} heroes tagged`,
  );
  console.log(
    `  mobility_ability_tier: ${heroes.filter((h) => h.mobility_ability_tier! > 0).length} heroes tagged`,
  );
}

main();
