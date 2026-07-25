// Single source of truth for Custom Tags — who carries which tag, and the
// display metadata for each. Server (server/src/battle/custom-tags.ts) reads
// the hero-name sets to drive actual battle math; client
// (client/src/data/customTags.ts) reads the same definitions to render
// badges. Previously these were two hand-synced files (see
// Blueprint/10-tech-debt-backlog.md, "Custom Tags — new mechanic") — that
// duplication silently drifted (Crystal Maiden carried Frosty in battle math
// but never showed the badge) before this file unified them.
//
// Numeric effect magnitudes (percentages, thresholds) stay in
// server/src/battle/custom-tags.ts — those only matter to battle math, not
// to what badge renders on a card.

// Follows Dota 2's own item rarity scale (Обычный/Необычный/Редкий/...) —
// 'uncommon' sits between 'common' and 'rare', not a synonym for either.
export type TagRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface CustomTagDefinition {
  name: string;
  rarity: TagRarity;
  // Always shown on the card, regardless of team composition.
  visible: boolean;
  // Only meaningful when visible=false. Becomes visible once its synergy
  // condition is active for the current draft (count of teammates carrying
  // the same tag name reaches minCountToReveal).
  revealable: boolean;
  minCountToReveal?: number;
  description: string;
  // Heroes who carry/display this tag. Not necessarily the same as who
  // benefits from its effect — see MANA_BOOSTER_BENEFICIARIES below.
  heroNames: string[];
}

// Mana Booster's effect targets these heroes (Crystal Maiden's mana aura
// beneficiaries), but only Crystal Maiden herself carries/displays the tag.
export const MANA_BOOSTER_BENEFICIARIES = [
  'Storm Spirit',
  'Invoker',
  'Leshrac',
  'Skywrath Mage',
  'Zeus',
  'Outworld Destroyer',
];

export const CUSTOM_TAG_DEFINITIONS: CustomTagDefinition[] = [
  {
    name: 'Mana Booster',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description: "Crystal Maiden's mana aura — allies tagged Mana Dependent get a final-power boost.",
    heroNames: ['Crystal Maiden'],
  },
  {
    name: 'Statstealer',
    rarity: 'epic',
    visible: false,
    revealable: true,
    minCountToReveal: 2,
    description: '+5% final power to every Statstealer-tagged hero once 2+ are on the team.',
    heroNames: ['Silencer', 'Slark', 'Pudge', 'Undying', 'Outworld Destroyer'],
  },
  {
    name: 'Frosty',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description: "-3% to the enemy team's Movement axis per Frosty hero on this team.",
    heroNames: [
      'Tusk',
      'Abaddon',
      'Drow Ranger',
      'Crystal Maiden',
      'Jakiro',
      'Ancient Apparition',
      'Winter Wyvern',
    ],
  },
  {
    name: 'The Fundamentals',
    rarity: 'legendary',
    visible: true,
    revealable: false,
    description:
      "Boosts the team's weakest axis (or axes) — strength scales with how many Fundamentals heroes are drafted.",
    heroNames: ['Io', 'Keeper of the Light', 'Chaos Knight', 'Enigma'],
  },
  {
    name: 'Two Heads Better',
    rarity: 'rare',
    visible: false,
    revealable: true,
    minCountToReveal: 3,
    description:
      'Solo or duo: each doubles their own weakest axis. All 3 (Ogre Magi + Jakiro + Alchemist): replaced by +20% team teamfight and map control.',
    heroNames: ['Ogre Magi', 'Jakiro', 'Alchemist'],
  },
  {
    name: 'The Button',
    rarity: 'epic',
    visible: true,
    revealable: false,
    description: '+5% personal scaling, plus an extra +5% power in the late game — active even solo.',
    heroNames: [
      'Mars',
      'Tidehunter',
      'Magnus',
      'Shadow Fiend',
      'Faceless Void',
      'Puck',
      'Enigma',
      'Winter Wyvern',
      'Disruptor',
    ],
  },
  {
    name: 'Global',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description:
      '+10% personal map control, active even solo. 2+ on the team: each also gets +5% teamfight and +5% burst.',
    heroNames: ['Silencer', 'Tinker', 'Io', 'Dawnbreaker', 'Spectre', 'Zeus', "Nature's Prophet"],
  },
  {
    name: 'High Skill',
    rarity: 'epic',
    visible: false,
    revealable: true,
    minCountToReveal: 3,
    description:
      'Upsets are more likely around this hero (execution swings the result either way). 2+ on the team: -2.5% overall power each.',
    heroNames: [
      'Lone Druid',
      'Monkey King',
      'Invoker',
      'Tinker',
      'Huskar',
      'Meepo',
      'Morphling',
      'Brewmaster',
      'Arc Warden',
      'Chen',
    ],
  },
  {
    name: 'Divided Attention',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description:
      '-10% personal durability and -10% personal objectives, active even solo — power split across multiple bodies is easier to pick apart.',
    heroNames: [
      'Lone Druid',
      'Lycan',
      'Beastmaster',
      "Nature's Prophet",
      'Arc Warden',
      'Broodmother',
      'Naga Siren',
      'Meepo',
    ],
  },
  {
    name: 'Tempo Monster',
    rarity: 'rare',
    visible: false,
    revealable: false, // always-hidden — never rendered, calculation-only
    description:
      '+3% final power if team tempo > 8; otherwise -25% scaling/durability/map control. Additional -10% if another hard-carry hero is drafted. Never shown to the player.',
    heroNames: [
      "Nature's Prophet",
      'Meepo',
      'Lone Druid',
      'Lycan',
      'Broodmother',
      'Kez',
      'Alchemist',
      'Huskar',
      'Troll Warlord',
      'Death Prophet',
      'Visage',
    ],
  },
  {
    name: 'Agility Crusher',
    rarity: 'epic',
    visible: false,
    revealable: false, // always-hidden — never rendered, calculation-only
    description: 'Debuffs enemy agility cores at battle-assessment time. Never shown to the player.',
    heroNames: ['Elder Titan'],
  },
  // Lore-based tags added 2026-07-25 (Blueprint/10-tech-debt-backlog.md,
  // "Лор-исследование"). Old Rivals/Reunion approved for implementation;
  // Nemeton-Touched/Blood Debt/World Tree's Ward were not.
  {
    name: 'Old Rivals',
    rarity: 'uncommon',
    visible: false,
    revealable: true,
    minCountToReveal: 2,
    description:
      'Kunkka and Tidehunter, bound by an old grudge. Forced onto the same team: the tension shows, -5% teamfight each. Facing each other across the draft: whichever of the two is on the enemy side gets personally debuffed, -5% power — the rivalry distracts them even from a distance.',
    heroNames: ['Kunkka', 'Tidehunter'],
  },
  {
    name: 'Reunion',
    rarity: 'rare',
    visible: false,
    revealable: true,
    minCountToReveal: 2,
    description: "Mirana and Muerta, reunited. Both on the team: +3% personal map control each.",
    heroNames: ['Mirana', 'Muerta'],
  },
];

export function heroNameSetForTag(tagName: string): Set<string> {
  const def = CUSTOM_TAG_DEFINITIONS.find((t) => t.name === tagName);
  return new Set(def?.heroNames ?? []);
}

// Per-hero view of the same definitions, for badge rendering.
export function buildCustomTagsByHeroName(): Record<string, CustomTagDefinition[]> {
  const byHero: Record<string, CustomTagDefinition[]> = {};
  for (const def of CUSTOM_TAG_DEFINITIONS) {
    for (const heroName of def.heroNames) {
      (byHero[heroName] ??= []).push(def);
    }
  }
  return byHero;
}
