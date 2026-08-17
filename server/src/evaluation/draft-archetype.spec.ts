import type { AnalyzerResult, Hero } from 'shared';
import { classifyDraftArchetype } from './draft-archetype';

function axis(key: string, percentile: number): AnalyzerResult {
  return {
    key,
    label: key,
    score: percentile / 10,
    percentile,
    explanation: [],
  };
}

function hero(partial: Partial<Hero> & { name: string }): Hero {
  const emptyVals = {} as Hero['evaluation_values'];
  const byRole = {
    Carry: emptyVals,
    Mid: emptyVals,
    Offlane: emptyVals,
    Support: emptyVals,
  };
  return {
    id: 1,
    primary_attribute: 'agi',
    attack_type: 'Melee',
    roles: [],
    tags: [],
    synergy_tags: [],
    counter_tags: [],
    evaluation_values: emptyVals,
    evaluation_values_by_role: byRole,
    presumed_positions: [],
    ...partial,
  };
}

describe('classifyDraftArchetype', () => {
  it('returns four_plus_one when exactly one dedicated Carry is present', () => {
    const heroes = [
      hero({
        name: 'Anti-Mage',
        presumed_positions: [{ position: 'Carry', share: 0.9 }],
      }),
      hero({ name: 'Crystal Maiden', presumed_positions: [{ position: 'Support', share: 0.8 }] }),
      hero({ name: 'Lion', presumed_positions: [{ position: 'Support', share: 0.7 }] }),
      hero({ name: 'Tidehunter', presumed_positions: [{ position: 'Offlane', share: 0.6 }] }),
      hero({ name: 'Invoker', presumed_positions: [{ position: 'Mid', share: 0.7 }] }),
    ];
    // Even with push-looking percentiles, 4+1 wins first.
    const breakdown = [
      axis('objectives', 90),
      axis('tempo', 80),
      axis('scaling', 40),
      axis('mobility', 80),
      axis('teamfight', 80),
    ];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('four_plus_one');
  });

  it('returns split_push on high mobility + split_push tag', () => {
    const heroes = [
      hero({ name: "Nature's Prophet", tags: ['split_push'] }),
      hero({ name: 'A' }),
      hero({ name: 'B' }),
      hero({ name: 'C' }),
      hero({ name: 'D' }),
    ];
    const breakdown = [axis('mobility', 75), axis('objectives', 40)];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('split_push');
  });

  it('returns push on high objectives with tempo not lagging scaling', () => {
    const heroes = [
      hero({ name: 'A' }),
      hero({ name: 'B' }),
      hero({ name: 'C' }),
      hero({ name: 'D' }),
      hero({ name: 'E' }),
    ];
    const breakdown = [
      axis('objectives', 75),
      axis('tempo', 70),
      axis('scaling', 60),
      axis('mobility', 40),
      axis('teamfight', 50),
    ];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('push');
  });

  it('returns tempo on a tempo spike with soft scaling', () => {
    const heroes = [
      hero({ name: 'A' }),
      hero({ name: 'B' }),
      hero({ name: 'C' }),
      hero({ name: 'D' }),
      hero({ name: 'E' }),
    ];
    const breakdown = [
      axis('tempo', 96),
      axis('scaling', 0),
      axis('objectives', 1),
      axis('mobility', 78),
      axis('teamfight', 3),
    ];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('tempo');
  });

  it('does not call a high-objectives siege tempo — Push still wins', () => {
    const heroes = [
      hero({ name: 'A' }),
      hero({ name: 'B' }),
      hero({ name: 'C' }),
      hero({ name: 'D' }),
      hero({ name: 'E' }),
    ];
    const breakdown = [
      axis('objectives', 75),
      axis('tempo', 80),
      axis('scaling', 40),
      axis('mobility', 40),
      axis('teamfight', 50),
    ];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('push');
  });

  it('does not call tempo when scaling is also high', () => {
    const heroes = [
      hero({ name: 'A' }),
      hero({ name: 'B' }),
      hero({ name: 'C' }),
      hero({ name: 'D' }),
      hero({ name: 'E' }),
    ];
    const breakdown = [
      axis('tempo', 80),
      axis('scaling', 60),
      axis('objectives', 50),
      axis('mobility', 40),
      axis('teamfight', 50),
    ];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('balance');
  });

  it('does not call tempo below the 70 gate', () => {
    const heroes = [
      hero({ name: 'A' }),
      hero({ name: 'B' }),
      hero({ name: 'C' }),
      hero({ name: 'D' }),
      hero({ name: 'E' }),
    ];
    const breakdown = [
      axis('tempo', 65),
      axis('scaling', 40),
      axis('objectives', 50),
      axis('mobility', 40),
      axis('teamfight', 50),
    ];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('balance');
  });

  it('returns deathball on high teamfight without mobility spike', () => {
    const heroes = [
      hero({ name: 'A' }),
      hero({ name: 'B' }),
      hero({ name: 'C' }),
      hero({ name: 'D' }),
      hero({ name: 'E' }),
    ];
    const breakdown = [
      axis('teamfight', 80),
      axis('durability', 60),
      axis('mobility', 40),
      axis('objectives', 50),
      axis('tempo', 55),
      axis('scaling', 55),
    ];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('deathball');
  });

  it('returns scaling when scaling is high and tempo is soft', () => {
    const heroes = [
      hero({ name: 'A' }),
      hero({ name: 'B' }),
      hero({ name: 'C' }),
      hero({ name: 'D' }),
      hero({ name: 'E' }),
    ];
    const breakdown = [
      axis('scaling', 80),
      axis('tempo', 40),
      axis('objectives', 50),
      axis('mobility', 40),
      axis('teamfight', 50),
    ];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('scaling');
  });

  it('defaults to balance when nothing spikes', () => {
    const heroes = [
      hero({ name: 'A' }),
      hero({ name: 'B' }),
      hero({ name: 'C' }),
      hero({ name: 'D' }),
      hero({ name: 'E' }),
    ];
    const breakdown = [
      axis('scaling', 50),
      axis('tempo', 50),
      axis('objectives', 50),
      axis('mobility', 50),
      axis('teamfight', 50),
    ];
    expect(classifyDraftArchetype(heroes, breakdown).id).toBe('balance');
  });
});
