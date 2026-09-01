import type { Hero, PresumedPosition } from 'shared';

export interface CaptainsMatchupLookup {
  getMatchupWinRate(heroId: number, opponentHeroId: number): number | null;
}

export interface CmAiContext {
  ownPicks: Hero[];
  opponentPicks: Hero[];
  lookup?: CaptainsMatchupLookup | null;
}

const EMPTY_CTX: CmAiContext = { ownPicks: [], opponentPicks: [] };

const ROLE_SLOTS: PresumedPosition[] = ['Carry', 'Mid', 'Offlane', 'Support', 'Support'];

/** Style tags that a counter_tag is written against (Blueprint/09). */
const COUNTER_TO_STYLE: Record<string, string[]> = {
  counters_illusions: ['illusion_based'],
  counters_summons: ['summon_based'],
};

const MATCHUP_FLOOR = 0.55;
const MATCHUP_WEIGHT = 50;
const TAG_HIT = 5;
const COUNTER_LOCK = 8;
const ROLE_FILL = 6;
const ROLE_OFF = -5;
const STARVE = 8;
const STARVE_MISS = -5;
const POWER_PICK = 0.2;

export function heroPower(hero: Hero): number {
  const v = hero.evaluation_values;
  return (v.teamfight + v.tempo + v.scaling + v.burst + v.control + v.durability + v.initiating) / 7;
}

export function primaryRole(hero: Hero): PresumedPosition | null {
  const ranked = [...(hero.presumed_positions ?? [])].sort((a, b) => b.share - a.share);
  return ranked[0]?.position ?? null;
}

export function remainingRoleSlots(picks: Hero[]): PresumedPosition[] {
  const left = [...ROLE_SLOTS];
  for (const hero of picks) {
    const ranked = [...(hero.presumed_positions ?? [])].sort((a, b) => b.share - a.share);
    const fit = ranked.find((entry) => {
      const filled = left.filter((role) => role === entry.position).length;
      return filled > 0;
    });
    if (!fit) continue;
    const idx = left.indexOf(fit.position);
    if (idx >= 0) left.splice(idx, 1);
  }
  return left;
}

export function tagCounterHits(candidate: Hero, opponents: Hero[]): number {
  let hits = 0;
  for (const tag of candidate.counter_tags) {
    const styles = COUNTER_TO_STYLE[tag];
    if (!styles) continue;
    if (opponents.some((opp) => opp.tags.some((t) => styles.includes(t)))) hits += 1;
  }
  return hits;
}

export function bestMatchupEdge(
  candidate: Hero,
  opponents: Hero[],
  lookup?: CaptainsMatchupLookup | null,
): number {
  if (!lookup || opponents.length === 0) return 0;
  let best = 0;
  for (const opp of opponents) {
    const wr = lookup.getMatchupWinRate(candidate.id, opp.id);
    if (wr == null || wr < MATCHUP_FLOOR) continue;
    best = Math.max(best, wr - 0.5);
  }
  return best;
}

function available(roster: Hero[], taken: Set<number>): Hero[] {
  return roster.filter((h) => !taken.has(h.id));
}

function pickBest(pool: Hero[], scoreOf: (hero: Hero) => number): number | null {
  if (pool.length === 0) return null;
  const ranked = [...pool].sort((a, b) => {
    const diff = scoreOf(b) - scoreOf(a);
    if (diff !== 0) return diff;
    return a.id - b.id;
  });
  return ranked[0]?.id ?? null;
}

export function chooseAiBan(roster: Hero[], taken: Set<number>, ctx: CmAiContext = EMPTY_CTX): number | null {
  const pool = available(roster, taken);
  const remaining = remainingRoleSlots(ctx.opponentPicks);
  const starve = ctx.opponentPicks.length > 0 && remaining.length > 0;
  return pickBest(pool, (hero) => {
    let score = heroPower(hero);
    if (!starve) return score;
    const role = primaryRole(hero);
    if (role && remaining.includes(role)) score += STARVE;
    else score += STARVE_MISS;
    return score;
  });
}

export function chooseAiPick(
  roster: Hero[],
  taken: Set<number>,
  ctx: CmAiContext = EMPTY_CTX,
): number | null {
  const pool = available(roster, taken);
  const remaining = remainingRoleSlots(ctx.ownPicks);
  return pickBest(pool, (hero) => {
    const role = primaryRole(hero);
    const roleScore = role && remaining.includes(role) ? ROLE_FILL : ROLE_OFF;
    const edge = bestMatchupEdge(hero, ctx.opponentPicks, ctx.lookup);
    const tags = tagCounterHits(hero, ctx.opponentPicks);
    const lock = edge > 0 || tags > 0 ? COUNTER_LOCK : 0;
    return roleScore + edge * MATCHUP_WEIGHT + tags * TAG_HIT + lock + heroPower(hero) * POWER_PICK;
  });
}
