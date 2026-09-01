import {
  isInternationalLeague,
  parsePooledProMatchId,
  pooledProIdsForOpenDotaMatch,
  pooledProLoseId,
  pooledProWinId,
} from './pooled-pro-id';

describe('pooled-pro-id', () => {
  it('detects TI league names and ignores other internationals', () => {
    expect(isInternationalLeague('The International 2022')).toBe(true);
    expect(isInternationalLeague('the international 2021')).toBe(true);
    expect(isInternationalLeague('ESL One Birmingham')).toBe(false);
    expect(isInternationalLeague(null)).toBe(false);
  });

  it('parses winner and loser pool ids back to the OpenDota match id', () => {
    expect(pooledProWinId('6813943972')).toBe('pro-6813943972');
    expect(pooledProLoseId('6813943972')).toBe('pro-6813943972-lose');
    expect(parsePooledProMatchId('pro-6813943972')).toBe('6813943972');
    expect(parsePooledProMatchId('pro-6813943972-lose')).toBe('6813943972');
    expect(parsePooledProMatchId('player-1')).toBeNull();
    expect(pooledProIdsForOpenDotaMatch('1')).toEqual(['pro-1', 'pro-1-lose']);
  });
});
