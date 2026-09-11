import { isTiFinalsOpponent } from 'shared';

describe('isTiFinalsOpponent', () => {
  it('marks a known TI grand-finals match', () => {
    expect(isTiFinalsOpponent({ source: 'pro', matchId: '4080856812' })).toBe(true);
  });

  it('does not treat a TI playoff that is not the last series as a final', () => {
    // TI 2024 lower-bracket final (Gaimin Gladiators vs Tundra), not the GF.
    expect(isTiFinalsOpponent({ source: 'pro', matchId: '7943810234' })).toBe(false);
  });

  it('marks TI 2026 grand-finals games from the last Spirit–VISION series', () => {
    expect(isTiFinalsOpponent({ source: 'pro', matchId: '8960991322' })).toBe(true);
    expect(isTiFinalsOpponent({ source: 'pro', matchId: '8960577698' })).toBe(true);
  });

  it('does not treat a TI 2026 group-stage match as a final', () => {
    expect(isTiFinalsOpponent({ source: 'pro', matchId: '8947050343' })).toBe(false);
  });

  it('does not treat a TI regional qualifier match as a final', () => {
    expect(isTiFinalsOpponent({ source: 'pro', matchId: '8867047967' })).toBe(false);
  });

  it('does not infer finals from a missing matchId even on a pro opponent', () => {
    expect(isTiFinalsOpponent({ source: 'pro', matchId: null })).toBe(false);
  });

  it('ignores player-sourced drafts even if matchId collides', () => {
    expect(isTiFinalsOpponent({ source: 'player', matchId: '4080856812' })).toBe(false);
  });

  it('returns false for missing opponent or matchId', () => {
    expect(isTiFinalsOpponent(null)).toBe(false);
    expect(isTiFinalsOpponent({ source: 'pro', matchId: null })).toBe(false);
    expect(isTiFinalsOpponent({ source: 'pro', matchId: '' })).toBe(false);
  });
});
