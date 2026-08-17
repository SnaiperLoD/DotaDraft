import { isI18nLine } from 'shared';
import { createSynergyAnalyzer, type SynergyLookup } from './synergy.analyzer';
import { makeHero, DEFAULT_EVALUATION_VALUES, picks } from '../../test-utils/hero-factory';
import { flattenLocalized } from '../../test-utils/localized-text';

const noRealData: SynergyLookup = {
  getSynergyWinRate: () => null,
  getWinRate: () => null,
};

describe('createSynergyAnalyzer (tag rules, no real data)', () => {
  const synergyAnalyzer = createSynergyAnalyzer(noRealData);

  it('reports no synergy when nothing matches', () => {
    const heroes = [makeHero({ id: 1, name: 'A' }), makeHero({ id: 2, name: 'B' })];
    const result = synergyAnalyzer.analyze(picks(heroes));
    expect(result.score).toBe(0);
    expect(flattenLocalized(result.explanation)).toMatch(/eval.synergy.none/);
  });

  it('scores a needs_setup + enables_engage pair and names both heroes', () => {
    const setup = makeHero({ id: 1, name: 'Lion', synergy_tags: ['needs_setup'] });
    const enabler = makeHero({ id: 2, name: 'Mirana', synergy_tags: ['enables_engage'] });
    const result = synergyAnalyzer.analyze(picks([setup, enabler]));
    expect(result.score).toBe(2.5);
    expect(flattenLocalized([result.explanation[0]])).toContain('Lion');
    expect(flattenLocalized([result.explanation[0]])).toContain('Mirana');
  });

  it('stacks multiple independent tag-pair rules', () => {
    const heroes = [
      makeHero({ id: 1, name: 'A', synergy_tags: ['needs_setup'] }),
      makeHero({ id: 2, name: 'B', synergy_tags: ['enables_engage'] }),
      makeHero({ id: 3, name: 'C', synergy_tags: ['needs_space'] }),
      makeHero({ id: 4, name: 'D', synergy_tags: ['creates_space'] }),
    ];
    const result = synergyAnalyzer.analyze(picks(heroes));
    // needs_setup+enables_engage (2.5) + needs_space+creates_space (2) = 4.5
    expect(result.score).toBe(4.5);
  });

  it('does not pair a hero with itself', () => {
    const soloHero = makeHero({ id: 1, name: 'Solo', synergy_tags: ['needs_setup', 'enables_engage'] });
    const result = synergyAnalyzer.analyze(picks([soloHero]));
    expect(result.score).toBe(0);
  });

  it('adds a bonus for 2+ high-mobility heroes', () => {
    const mobile = (id: number, name: string) =>
      makeHero({ id, name, evaluation_values: { ...DEFAULT_EVALUATION_VALUES, mobility: 6 } });
    const result = synergyAnalyzer.analyze(picks([mobile(1, 'A'), mobile(2, 'B')]));
    expect(result.score).toBe(1);
    expect(flattenLocalized(result.explanation)).toMatch(/eval.synergy.mobility/);
  });

  it('adds a bonus for 3+ teamfight-tagged heroes', () => {
    const teamfighter = (id: number, name: string) => makeHero({ id, name, tags: ['teamfight'] });
    const result = synergyAnalyzer.analyze(
      picks([teamfighter(1, 'A'), teamfighter(2, 'B'), teamfighter(3, 'C')]),
    );
    expect(result.score).toBe(1);
    expect(flattenLocalized(result.explanation)).toMatch(/eval.synergy.teamfight/);
  });

  it('caps the final score at 10', () => {
    // Stack every rule plus both bonuses to try to exceed 10.
    const heroes = [
      makeHero({
        id: 1,
        name: 'A',
        synergy_tags: ['needs_setup', 'needs_space'],
        tags: ['teamfight'],
        evaluation_values: { ...DEFAULT_EVALUATION_VALUES, mobility: 6 },
      }),
      makeHero({
        id: 2,
        name: 'B',
        synergy_tags: ['enables_engage', 'creates_space', 'protects_allies', 'wave_clear_support'],
        tags: ['teamfight'],
        evaluation_values: { ...DEFAULT_EVALUATION_VALUES, mobility: 6 },
      }),
      makeHero({
        id: 3,
        name: 'C',
        synergy_tags: ['amplifies_magic_damage', 'amplifies_physical_damage'],
        tags: ['teamfight'],
      }),
    ];
    const result = synergyAnalyzer.analyze(picks(heroes));
    expect(result.score).toBeLessThanOrEqual(10);
  });
});

