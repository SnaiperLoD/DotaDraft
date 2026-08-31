import { flipCoin, shouldCoinFlipChallenge } from './challenge-mirror';

describe('shouldCoinFlipChallenge', () => {
  const five = [1, 2, 3, 4, 5];

  it('is true only for a challenge paste against the same five heroes', () => {
    expect(shouldCoinFlipChallenge('dd1abcdefghijklm', five, [5, 4, 3, 2, 1])).toBe(true);
    expect(shouldCoinFlipChallenge('  dd1x  ', five, five)).toBe(true);
  });

  it('is false without a challenge paste, even if the hero sets match', () => {
    expect(shouldCoinFlipChallenge(null, five, five)).toBe(false);
    expect(shouldCoinFlipChallenge(undefined, five, five)).toBe(false);
    expect(shouldCoinFlipChallenge('', five, five)).toBe(false);
    expect(shouldCoinFlipChallenge('   ', five, five)).toBe(false);
  });

  it('is false when any hero differs', () => {
    expect(shouldCoinFlipChallenge('dd1abcdefghijklm', five, [1, 2, 3, 4, 6])).toBe(false);
    expect(shouldCoinFlipChallenge('dd1abcdefghijklm', five, [1, 2, 3, 4])).toBe(false);
    expect(shouldCoinFlipChallenge('dd1abcdefghijklm', [], [])).toBe(false);
  });
});

describe('flipCoin', () => {
  it('returns Win below 0.5 and Lose at or above', () => {
    expect(flipCoin(() => 0)).toBe('Win');
    expect(flipCoin(() => 0.499999)).toBe('Win');
    expect(flipCoin(() => 0.5)).toBe('Lose');
    expect(flipCoin(() => 0.9)).toBe('Lose');
  });
});
