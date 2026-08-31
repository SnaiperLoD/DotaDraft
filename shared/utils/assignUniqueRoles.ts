import { ROLES, type DraftRole } from '../constants/roles';
import type { Hero } from '../types/hero';
import type { PooledHeroRole } from '../types/opponent-pool';
import { bestGuessPosition } from './heroPosition';

function preferredRoles(hero: Hero): DraftRole[] {
  const position = bestGuessPosition(hero);
  if (position === 'Support') return ['Soft Support', 'Hard Support'];
  return [position];
}

// Greedy unique 1–5 for a five-hero lineup. Preferred presumed position
// first; leftover heroes take whatever DraftRole is still free. Used for
// Captains AI (no RoleAssignment UI) and not for the player's own draft.
export function assignUniqueRoles(heroes: Hero[]): PooledHeroRole[] {
  if (heroes.length !== 5) {
    throw new Error('assignUniqueRoles needs 5 heroes');
  }
  const used = new Set<DraftRole>();
  const assigned = new Map<number, DraftRole>();
  for (const hero of heroes) {
    const free = preferredRoles(hero).find((role) => !used.has(role));
    if (!free) continue;
    used.add(free);
    assigned.set(hero.id, free);
  }
  for (const hero of heroes) {
    if (assigned.has(hero.id)) continue;
    const free = ROLES.find((role) => !used.has(role));
    if (!free) break;
    used.add(free);
    assigned.set(hero.id, free);
  }
  return heroes.map((hero) => ({ heroId: hero.id, role: assigned.get(hero.id)! }));
}
