import {
  sanitizeProPlayerName,
  displayProPlayerName,
  opponentTeamCaption,
  resolveOfficialPlayerName,
} from 'shared';

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

describe('resolveOfficialPlayerName', () => {
  const pro = new Map<number, string>([
    [87278757, 'Puppey'],
    [183719386, 'Yatoro'],
  ]);

  it('wins with the curated proPlayers handle over Steam graffiti', () => {
    expect(
      resolveOfficialPlayerName(
        { account_id: 183719386, name: null, personaname: 'road to dream (9k)' },
        pro,
      ),
    ).toBe('Yatoro');
  });

  it('uses the match verified name when the account is not on the pro list', () => {
    expect(resolveOfficialPlayerName({ account_id: 1, name: 'gh', personaname: 'trash nick' }, pro)).toBe(
      'gh',
    );
  });

  it('drops Steam graffiti when that is the only string available', () => {
    expect(
      resolveOfficialPlayerName({ account_id: 1, name: null, personaname: 'road to dream (9k)' }, pro),
    ).toBeNull();
  });
});

describe('displayProPlayerName', () => {
  it('keeps mixed CJK+latin official handles the graffiti filter would hide', () => {
    expect(displayProPlayerName('医者watson`')).toBe('医者watson`');
    expect(displayProPlayerName('天鸽')).toBe('天鸽');
    expect(displayProPlayerName('Yatoro')).toBe('Yatoro');
  });

  it('still hides Steam graffiti and CJK sentences', () => {
    expect(displayProPlayerName('road to dream (9k)')).toBeNull();
    expect(displayProPlayerName('别浪费我的时间。')).toBeNull();
  });
});
