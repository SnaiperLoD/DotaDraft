import type { Hero, PresumedPosition } from '../types/hero';

// Best-guess single Carry/Mid/Offlane/Support bucket for a hero, for
// features that need one answer (e.g. aligning an opponent's draft against
// the user's role slots in Battle Mode) rather than the full weighted
// presumed_positions list. Falls back to official OpenDota roles when a
// hero has no significant sampled position (thin data) — same fallback
// shape as client/src/utils/heroRoleColor.ts uses for portrait tinting,
// kept separate since that one also needs a "Universal" blend case this
// doesn't.
export function bestGuessPosition(hero: Hero): PresumedPosition {
  if (hero.presumed_positions.length > 0) {
    const top = [...hero.presumed_positions].sort((a, b) => b.share - a.share)[0];
    return top.position;
  }

  const hasSupport = hero.roles.includes('Support');
  const hasCarry = hero.roles.includes('Carry');
  const hasOfflaneSignal = hero.roles.includes('Initiator') || hero.roles.includes('Durable');

  if (hasSupport) return 'Support';
  if (hasCarry) return 'Carry';
  if (hasOfflaneSignal) return 'Offlane';
  return 'Mid';
}
