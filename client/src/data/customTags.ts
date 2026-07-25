// Custom game tags — a hand-authored layer sitting ON TOP of the calibrated
// evaluation_values/axis-weights model, not a replacement for it. Explicitly
// not trying to track real winRate (unlike every other axis in this
// project) — the point is drafting depth/combo-hunting, kept in bounds only
// by two loose guardrails (not enforced here yet): overall draft
// win-vector direction should still roughly match reality, and no hero's
// system-average winRate should drift outside 40-60%. See
// Blueprint/10-tech-debt-backlog.md for the fuller writeup.
//
// This file is PLACEHOLDER/DEMO data — a handful of hand-picked tags to
// give the UI something real to render while the actual tag system
// (storage, synergy-activation detection, battle-resolution hookup) is
// still being designed. Nothing here feeds into battle-resolution.ts yet.

export type TagRarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface CustomTag {
  name: string;
  rarity: TagRarity;
  // Always shown on the card, regardless of team composition.
  visible: boolean;
  // Only meaningful when visible=false. A "проявляемый" tag becomes visible
  // once its synergy condition is active for the current draft — computed
  // for real in visibleTagsFor() below (count of teammates carrying the
  // same tag name, threshold set per-tag by minCountToReveal).
  revealable: boolean;
  minCountToReveal?: number;
  description: string;
}

// Keyed by hero name (matches shared Hero.name) rather than heroId, so this
// stays readable without a hero-id lookup table alongside it.
export const CUSTOM_TAGS_BY_HERO_NAME: Record<string, CustomTag[]> = {
  'Crystal Maiden': [
    {
      name: 'Mana Booster',
      rarity: 'rare',
      visible: true,
      revealable: false,
      description: "Crystal Maiden's mana aura — allies tagged Mana Dependent get a final-power boost.",
    },
  ],
  Silencer: [statstealer(), global()],
  Slark: [statstealer()],
  Pudge: [statstealer()],
  Undying: [statstealer()],
  'Outworld Destroyer': [statstealer()],
  'Elder Titan': [
    {
      name: 'Agility Crusher',
      rarity: 'epic',
      visible: false,
      revealable: false, // always-hidden — never rendered, calculation-only
      description: 'Debuffs enemy agility cores at battle-assessment time. Never shown to the player.',
    },
  ],
  Tusk: [frosty()],
  Abaddon: [frosty()],
  'Drow Ranger': [frosty()],
  Jakiro: [frosty(), twoHeadsBetter()],
  'Ancient Apparition': [frosty()],
  'Winter Wyvern': [frosty(), theButton()],
  Io: [fundamentals(), global()],
  'Keeper of the Light': [fundamentals()],
  'Chaos Knight': [fundamentals()],
  Enigma: [fundamentals(), theButton()],
  'Ogre Magi': [twoHeadsBetter()],
  Alchemist: [twoHeadsBetter(), tempoMonster()],
  Mars: [theButton()],
  Tidehunter: [theButton()],
  Magnus: [theButton()],
  'Shadow Fiend': [theButton()],
  'Faceless Void': [theButton()],
  Puck: [theButton()],
  Disruptor: [theButton()],
  Tinker: [global(), highSkill()],
  Dawnbreaker: [global()],
  Spectre: [global()],
  Zeus: [global()],
  "Nature's Prophet": [global(), dividedAttention(), tempoMonster()],
  'Lone Druid': [highSkill(), dividedAttention(), tempoMonster()],
  'Monkey King': [highSkill()],
  Invoker: [highSkill()],
  Huskar: [highSkill(), tempoMonster()],
  Meepo: [highSkill(), dividedAttention(), tempoMonster()],
  Morphling: [highSkill()],
  Brewmaster: [highSkill()],
  'Arc Warden': [highSkill(), dividedAttention()],
  Chen: [highSkill()],
  Lycan: [dividedAttention(), tempoMonster()],
  Beastmaster: [dividedAttention()],
  Broodmother: [dividedAttention(), tempoMonster()],
  'Naga Siren': [dividedAttention()],
  Kez: [tempoMonster()],
  'Troll Warlord': [tempoMonster()],
  'Death Prophet': [tempoMonster()],
  Visage: [tempoMonster()],
};

