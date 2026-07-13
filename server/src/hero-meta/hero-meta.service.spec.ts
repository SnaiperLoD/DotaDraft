import * as fs from 'fs';
import { HeroMetaService } from './hero-meta.service';

jest.mock('fs');

function mockHeroMeta(heroes: unknown[]) {
  (fs.existsSync as jest.Mock).mockReturnValue(true);
  (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ heroes }));
}

describe('HeroMetaService', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns null for every lookup when hero-meta.json is missing', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const service = new HeroMetaService();
    expect(service.getWinRate(1)).toBeNull();
    expect(service.getSynergyWinRate(1, 2)).toBeNull();
    expect(service.getMatchupWinRate(1, 2)).toBeNull();
  });

  it('returns winRate directly for a known hero', () => {
    mockHeroMeta([{ heroId: 1, winRate: 0.52, synergy: [], matchups: [] }]);
    const service = new HeroMetaService();
    expect(service.getWinRate(1)).toBe(0.52);
    expect(service.getWinRate(999)).toBeNull();
  });

  it('requires at least MIN_GAMES samples before trusting a synergy/matchup win rate', () => {
    mockHeroMeta([
      {
        heroId: 1,
        winRate: 0.5,
        synergy: [
          { allyHeroId: 2, games: 9, wins: 8 }, // below threshold
          { allyHeroId: 3, games: 10, wins: 6 }, // at threshold
        ],
        matchups: [{ opponentHeroId: 4, games: 5, wins: 4 }],
      },
    ]);
    const service = new HeroMetaService();
    expect(service.getSynergyWinRate(1, 2)).toBeNull();
    expect(service.getSynergyWinRate(1, 3)).toBe(0.6);
    expect(service.getMatchupWinRate(1, 4)).toBeNull();
  });
});
