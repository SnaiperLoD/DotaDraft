import { ROLES, bestGuessPosition, type DraftRole, type Hero, type PresumedPosition } from 'shared';

const ROLE_TO_BROAD_POSITION: Record<DraftRole, PresumedPosition> = {
  Carry: 'Carry',
  Mid: 'Mid',
  Offlane: 'Offlane',
  'Soft Support': 'Support',
  'Hard Support': 'Support',
};

// Orders the opponent's 5 heroes to line up against the user's role slots
// (Carry/Mid/Offlane/Soft Support/Hard Support, in that fixed order) for a
// side-by-side Battle Mode display — purely presentational, has no effect
// on resolveBattle's outcome. Greedy: each slot claims the first unclaimed
// opponent hero whose best-guess position matches; anything left over
// (ties, gaps) fills remaining slots in original order rather than being
// dropped.
export function alignOpponentToRoles(opponentHeroes: Hero[]): Hero[] {
  const remaining = [...opponentHeroes];
  const aligned: (Hero | null)[] = ROLES.map((role) => {
    const targetPosition = ROLE_TO_BROAD_POSITION[role];
    const index = remaining.findIndex((h) => bestGuessPosition(h) === targetPosition);
    if (index === -1) return null;
    return remaining.splice(index, 1)[0];
  });

  return aligned.map((hero) => hero ?? remaining.shift()!);
}
