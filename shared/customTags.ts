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
    // 2026-08-12 (user-approved research batch): +Clockwerk (Rocket Flare,
    // global scout/damage), +Keeper of the Light (Recall, global ally
    // teleport — also `global_impact` in the data), +Storm Spirit (Ball
    // Lightning, global mobility — also `global_impact`), +Ancient Apparition
    // (Ice Blast, cross-map reach). No effect change: note the map_control
    // solo buff is currently inert (map_control has weight 0 in the Battle
    // Engine, see Blueprint/10-tech-debt-backlog.md), so these only matter for
    // the 2+ teamfight/burst branch until Global's effect is retargeted.
    heroNames: [
      'Silencer',
      'Tinker',
      'Io',
      'Dawnbreaker',
      'Spectre',
      'Zeus',
      "Nature's Prophet",
      'Invoker',
      'Clockwerk',
      'Keeper of the Light',
      'Storm Spirit',
      'Ancient Apparition',
      // Added 2026-08-13 (user): Charge of Darkness is a global-range charge
      // across the whole map.
      'Spirit Breaker',
      // Added 2026-08-13 (user): Dark Rift teleports the whole team across the
      // map — global.
      'Underlord',
    ],
  },
  // Mechanical — added 2026-08-12 (user-approved research batch). Lore theme:
  // machines/constructs. Effect "machines don't tilt": a Mechanical hero makes
  // its side immune to High Skill upset variance (battle-resolution.ts) and
  // immune to the opponent's per-hero curses (custom-tags.ts,
  // curseEffectsOnOpponent). Visible flavour tag.
  {
    name: 'Mechanical',
    rarity: 'uncommon',
    visible: true,
    revealable: false,
    description:
      "Machines don't tilt — immune to High Skill upset swings and to the opponent's synergy curses.",
    heroNames: ['Clockwerk', 'Timbersaw', 'Gyrocopter', 'Tinker'],
  },
  // Healer — added 2026-08-12 (user-approved research batch). Ally sustain the
  // durability/saving axes only partly capture. Team durability buff whose
  // per-hero magnitude grows with stack count, same shape as Mass Buffer
  // (+2% solo, +3% each at 2, +4% each at 3…), each carrier contributing.
  {
    name: 'Healer',
    rarity: 'uncommon',
    visible: true,
    revealable: false,
    description:
      'Sustained healing keeps the team topped up — adds to team durability, and each Healer contributes more as the group grows.',
    heroNames: [
      'Dazzle',
      'Omniknight',
      'Oracle',
      'Chen',
      'Abaddon',
      'Treant Protector',
      'Warlock',
      'Winter Wyvern',
      'Necrophos',
      'Witch Doctor',
      // Added 2026-08-13 (user): Sun Ray heals allies.
      'Phoenix',
      // Added 2026-08-13 (user): Life Drain restores health (ally-targetable
      // with Aghanim's).
      'Pugna',
      // Added 2026-08-13 (user): Luminosity heals allies on crit; Solar
      // Guardian heals in its area.
      'Dawnbreaker',
      // Added 2026-08-13 session-2 (user): Press The Attack applies a strong
      // heal-over-time (and dispel) to an ally.
      'Legion Commander',
      // Added 2026-08-13 session-2 (user): under Spirit Form (ult), Illuminate
      // becomes a wave that heals allies — a real ally heal, not just Chakra
      // Magic's mana restore.
      'Keeper of the Light',
    ],
  },
  // Gold Generator — added 2026-08-12 (user-approved research batch). Team
  // economy not captured by personal percentiles (Bounty's Track gold, Alch's
  // Greevil's Greed + Aghanim gift). A richer team scales harder: small team
  // scaling buff per carrier, active even solo.
  {
    name: 'Gold Generator',
    rarity: 'uncommon',
    visible: true,
    revealable: false,
    description:
      'Feeds the whole team extra gold (Track / Greevil’s Greed) — a richer team scales harder. Adds to team scaling per Gold Generator.',
    heroNames: ['Bounty Hunter', 'Alchemist'],
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
  // Summoning Sickness — added 2026-08-10 after the no-crutch self-play run
  // (realWinRateWeight=0, manual power overrides empty, seeds 1-5, 300k
  // matches each). Targets the ONE archetype that came out systematically
  // overrated: heroes with real summoned units. Membership is the
  // intersection of "has actual summons" and "favoredRate exceeded real
  // winRate by >=10pp", not all summoners — Visage (-5.7pp), Broodmother
  // (-1.7pp), Meepo (-6.1pp), Enigma, Warlock and Arc Warden summon too but
  // are not overrated, and penalising them would push them further under.
  // Naga Siren (+17.7pp) and Terrorblade (+11.2pp) are excluded on the other
  // side: illusions, not summons, and already carried by Army of Clones.
  {
    name: 'Summoning Sickness',
    rarity: 'rare',
    visible: false,
    revealable: false, // always-hidden — never rendered, calculation-only
    description:
      "Summoned units inflate the hero's own calibration. -30% personal power, always active. Never shown to the player.",
    heroNames: ['Beastmaster', "Nature's Prophet", 'Chen', 'Lone Druid', 'Lycan'],
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
    // Treant Protector removed 2026-08-16: Nature's Guise is real invis, but
    // he was already overrated and Unseen's +6% pushed him further — moved to
    // Paper Utility (hidden calibration) instead of carrying a buff.
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
      "Vulnerable to burst damage despite looking sturdy on paper. -20% personal power when the opposing team's raw Burst average is above average.",
    heroNames: ['Huskar', 'Phoenix', 'Enchantress', 'Necrophos', 'Monkey King'],
  },
  // --- Divergence-fix batch 2026-08-16 (B0 flagged clusters; user-approved) ---
  {
    name: 'Disable Battery',
    rarity: 'rare',
    visible: false,
    revealable: false, // always-hidden — calibration only
    description:
      'Backline disable/nuke that wins fights — axes tax these heroes as "dies a lot / farms little," but the real win condition is the battery of control from the fog. +25% personal power, always active. Never shown to the player.',
    heroNames: [
      'Disruptor',
      'Shadow Shaman',
      'Crystal Maiden',
      'Lich',
      'Ancient Apparition',
      'Silencer',
      'Skywrath Mage',
      'Dark Willow',
    ],
  },
  {
    name: 'Haunt Absolute',
    rarity: 'rare',
    visible: false,
    revealable: false, // always-hidden — calibration only
    description:
      "Haunt is global presence that axes under-count as personal strength (and Global's map-control buff is inert while that axis weighs 0). +12% personal power, always active. Never shown to the player.",
    heroNames: ['Spectre'],
  },
  {
    name: 'Mirage Tax',
    rarity: 'rare',
    visible: false,
    revealable: false, // always-hidden — calibration only
    description:
      'Illusion farm and body-count inflate objectives/mobility without a matching real-body fight presence. -15% personal power, always active. Never shown to the player.',
    heroNames: ['Naga Siren', 'Terrorblade'],
  },
  {
    name: 'Paper Utility',
    rarity: 'rare',
    visible: false,
    revealable: false, // always-hidden — calibration only
    description:
      'Utility axes (stacks, map presence, control) read high without converting to outcomes. -25% personal power, always active. Never shown to the player.',
    heroNames: [
      'Keeper of the Light',
      'Snapfire',
      'Treant Protector',
      'Batrider',
      'Enchantress',
    ],
  },
  // --- Divergence-fix batch 2 (2026-08-16, post tag-batch measure) ---
  {
    name: 'Raid Boss',
    rarity: 'rare',
    visible: false,
    revealable: false, // always-hidden — calibration only
    description:
      'Late-game / space-dependent cores the mid-clash model under-rates. +18% personal power, always active. Never shown to the player.',
    heroNames: [
      'Phantom Lancer',
      'Medusa',
      'Troll Warlord',
      'Phantom Assassin',
      'Sven',
      'Ursa',
    ],
  },
  {
    name: 'Showstopper Tax',
    rarity: 'rare',
    visible: false,
    revealable: false,
    description:
      'Flashy initiate/setup reads sky-high on control/tempo without converting in average games. -25% personal power, always active. Never shown to the player.',
    heroNames: [
      'Ember Spirit',
      'Kunkka',
      'Marci',
      'Primal Beast',
      'Centaur Warrunner',
      'Earthshaker',
      'Legion Commander',
      'Earth Spirit',
      'Dawnbreaker',
    ],
  },
  {
    name: 'False Immortal',
    rarity: 'rare',
    visible: false,
    revealable: false,
    description:
      'Self-sustain looks like durability on paper; focused burst still deletes them. -18% personal power, always active (stacks with Prone To Burst when that fires). Never shown to the player.',
    // Huskar/Enchantress deliberately omitted — already near-neutral after Prone/Paper Utility.
    heroNames: ['Necrophos', 'Monkey King', 'Phoenix'],
  },
  {
    name: 'Siege Voltage',
    rarity: 'rare',
    visible: false,
    revealable: false, // always-hidden — calibration only
    description:
      'Mid push/nuke cores whose siege and burst win conditions axes under-count. +12% personal power, always active. Never shown to the player.',
    heroNames: ['Death Prophet', 'Lina', 'Outworld Destroyer'],
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
// Healer mirrors Mass Buffer's count-growing per-hero shape, one point lower
// at the base (+2% solo). Hand-duplicated from server HEALER_BASE_BUFF/
// HEALER_PER_EXTRA the same way Mass Buffer's numbers are.
const HEALER_BASE_PCT = 2;
const HEALER_PER_EXTRA_PCT = 1;
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

  if (def.name === 'Healer') {
    const perHeroPct = HEALER_BASE_PCT + HEALER_PER_EXTRA_PCT * (count - 1);
    const base = 'Sustained healing keeps the team topped up.';
    // Solo: the per-hero and combined figures are the same number, so the
    // "+X each, +X combined" split just repeats itself — show it once.
    if (count === 1) return `${base} 1 Healer on this team: +${perHeroPct}% team durability.`;
    const totalPct = perHeroPct * count;
    return `${base} ${count} Healers on this team: +${perHeroPct}% team durability each, +${totalPct}% combined.`;
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