function statstealer(): CustomTag {
  return {
    name: 'Statstealer',
    rarity: 'epic',
    visible: false,
    revealable: true,
    minCountToReveal: 2,
    description: '+5% final power to every Statstealer-tagged hero once 2+ are on the team.',
  };
}

function frosty(): CustomTag {
  return {
    name: 'Frosty',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description: "-3% to the enemy team's Movement axis per Frosty hero on this team.",
  };
}

function fundamentals(): CustomTag {
  return {
    name: 'The Fundamentals',
    rarity: 'legendary',
    visible: true,
    revealable: false,
    description: "Boosts the team's weakest axis (or axes) — strength scales with how many Fundamentals heroes are drafted.",
  };
}

function twoHeadsBetter(): CustomTag {
  return {
    name: 'Two Heads Better',
    rarity: 'rare',
    visible: false,
    revealable: true,
    minCountToReveal: 3,
    description:
      "Solo or duo: each doubles their own weakest axis. All 3 (Ogre Magi + Jakiro + Alchemist): replaced by +20% team teamfight and map control.",
  };
}

function theButton(): CustomTag {
  return {
    name: 'The Button',
    rarity: 'epic',
    visible: true,
    revealable: false,
    description: '+5% personal scaling, plus an extra +5% power in the late game — active even solo.',
  };
}

function global(): CustomTag {
  return {
    name: 'Global',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description: '+10% personal map control, active even solo. 2+ on the team: each also gets +5% teamfight and +5% burst.',
  };
}

function dividedAttention(): CustomTag {
  return {
    name: 'Divided Attention',
    rarity: 'rare',
    visible: true,
    revealable: false,
    description: "-10% personal durability and -10% personal objectives, active even solo — power split across multiple bodies is easier to pick apart.",
  };
}

function tempoMonster(): CustomTag {
  return {
    name: 'Tempo Monster',
    rarity: 'rare',
    visible: false,
    revealable: false, // always-hidden — never rendered, calculation-only
    description:
      "+3% final power if team tempo > 8; otherwise -25% scaling/durability/map control. Additional -10% if another hard-carry hero is drafted. Never shown to the player.",
  };
}

function highSkill(): CustomTag {
  return {
    name: 'High Skill',
    rarity: 'epic',
    visible: false,
    revealable: true,
    minCountToReveal: 3,
    description:
      'Upsets are more likely around this hero (execution swings the result either way). 2+ on the team: -2.5% overall power each.',
  };
}

// Tags actually worth rendering on a card right now: always-visible ones,
// plus revealable ones whose synergy is currently active. Always-hidden
// tags (visible=false, revealable=false, e.g. Elder Titan's Agility
// Crusher) never appear here by construction.
//
// contextHeroNames: the roster to count teammates against — pass the
// hero's own name included in it. Callers differ in what that roster is:
// DraftLedger passes the full picked team (the hero is already in it);
// HeroPool passes [...pickedTeam, thisPoolHero] — a *hypothetical* reveal,
// so picking the hero that completes a combo shows it revealed before you
// commit to the pick, nudging toward collecting it (the whole point of
// Custom Tags per the original brief).
export function visibleTagsFor(heroName: string, contextHeroNames: string[]): CustomTag[] {
  const tags = CUSTOM_TAGS_BY_HERO_NAME[heroName] ?? [];
  return tags.filter((t) => {
    if (t.visible) return true;
    if (!t.revealable) return false;
    const count = contextHeroNames.filter((n) =>
      (CUSTOM_TAGS_BY_HERO_NAME[n] ?? []).some((x) => x.name === t.name),
    ).length;
    return count >= (t.minCountToReveal ?? 1);
  });
}
