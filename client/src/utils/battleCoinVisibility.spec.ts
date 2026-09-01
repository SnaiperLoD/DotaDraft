import { describe, expect, it } from 'vitest';
import { battleCoinVisibility } from './battleCoinVisibility';

describe('battleCoinVisibility', () => {
  it('hides standard result while coin flip is active', () => {
    expect(
      battleCoinVisibility({
        result: { coinFlip: true },
        loading: false,
        revealing: false,
        coinPhase: 'spin',
      }),
    ).toMatchObject({ showStandardResult: false, showCoin: true, showCoinFaceoff: false });
  });

  it('shows standard result when battle math resolved normally', () => {
    expect(
      battleCoinVisibility({
        result: { coinFlip: false },
        loading: false,
        revealing: false,
        coinPhase: null,
      }),
    ).toMatchObject({ showStandardResult: true, showCoin: false, showCoinFaceoff: false });
  });

  it('keeps standard result hidden while loading or revealing', () => {
    expect(
      battleCoinVisibility({
        result: { coinFlip: false },
        loading: true,
        revealing: false,
        coinPhase: null,
      }).showStandardResult,
    ).toBe(false);
  });
});
