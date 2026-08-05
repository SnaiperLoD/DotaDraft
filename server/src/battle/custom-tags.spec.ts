import { makeHero } from '../test-utils/hero-factory';
import { blessingEffectsFor, curseEffectsOnOpponent, mergeTagEffects, emptyTagEffects } from './custom-tags';

describe('blessingEffectsFor', () => {
  describe('Mana Booster', () => {
    it('buffs a Mana Depended teammate when Crystal Maiden is on the team', () => {
      const cm = makeHero({ id: 1, name: 'Crystal Maiden' });
      const storm = makeHero({ id: 2, name: 'Storm Spirit' });
      const effects = blessingEffectsFor([cm, storm], {});
      expect(effects.heroPowerMultiplier.get(storm.id)).toBe(1.03);
    });

    it('does not buff Crystal Maiden herself', () => {
      const cm = makeHero({ id: 1, name: 'Crystal Maiden' });
      const effects = blessingEffectsFor([cm], {});
      expect(effects.heroPowerMultiplier.has(cm.id)).toBe(false);
    });

    it('does nothing without Crystal Maiden present', () => {
      const storm = makeHero({ id: 2, name: 'Storm Spirit' });
      const effects = blessingEffectsFor([storm], {});
      expect(effects.heroPowerMultiplier.size).toBe(0);
    });
  });

  describe('Statstealer', () => {
    it('does nothing with only 1 tagged hero', () => {
      const silencer = makeHero({ id: 1, name: 'Silencer' });
      const effects = blessingEffectsFor([silencer], {});
      expect(effects.heroPowerMultiplier.size).toBe(0);
    });

    it('buffs every tagged hero once 2+ are on the team', () => {
      const silencer = makeHero({ id: 1, name: 'Silencer' });
      const slark = makeHero({ id: 2, name: 'Slark' });
      const untagged = makeHero({ id: 3, name: 'Sniper' });
      const effects = blessingEffectsFor([silencer, slark, untagged], {});
      expect(effects.heroPowerMultiplier.get(silencer.id)).toBe(1.05);
      expect(effects.heroPowerMultiplier.get(slark.id)).toBe(1.05);
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

    it('boosts the single weakest axis by 20% with 2 tagged heroes', () => {
      const effects = blessingEffectsFor([io, kotl], rawAxisAverages);
      expect(effects.axisMultiplier).toEqual({ tempo: 1.2 });
    });

    it('boosts the 2 weakest axes by 20% with 3 tagged heroes (overrides the 2-tier)', () => {
      const effects = blessingEffectsFor([io, kotl, ck], rawAxisAverages);
      expect(effects.axisMultiplier).toEqual({ tempo: 1.2, mobility: 1.2 });
    });

    it('boosts the 4 weakest axes by 25% with 4 tagged heroes (overrides lower tiers)', () => {
      const effects = blessingEffectsFor([io, kotl, ck, enigma], rawAxisAverages);
      expect(effects.axisMultiplier).toEqual({ tempo: 1.25, mobility: 1.25, control: 1.25, burst: 1.25 });
    });
  });
});

describe('Two Heads Better', () => {
  function heroWithAxes(id: number, name: string, overrides: Record<string, number>) {
    return makeHero({ id, name, evaluation_values: { teamfight: 5, tempo: 5, scaling: 5, mobility: 5, objectives: 5, control: 5, durability: 5, burst: 5, map_control: 5, saving: 5, initiating: 5, skirmish_rate: 5, camp_stacking: 5, resource_efficiency: 5, ...overrides } });
  }

  it('doubles a solo tagged hero\'s own weakest axis', () => {
    const jakiro = heroWithAxes(1, 'Jakiro', { durability: 1 });
    const effects = blessingEffectsFor([jakiro], {});
    expect(effects.heroAxisMultiplier.get(jakiro.id)?.durability).toBe(2);
    expect(effects.axisMultiplier.teamfight).toBeUndefined();
  });

  it('doubles each of 2 tagged heroes\' own weakest axis independently, not team-wide', () => {
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
  it('boosts a solo tagged hero\'s scaling and their late-phase power, both active with just 1', () => {
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
  // Beastmaster/Naga Siren carry Divided Attention only, not Tempo Monster
  // (which overlaps 5-for-8 with this roster and would otherwise contaminate
  // these numbers with its own tempo-conditional penalty) — see the
  // dedicated Tempo Monster describe block below for that interaction.
  it('debuffs a solo carrier\'s durability and objectives by 10%, no team-count gate', () => {
    const beastmaster = makeHero({ id: 1, name: 'Beastmaster' });
    const effects = blessingEffectsFor([beastmaster], {});
    expect(effects.heroAxisMultiplier.get(beastmaster.id)?.durability).toBeCloseTo(0.9);
    expect(effects.heroAxisMultiplier.get(beastmaster.id)?.objectives).toBeCloseTo(0.9);
    expect(effects.heroAxisMultiplier.get(beastmaster.id)?.teamfight).toBeUndefined();
  });

  it('does nothing for an untagged hero', () => {
    const sniper = makeHero({ id: 1, name: 'Sniper' });
    const effects = blessingEffectsFor([sniper], {});
    expect(effects.heroAxisMultiplier.get(sniper.id)).toBeUndefined();
  });

  it('applies independently to each of multiple carriers', () => {
    const beastmaster = makeHero({ id: 1, name: 'Beastmaster' });
    const naga = makeHero({ id: 2, name: 'Naga Siren' });
    const effects = blessingEffectsFor([beastmaster, naga], {});
    expect(effects.heroAxisMultiplier.get(beastmaster.id)?.durability).toBeCloseTo(0.9);
    expect(effects.heroAxisMultiplier.get(naga.id)?.durability).toBeCloseTo(0.9);
  });
});

describe('Tempo Monster', () => {
  it('gives +3% final power when the team\'s own tempo average is above 8', () => {
    const lycan = makeHero({ id: 1, name: 'Lycan' });
    const effects = blessingEffectsFor([lycan], { tempo: 8.5 });
    expect(effects.heroPowerMultiplier.get(lycan.id)).toBeCloseTo(1.03);
    expect(effects.heroAxisMultiplier.get(lycan.id)?.scaling).toBeUndefined();
  });

  it('gives -25% scaling/durability/map_control when team tempo is 8 or below', () => {
    const lycan = makeHero({ id: 1, name: 'Lycan' });
    const effects = blessingEffectsFor([lycan], { tempo: 8 });
    expect(effects.heroAxisMultiplier.get(lycan.id)?.scaling).toBeCloseTo(0.75);
    expect(effects.heroAxisMultiplier.get(lycan.id)?.durability).toBeCloseTo(0.75 * 0.9); // stacks with Divided Attention
    expect(effects.heroAxisMultiplier.get(lycan.id)?.map_control).toBeCloseTo(0.75);
    expect(effects.heroPowerMultiplier.has(lycan.id)).toBe(false);
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
    const support = makeHero({ id: 2, name: 'Sniper', presumed_positions: [{ position: 'Support', share: 0.9 }] });
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
    const a = { ...emptyTagEffects(), heroPowerMultiplier: new Map([[1, 1.05]]), axisMultiplier: { mobility: 0.97 } };
    const b = { ...emptyTagEffects(), heroPowerMultiplier: new Map([[1, 1.1]]), axisMultiplier: { mobility: 0.9 } };
    const merged = mergeTagEffects(a, b);
    expect(merged.heroPowerMultiplier.get(1)).toBeCloseTo(1.05 * 1.1);
    expect(merged.axisMultiplier.mobility).toBeCloseTo(0.97 * 0.9);
  });
});
