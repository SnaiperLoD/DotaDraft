import type { Hero, HeroEvaluationValues } from 'shared';

export const DEFAULT_EVALUATION_VALUES: HeroEvaluationValues = {
  teamfight: 3,
  tempo: 3,
  scaling: 3,
  mobility: 3,
  objectives: 3,
  control: 3,
  durability: 3,
  burst: 3,
  map_control: 3,
};

// Shared Hero builder for tests — every field defaults to an inert value
// (empty tags, flat 3s on every axis) so a test only has to specify the
// fields it actually cares about.
export function makeHero(overrides: Partial<Hero> & { id: number; name: string }): Hero {
  return {
    primary_attribute: 'strength',
    attack_type: 'Melee',
    roles: [],
    tags: [],
    synergy_tags: [],
    counter_tags: [],
    evaluation_values: { ...DEFAULT_EVALUATION_VALUES },
    presumed_positions: [],
    ...overrides,
  };
}
