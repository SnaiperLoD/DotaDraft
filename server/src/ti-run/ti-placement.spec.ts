import { deriveTiPlacement, linkSeries, tiBracketById, type TiPathFight, type TiSeries } from 'shared';

const s = (
  id: string,
  round: string,
  bracket: TiSeries['bracket'],
  teamA: string,
  teamB: string,
  winner: string,
): TiSeries => ({ id, round, bracket, teamA, teamB, winner });

const fight = (matchId: string, round: string, outcome: TiPathFight['outcome']): TiPathFight => ({
  matchId,
  round,
  opponent: 'Opp',
  outcome,
  advantageDirection: 'A',
});

describe('deriveTiPlacement', () => {
  const toy = linkSeries([
    s('ub_qf', 'UB QF', 'upper', 'Spirit', 'Liquid', 'Spirit'),
    s('lb_r1', 'LB R1', 'lower', 'Liquid', 'OG', 'Liquid'),
    s('ub_f', 'UB Final', 'upper', 'Spirit', 'Falcons', 'Falcons'),
    s('lb_f', 'LB Final', 'lower', 'Spirit', 'Liquid', 'Spirit'),
    s('gf', 'Grand Final', 'grand', 'Falcons', 'Spirit', 'Spirit'),
  ]);

  it('crowns a CHAMPION status even if the last path fight is a prior loss', () => {
    expect(
      deriveTiPlacement({
        status: 'CHAMPION',
        path: [fight('gf', 'Grand Final', 'Win')],
        matches: toy,
      }).kind,
    ).toBe('champion');
  });

  it('keeps in-progress runs as playing', () => {
    expect(
      deriveTiPlacement({
        status: 'PLAYING',
        path: [fight('ub_qf', 'UB QF', 'Win')],
        matches: toy,
      }).kind,
    ).toBe('playing');
  });

  it('maps a Grand Final loss to 2nd', () => {
    expect(
      deriveTiPlacement({
        status: 'ELIMINATED',
        path: [fight('gf', 'Grand Final', 'Lose')],
        matches: toy,
      }),
    ).toEqual({ kind: 'second', lastRound: 'Grand Final' });
  });

  it('maps a unique Lower Final loss to 3rd', () => {
    expect(
      deriveTiPlacement({
        status: 'ELIMINATED',
        path: [fight('lb_f', 'LB Final', 'Lose')],
        matches: toy,
      }),
    ).toEqual({ kind: 'third', lastRound: 'LB Final' });
  });

  it('maps a unique hop-2 lower death to 4th', () => {
    expect(
      deriveTiPlacement({
        status: 'ELIMINATED',
        path: [fight('lb_r1', 'LB R1', 'Lose')],
        matches: toy,
      }),
    ).toEqual({ kind: 'fourth', lastRound: 'LB R1' });
  });

  it('falls back to the dying round name when the graph is missing', () => {
    expect(
      deriveTiPlacement({
        status: 'ELIMINATED',
        path: [fight('lb_r3_1', 'Lower Bracket Round 3', 'Lose')],
        matches: [],
      }),
    ).toEqual({ kind: 'round', lastRound: 'Lower Bracket Round 3' });
  });
});

describe('deriveTiPlacement against TI 2021 occupy-slot graph', () => {
  const matches = tiBracketById('ti-2021')!.matches;

  it('treats LB Round 5 as 4th (one match, two hops to GF)', () => {
    expect(
      deriveTiPlacement({
        status: 'ELIMINATED',
        path: [fight('lb_r5', 'Lower Bracket Round 5', 'Lose')],
        matches,
      }).kind,
    ).toBe('fourth');
  });

  it('treats a two-match hop-3 death as Top 8, not a fake 5th', () => {
    expect(
      deriveTiPlacement({
        status: 'ELIMINATED',
        path: [fight('lb_r4_1', 'Lower Bracket Round 4', 'Lose')],
        matches,
      }).kind,
    ).toBe('top8');
  });

  it('labels an early lower-bracket death by round', () => {
    expect(
      deriveTiPlacement({
        status: 'ELIMINATED',
        path: [fight('lb_r1_1', 'Lower Bracket Round 1', 'Lose')],
        matches,
      }),
    ).toEqual({ kind: 'round', lastRound: 'Lower Bracket Round 1' });
  });
});
