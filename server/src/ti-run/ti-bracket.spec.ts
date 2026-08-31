import {
  advanceBracket,
  linkSeries,
  openingMatch,
  otherTeam,
  projectLiveBracket,
  type TiPathFight,
  type TiSeries,
} from 'shared';

const s = (
  id: string,
  round: string,
  bracket: TiSeries['bracket'],
  teamA: string,
  teamB: string,
  winner: string,
): TiSeries => ({ id, round, bracket, teamA, teamB, winner });

describe('occupy-slot double-elim', () => {
  const matches = linkSeries([
    s('ub_qf', 'UB QF', 'upper', 'Spirit', 'Liquid', 'Spirit'),
    s('lb_r1', 'LB R1', 'lower', 'Liquid', 'OG', 'Liquid'),
    s('ub_f', 'UB Final', 'upper', 'Spirit', 'Falcons', 'Falcons'),
    s('lb_f', 'LB Final', 'lower', 'Spirit', 'Liquid', 'Spirit'),
    s('gf', 'Grand Final', 'grand', 'Falcons', 'Spirit', 'Spirit'),
  ]);

  it('sends an upper-bracket loss into the historical loser path', () => {
    const opening = openingMatch(matches, 'Spirit');
    expect(otherTeam(opening, 'Spirit')).toBe('Liquid');
    const drop = advanceBracket(matches, opening.id, false);
    expect(drop.nextMatchId).toBe('lb_r1');
    expect(drop.opponent).toBe('OG');
    expect(drop.eliminated).toBe(false);
  });

  it('advances a win along the historical winner path and crowns GF', () => {
    const winUb = advanceBracket(matches, 'ub_qf', true);
    expect(winUb.nextMatchId).toBe('ub_f');
    expect(winUb.opponent).toBe('Falcons');
    const gfWin = advanceBracket(matches, 'gf', true);
    expect(gfWin.champion).toBe(true);
    const gfLoss = advanceBracket(matches, 'gf', false);
    expect(gfLoss.eliminated).toBe(true);
  });

  it('eliminates when a loss has no next loser slot', () => {
    const lone = linkSeries([s('lb_only', 'LB R1', 'lower', 'A', 'B', 'A')]);
    const drop = advanceBracket(lone, 'lb_only', false);
    expect(drop.eliminated).toBe(true);
    expect(drop.nextMatchId).toBeNull();
    expect(drop.champion).toBe(false);
  });

  it('throws on an unknown match id', () => {
    expect(() => advanceBracket(matches, 'nope', true)).toThrow('Unknown match nope');
  });
});

describe('projectLiveBracket', () => {
  const template = linkSeries([
    s('ub_qf', 'UB QF', 'upper', 'Spirit', 'Liquid', 'Spirit'),
    s('lb_r1', 'LB R1', 'lower', 'Liquid', 'OG', 'Liquid'),
    s('ub_f', 'UB Final', 'upper', 'Spirit', 'Falcons', 'Falcons'),
    s('lb_f', 'LB Final', 'lower', 'Spirit', 'Liquid', 'Spirit'),
    s('gf', 'Grand Final', 'grand', 'Falcons', 'Spirit', 'Spirit'),
  ]);

  const fight = (matchId: string, opponent: string, outcome: TiPathFight['outcome']): TiPathFight => ({
    matchId,
    round: matchId,
    opponent,
    outcome,
    advantageDirection: 'A',
    confidenceTier: 'Moderate',
  });

  const byId = (rows: ReturnType<typeof projectLiveBracket>, id: string) => rows.find((m) => m.id === id)!;

  it('keeps the slot graph but blanks historical results before any fight', () => {
    const live = projectLiveBracket(template, {
      playerTeam: 'Spirit',
      path: [],
      currentMatchId: 'ub_qf',
    });
    expect(byId(live, 'ub_qf')).toMatchObject({ teamA: 'Spirit', teamB: 'Liquid', winner: '' });
    expect(byId(live, 'ub_f')).toMatchObject({ teamA: '', teamB: '', winner: '' });
    expect(byId(live, 'gf')).toMatchObject({ teamA: '', teamB: '', winner: '' });
    expect(template.find((m) => m.id === 'gf')?.winner).toBe('Spirit');
    expect(byId(live, 'ub_qf').nextWin).toBe('ub_f');
  });

  it('paints the user path after an upper-bracket win and leaves the rest TBD', () => {
    const live = projectLiveBracket(template, {
      playerTeam: 'Spirit',
      path: [fight('ub_qf', 'Liquid', 'Win')],
      currentMatchId: 'ub_f',
    });
    expect(byId(live, 'ub_qf')).toMatchObject({ teamA: 'Spirit', teamB: 'Liquid', winner: 'Spirit' });
    expect(byId(live, 'ub_f')).toMatchObject({ teamA: 'Spirit', teamB: 'Falcons', winner: '' });
    expect(byId(live, 'lb_r1').teamA).toBe('');
    expect(byId(live, 'gf').winner).toBe('');
  });

  it('drops the user into the historical loser slot after a loss', () => {
    const live = projectLiveBracket(template, {
      playerTeam: 'Spirit',
      path: [fight('ub_qf', 'Liquid', 'Lose')],
      currentMatchId: 'lb_r1',
    });
    expect(byId(live, 'ub_qf').winner).toBe('Liquid');
    expect(byId(live, 'lb_r1')).toMatchObject({ teamA: 'Spirit', teamB: 'OG', winner: '' });
    expect(byId(live, 'ub_f').teamA).toBe('');
  });

  it('shows the player as GF champion without filling unused slots', () => {
    const live = projectLiveBracket(template, {
      playerTeam: 'Spirit',
      path: [
        fight('ub_qf', 'Liquid', 'Lose'),
        fight('lb_r1', 'OG', 'Win'),
        fight('lb_f', 'Spirit', 'Win'),
        fight('gf', 'Falcons', 'Win'),
      ],
      currentMatchId: null,
    });
    expect(byId(live, 'gf')).toMatchObject({ teamA: 'Falcons', teamB: 'Spirit', winner: 'Spirit' });
    expect(byId(live, 'ub_f')).toMatchObject({ teamA: '', teamB: '', winner: '' });
  });

  it('marks GF elim when the user loses the final', () => {
    const live = projectLiveBracket(template, {
      playerTeam: 'Spirit',
      path: [fight('gf', 'Falcons', 'Lose')],
      currentMatchId: null,
    });
    expect(byId(live, 'gf').winner).toBe('Falcons');
    expect(byId(live, 'gf').teamB).toBe('Spirit');
  });
});
