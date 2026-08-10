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
  // Added 2026-08-10 (roster audit): Mana Shield spends mana as effective
  // HP, which makes Medusa the single most mana-dependent hero on the
  // roster — she was the one obvious omission from this list.
  'Medusa',
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
      // Added 2026-08-10 (roster audit): the only ice-themed hero that was
      // outside the tag — Frost Blast / Frost Shield / Chain Frost.
      'Lich',
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
      'Warlock',
      'Sand King',
      // Added 2026-08-10 (roster audit): Echo Slam is the archetypal
      // one-button teamfight ultimate this tag is named for.
      'Earthshaker',
    ],
  },
  {
    name: 'Global',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description:
      '+10% personal map control, active even solo. 2+ on the team: each also gets +5% teamfight and +5% burst.',
    // 'Invoker' added 2026-08-10 (roster audit): Sun Strike is global, and
    // heroes.json's own `global_impact` tag already marked him — the custom
    // tag was the side that disagreed with the data.
    heroNames: ['Silencer', 'Tinker', 'Io', 'Dawnbreaker', 'Spectre', 'Zeus', "Nature's Prophet", 'Invoker'],
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
      // Added 2026-08-10 (roster audit): familiars are a second and third
      // body to keep alive, and heroes.json marks Visage `summon_based`.
      // The other four summoners the data flags (Enigma, Warlock, Chen,
      // Ringmaster) were deliberately left out of this batch — see the
      // audit entry in Blueprint/10-tech-debt-backlog.md.
      'Visage',
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
    description: 'Mirana and Muerta, reunited. Both on the team: +3% personal map control each.',
    heroNames: ['Mirana', 'Muerta'],
  },
  // Self-play outlier investigation, round 2 (Blueprint/10-tech-debt-backlog.md,
  // "Self-play без real-winRate заглушки") — Unseen/Army of Clones/Mass
  // Buffer/Prone To Burst target the specific heroes whose in-system
  // favoredRate diverged >=10pp from real OpenDota winRate with the
  // real-winRate blend disabled, grouped by the unmodeled mechanic behind
  // each divergence (invisibility, illusions, team-wide amplification,
  // burst-fragility). Statstealer (above) extended separately for Undying —
  // same tag, not a new one.
  {
    name: 'Unseen',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description:
      'Personal invisibility — a real strength no axis measures. +6% personal power, +8% personal map control, active even solo. 2+ on the team: -durability/-teamfight each, scaling with stack count (too many pick-off specialists, not enough frontline).',
    heroNames: ['Riki', 'Weaver', 'Clinkz', 'Bounty Hunter', 'Nyx Assassin'],
  },
  {
    name: 'Army of Clones',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description:
      'Illusions/clones — extra bodies for damage, split-push, and vision no axis measures. +6% personal power, +8% personal map control, active even solo. 2+ on the team: -durability/-teamfight each, scaling with stack count (the real body is easier to pick apart the more the team leans on illusions).',
    // 'Chaos Knight' added 2026-08-10 (roster audit): Phantasm, and
    // heroes.json's `illusion_based` already listed exactly Phantom Lancer,
    // Chaos Knight and Terrorblade — he was the one the tag skipped.
    // (Naga Siren carries this tag WITHOUT being `illusion_based` in the
    // data; left as-is, flagged in the backlog rather than changed here.)
    heroNames: ['Phantom Lancer', 'Terrorblade', 'Naga Siren', 'Chaos Knight'],
  },
  {
    name: 'Mass Buffer',
    rarity: 'uncommon',
    visible: true,
    revealable: false,
    description:
      'Team-wide damage amplification (auras/debuffs). Each Mass Buffer hero adds to team teamfight/burst, active even solo — and the per-hero contribution itself grows with stack size (+3% solo, +4% each at 2, +5% each at 3...), so the total scales faster than linearly.',
    // 'Chen' added 2026-08-10 by direct user request. Note the mismatch,
    // accepted knowingly: this tag's effect is team teamfight/burst, i.e.
    // DAMAGE amplification, and Chen's auras (Divine Favor, Hand of God)
    // are sustain/defensive. He is tagged here rather than under a separate
    // defensive-aura tag because the user chose not to introduce one.
    heroNames: ['Vengeful Spirit', 'Mirana', 'Luna', 'Drow Ranger', 'Chen'],
  },
  {
    name: 'Prone To Burst',
    rarity: 'uncommon',
    visible: true,
    revealable: false,
    description:
      "Vulnerable to burst damage despite looking sturdy on paper. -8% personal power when the opposing team's raw Burst average is high.",
    heroNames: ['Huskar', 'Phoenix', 'Enchantress', 'Necrophos', 'Monkey King'],
  },
];

