import type { Hero, HeroEvaluationValues } from 'shared';
import { MANA_BOOSTER_BENEFICIARIES, heroNameSetForTag } from 'shared';
import type { GamePhase } from './battle-resolution';
import { isHardCarry } from '../common/hard-carry';

// Custom tags — a hand-authored layer on top of the calibrated
// evaluation_values/axis-weights model (self-play outlier investigation,
// Blueprint/10-tech-debt-backlog.md "custom tags"). Explicitly NOT trying
// to track real winRate the way every other mechanism in battle-resolution
// does — the point is drafting depth/combo-hunting. Two categories:
//   blessing — a team's own tags buff itself.
//   curse    — a team's tags debuff the OPPONENT (Battle Engine checks both
//              categories for both sides before resolving a battle).
// Which heroes carry which tag lives in shared/customTags.ts — the single
// source also used by client/src/data/customTags.ts for badge display, so
// the two can no longer drift apart the way they used to (Crystal Maiden
// used to apply Frosty here without the client ever showing the badge).
// Numeric effect magnitudes (percentages, thresholds) stay local here —
// those only matter to battle math, not to what badge renders on a card.

export type TagCategory = 'blessing' | 'curse';
type Axis = keyof HeroEvaluationValues;

// Multiplicative-only, four independent dimensions so effects compose
// cleanly regardless of order and can never push a value negative:
//   heroPowerMultiplier      — named hero, every axis, every phase.
//   axisMultiplier           — whole team, one axis, every phase.
//   heroAxisMultiplier       — named hero, one axis, every phase (own
//                              weakest-axis boosts, per-hero axis-specific
//                              buffs that aren't a flat power change).
//   phaseHeroPowerMultiplier — named hero, every axis, ONE specific phase
//                              only (The Button's late-game-only boost).
export interface CustomTagEffects {
  heroPowerMultiplier: Map<number, number>;
  axisMultiplier: Partial<Record<Axis, number>>;
  heroAxisMultiplier: Map<number, Partial<Record<Axis, number>>>;
  phaseHeroPowerMultiplier: Map<GamePhase, Map<number, number>>;
}

export function emptyTagEffects(): CustomTagEffects {
  return {
    heroPowerMultiplier: new Map(),
    axisMultiplier: {},
    heroAxisMultiplier: new Map(),
    phaseHeroPowerMultiplier: new Map(),
  };
}

function mulHeroPower(effects: CustomTagEffects, heroId: number, factor: number): void {
  effects.heroPowerMultiplier.set(heroId, (effects.heroPowerMultiplier.get(heroId) ?? 1) * factor);
}

function mulAxis(effects: CustomTagEffects, axis: Axis, factor: number): void {
  effects.axisMultiplier[axis] = (effects.axisMultiplier[axis] ?? 1) * factor;
}

function mulHeroAxis(effects: CustomTagEffects, heroId: number, axis: Axis, factor: number): void {
  const forHero = effects.heroAxisMultiplier.get(heroId) ?? {};
  forHero[axis] = (forHero[axis] ?? 1) * factor;
  effects.heroAxisMultiplier.set(heroId, forHero);
}

function mulPhaseHeroPower(
  effects: CustomTagEffects,
  phase: GamePhase,
  heroId: number,
  factor: number,
): void {
  const forPhase = effects.phaseHeroPowerMultiplier.get(phase) ?? new Map<number, number>();
  forPhase.set(heroId, (forPhase.get(heroId) ?? 1) * factor);
  effects.phaseHeroPowerMultiplier.set(phase, forPhase);
}

