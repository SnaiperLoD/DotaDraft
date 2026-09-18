import type { DraftHeroView, DraftStateView, Hero } from 'shared';

const NO_INFO = { no_info: true as const };

export function minimalHero(overrides: Partial<Hero> = {}): Hero {
  const id = overrides.id ?? 1;
  return {
    id,
    name: overrides.name ?? `Hero ${id}`,
    primary_attribute: 'str',
    attack_type: 'Melee',
    roles: [],
    tags: [],
    synergy_tags: [],
    counter_tags: [],
    evaluation_values: {} as Hero['evaluation_values'],
    evaluation_values_by_role: {
      Carry: NO_INFO,
      Mid: NO_INFO,
      Offlane: NO_INFO,
      Support: NO_INFO,
    },
    presumed_positions: [],
    ...overrides,
  };
}

export function draftHeroView(overrides: Partial<DraftHeroView> & { name?: string } = {}): DraftHeroView {
  const { name, ...rest } = overrides;
  const heroId = rest.heroId ?? rest.hero?.id ?? 1;
  const hero =
    rest.hero ??
    minimalHero({
      id: heroId,
      name: name ?? `Hero ${heroId}`,
    });
  return {
    assignedRole: null,
    pickOrder: heroId,
    ...rest,
    heroId,
    hero,
  };
}

export function draftState(overrides: Partial<DraftStateView> = {}): DraftStateView {
  return {
    id: 'draft-1',
    status: 'PICKING',
    mode: 'battle',
    heroes: [],
    pool: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    rerollsRemaining: 1,
    ...overrides,
  };
}

export function fivePoolHeroes(): Hero[] {
  return [1, 2, 3, 4, 5].map((id) => minimalHero({ id, name: `Hero ${id}` }));
}

export function fiveDraftHeroes(): DraftHeroView[] {
  return [1, 2, 3, 4, 5].map((id) => draftHeroView({ heroId: id, name: `Hero ${id}`, pickOrder: id }));
}
