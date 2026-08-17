import { makeHero } from '../test-utils/hero-factory';
import {
  blessingEffectsFor,
  curseEffectsOnOpponent,
  mergeTagEffects,
  emptyTagEffects,
  fundamentalsTargetAxes,
  fundamentalsBoostMagnitude,
  formatFundamentalsDescription,
} from './custom-tags';

describe('blessingEffectsFor', () => {
  describe('Mana Booster', () => {
    it('buffs a Mana Depended teammate when Crystal Maiden is on the team', () => {
      const cm = makeHero({ id: 1, name: 'Crystal Maiden' });
      const storm = makeHero({ id: 2, name: 'Storm Spirit' });
      const effects = blessingEffectsFor([cm, storm], {});
      expect(effects.heroPowerMultiplier.get(storm.id)).toBe(1.03);
    });

    it('does not apply Mana Booster to Crystal Maiden herself (Disable Battery still buffs her)', () => {
      const cm = makeHero({ id: 1, name: 'Crystal Maiden' });
      const effects = blessingEffectsFor([cm], {});
      // Mana Booster never self-buffs CM; Disable Battery (+25%) does.
      expect(effects.heroPowerMultiplier.get(cm.id)).toBeCloseTo(1.25);
    });

    it('does nothing without Crystal Maiden present', () => {
      const storm = makeHero({ id: 2, name: 'Storm Spirit' });
      const effects = blessingEffectsFor([storm], {});
      expect(effects.heroPowerMultiplier.size).toBe(0);
    });
  });

  describe('Statstealer', () => {
    it('buffs a solo tagged hero by 2%', () => {
      const undying = makeHero({ id: 1, name: 'Undying' });
      const effects = blessingEffectsFor([undying], {});
      expect(effects.heroPowerMultiplier.get(undying.id)).toBeCloseTo(1.02);
    });

    it('buffs every tagged hero once 2+ are on the team', () => {
      // Slark+Pudge — not Silencer (also Disable Battery, would compose).
      const slark = makeHero({ id: 1, name: 'Slark' });
      const pudge = makeHero({ id: 2, name: 'Pudge' });
      const untagged = makeHero({ id: 3, name: 'Sniper' });
      const effects = blessingEffectsFor([slark, pudge, untagged], {});
      expect(effects.heroPowerMultiplier.get(slark.id)).toBe(1.05);
      expect(effects.heroPowerMultiplier.get(pudge.id)).toBe(1.05);
      expect(effects.heroPowerMultiplier.has(untagged.id)).toBe(false);
    });
  });

  describe('The Fundamentals', () => {
    const rawAxisAverages = {
      teamfight: 5,
      tempo: 2, // weakest
      scaling: 5,
      mobility: 3, // 2nd weakest
      objectives: 5,
      control: 4, // 3rd weakest
      durability: 5,
      burst: 4.5, // 4th weakest
      map_control: 5,
      saving: 5,
      initiating: 5,
      skirmish_rate: 5,
      camp_stacking: 5,
    };
    const io = makeHero({ id: 1, name: 'Io' });
    const kotl = makeHero({ id: 2, name: 'Keeper of the Light' });
    const ck = makeHero({ id: 3, name: 'Chaos Knight' });
    const enigma = makeHero({ id: 4, name: 'Enigma' });

    it('does nothing with only 1 tagged hero', () => {
      const effects = blessingEffectsFor([io], rawAxisAverages);
      expect(effects.axisMultiplier).toEqual({});
    });

    // Uses io/ck (both Fundamentals, neither a Healer) rather than kotl — as of
    // 2026-08-13 Keeper of the Light also carries Healer, which adds a team
    // durability multiplier that would show up here and isn't what this test is
    // about. The 4-hero test below still needs kotl (all four Fundamentals) and
    // accounts for the Healer durability buff explicitly.
    it('boosts the single weakest axis by 20% with 2 tagged heroes', () => {
      const effects = blessingEffectsFor([io, ck], rawAxisAverages);
      expect(effects.axisMultiplier).toEqual({ tempo: 1.2 });
    });

    it('boosts the 2 weakest axes by 20% with 3 tagged heroes (overrides the 2-tier)', () => {
      const effects = blessingEffectsFor([io, ck, enigma], rawAxisAverages);
      expect(effects.axisMultiplier).toEqual({ tempo: 1.2, mobility: 1.2 });
    });

    it('boosts the 4 weakest axes by 25% with 4 tagged heroes (overrides lower tiers)', () => {
      const effects = blessingEffectsFor([io, kotl, ck, enigma], rawAxisAverages);
      // durability 1.02 = Keeper of the Light's Healer buff (1 Healer, +2%),
      // orthogonal to The Fundamentals' four weakest-axis boosts.
      expect(effects.axisMultiplier).toEqual({
        tempo: 1.25,
        mobility: 1.25,
        control: 1.25,
        burst: 1.25,
        durability: 1.02,
      });
    });
  });

  describe('fundamentalsTargetAxes / formatFundamentalsDescription', () => {
    const raw = {
      teamfight: 5,
      tempo: 2,
      scaling: 5,
      mobility: 3,
      objectives: 5,
      control: 4,
      durability: 5,
      burst: 4.5,
      map_control: 5,
      saving: 5,
      initiating: 5,
      skirmish_rate: 5,
      camp_stacking: 5,
    };

    it('picks the same axis tiers as blessingEffectsFor', () => {
      expect(fundamentalsTargetAxes(raw, 1)).toEqual([]);
      expect(fundamentalsTargetAxes(raw, 2)).toEqual(['tempo']);
      expect(fundamentalsTargetAxes(raw, 3)).toEqual(['tempo', 'mobility']);
      expect(fundamentalsTargetAxes(raw, 4)).toEqual(['tempo', 'mobility', 'control', 'burst']);
      expect(fundamentalsBoostMagnitude(2)).toBe(1.2);
      expect(fundamentalsBoostMagnitude(4)).toBe(1.25);
    });

    it('names human axis labels for Active Combos copy', () => {
      expect(formatFundamentalsDescription([], 1)).toContain('2+ Fundamentals');
      expect(formatFundamentalsDescription(['tempo'], 2)).toBe("Boosts this draft's weakest axis: tempo.");
      expect(formatFundamentalsDescription(['tempo', 'damage output'], 3)).toBe(
        "Boosts this draft's weakest axes: tempo and damage output.",
      );
      expect(formatFundamentalsDescription(['tempo', 'mobility', 'control'], 4)).toBe(
        "Boosts this draft's weakest axes: tempo, mobility, and control.",
      );
    });
  });
});