export function mergeTagEffects(...list: CustomTagEffects[]): CustomTagEffects {
  const merged = emptyTagEffects();
  for (const e of list) {
    for (const [heroId, mult] of e.heroPowerMultiplier) mulHeroPower(merged, heroId, mult);
    for (const axis of Object.keys(e.axisMultiplier) as Axis[])
      mulAxis(merged, axis, e.axisMultiplier[axis]!);
    for (const [heroId, axisMap] of e.heroAxisMultiplier) {
      for (const axis of Object.keys(axisMap) as Axis[]) mulHeroAxis(merged, heroId, axis, axisMap[axis]!);
    }
    for (const [phase, heroMap] of e.phaseHeroPowerMultiplier) {
      for (const [heroId, mult] of heroMap) mulPhaseHeroPower(merged, phase, heroId, mult);
    }
  }
  return merged;
}

// Kept permanently (always empty in normal operation) as reusable
// measurement infrastructure — add a tag's exact display name, run
// simulate-self-play, remove it, to get a clean single-tag-off A/B against
// the all-tags-on baseline (Blueprint/10-tech-debt-backlog.md, "measure
// tag/badge significance on every large test run"). Always empty when
// committed. battle-resolution.ts's High Skill upset mechanic checks this
// too (isTagDisabled), since that half doesn't live in this file.
export const DISABLED_TAGS = new Set<string>([]);
export function isTagDisabled(name: string): boolean {
  return DISABLED_TAGS.has(name);
}

// ---------- registry (hero-name sets sourced from shared/customTags.ts) ----------

const MANA_DEPENDED = new Set(MANA_BOOSTER_BENEFICIARIES);
const STATSTEALER = heroNameSetForTag('Statstealer');
const FROSTY = heroNameSetForTag('Frosty');
const FUNDAMENTALS = heroNameSetForTag('The Fundamentals');
const TWO_HEADS_BETTER = heroNameSetForTag('Two Heads Better');
const THE_BUTTON = heroNameSetForTag('The Button');
const GLOBAL = heroNameSetForTag('Global');
export const HIGH_SKILL = heroNameSetForTag('High Skill');
// Multi-unit heroes (summons/illusions/clones) — self-play outlier
// investigation found this whole archetype systematically overrated on
// durability+objectives specifically (Blueprint/10-tech-debt-backlog.md):
// likely the summoned units' stats leak into the hero's own calibration
// (extra pooled HP, simultaneous multi-body pushing), without the offsetting
// real weakness — split power is easier to pick apart piece by piece than
// the raw stat sheet implies.
const DIVIDED_ATTENTION = heroNameSetForTag('Divided Attention');
const DIVIDED_ATTENTION_PENALTY = 0.9;

// Tempo Monster — hidden, always-active (no reveal state at all, per spec).
// Rewards a genuinely tempo-built team (+3% final power) and punishes a
// team that isn't (-25% scaling/durability/map_control) for each carrier,
// plus a further -10% if another Hard Carry is drafted alongside them.
// Overlaps 5-for-5 with Divided Attention's roster (Nature's Prophet/Meepo/
// Lone Druid/Lycan/Broodmother) — flagged as a real stacking risk before
// building this (Blueprint/10-tech-debt-backlog.md), implementing as
// specified to observe the actual measured effect rather than guessing.
const TEMPO_MONSTER = heroNameSetForTag('Tempo Monster');
const TEMPO_MONSTER_THRESHOLD = 8;
const TEMPO_MONSTER_BUFF = 1.03;
const TEMPO_MONSTER_PENALTY = 0.75;
const TEMPO_MONSTER_HARD_CARRY_PENALTY = 0.9;

const STATSTEALER_MIN_COUNT = 2;
export const HIGH_SKILL_DEBUFF_MIN_COUNT = 2;
export const HIGH_SKILL_UPSET_SHIFT = 0.05;
const HIGH_SKILL_DEBUFF_PER_HERO = 0.975;

// Old Rivals — Kunkka/Tidehunter. Same team: forced cooperation doesn't
// erase the grudge, -5% teamfight each personally. Opposite teams: whichever
// rival is on the OPPONENT's side gets personally debuffed (-5% power) —
// evaluated from both sides independently by battle-resolution.ts, so the
// effect ends up mutual without a special two-sided branch here.
const OLD_RIVALS = heroNameSetForTag('Old Rivals');
const OLD_RIVALS_TEAMFIGHT_PENALTY = 0.95;
const OLD_RIVALS_ENEMY_POWER_PENALTY = 0.95;

