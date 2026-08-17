import { HeroAbilitiesService } from './hero-abilities.service';

describe('HeroAbilitiesService.topAbilities', () => {
  const service = new HeroAbilitiesService();
  const INVOKER_ID = 74;

  it('returns abilities sorted by category score, highest first, limited to N', () => {
    const result = service.topAbilities(INVOKER_ID, 'control_strength', 3);
    expect(result).toHaveLength(3);
    // Tornado/Ice Wall/Deafening Blast all score 4 on control_strength for
    // Invoker (server/data/hero-abilities.json) — higher than Cold Snap's 3,
    // so all 3 slots go to the tied-at-4 group, none to Cold Snap.
    expect(result.every((a) => a.score === 4)).toBe(true);
    expect(result.map((a) => a.abilityKey)).toEqual(
      expect.arrayContaining(['invoker_tornado', 'invoker_ice_wall', 'invoker_deafening_blast']),
    );
  });

  it('excludes abilities with no score for the requested category', () => {
    const result = service.topAbilities(INVOKER_ID, 'control_strength', 20);
    // invoker_wex/alacrity/sun_strike/forge_spirit have no control_strength
    // entry at all in categoryScores — must not appear with a fabricated 0.
    expect(result.map((a) => a.abilityKey)).not.toEqual(
      expect.arrayContaining(['invoker_wex', 'invoker_alacrity']),
    );
  });

  it('returns an empty array for a hero with no ability data', () => {
    expect(service.topAbilities(999999, 'mobility', 3)).toEqual([]);
  });
});