describe('Two Heads Better', () => {
  function heroWithAxes(id: number, name: string, overrides: Record<string, number>) {
    return makeHero({
      id,
      name,
      evaluation_values: {
        teamfight: 5,
        tempo: 5,
        scaling: 5,
        mobility: 5,
        objectives: 5,
        control: 5,
        durability: 5,
        burst: 5,
        map_control: 5,
        saving: 5,
        initiating: 5,
        skirmish_rate: 5,
        camp_stacking: 5,
        resource_efficiency: 5,
        ...overrides,
      },
    });
  }

  it("doubles a solo tagged hero's own weakest axis", () => {
    const jakiro = heroWithAxes(1, 'Jakiro', { durability: 1 });
    const effects = blessingEffectsFor([jakiro], {});
    expect(effects.heroAxisMultiplier.get(jakiro.id)?.durability).toBe(2);
    expect(effects.axisMultiplier.teamfight).toBeUndefined();
  });

  it("doubles each of 2 tagged heroes' own weakest axis independently, not team-wide", () => {
    const jakiro = heroWithAxes(1, 'Jakiro', { durability: 1 });
    const ogre = heroWithAxes(2, 'Ogre Magi', { burst: 0.5 });
    const effects = blessingEffectsFor([jakiro, ogre], {});
    expect(effects.heroAxisMultiplier.get(jakiro.id)?.durability).toBe(2);
    expect(effects.heroAxisMultiplier.get(ogre.id)?.burst).toBe(2);
    expect(effects.axisMultiplier.teamfight).toBeUndefined();
  });

  it('replaces the individual effect with a team-wide teamfight/map_control +20% once all 3 are drafted', () => {
    const jakiro = heroWithAxes(1, 'Jakiro', { durability: 1 });
    const ogre = heroWithAxes(2, 'Ogre Magi', { burst: 0.5 });
    const alch = heroWithAxes(3, 'Alchemist', { saving: 0.2 });
    const effects = blessingEffectsFor([jakiro, ogre, alch], {});
    expect(effects.axisMultiplier.teamfight).toBe(1.2);
    expect(effects.axisMultiplier.map_control).toBe(1.2);
    expect(effects.heroAxisMultiplier.get(jakiro.id)).toBeUndefined();
    expect(effects.heroAxisMultiplier.get(ogre.id)).toBeUndefined();
  });
});

describe('The Button', () => {
  it("boosts a solo tagged hero's scaling and their late-phase power, both active with just 1", () => {
    const mars = makeHero({ id: 1, name: 'Mars' });
    const effects = blessingEffectsFor([mars], {});
    expect(effects.heroAxisMultiplier.get(mars.id)?.scaling).toBe(1.05);
    expect(effects.phaseHeroPowerMultiplier.get('late')?.get(mars.id)).toBe(1.05);
    expect(effects.phaseHeroPowerMultiplier.get('early')?.get(mars.id)).toBeUndefined();
  });

  it('does nothing for an untagged hero', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    const effects = blessingEffectsFor([sniper], {});
    expect(effects.heroAxisMultiplier.get(sniper.id)).toBeUndefined();
    expect(effects.phaseHeroPowerMultiplier.get('late')?.get(sniper.id)).toBeUndefined();
  });
});

