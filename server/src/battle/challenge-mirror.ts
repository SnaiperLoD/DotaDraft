import { sameHeroSet } from 'shared';
import type { ResolvedOutcome } from 'shared';

export function shouldCoinFlipChallenge(
  copiedDraft: string | null | undefined,
  mineIds: number[],
  opponentIds: number[],
): boolean {
  return Boolean(copiedDraft?.trim()) && sameHeroSet(mineIds, opponentIds);
}

export function flipCoin(rng: () => number): ResolvedOutcome {
  return rng() < 0.5 ? 'Win' : 'Lose';
}