// Dynamic description text for count-dependent tags (Blueprint/10-tech-
// debt-backlog.md, "Active Combos: динамический текст магнитуды для
// count-based тегов", by direct user request — found while investigating
// the Mass Buffer bug: the static description explained the FORMULA but
// never substituted the actual number for a given draft, which read as if
// the effect wasn't scaling even when it correctly was). Scoped to the
// three tags whose effect is a genuine count-dependent numeric formula
// (Mass Buffer, Unseen, Army of Clones) plus Statstealer, whose static text
// omitted the solo case entirely. Every other tag's magnitude is fixed
// regardless of carrier count, so its static `description` already says
// the whole story.
//
// The specific per-hero/per-count numbers below are hand-duplicated from
// server/src/battle/custom-tags.ts's real magnitudes, same as this file's
// static descriptions already do in prose (e.g. Unseen's "+6%/+8%" text
// already hand-matches UNSEEN_POWER_BUFF/UNSEEN_MAP_CONTROL_BUFF) — not a
// new boundary crossing, just the count-aware version of duplication this
// file already does. If those constants change, this needs updating by
// hand too (same maintenance cost the static text already carries).
const MASS_BUFFER_BASE_PCT = 3;
const MASS_BUFFER_PER_EXTRA_PCT = 1;
const STEALTH_STACK_PENALTY_PCT: Record<number, number> = { 2: 5, 3: 10, 4: 15, 5: 20 };

function describeActiveTag(def: CustomTagDefinition, heroNames: string[]): string {
  const count = heroNames.filter((n) => def.heroNames.includes(n)).length;

  if (def.name === 'Mass Buffer') {
    const perHeroPct = MASS_BUFFER_BASE_PCT + MASS_BUFFER_PER_EXTRA_PCT * (count - 1);
    const totalPct = perHeroPct * count;
    return (
      `Team-wide damage amplification (auras/debuffs). ${count} Mass Buffer hero${count === 1 ? '' : 'es'} on this team: ` +
      `+${perHeroPct}% team teamfight/burst each, +${totalPct}% combined.`
    );
  }

  if (def.name === 'Unseen' || def.name === 'Army of Clones') {
    const flavor = def.name === 'Unseen' ? 'Personal invisibility' : 'Illusions/clones';
    const base = `${flavor} — a real strength no axis measures. +6% personal power, +8% personal map control, active even solo.`;
    if (count < 2) return base;
    const penaltyPct = STEALTH_STACK_PENALTY_PCT[Math.min(count, 5)] ?? STEALTH_STACK_PENALTY_PCT[5];
    return `${base} ${count} on this team: -${penaltyPct}% durability/teamfight each.`;
  }

  if (def.name === 'Statstealer') {
    return count >= 2
      ? `+5% final power to every Statstealer-tagged hero — ${count} on this team.`
      : '+2% final power, active even solo (rises to +5% each once a 2nd Statstealer joins the team).';
  }

  return def.description;
}

export function heroNameSetForTag(tagName: string): Set<string> {
  const def = CUSTOM_TAG_DEFINITIONS.find((t) => t.name === tagName);
  return new Set(def?.heroNames ?? []);
}

// Team-level view of the same visibility rule visibleTagsFor() (client
// customTags.ts) applies per-hero: a tag counts as "active for this draft"
// if it's always-visible on ANY teammate, or revealable and the team's own
// count of carriers already clears its minCountToReveal — same reveal
// condition, just read once for the whole 5-hero team instead of once per
// hero-card. De-duplicated (a tag with 3 carriers only appears once, not
// 3 times) — this is what Evaluation Engine's "active combos" summary
// reads (evaluation.service.ts), so a team either shows a tag or doesn't,
// it doesn't matter how many copies triggered it.
export function activeCustomTagsForTeam(heroNames: string[]): CustomTagDefinition[] {
  const active: CustomTagDefinition[] = [];
  for (const def of CUSTOM_TAG_DEFINITIONS) {
    const carriers = heroNames.filter((n) => def.heroNames.includes(n)).length;
    if (carriers === 0) continue;
    if (def.visible || (def.revealable && carriers >= (def.minCountToReveal ?? 1))) {
      // description resolved per-team (describeActiveTag above) rather than
      // the static def.description — count-dependent tags substitute the
      // actual magnitude for THIS team instead of restating the formula.
      active.push({ ...def, description: describeActiveTag(def, heroNames) });
    }
  }
  return active;
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