describe('Global', () => {
  it('gives a solo tagged hero only the map_control boost', () => {
    const zeus = makeHero({ id: 1, name: 'Zeus' });
    const effects = blessingEffectsFor([zeus], {});
    expect(effects.heroAxisMultiplier.get(zeus.id)?.map_control).toBe(1.1);
    expect(effects.heroAxisMultiplier.get(zeus.id)?.teamfight).toBeUndefined();
  });

  it('adds teamfight/burst boosts on top once 2+ are on the team', () => {
    const zeus = makeHero({ id: 1, name: 'Zeus' });
    const tinker = makeHero({ id: 2, name: 'Tinker' });
    const effects = blessingEffectsFor([zeus, tinker], {});
    for (const h of [zeus, tinker]) {
      expect(effects.heroAxisMultiplier.get(h.id)?.map_control).toBe(1.1);
      expect(effects.heroAxisMultiplier.get(h.id)?.teamfight).toBe(1.05);
      expect(effects.heroAxisMultiplier.get(h.id)?.burst).toBe(1.05);
    }
  });
});

describe('Healer', () => {
  it('gives a solo Healer +2% team durability', () => {
    const dazzle = makeHero({ id: 1, name: 'Dazzle' });
    const effects = blessingEffectsFor([dazzle], {});
    expect(effects.axisMultiplier.durability).toBeCloseTo(1.02);
  });

  it('grows the per-hero magnitude with stack count (+3% each at 2 -> +6% combined)', () => {
    const dazzle = makeHero({ id: 1, name: 'Dazzle' });
    const omni = makeHero({ id: 2, name: 'Omniknight' });
    const effects = blessingEffectsFor([dazzle, omni], {});
    // perHero 0.03 at count 2, combined = 1 + 0.03*2.
    expect(effects.axisMultiplier.durability).toBeCloseTo(1.06);
  });

  it('does nothing with no Healer on the team', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    const effects = blessingEffectsFor([sniper], {});
    expect(effects.axisMultiplier.durability).toBeUndefined();
  });
});

describe('Gold Generator', () => {
  it('gives a solo carrier +3% team scaling', () => {
    const bounty = makeHero({ id: 1, name: 'Bounty Hunter' });
    const effects = blessingEffectsFor([bounty], {});
    expect(effects.axisMultiplier.scaling).toBeCloseTo(1.03);
  });

  it('stacks per carrier (+6% with both)', () => {
    const bounty = makeHero({ id: 1, name: 'Bounty Hunter' });
    const alch = makeHero({ id: 2, name: 'Alchemist' });
    const effects = blessingEffectsFor([bounty, alch], {});
    expect(effects.axisMultiplier.scaling).toBeCloseTo(1.06);
  });
});

describe('High Skill (team self-debuff half)', () => {
  it('does not debuff a solo tagged hero', () => {
    const invoker = makeHero({ id: 1, name: 'Invoker' });
    const effects = blessingEffectsFor([invoker], {});
    expect(effects.heroPowerMultiplier.has(invoker.id)).toBe(false);
  });

  it('debuffs each tagged hero by 2.5% once 2+ are on the team', () => {
    const invoker = makeHero({ id: 1, name: 'Invoker' });
    const tinker = makeHero({ id: 2, name: 'Tinker' });
    const effects = blessingEffectsFor([invoker, tinker], {});
    expect(effects.heroPowerMultiplier.get(invoker.id)).toBeCloseTo(0.975);
    expect(effects.heroPowerMultiplier.get(tinker.id)).toBeCloseTo(0.975);
  });
});

describe('Divided Attention', () => {
  // Arc Warden/Naga Siren carry Divided Attention only — not Tempo Monster
  // (which overlaps 5-for-8 with this roster) and not Summoning Sickness
  // (which overlaps on Beastmaster/Nature's Prophet/Lone Druid/Lycan), either
  // of which would contaminate these numbers with its own penalty. Beastmaster
  // used to stand here and had to move when Summoning Sickness was added.
  it("debuffs a solo carrier's durability and objectives by 10%, no team-count gate", () => {
    const arcWarden = makeHero({ id: 1, name: 'Arc Warden' });
    const effects = blessingEffectsFor([arcWarden], {});
    expect(effects.heroAxisMultiplier.get(arcWarden.id)?.durability).toBeCloseTo(0.9);
    expect(effects.heroAxisMultiplier.get(arcWarden.id)?.objectives).toBeCloseTo(0.9);
    expect(effects.heroAxisMultiplier.get(arcWarden.id)?.teamfight).toBeUndefined();
  });

  it('does nothing for an untagged hero', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    const effects = blessingEffectsFor([sniper], {});
    expect(effects.heroAxisMultiplier.get(sniper.id)).toBeUndefined();
  });

  it('applies independently to each of multiple carriers', () => {
    const arcWarden = makeHero({ id: 1, name: 'Arc Warden' });
    const naga = makeHero({ id: 2, name: 'Naga Siren' });
    const effects = blessingEffectsFor([arcWarden, naga], {});
    expect(effects.heroAxisMultiplier.get(arcWarden.id)?.durability).toBeCloseTo(0.9);
    expect(effects.heroAxisMultiplier.get(naga.id)?.durability).toBeCloseTo(0.9);
  });
});

