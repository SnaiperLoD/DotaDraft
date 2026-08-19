import type { Hero, PresumedPosition } from 'shared';

export function heroPower(hero: Hero): number {
  const v = hero.evaluation_values;
  return (v.teamfight + v.tempo + v.scaling + v.burst + v.control + v.durability + v.initiating) / 7;
}

export function chooseAiBan(roster: Hero[], taken: Set<number>): number | null {
  const pool = roster.filter((h) => !taken.has(h.id)).sort((a, b) => heroPower(b) - heroPower(a));
  return pool[0]?.id ?? null;
}

export function chooseAiPick(roster: Hero[], taken: Set<number>, alreadyPicked: Hero[]): number | null {
  const filled = new Set(
    alreadyPicked
      .map((h) => h.presumed_positions[0]?.position)
      .filter((p): p is PresumedPosition => Boolean(p)),
  );
  const pool = roster.filter((h) => !taken.has(h.id));
  const roleFit = pool.filter((h) => {
    const top = h.presumed_positions[0]?.position;
    return top ? !filled.has(top) : false;
  });
  const ranked = (roleFit.length > 0 ? roleFit : pool).sort((a, b) => heroPower(b) - heroPower(a));
  return ranked[0]?.id ?? null;
}