describe('createSynergyAnalyzer (real win-rate data blending)', () => {
  it("halves a tag rule's weight when real data shows the pair underperforming by 4.5pp+", () => {
    const setup = makeHero({ id: 1, name: 'Lion', synergy_tags: ['needs_setup'] });
    const enabler = makeHero({ id: 2, name: 'Mirana', synergy_tags: ['enables_engage'] });

    const underperforming: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // Expected (avg of solo win rates) is 0.5; actual is 0.45 -> -5pp, past the -4.5pp threshold.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.45 : null),
    };

    const result = createSynergyAnalyzer(underperforming).analyze(picks([setup, enabler]));
    // Tag rule dampened: 2.5 * 0.5 = 1.25. This -5pp delta ALSO clears the
    // worst-pair significance bar (-3pp) since it's the only pair in a
    // 2-hero picks list — both mechanisms fire on the same pair, by design
    // (the same way a strong positive delta can both confirm a tag rule AND
    // earn the separate best-pair bonus): penalty = min(3, 0.05*15) = 0.75.
    // 1.25 - 0.75 = 0.5.
    expect(result.score).toBe(0.5);
    expect(isI18nLine(result.explanation[0]) && result.explanation[0].params?.dampened).toBe('1');
  });

  it('does not dampen a tag rule when the underperformance is within the threshold', () => {
    const setup = makeHero({ id: 1, name: 'Lion', synergy_tags: ['needs_setup'] });
    const enabler = makeHero({ id: 2, name: 'Mirana', synergy_tags: ['enables_engage'] });

    const mildUnderperformance: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // -2pp, short of the -4.5pp dampening threshold.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.48 : null),
    };

    const result = createSynergyAnalyzer(mildUnderperformance).analyze(picks([setup, enabler]));
    expect(result.score).toBe(2.5);
    expect(isI18nLine(result.explanation[0]) && result.explanation[0].params?.dampened).toBeUndefined();
  });

  it('rewards a real-data-only synergy pair with no matching tags at all', () => {
    const heroA = makeHero({ id: 1, name: 'Axe' });
    const heroB = makeHero({ id: 2, name: 'Sven' });

    const strongRealSynergy: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // Expected 0.5, actual 0.6 -> +10pp, well past the +3pp significance bar.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.6 : null),
    };

    const result = createSynergyAnalyzer(strongRealSynergy).analyze(picks([heroA, heroB]));
    expect(result.score).toBeGreaterThan(0);
    expect(flattenLocalized([result.explanation[0]])).toContain('Axe');
    expect(flattenLocalized([result.explanation[0]])).toContain('Sven');
    expect(flattenLocalized([result.explanation[0]])).toMatch(/eval.synergy.realStrong/);
  });

  it('ignores small real-data deltas as noise (below the significance threshold)', () => {
    const heroA = makeHero({ id: 1, name: 'Axe' });
    const heroB = makeHero({ id: 2, name: 'Sven' });

    const weakSignal: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // +1pp — below the +3pp significance bar.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.51 : null),
    };

    const result = createSynergyAnalyzer(weakSignal).analyze(picks([heroA, heroB]));
    expect(result.score).toBe(0);
  });

  // Symmetric to "rewards a real-data-only synergy pair" above — Blueprint/
  // 10-tech-debt-backlog.md, "Показать худшую синергию в Synergy", by
  // direct user request.
  it('penalizes a real-data-only worst synergy pair with no matching tags at all', () => {
    const heroA = makeHero({ id: 1, name: 'Axe' });
    const heroB = makeHero({ id: 2, name: 'Sven' });

    const weakRealSynergy: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // Expected 0.5, actual 0.4 -> -10pp, well past the -3pp significance bar.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.4 : null),
    };

    const result = createSynergyAnalyzer(weakRealSynergy).analyze(picks([heroA, heroB]));
    expect(result.score).toBe(0); // floored — nothing else contributes positively here
    expect(flattenLocalized([result.explanation[0]])).toContain('Axe');
    expect(flattenLocalized([result.explanation[0]])).toContain('Sven');
    expect(flattenLocalized([result.explanation[0]])).toMatch(/eval.synergy.realWeak/);
  });

  it('SHOWS a small negative real-data pair but does NOT penalize it below the significance threshold', () => {
    // Changed 2026-08-13 (user: "I did not see bad pairs displayed"): a
    // marginally-negative pair is now surfaced for the player to see, even
    // though it's too small to move the score.
    const heroA = makeHero({ id: 1, name: 'Axe' });
    const heroB = makeHero({ id: 2, name: 'Sven' });

    const mildSignal: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // -1pp — short of the -3pp significance bar, so no score penalty, but < 0.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.49 : null),
    };

    const result = createSynergyAnalyzer(mildSignal).analyze(picks([heroA, heroB]));
    expect(result.score).toBe(0); // not penalized
    expect(flattenLocalized(result.explanation)).toMatch(/eval.synergy.realWeak/);
  });

  it('floors the final score at 0 rather than going negative', () => {
    const heroA = makeHero({ id: 1, name: 'Axe' });
    const heroB = makeHero({ id: 2, name: 'Sven' });

    const stronglyNegative: SynergyLookup = {
      getWinRate: (id) => (id === 1 || id === 2 ? 0.5 : null),
      // Expected 0.5, actual 0.2 -> -30pp, magnitude far past the *15/min(3,..) cap.
      getSynergyWinRate: (a, b) => ([a, b].sort().join() === '1,2' ? 0.2 : null),
    };

    const result = createSynergyAnalyzer(stronglyNegative).analyze(picks([heroA, heroB]));
    expect(result.score).toBe(0);
  });

  it('applies both the best-pair bonus and worst-pair penalty when different pairs qualify for each', () => {
    const strong1 = makeHero({ id: 1, name: 'A' });
    const strong2 = makeHero({ id: 2, name: 'B' });
    const weak1 = makeHero({ id: 3, name: 'C' });
    const weak2 = makeHero({ id: 4, name: 'D' });

    const mixedSignal: SynergyLookup = {
      getWinRate: () => 0.5,
      getSynergyWinRate: (a, b) => {
        const key = [a, b].sort().join();
        if (key === '1,2') return 0.6; // +10pp -> best pair
        if (key === '3,4') return 0.4; // -10pp -> worst pair
        return null;
      },
    };

    const result = createSynergyAnalyzer(mixedSignal).analyze(picks([strong1, strong2, weak1, weak2]));
    // +3 (capped bonus) - 3 (capped penalty) = 0, but both lines should still be present.
    expect(flattenLocalized(result.explanation)).toMatch(/eval.synergy.realStrong/);
    expect(flattenLocalized(result.explanation)).toMatch(/eval.synergy.realWeak/);
  });
});

