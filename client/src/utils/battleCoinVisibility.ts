export type CoinPhase = 'faceoff' | 'spin' | 'done' | null;

export function battleCoinVisibility(input: {
  result: { coinFlip?: boolean } | null;
  loading: boolean;
  revealing: boolean;
  coinPhase: CoinPhase;
}): {
  showCoinFaceoff: boolean;
  showCoin: boolean;
  showStandardResult: boolean;
} {
  const { result, loading, revealing, coinPhase } = input;
  return {
    showCoinFaceoff: Boolean(result?.coinFlip && coinPhase === 'faceoff'),
    showCoin: Boolean(result?.coinFlip && (coinPhase === 'spin' || coinPhase === 'done')),
    showStandardResult: Boolean(result && !loading && !revealing && !result.coinFlip),
  };
}