describe('Summoning Sickness', () => {
  // Chen is the one carrier whose OTHER tags don't write heroPowerMultiplier:
  // High Skill needs 2+ carriers to debuff, and Mass Buffer writes a team-wide
  // axisMultiplier. So what lands on Chen's power here is this tag alone.
  it('applies a flat -30% power debuff to a solo carrier, unconditionally', () => {
    const chen = makeHero({ id: 1, name: 'Chen' });
    const effects = blessingEffectsFor([chen], {});
    expect(effects.heroPowerMultiplier.get(chen.id)).toBeCloseTo(0.7);
  });

  it('is a power debuff, not a per-axis one', () => {
    // The first cut of this tag debuffed four named axes and measured far too
    // weak to close the anomaly (see the sweep table in custom-tags.ts), so
    // the shape changed. Nothing should land on Chen's per-axis map.
    const chen = makeHero({ id: 1, name: 'Chen' });
    expect(blessingEffectsFor([chen], {}).heroAxisMultiplier.get(chen.id)).toBeUndefined();
  });

  it('applies independently to each carrier on the same team', () => {
    const chen = makeHero({ id: 1, name: 'Chen' });
    const beastmaster = makeHero({ id: 2, name: 'Beastmaster' });
    const effects = blessingEffectsFor([chen, beastmaster], {});
    expect(effects.heroPowerMultiplier.get(chen.id)).toBeCloseTo(0.7);
    expect(effects.heroPowerMultiplier.get(beastmaster.id)).toBeCloseTo(0.7);
  });

  it('does not apply to a summoner outside the pool', () => {
    // Visage summons too but came out UNDER-rated (-5.7pp) in the no-crutch
    // run, so he is deliberately not a carrier. Tempo above the threshold so
    // Tempo Monster's own power branch stays off and can't mask this.
    const visage = makeHero({ id: 1, name: 'Visage' });
    const effects = blessingEffectsFor([visage], { tempo: 9 });
    // Tempo Monster's +3% is the only thing on his power here, no 0.7.
    expect(effects.heroPowerMultiplier.get(visage.id)).toBeCloseTo(1.03);
  });

  it('does nothing for an untagged hero', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    expect(blessingEffectsFor([sniper], {}).heroPowerMultiplier.get(sniper.id)).toBeUndefined();
  });
});

describe('Tempo Monster', () => {
  // Lycan is kept here on purpose even though he carries three overlapping
  // tags — the stacking IS the thing worth pinning down. He is Divided
  // Attention (durability x0.9, per-axis), Summoning Sickness (x0.7, flat
  // power) and Tempo Monster (tempo-conditional) at once. The two power
  // effects compose on heroPowerMultiplier; the axis effects stay separate.
  it("gives +3% final power when the team's own tempo average is above 8", () => {
    const lycan = makeHero({ id: 1, name: 'Lycan' });
    const effects = blessingEffectsFor([lycan], { tempo: 8.5 });
    // Tempo Monster +3% composed with Summoning Sickness -30%.
    expect(effects.heroPowerMultiplier.get(lycan.id)).toBeCloseTo(1.03 * 0.7);
    expect(effects.heroAxisMultiplier.get(lycan.id)?.scaling).toBeUndefined();
  });

  it('gives -25% scaling/durability/map_control when team tempo is 8 or below', () => {
    const lycan = makeHero({ id: 1, name: 'Lycan' });
    const effects = blessingEffectsFor([lycan], { tempo: 8 });
    expect(effects.heroAxisMultiplier.get(lycan.id)?.scaling).toBeCloseTo(0.75);
    expect(effects.heroAxisMultiplier.get(lycan.id)?.durability).toBeCloseTo(0.75 * 0.9); // stacks with Divided Attention
    expect(effects.heroAxisMultiplier.get(lycan.id)?.map_control).toBeCloseTo(0.75);
    // Tempo Monster's power branch is off here, so his power carries only
    // Summoning Sickness.
    expect(effects.heroPowerMultiplier.get(lycan.id)).toBeCloseTo(0.7);
  });

  it('does nothing for an untagged hero regardless of team tempo', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    const effects = blessingEffectsFor([sniper], { tempo: 9 });
    expect(effects.heroPowerMultiplier.has(sniper.id)).toBe(false);
    expect(effects.heroAxisMultiplier.get(sniper.id)).toBeUndefined();
  });

  it('applies an additional -10% when another hard-carry hero is on the team', () => {
    const alchemist = makeHero({ id: 1, name: 'Alchemist' });
    const hardCarry = makeHero({
      id: 2,
      name: 'Anti-Mage',
      presumed_positions: [{ position: 'Carry', share: 0.8 }],
    });
    const effects = blessingEffectsFor([alchemist, hardCarry], { tempo: 9 });
    // +3% (tempo>8) then -10% (another hard carry) = 1.03 * 0.9
    expect(effects.heroPowerMultiplier.get(alchemist.id)).toBeCloseTo(1.03 * 0.9);
  });

  it('does not apply the hard-carry penalty when the only hard carry is the tagged hero itself', () => {
    const aloneHardCarry = makeHero({
      id: 1,
      name: 'Alchemist',
      presumed_positions: [{ position: 'Carry', share: 0.8 }],
    });
    const support = makeHero({
      id: 2,
      name: 'Sniper',
      presumed_positions: [{ position: 'Support', share: 0.9 }],
    });
    const effects = blessingEffectsFor([aloneHardCarry, support], { tempo: 9 });
    expect(effects.heroPowerMultiplier.get(aloneHardCarry.id)).toBeCloseTo(1.03);
  });
});