// Reunion — Mirana/Muerta. Both on the team: +3% personal map control each.
const REUNION = heroNameSetForTag('Reunion');
const REUNION_MAP_CONTROL_BUFF = 1.03;

// Statstealer solo bonus (2026-08-05, self-play round 2) — the existing
// 2+ gate above structurally starves a lone Statstealer (most commonly
// Undying, who has no other Statstealer regularly drafted alongside him) of
// any bonus at all in a typical draft. Smaller than the 2+ payoff so
// stacking is still meaningfully rewarded, not flattened.
const STATSTEALER_SOLO_BUFF = 1.02;

// Unseen — permanent-invisibility heroes (Riki/Weaver/Clinkz/Bounty Hunter/
// Nyx Assassin). Solo-active personal power + map_control buff (invisibility
// is a real strength no axis measures); 2+ on the team trades frontline
// presence for a stack of pick-off specialists, scaling penalty by count —
// same keyed-by-count shape as hardCarryStackPenalty/utilityStackPenalty.
const UNSEEN = heroNameSetForTag('Unseen');
const UNSEEN_POWER_BUFF = 1.06;
const UNSEEN_MAP_CONTROL_BUFF = 1.08;
const STEALTH_STACK_PENALTY: Record<string, number> = { '2': 0.95, '3': 0.9, '4': 0.85, '5': 0.8 };

// Army of Clones — illusion/clone heroes (Phantom Lancer/Terrorblade/Naga
// Siren). Same shape as Unseen (personal power + map_control solo-active,
// stacking durability/teamfight penalty at 2+) — illusions are extra bodies
// for damage/vision no axis measures, but the real body gets easier to pick
// off the more the team leans on clones instead of a genuine frontline.
const ARMY_OF_CLONES = heroNameSetForTag('Army of Clones');
const ARMY_OF_CLONES_POWER_BUFF = 1.06;
const ARMY_OF_CLONES_MAP_CONTROL_BUFF = 1.08;

// Mass Buffer — team-wide amplification heroes (Vengeful Spirit/Mirana/Luna/
// Drow Ranger) whose real value (auras/debuffs that amplify allies) mostly
// falls outside Battle Engine's real-data-only synergy signal (no archetype-
// tag fallback the way Evaluation Engine's Synergy Analyzer has). Team-wide
// teamfight/burst buff, solo-active, +1% per additional carrier — applied
// ONCE at the combined magnitude, not multiplied per carrier, so it scales
// with count rather than compounding.
const MASS_BUFFER = heroNameSetForTag('Mass Buffer');
const MASS_BUFFER_BASE_BUFF = 0.03;
const MASS_BUFFER_PER_EXTRA = 0.01;

// Prone To Burst — heroes that look sturdy on paper (self-sustain/big HP
// pool) but are actually fragile once a burst-heavy opponent gets a clean
// window (Huskar/Phoenix/Enchantress/Necrophos/Monkey King). Personal power
// debuff conditioned on the OPPONENT's raw burst average, not the caster's
// own team — a new effect shape (see curseEffectsOnOpponent-adjacent
// reasoning), implemented in blessingEffectsFor since it's still "this
// hero's own vulnerability," just read against external context.
const PRONE_TO_BURST = heroNameSetForTag('Prone To Burst');
const PRONE_TO_BURST_OPPONENT_BURST_THRESHOLD = 6.5; // population mean ~5.16, sd ~1.34 (Q1, simulate-self-play.ts)
const PRONE_TO_BURST_PENALTY = 0.92;

