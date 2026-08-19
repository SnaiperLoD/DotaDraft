import { sanitizeProPlayerName, opponentTeamCaption } from 'shared';

describe('sanitizeProPlayerName', () => {
  it('keeps short latin handles', () => {
    expect(sanitizeProPlayerName('gh')).toBe('gh');
    expect(sanitizeProPlayerName('Yatoro')).toBe('Yatoro');
    expect(sanitizeProPlayerName('CHIRA_JUNIOR')).toBe('CHIRA_JUNIOR');
  });

  it('drops Steam graffiti and CJK nicks', () => {
    expect(sanitizeProPlayerName('road to dream (9k)')).toBeNull();
    expect(sanitizeProPlayerName('别浪费我的时间。')).toBeNull();
    expect(sanitizeProPlayerName('I m Going To Be 10k Player')).toBeNull();
    expect(sanitizeProPlayerName('; ]')).toBeNull();
  });

  it('falls team caption back to league when team name is missing', () => {
    expect(opponentTeamCaption(null, 'The International 2026')).toEqual({
      teamName: 'The International 2026',
      leagueName: null,
    });
    expect(opponentTeamCaption('Team Spirit', 'The International 2026')).toEqual({
      teamName: 'Team Spirit',
      leagueName: 'The International 2026',
    });
  });
});