describe('Old Rivals (blessing half — same team)', () => {
  it('does nothing with only Kunkka on the team', () => {
    const kunkka = makeHero({ id: 1, name: 'Kunkka' });
    const effects = blessingEffectsFor([kunkka], {});
    expect(effects.heroAxisMultiplier.get(kunkka.id)).toBeUndefined();
  });

  it('debuffs both by 5% teamfight when Kunkka and Tidehunter are on the same team', () => {
    const kunkka = makeHero({ id: 1, name: 'Kunkka' });
    const tide = makeHero({ id: 2, name: 'Tidehunter' });
    const effects = blessingEffectsFor([kunkka, tide], {});
    expect(effects.heroAxisMultiplier.get(kunkka.id)?.teamfight).toBeCloseTo(0.95);
    expect(effects.heroAxisMultiplier.get(tide.id)?.teamfight).toBeCloseTo(0.95);
  });
});

describe('Reunion', () => {
  it('does nothing with only Mirana on the team', () => {
    const mirana = makeHero({ id: 1, name: 'Mirana' });
    const effects = blessingEffectsFor([mirana], {});
    expect(effects.heroAxisMultiplier.get(mirana.id)).toBeUndefined();
  });

  it('buffs both by 3% map control when Mirana and Muerta are on the same team', () => {
    const mirana = makeHero({ id: 1, name: 'Mirana' });
    const muerta = makeHero({ id: 2, name: 'Muerta' });
    const effects = blessingEffectsFor([mirana, muerta], {});
    expect(effects.heroAxisMultiplier.get(mirana.id)?.map_control).toBeCloseTo(1.03);
    expect(effects.heroAxisMultiplier.get(muerta.id)?.map_control).toBeCloseTo(1.03);
  });
});

describe('Unseen', () => {
  it("buffs a solo carrier's personal power and map control, no team-count gate", () => {
    const riki = makeHero({ id: 1, name: 'Riki' });
    const effects = blessingEffectsFor([riki], {});
    expect(effects.heroPowerMultiplier.get(riki.id)).toBeCloseTo(1.06);
    expect(effects.heroAxisMultiplier.get(riki.id)?.map_control).toBeCloseTo(1.08);
    expect(effects.heroAxisMultiplier.get(riki.id)?.durability).toBeUndefined();
  });

  it('does nothing for an untagged hero', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    const effects = blessingEffectsFor([sniper], {});
    expect(effects.heroPowerMultiplier.has(sniper.id)).toBe(false);
  });

  it('applies a durability/teamfight penalty once 2+ are on the team', () => {
    const riki = makeHero({ id: 1, name: 'Riki' });
    const weaver = makeHero({ id: 2, name: 'Weaver' });
    const effects = blessingEffectsFor([riki, weaver], {});
    for (const h of [riki, weaver]) {
      expect(effects.heroPowerMultiplier.get(h.id)).toBeCloseTo(1.06);
      expect(effects.heroAxisMultiplier.get(h.id)?.durability).toBeCloseTo(0.95);
      expect(effects.heroAxisMultiplier.get(h.id)?.teamfight).toBeCloseTo(0.95);
    }
  });

  it('scales the penalty up with a bigger stack', () => {
    const riki = makeHero({ id: 1, name: 'Riki' });
    const weaver = makeHero({ id: 2, name: 'Weaver' });
    const clinkz = makeHero({ id: 3, name: 'Clinkz' });
    const effects = blessingEffectsFor([riki, weaver, clinkz], {});
    expect(effects.heroAxisMultiplier.get(riki.id)?.durability).toBeCloseTo(0.9);
  });
});

describe('Army of Clones', () => {
  it("buffs a solo carrier's personal power and map control, no team-count gate", () => {
    const pl = makeHero({ id: 1, name: 'Phantom Lancer' });
    const effects = blessingEffectsFor([pl], {});
    // Raid Boss (+18%) also on PL — composed with Army of Clones (+6%).
    expect(effects.heroPowerMultiplier.get(pl.id)).toBeCloseTo(1.06 * 1.18);
    expect(effects.heroAxisMultiplier.get(pl.id)?.map_control).toBeCloseTo(1.08);
  });

  it('applies a durability/teamfight penalty once 2+ are on the team', () => {
    const pl = makeHero({ id: 1, name: 'Phantom Lancer' });
    const tb = makeHero({ id: 2, name: 'Terrorblade' });
    const effects = blessingEffectsFor([pl, tb], {});
    for (const h of [pl, tb]) {
      expect(effects.heroAxisMultiplier.get(h.id)?.durability).toBeCloseTo(0.95);
      expect(effects.heroAxisMultiplier.get(h.id)?.teamfight).toBeCloseTo(0.95);
    }
  });

  it('does not cross-stack with Unseen (separate rosters)', () => {
    const pl = makeHero({ id: 1, name: 'Phantom Lancer' });
    const riki = makeHero({ id: 2, name: 'Riki' });
    const effects = blessingEffectsFor([pl, riki], {});
    expect(effects.heroAxisMultiplier.get(pl.id)?.durability).toBeUndefined();
    expect(effects.heroAxisMultiplier.get(riki.id)?.durability).toBeUndefined();
  });
});

