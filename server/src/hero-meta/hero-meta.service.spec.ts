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

  it('returns null only when there is no entry at all (games=0 sentinel included)', () => {
    mockHeroMeta([
      {
        heroId: 1,
        winRate: 0.5,
        synergy: [{ allyHeroId: 2, games: 0, wins: 0 }],
        matchups: [],
      },
    ]);
    const service = new HeroMetaService();
    expect(service.getSynergyWinRate(1, 2)).toBeNull();
    expect(service.getSynergyWinRate(1, 999)).toBeNull();
    expect(service.getMatchupWinRate(1, 999)).toBeNull();
  });

  it('shrinks the raw win rate toward 0.5 proportional to sample size (K from battle-diff-inputs.json), instead of a hard cutoff', () => {
    const actualFs = jest.requireActual<typeof fs>('fs');
    const { shrinkageK: K } = JSON.parse(
      actualFs.readFileSync(
        require('path').join(__dirname, '..', '..', 'data', 'battle-diff-inputs.json'),
        'utf-8',
      ),
    ) as { shrinkageK: number };
    mockHeroMeta([
      {
        heroId: 1,
        winRate: 0.5,
        synergy: [
          { allyHeroId: 2, games: 9, wins: 8 }, // thin sample, raw wr=0.889
          { allyHeroId: 3, games: 10, wins: 6 }, // raw wr=0.6
        ],
        matchups: [{ opponentHeroId: 4, games: 5, wins: 4 }], // raw wr=0.8
      },
    ]);
    const service = new HeroMetaService();
    // weight = games/(games+K); shrunk = weight*rawWr + (1-weight)*0.5
    expect(service.getSynergyWinRate(1, 2)).toBeCloseTo((9 / (9 + K)) * (8 / 9) + (K / (9 + K)) * 0.5, 5);
    expect(service.getSynergyWinRate(1, 3)).toBeCloseTo((10 / (10 + K)) * 0.6 + (K / (10 + K)) * 0.5, 5);
    expect(service.getMatchupWinRate(1, 4)).toBeCloseTo((5 / (5 + K)) * 0.8 + (K / (5 + K)) * 0.5, 5);
    // thinner sample (9 games) shrinks harder toward 0.5 than a thicker one (10 games) with a more extreme raw rate
    expect(Math.abs(service.getSynergyWinRate(1, 2)! - 0.5)).toBeGreaterThan(
      Math.abs(service.getSynergyWinRate(1, 3)! - 0.5),
    );
  });
});