describe('createSynergyAnalyzer (game-plan conflict / anti-synergy rules)', () => {
  const noRealData: SynergyLookup = { getWinRate: () => null, getSynergyWinRate: () => null };

  it('penalizes a split-push + late-scaling pair as conflicting game plans (no co-pick data needed)', () => {
    // Lycan (split_push) + Medusa (late_game_scaling) — the user's example. These
    // are so rarely co-drafted they have no real co-pick data, so the archetype
    // tags carry the signal.
    const lycan = makeHero({ id: 1, name: 'Lycan', tags: ['split_push'] });
    const medusa = makeHero({ id: 2, name: 'Medusa', tags: ['late_game_scaling'] });

    const result = createSynergyAnalyzer(noRealData).analyze(picks([lycan, medusa]));
    const text = flattenLocalized(result.explanation);
    expect(text).toContain('Lycan');
    expect(text).toContain('Medusa');
    expect(text).toMatch(/eval.synergy.anti.split_push_late/);
    // Floored at 0 (a lone conflicting pair has nothing positive to offset it).
    expect(result.score).toBe(0);
  });

  it('penalizes a deathball + late-scaling pair as conflicting timings', () => {
    const deathball = makeHero({ id: 1, name: 'Leshrac', tags: ['deathball'] });
    const lateCarry = makeHero({ id: 2, name: 'Spectre', tags: ['late_game_scaling'] });

    const result = createSynergyAnalyzer(noRealData).analyze(picks([deathball, lateCarry]));
    expect(flattenLocalized(result.explanation)).toMatch(/eval.synergy.anti.deathball_late/);
  });

  it('does not flag a conflict when only one side of the archetype pair is present', () => {
    const lycan = makeHero({ id: 1, name: 'Lycan', tags: ['split_push'] });
    const other = makeHero({ id: 2, name: 'Sven', tags: ['teamfight'] });

    const result = createSynergyAnalyzer(noRealData).analyze(picks([lycan, other]));
    expect(flattenLocalized(result.explanation)).not.toMatch(/eval.synergy.anti/);
  });

  it('does not flag a single hero carrying both tags against itself', () => {
    const both = makeHero({ id: 1, name: 'Weird', tags: ['split_push', 'late_game_scaling'] });
    const filler = makeHero({ id: 2, name: 'Filler', tags: ['teamfight'] });

    const result = createSynergyAnalyzer(noRealData).analyze(picks([both, filler]));
    expect(flattenLocalized(result.explanation)).not.toMatch(/eval.synergy.anti/);
  });

  it('does not treat a dual-tagged late split-pusher as wanting to end early', () => {
    // Phantom Lancer / Lone Druid style: split_push is the late-game map plan,
    // not an early-close win condition. Pairing them must not fire the
    // "press the map and end early" conflict template.
    const pl = makeHero({
      id: 12,
      name: 'Phantom Lancer',
      tags: ['illusion_based', 'split_push', 'late_game_scaling'],
    });
    const ld = makeHero({ id: 80, name: 'Lone Druid', tags: ['split_push', 'late_game_scaling'] });

    const result = createSynergyAnalyzer(noRealData).analyze(picks([pl, ld]));
    expect(flattenLocalized(result.explanation)).not.toMatch(/eval.synergy.anti/);
  });

  it('does not flag dual-tagged split_push + pure late_game_scaling as a conflict', () => {
    // Arc Warden already carried both tags; without skipping dual-tagged early
    // sides, he was narrated as wanting to end early vs Medusa.
    const aw = makeHero({ id: 1, name: 'Arc Warden', tags: ['split_push', 'late_game_scaling'] });
    const medusa = makeHero({ id: 2, name: 'Medusa', tags: ['late_game_scaling'] });

    const result = createSynergyAnalyzer(noRealData).analyze(picks([aw, medusa]));
    expect(flattenLocalized(result.explanation)).not.toMatch(/eval.synergy.anti/);
  });

  it('does not treat Tinker as wanting to end early vs a late scaler', () => {
    // Same dual-tag exemption as PL/LD/AW: Tinker split-pushes after scaling,
    // so pairing with Medusa must not fire the early-close conflict template.
    const tinker = makeHero({
      id: 34,
      name: 'Tinker',
      tags: ['poke', 'split_push', 'global_impact', 'late_game_scaling'],
    });
    const medusa = makeHero({ id: 94, name: 'Medusa', tags: ['late_game_scaling'] });

    const result = createSynergyAnalyzer(noRealData).analyze(picks([tinker, medusa]));
    expect(flattenLocalized(result.explanation)).not.toMatch(/eval.synergy.anti/);
  });
});