describe('Mass Buffer', () => {
  it('gives a solo carrier a 3% team teamfight/burst buff', () => {
    const vs = makeHero({ id: 1, name: 'Vengeful Spirit' });
    const other = makeHero({ id: 2, name: 'Sniper' });
    const effects = blessingEffectsFor([vs, other], {});
    expect(effects.axisMultiplier.teamfight).toBeCloseTo(1.03);
    expect(effects.axisMultiplier.burst).toBeCloseTo(1.03);
  });

  it('does nothing for a team with no Mass Buffer hero', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    const effects = blessingEffectsFor([sniper], {});
    expect(effects.axisMultiplier.teamfight).toBeUndefined();
  });

  it('sums the grown per-hero magnitude across both carriers, not one flat team-wide bump', () => {
    const vs = makeHero({ id: 1, name: 'Vengeful Spirit' });
    const mirana = makeHero({ id: 2, name: 'Mirana' });
    const effects = blessingEffectsFor([vs, mirana], {});
    // per-hero buff at count=2 is 4% (0.03 + 0.01), contributed by BOTH
    // carriers: 1 + 0.04*2 = 1.08 (not 1.04 — that was the bug this fixes,
    // see custom-tags.ts comment).
    expect(effects.axisMultiplier.teamfight).toBeCloseTo(1.08);
    expect(effects.axisMultiplier.burst).toBeCloseTo(1.08);
  });

  it('keeps scaling with a third carrier', () => {
    const vs = makeHero({ id: 1, name: 'Vengeful Spirit' });
    const mirana = makeHero({ id: 2, name: 'Mirana' });
    const luna = makeHero({ id: 3, name: 'Luna' });
    const effects = blessingEffectsFor([vs, mirana, luna], {});
    // per-hero buff at count=3 is 5%, times 3 carriers: 1 + 0.05*3 = 1.15.
    expect(effects.axisMultiplier.teamfight).toBeCloseTo(1.15);
  });

  it('keeps scaling with a fourth carrier', () => {
    const vs = makeHero({ id: 1, name: 'Vengeful Spirit' });
    const mirana = makeHero({ id: 2, name: 'Mirana' });
    const luna = makeHero({ id: 3, name: 'Luna' });
    const drow = makeHero({ id: 4, name: 'Drow Ranger' });
    const effects = blessingEffectsFor([vs, mirana, luna, drow], {});
    // per-hero buff at count=4 is 6%, times 4 carriers: 1 + 0.06*4 = 1.24.
    expect(effects.axisMultiplier.teamfight).toBeCloseTo(1.24);
  });
});

describe('Prone To Burst', () => {
  it('does nothing when the opponent context is not provided', () => {
    const huskar = makeHero({ id: 1, name: 'Huskar' });
    const effects = blessingEffectsFor([huskar], {});
    expect(effects.heroPowerMultiplier.has(huskar.id)).toBe(false);
  });

  it("does nothing when the opponent's raw burst average is at or below the threshold", () => {
    const huskar = makeHero({ id: 1, name: 'Huskar' });
    const effects = blessingEffectsFor([huskar], {}, { burst: 5.5 });
    expect(effects.heroPowerMultiplier.has(huskar.id)).toBe(false);
  });

  it("debuffs a carrier by 20% when the opponent's raw burst average is above the threshold", () => {
    const huskar = makeHero({ id: 1, name: 'Huskar' });
    const effects = blessingEffectsFor([huskar], {}, { burst: 5.6 });
    expect(effects.heroPowerMultiplier.get(huskar.id)).toBeCloseTo(0.8);
  });

  it('does not debuff an untagged hero even against a high-burst opponent', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    const effects = blessingEffectsFor([sniper], {}, { burst: 9 });
    expect(effects.heroPowerMultiplier.has(sniper.id)).toBe(false);
  });
});

describe('Disable Battery', () => {
  it('buffs a solo carrier by 25% personal power', () => {
    const disruptor = makeHero({ id: 1, name: 'Disruptor' });
    const effects = blessingEffectsFor([disruptor], {});
    expect(effects.heroPowerMultiplier.get(disruptor.id)).toBeCloseTo(1.25);
  });

  it('does nothing for an untagged hero', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    const effects = blessingEffectsFor([sniper], {});
    expect(effects.heroPowerMultiplier.has(sniper.id)).toBe(false);
  });
});

describe('Haunt Absolute', () => {
  it('buffs Spectre by 12% personal power', () => {
    const spectre = makeHero({ id: 1, name: 'Spectre' });
    const effects = blessingEffectsFor([spectre], {});
    expect(effects.heroPowerMultiplier.get(spectre.id)).toBeCloseTo(1.12);
  });
});

