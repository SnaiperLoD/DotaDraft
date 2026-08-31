import { advanceBracket, linkSeries, openingMatch, otherTeam } from 'shared';
import type { TiSeries } from 'shared';

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
