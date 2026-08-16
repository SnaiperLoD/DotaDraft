// Run-scoped battle streak helpers. Outcomes should be chronological
// (oldest → newest) for `current*Streak`; History stores newest-first so
// reverse before calling, or use the NewestFirst variants.

export type FightOutcome = 'Win' | 'Lose';

export function runRecord(outcomes: FightOutcome[]): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const o of outcomes) {
    if (o === 'Win') wins++;
    else losses++;
  }
  return { wins, losses };
}

/** Consecutive wins ending at the latest fight (chrono ascending). */
export function currentWinStreak(outcomesOldestFirst: FightOutcome[]): number {
  let n = 0;
  for (let i = outcomesOldestFirst.length - 1; i >= 0; i--) {
    if (outcomesOldestFirst[i] === 'Win') n++;
    else break;
  }
  return n;
}

/** Consecutive losses ending at the latest fight (chrono ascending). */
export function currentLoseStreak(outcomesOldestFirst: FightOutcome[]): number {
  let n = 0;
  for (let i = outcomesOldestFirst.length - 1; i >= 0; i--) {
    if (outcomesOldestFirst[i] === 'Lose') n++;
    else break;
  }
  return n;
}

/** Longest win streak anywhere in the run (chrono ascending). */
export function bestWinStreak(outcomesOldestFirst: FightOutcome[]): number {
  let best = 0;
  let cur = 0;
  for (const o of outcomesOldestFirst) {
    if (o === 'Win') {
      cur++;
      if (cur > best) best = cur;
    } else {
      cur = 0;
    }
  }
  return best;
}

export function currentWinStreakNewestFirst(outcomesNewestFirst: FightOutcome[]): number {
  let n = 0;
  for (const o of outcomesNewestFirst) {
    if (o === 'Win') n++;
    else break;
  }
  return n;
}