describe('Mirage Tax', () => {
  it('penalises Naga Siren by 15% personal power', () => {
    const naga = makeHero({ id: 1, name: 'Naga Siren' });
    const effects = blessingEffectsFor([naga], {});
    // Army of Clones +6% composed with Mirage Tax -15%: 1.06 * 0.85
    expect(effects.heroPowerMultiplier.get(naga.id)).toBeCloseTo(1.06 * 0.85);
  });

  it('penalises Terrorblade the same way (also Army of Clones)', () => {
    const tb = makeHero({ id: 1, name: 'Terrorblade' });
    const effects = blessingEffectsFor([tb], {});
    expect(effects.heroPowerMultiplier.get(tb.id)).toBeCloseTo(1.06 * 0.85);
  });
});

describe('Paper Utility', () => {
  it('penalises Keeper of the Light by 25% personal power', () => {
    const kotl = makeHero({ id: 1, name: 'Keeper of the Light' });
    const effects = blessingEffectsFor([kotl], {});
    expect(effects.heroPowerMultiplier.get(kotl.id)).toBeCloseTo(0.75);
  });

  it('penalises Treant without Unseen buff (Treant removed from Unseen)', () => {
    const treant = makeHero({ id: 1, name: 'Treant Protector' });
    const effects = blessingEffectsFor([treant], {});
    expect(effects.heroPowerMultiplier.get(treant.id)).toBeCloseTo(0.75);
    expect(effects.heroAxisMultiplier.get(treant.id)?.map_control).toBeUndefined();
  });

  it('composes with Prone To Burst for Enchantress when opponent burst is high', () => {
    const ench = makeHero({ id: 1, name: 'Enchantress' });
    const effects = blessingEffectsFor([ench], {}, { burst: 7 });
    expect(effects.heroPowerMultiplier.get(ench.id)).toBeCloseTo(0.75 * 0.8);
  });
});

describe('Raid Boss', () => {
  it('buffs Phantom Lancer by 18% (and still stacks with Army of Clones)', () => {
    const pl = makeHero({ id: 1, name: 'Phantom Lancer' });
    const effects = blessingEffectsFor([pl], {});
    expect(effects.heroPowerMultiplier.get(pl.id)).toBeCloseTo(1.06 * 1.18);
  });

  it('buffs Medusa by 18% with no other power tags', () => {
    const medusa = makeHero({ id: 1, name: 'Medusa' });
    const effects = blessingEffectsFor([medusa], {});
    expect(effects.heroPowerMultiplier.get(medusa.id)).toBeCloseTo(1.18);
  });
});

describe('Showstopper Tax', () => {
  it('penalises Ember Spirit by 25%', () => {
    const ember = makeHero({ id: 1, name: 'Ember Spirit' });
    const effects = blessingEffectsFor([ember], {});
    expect(effects.heroPowerMultiplier.get(ember.id)).toBeCloseTo(0.75);
  });
});

describe('False Immortal', () => {
  it('penalises Necrophos by 18% unconditionally', () => {
    const necro = makeHero({ id: 1, name: 'Necrophos' });
    const effects = blessingEffectsFor([necro], {});
    // Also Healer — team durability axis only, not personal power.
    expect(effects.heroPowerMultiplier.get(necro.id)).toBeCloseTo(0.82);
  });

  it('stacks with Prone To Burst when opponent burst is high', () => {
    const necro = makeHero({ id: 1, name: 'Necrophos' });
    const effects = blessingEffectsFor([necro], {}, { burst: 7 });
    expect(effects.heroPowerMultiplier.get(necro.id)).toBeCloseTo(0.82 * 0.8);
  });

  it('does not apply to Huskar (deliberately omitted from roster)', () => {
    const huskar = makeHero({ id: 1, name: 'Huskar' });
    const effects = blessingEffectsFor([huskar], {});
    expect(effects.heroPowerMultiplier.has(huskar.id)).toBe(false);
  });
});

describe('Siege Voltage', () => {
  it('buffs Death Prophet by 12%', () => {
    const dp = makeHero({ id: 1, name: 'Death Prophet' });
    const effects = blessingEffectsFor([dp], {});
    expect(effects.heroPowerMultiplier.get(dp.id)).toBeCloseTo(1.12);
  });

  it('stacks Statstealer solo with Siege Voltage on Outworld Destroyer', () => {
    const od = makeHero({ id: 1, name: 'Outworld Destroyer' });
    const effects = blessingEffectsFor([od], {});
    expect(effects.heroPowerMultiplier.get(od.id)).toBeCloseTo(1.02 * 1.12);
  });
});