// "Core" for Agility Crusher's -5% (non-agility cores) clause — a hero
// whose most-played presumed position isn't Support. No data at all
// defaults to true (conservative: the curse still applies) rather than
// silently exempting heroes we have no position read on.
function isCore(hero: Hero): boolean {
  const top = hero.presumed_positions?.[0];
  if (!top) return true;
  return top.position !== 'Support';
}

// A hero's own weakest raw axis (Two Heads Better) — straight off
// evaluation_values, no role-fit/team context, since this is "this hero's
// personal blind spot," not a team-relative measure.
function weakestOwnAxis(hero: Hero): Axis {
  const entries = Object.entries(hero.evaluation_values) as [Axis, number][];
  return entries.reduce((min, cur) => (cur[1] < min[1] ? cur : min))[0];
}

// ---------- blessing: a team's tags buffing itself ----------

// rawAxisAverages: the team's OWN un-tagged axis averages (axisAverage()
// with no tagEffects) — passed in by the caller so The Fundamentals can
// rank "weakest axis" without creating a feedback loop against its own
// output.
// opponentRawAxisAverages: the OTHER team's own un-tagged axis averages —
// optional (defaults to {}, so existing call sites/tests without opponent
// context just never trigger opponent-conditional tags like Prone To Burst)
// since assessBattle() already computes both sides' rawAxisAverages before
// either blessingEffectsFor() call (battle-resolution.ts), so this is just
// threading an already-available value through, not new architecture.
export function blessingEffectsFor(
  team: Hero[],
  rawAxisAverages: Partial<Record<Axis, number>>,
  opponentRawAxisAverages: Partial<Record<Axis, number>> = {},
): CustomTagEffects {
  const effects = emptyTagEffects();
  const names = new Set(team.map((h) => h.name));

  // Mana Booster: Crystal Maiden present -> Mana Depended teammates +3%.
  if (!isTagDisabled('Mana Booster') && names.has('Crystal Maiden')) {
    for (const h of team) {
      if (h.name !== 'Crystal Maiden' && MANA_DEPENDED.has(h.name)) mulHeroPower(effects, h.id, 1.03);
    }
  }

  // Statstealer: 2+ tagged heroes on the team -> each of them +5%. A lone
  // Statstealer still gets a smaller +2% (2026-08-05, self-play round 2) —
  // the 2+ gate alone structurally starved solo carriers (Undying most
  // commonly) of any bonus at all, since a second Statstealer is rarely
  // drafted alongside them.
  const statstealers = team.filter((h) => STATSTEALER.has(h.name));
  if (!isTagDisabled('Statstealer') && statstealers.length >= 1) {
    const buff = statstealers.length >= STATSTEALER_MIN_COUNT ? 1.05 : STATSTEALER_SOLO_BUFF;
    for (const h of statstealers) mulHeroPower(effects, h.id, buff);
  }

  // Unseen: solo-active personal power + map_control buff for every
  // permanent-invisibility carrier. 2+ on the team: each takes a
  // durability/teamfight penalty, keyed by stack count (too many pick-off
  // specialists trade away frontline presence and sustained fight power).
  const unseenHeroes = isTagDisabled('Unseen') ? [] : team.filter((h) => UNSEEN.has(h.name));
  for (const h of unseenHeroes) {
    mulHeroPower(effects, h.id, UNSEEN_POWER_BUFF);
    mulHeroAxis(effects, h.id, 'map_control', UNSEEN_MAP_CONTROL_BUFF);
  }
  if (unseenHeroes.length >= 2) {
    const penalty = STEALTH_STACK_PENALTY[String(unseenHeroes.length)] ?? STEALTH_STACK_PENALTY['5'];
    for (const h of unseenHeroes) {
      mulHeroAxis(effects, h.id, 'durability', penalty);
      mulHeroAxis(effects, h.id, 'teamfight', penalty);
    }
  }

  // Army of Clones: same shape as Unseen, separate roster (illusion/clone
  // heroes) — see the tag comment above for the reasoning.
  const cloneHeroes = isTagDisabled('Army of Clones') ? [] : team.filter((h) => ARMY_OF_CLONES.has(h.name));
  for (const h of cloneHeroes) {
    mulHeroPower(effects, h.id, ARMY_OF_CLONES_POWER_BUFF);
    mulHeroAxis(effects, h.id, 'map_control', ARMY_OF_CLONES_MAP_CONTROL_BUFF);
  }
  if (cloneHeroes.length >= 2) {
    const penalty = STEALTH_STACK_PENALTY[String(cloneHeroes.length)] ?? STEALTH_STACK_PENALTY['5'];
    for (const h of cloneHeroes) {
      mulHeroAxis(effects, h.id, 'durability', penalty);
      mulHeroAxis(effects, h.id, 'teamfight', penalty);
    }
  }

  // Mass Buffer: team-wide teamfight/burst buff, solo-active, magnitude
  // grows +1% per additional carrier — applied once at the combined
  // magnitude (not once per carrier) so it scales with count rather than
  // compounding multiplicatively.
  const massBufferCount = isTagDisabled('Mass Buffer')
    ? 0
    : team.filter((h) => MASS_BUFFER.has(h.name)).length;
  if (massBufferCount >= 1) {
    const magnitude = 1 + MASS_BUFFER_BASE_BUFF + MASS_BUFFER_PER_EXTRA * (massBufferCount - 1);
    mulAxis(effects, 'teamfight', magnitude);
    mulAxis(effects, 'burst', magnitude);
  }

  // Prone To Burst: personal power debuff, active only when the OPPONENT's
  // raw burst average clears the threshold — see the tag comment above for
  // why this reads external (opponent) context instead of the caster's own
  // team, unlike every other tag in this function.
  if (!isTagDisabled('Prone To Burst')) {
    const opponentBurst = opponentRawAxisAverages.burst ?? 0;
    if (opponentBurst > PRONE_TO_BURST_OPPONENT_BURST_THRESHOLD) {
      for (const h of team) {
        if (PRONE_TO_BURST.has(h.name)) mulHeroPower(effects, h.id, PRONE_TO_BURST_PENALTY);
      }
    }
  }

  // The Fundamentals: tiered by count, boosts that many of the team's own
  // weakest (lowest raw average) axes. 3-tag and 4-tag override rather than
  // stack with the lower tiers (per spec) — the `else if` chain enforces
  // that, only ever applying one tier's worth of axes/magnitude.
  const fundamentalsCount = team.filter((h) => FUNDAMENTALS.has(h.name)).length;
  if (!isTagDisabled('The Fundamentals') && fundamentalsCount >= 2) {
    const ranked = (Object.entries(rawAxisAverages) as [Axis, number][]).sort((a, b) => a[1] - b[1]);
    let axisCount: number;
    let boost: number;
    if (fundamentalsCount >= 4) {
      axisCount = 4;
      boost = 1.25;
    } else if (fundamentalsCount === 3) {
      axisCount = 2;
      boost = 1.2;
    } else {
      axisCount = 1;
      boost = 1.2;
    }
    for (const [axis] of ranked.slice(0, axisCount)) mulAxis(effects, axis, boost);
  }

  // Two Heads Better: Ogre Magi/Jakiro/Alchemist. With 1-2 on the team,
  // each individually doubles their OWN weakest axis (a personal "cover
  // your blind spot" buff — two heads compensating for one's gap). With
  // all 3, the effect changes entirely (not additively) to a team-wide
  // +20% teamfight/map_control — the "war council" reading of 3 casters
  // coordinating replaces the individual-compensation reading of 1-2.
  const twoHeads = isTagDisabled('Two Heads Better') ? [] : team.filter((h) => TWO_HEADS_BETTER.has(h.name));
  if (twoHeads.length === TWO_HEADS_BETTER.size) {
    mulAxis(effects, 'teamfight', 1.2);
    mulAxis(effects, 'map_control', 1.2);
  } else {
    for (const h of twoHeads) mulHeroAxis(effects, h.id, weakestOwnAxis(h), 2);
  }

  // The Button: active even solo, no team-count gate — each tagged hero
  // gets a personal scaling boost (+5%) plus an ADDITIONAL late-phase-only
  // power boost (+5%), stacking with (not replacing) the scaling bump. Two
  // separate mechanisms because "the whole game, +5% scaling" and "the
  // late game specifically, +5% overall" aren't the same shape of buff.
  if (!isTagDisabled('The Button')) {
    for (const h of team) {
      if (THE_BUTTON.has(h.name)) {
        mulHeroAxis(effects, h.id, 'scaling', 1.05);
        mulPhaseHeroPower(effects, 'late', h.id, 1.05);
      }
    }
  }

  // Global: active even solo (+10% map_control per tagged hero); at 2+,
  // EACH tagged hero also gets +5% teamfight/+5% burst on top — the
  // multi-front-pressure reading only kicks in once there's more than one
  // global-presence hero to coordinate with.
  const globalHeroes = isTagDisabled('Global') ? [] : team.filter((h) => GLOBAL.has(h.name));
  for (const h of globalHeroes) mulHeroAxis(effects, h.id, 'map_control', 1.1);
  if (globalHeroes.length >= 2) {
    for (const h of globalHeroes) {
      mulHeroAxis(effects, h.id, 'teamfight', 1.05);
      mulHeroAxis(effects, h.id, 'burst', 1.05);
    }
  }

  // High Skill: the upset-probability half lives in resolveBattle()
  // (battle-resolution.ts), not here — it modifies the win-roll, not any
  // axis/power value, so it doesn't fit this function's shape. Only the
  // "2+ on one team" self-debuff lives here: -2.5% overall power per
  // tagged hero, once 2+ are drafted together (a "too many main characters"
  // penalty — solo, a High Skill hero is just higher-variance, not weaker).
  const highSkillHeroes = team.filter((h) => HIGH_SKILL.has(h.name));
  if (!isTagDisabled('High Skill') && highSkillHeroes.length >= HIGH_SKILL_DEBUFF_MIN_COUNT) {
    for (const h of highSkillHeroes) mulHeroPower(effects, h.id, HIGH_SKILL_DEBUFF_PER_HERO);
  }

  // Divided Attention: self-debuff, no team-count gate — active per carrier
  // regardless of the rest of the draft, -10% durability and -10%
  // objectives each (the two axes the whole multi-unit archetype shares).
  if (!isTagDisabled('Divided Attention')) {
    for (const h of team) {
      if (DIVIDED_ATTENTION.has(h.name)) {
        mulHeroAxis(effects, h.id, 'durability', DIVIDED_ATTENTION_PENALTY);
        mulHeroAxis(effects, h.id, 'objectives', DIVIDED_ATTENTION_PENALTY);
      }
    }
  }

  // Tempo Monster: team's own (un-tagged) tempo average decides which
  // branch applies per carrier — +3% final power at tempo>8, otherwise
  // -25% scaling/durability/map_control. Independent of that, each carrier
  // also takes -10% overall power if ANY OTHER hard-carry hero (existing
  // isHardCarry(), common/hard-carry.ts — no separate tag needed) is on the
  // team. Hidden, never revealed, per spec.
  if (!isTagDisabled('Tempo Monster')) {
    const teamTempo = rawAxisAverages.tempo ?? 0;
    for (const h of team) {
      if (!TEMPO_MONSTER.has(h.name)) continue;
      if (teamTempo > TEMPO_MONSTER_THRESHOLD) {
        mulHeroPower(effects, h.id, TEMPO_MONSTER_BUFF);
      } else {
        mulHeroAxis(effects, h.id, 'scaling', TEMPO_MONSTER_PENALTY);
        mulHeroAxis(effects, h.id, 'durability', TEMPO_MONSTER_PENALTY);
        mulHeroAxis(effects, h.id, 'map_control', TEMPO_MONSTER_PENALTY);
      }
      const anotherHardCarry = team.some((other) => other.id !== h.id && isHardCarry(other));
      if (anotherHardCarry) mulHeroPower(effects, h.id, TEMPO_MONSTER_HARD_CARRY_PENALTY);
    }
  }

  // Old Rivals: both Kunkka and Tidehunter forced onto the same team —
  // -5% teamfight each, personally. (The opposite-teams branch of this tag
  // is a curse, see curseEffectsOnOpponent below.)
  if (!isTagDisabled('Old Rivals')) {
    const oldRivalsPresent = team.filter((h) => OLD_RIVALS.has(h.name));
    if (oldRivalsPresent.length === OLD_RIVALS.size) {
      for (const h of oldRivalsPresent) mulHeroAxis(effects, h.id, 'teamfight', OLD_RIVALS_TEAMFIGHT_PENALTY);
    }
  }

  // Reunion: Mirana + Muerta, both on the team -> +3% personal map control each.
  if (!isTagDisabled('Reunion')) {
    const reunionPresent = team.filter((h) => REUNION.has(h.name));
    if (reunionPresent.length === REUNION.size) {
      for (const h of reunionPresent) mulHeroAxis(effects, h.id, 'map_control', REUNION_MAP_CONTROL_BUFF);
    }
  }

  return effects;
}