describe('curseEffectsOnOpponent', () => {
  describe('Frosty', () => {
    it('does nothing with no Frosty heroes on the caster team', () => {
      const caster = [makeHero({ id: 1, name: 'Sniper' })];
      const effects = curseEffectsOnOpponent(caster, [makeHero({ id: 2, name: 'Anti-Mage' })]);
      expect(effects.axisMultiplier.mobility).toBeUndefined();
    });

    it('applies -3% to enemy mobility per Frosty hero, multiplicatively', () => {
      const caster = [makeHero({ id: 1, name: 'Tusk' }), makeHero({ id: 2, name: 'Jakiro' })];
      const effects = curseEffectsOnOpponent(caster, [makeHero({ id: 3, name: 'Anti-Mage' })]);
      expect(effects.axisMultiplier.mobility).toBeCloseTo(0.97 ** 2);
    });
  });

  describe('Agility Crusher', () => {
    it('does nothing without Elder Titan on the caster team', () => {
      const caster = [makeHero({ id: 1, name: 'Sniper' })];
      const agiCarry = makeHero({ id: 2, name: 'Anti-Mage', primary_attribute: 'agi' });
      const effects = curseEffectsOnOpponent(caster, [agiCarry]);
      expect(effects.heroPowerMultiplier.size).toBe(0);
    });

    it('applies -10% to agility-primary opponents', () => {
      const caster = [makeHero({ id: 1, name: 'Elder Titan' })];
      const agiCarry = makeHero({
        id: 2,
        name: 'Anti-Mage',
        primary_attribute: 'agi',
        presumed_positions: [{ position: 'Carry', share: 0.8 }],
      });
      const effects = curseEffectsOnOpponent(caster, [agiCarry]);
      expect(effects.heroPowerMultiplier.get(agiCarry.id)).toBe(0.9);
    });

    it('applies -5% to non-agility opponent cores', () => {
      const caster = [makeHero({ id: 1, name: 'Elder Titan' })];
      const strCore = makeHero({
        id: 2,
        name: 'Sven',
        primary_attribute: 'str',
        presumed_positions: [{ position: 'Carry', share: 0.7 }],
      });
      const effects = curseEffectsOnOpponent(caster, [strCore]);
      expect(effects.heroPowerMultiplier.get(strCore.id)).toBe(0.95);
    });

    it('exempts non-agility Support-classified opponents from the -5%', () => {
      const caster = [makeHero({ id: 1, name: 'Elder Titan' })];
      const strSupport = makeHero({
        id: 2,
        name: 'Dazzle',
        primary_attribute: 'str',
        presumed_positions: [{ position: 'Support', share: 0.9 }],
      });
      const effects = curseEffectsOnOpponent(caster, [strSupport]);
      expect(effects.heroPowerMultiplier.has(strSupport.id)).toBe(false);
    });
  });

  describe('Mechanical (curse immunity)', () => {
    it('exempts a Mechanical opponent from Agility Crusher, while a plain agi core is still cursed', () => {
      const caster = [makeHero({ id: 1, name: 'Elder Titan' })];
      // Tinker is Mechanical; force it agi so it WOULD be hit by the -10% if
      // it weren't immune. Anti-Mage is the non-Mechanical control.
      const mechAgi = makeHero({ id: 2, name: 'Tinker', primary_attribute: 'agi' });
      const plainAgi = makeHero({ id: 3, name: 'Anti-Mage', primary_attribute: 'agi' });
      const effects = curseEffectsOnOpponent(caster, [mechAgi, plainAgi]);
      expect(effects.heroPowerMultiplier.has(mechAgi.id)).toBe(false);
      expect(effects.heroPowerMultiplier.get(plainAgi.id)).toBe(0.9);
    });
  });

  describe('Old Rivals (curse half — opposite teams)', () => {
    it('debuffs the enemy Tidehunter when the caster has Kunkka', () => {
      const caster = [makeHero({ id: 1, name: 'Kunkka' })];
      const tide = makeHero({ id: 2, name: 'Tidehunter' });
      const effects = curseEffectsOnOpponent(caster, [tide]);
      expect(effects.heroPowerMultiplier.get(tide.id)).toBeCloseTo(0.95);
    });

    it('debuffs the enemy Kunkka when the caster has Tidehunter (symmetric by name-set membership)', () => {
      const caster = [makeHero({ id: 1, name: 'Tidehunter' })];
      const kunkka = makeHero({ id: 2, name: 'Kunkka' });
      const effects = curseEffectsOnOpponent(caster, [kunkka]);
      expect(effects.heroPowerMultiplier.get(kunkka.id)).toBeCloseTo(0.95);
    });

    it('does nothing when neither rival is on the opponent side', () => {
      const caster = [makeHero({ id: 1, name: 'Kunkka' })];
      const sniper = makeHero({ id: 2, name: 'Sniper' });
      const effects = curseEffectsOnOpponent(caster, [sniper]);
      expect(effects.heroPowerMultiplier.size).toBe(0);
    });

    it('does nothing when neither rival is on the caster side', () => {
      const caster = [makeHero({ id: 1, name: 'Sniper' })];
      const tide = makeHero({ id: 2, name: 'Tidehunter' });
      const effects = curseEffectsOnOpponent(caster, [tide]);
      expect(effects.heroPowerMultiplier.size).toBe(0);
    });
  });
});

describe('mergeTagEffects', () => {
  it('multiplies overlapping hero and axis effects rather than overwriting', () => {
    const a = {
      ...emptyTagEffects(),
      heroPowerMultiplier: new Map([[1, 1.05]]),
      axisMultiplier: { mobility: 0.97 },
    };
    const b = {
      ...emptyTagEffects(),
      heroPowerMultiplier: new Map([[1, 1.1]]),
      axisMultiplier: { mobility: 0.9 },
    };
    const merged = mergeTagEffects(a, b);
    expect(merged.heroPowerMultiplier.get(1)).toBeCloseTo(1.05 * 1.1);
    expect(merged.axisMultiplier.mobility).toBeCloseTo(0.97 * 0.9);
  });
});