// ---------- curse: caster's tags debuffing the OPPONENT ----------

// Takes both rosters — Frosty only needs the caster's, Agility Crusher
// needs to inspect the opponent's own attributes/positions, and both are
// "this team casts a curse that lands on the other team" in shape, so one
// signature covers both rather than splitting into two call sites.
export function curseEffectsOnOpponent(caster: Hero[], opponent: Hero[]): CustomTagEffects {
  const effects = emptyTagEffects();

  // Frosty: stacks per Frosty hero on the caster's team, -3% enemy mobility
  // per stack (multiplicative per-stack, not linear, so it can't go negative
  // no matter how many stack).
  const frostyCount = isTagDisabled('Frosty') ? 0 : caster.filter((h) => FROSTY.has(h.name)).length;
  if (frostyCount > 0) mulAxis(effects, 'mobility', 0.97 ** frostyCount);

  // Agility Crusher: Elder Titan on the caster's team -> -10% to every
  // agility-primary opponent, -5% to every other-attribute opponent core
  // (non-cores, i.e. Support-classified heroes, are exempt from the -5%).
  if (!isTagDisabled('Agility Crusher') && caster.some((h) => h.name === 'Elder Titan')) {
    for (const h of opponent) {
      if (h.primary_attribute === 'agi') mulHeroPower(effects, h.id, 0.9);
      else if (isCore(h)) mulHeroPower(effects, h.id, 0.95);
    }
  }

  // Old Rivals: if the caster's side has either Kunkka or Tidehunter and the
  // OPPONENT's side has the other one, that opposing rival gets personally
  // debuffed (-5% power) — facing each other is as distracting as being
  // forced to cooperate. Checked from both teams' perspectives independently
  // by battle-resolution.ts, so this ends up mutual without a special
  // two-sided branch: each side's own curse call only ever debuffs the rival
  // on the OTHER side.
  if (!isTagDisabled('Old Rivals') && caster.some((h) => OLD_RIVALS.has(h.name))) {
    for (const h of opponent) {
      if (OLD_RIVALS.has(h.name)) mulHeroPower(effects, h.id, OLD_RIVALS_ENEMY_POWER_PENALTY);
    }
  }

  return effects;
}

// ---------- High Skill upset mechanic (resolveBattle()-only, no axis/power effect) ----------

export function highSkillHeroesOn(team: Hero[]): Hero[] {
  return team.filter((h) => HIGH_SKILL.has(h.name));
}
