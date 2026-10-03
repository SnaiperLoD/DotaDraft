import {
  WEEK_SECONDS,
  buildProposedHeroMeta,
  cleanPairs,
  cleanRate,
  diffSummary,
  expectedMatchup,
  expectedSynergy,
  heroTotalsFromStats,
  latestCompleteWeek,
  mergeParts,
  mirrorAverage,
  pairCoverage,
  parseWeekArg,
  sharePrecheck,
  stratzWeekStart,
  sumPairs,
  type HeroMetaFile,
  type PairRaw,
} from './stratz-refresh';

describe('stratz-refresh weeks', () => {
  it('normalises to the STRATZ (Unix, Thursday-start) week', () => {
    // Mon 2026-09-14 lies in the bucket that starts Thu 2026-09-10 (week index 2958)
    expect(stratzWeekStart(1789344000)).toBe(2958 * WEEK_SECONDS);
    expect(new Date(stratzWeekStart(1789344000) * 1000).toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(parseWeekArg('2026-09-14')).toBe(1788998400);
    expect(parseWeekArg('1789344000')).toBe(1788998400);
    expect(() => parseWeekArg('last week')).toThrow();
  });

  it('latest complete week is the bucket before the current one', () => {
    const now = Date.parse('2026-10-03T12:00:00Z'); // Saturday; current bucket starts Thu 10-01
    expect(new Date(latestCompleteWeek(now) * 1000).toISOString().slice(0, 10)).toBe('2026-09-24');
  });
});

describe('stratz-refresh hero totals', () => {
  it('sums time=0 rows over positions and brackets, ignores other times', () => {
    const t = heroTotalsFromStats([
      [
        { heroId: 1, time: 0, matchCount: 100, winCount: 50 },
        { heroId: 1, time: 0, matchCount: 20, winCount: 15 },
        { heroId: 1, time: 10, matchCount: 999, winCount: 999 },
      ],
      [{ heroId: 1, time: 0, matchCount: 80, winCount: 35 }],
    ]);
    expect(t.get(1)).toEqual({ g: 200, w: 100 });
  });
});

const raw = (
  heroId: number,
  vs: [number, number, number][],
  withs: [number, number, number][] = [],
): PairRaw => ({
  heroId,
  advantage: {
    vs: vs.map(([heroId2, matchCount, winCount]) => ({ heroId2, matchCount, winCount })),
    with: withs.map(([heroId2, matchCount, winCount]) => ({ heroId2, matchCount, winCount })),
  },
});

describe('stratz-refresh pairs', () => {
  it('sums brackets and mirror-averages matchups and synergy', () => {
    const summed = sumPairs([
      raw(1, [[2, 100, 60]], [[2, 50, 30]]),
      raw(1, [[2, 100, 60]], []), // second bracket
      raw(2, [[1, 220, 92]], [[1, 54, 34]]),
    ]);
    expect(summed.vs.get('1-2')).toEqual({ g: 200, w: 120 });
    const avg = mirrorAverage(summed);
    // 1 vs 2: mean of (200, 120) and flipped (220, 220 − 92 = 128)
    expect(avg.vs.get('1-2')).toEqual({ g: 210, w: 124 });
    expect(avg.vs.get('2-1')).toEqual({ g: 210, w: 86 });
    expect(avg.with.get('1-2')).toEqual({ g: 52, w: 32 });
    expect(avg.with.get('2-1')).toEqual({ g: 52, w: 32 });
  });

  it('missing mirror falls back to the row itself', () => {
    const avg = mirrorAverage(sumPairs([raw(1, [[2, 100, 70]], [[3, 10, 4]])]));
    expect(avg.vs.get('1-2')).toEqual({ g: 100, w: 70 });
    expect(avg.with.get('1-3')).toEqual({ g: 10, w: 4 });
  });

  it('share pre-check passes on consistent mirrors and fails on same-side (opponent) orientation', () => {
    const consistent = sumPairs([
      raw(1, [
        [2, 1000, 550],
        [3, 1000, 450],
      ]),
      raw(2, [
        [1, 1000, 450],
        [3, 1000, 520],
      ]),
      raw(3, [
        [1, 1000, 550],
        [2, 1000, 480],
      ]),
    ]);
    const ok = sharePrecheck(consistent.vs);
    expect(ok.pass).toBe(true);
    expect(ok.meanDeviationPp).toBeCloseTo(0);
    const flipped = sumPairs([
      raw(1, [
        [2, 1000, 550],
        [3, 1000, 450],
      ]),
      raw(2, [
        [1, 1000, 550],
        [3, 1000, 520],
      ]),
      raw(3, [
        [1, 1000, 450],
        [2, 1000, 520],
      ]),
    ]);
    expect(sharePrecheck(flipped.vs).pass).toBe(false);
    expect(sharePrecheck(new Map()).pass).toBe(false);
  });

  it('coverage counts unordered pairs with both with and vs samples', () => {
    const set = sumPairs([raw(1, [[2, 10, 5]], [[2, 10, 5]]), raw(1, [[3, 10, 5]])]);
    expect(pairCoverage(set, [1, 2, 3])).toEqual({ pairs: 3, coveredBoth: 1, frac: 1 / 3 });
  });
});

describe('stratz-refresh cleaning math', () => {
  it('expectations are logit-additive', () => {
    expect(expectedMatchup(0.5, 0.5)).toBeCloseTo(0.5);
    expect(expectedMatchup(0.55, 0.5)).toBeCloseTo(0.55);
    expect(expectedMatchup(0.55, 0.45)).toBeCloseTo(1 / (1 + Math.exp(-2 * Math.log(0.55 / 0.45))));
    expect(expectedSynergy(0.5, 0.5)).toBeCloseTo(0.5);
    expect(expectedSynergy(0.55, 0.5)).toBeCloseTo(0.55);
  });

  it('cleaned rate re-centres on 0.5 and clamps', () => {
    expect(cleanRate(0.6, 0.55)).toBeCloseTo(0.55);
    expect(cleanRate(0.5, 0.55)).toBeCloseTo(0.45);
    expect(cleanRate(0.01, 0.9)).toBe(0.01);
    expect(cleanRate(0.99, 0.01)).toBe(0.99);
  });

  it('a strong hero with no interaction cleans to exactly 0.5', () => {
    const wh = 0.55;
    const wo = 0.48;
    const e = expectedMatchup(wh, wo);
    const avg = { vs: new Map([['1-2', { g: 1000, w: e * 1000 }]]), with: new Map() };
    const out = cleanPairs(avg, (id) => (id === 1 ? wh : id === 2 ? wo : undefined));
    expect(out.matchups.get(1)![0].opponentHeroId).toBe(2);
    expect(out.matchups.get(1)![0].wins / 1000).toBeCloseTo(0.5);
  });

  it('drops entries without a base win rate and sorts by the other hero', () => {
    const avg = {
      vs: new Map([
        ['1-3', { g: 100, w: 50 }],
        ['1-2', { g: 100, w: 60 }],
        ['1-9', { g: 100, w: 60 }],
      ]),
      with: new Map([['1-2', { g: 40, w: 22 }]]),
    };
    const out = cleanPairs(avg, (id) => (id === 9 ? undefined : 0.5));
    expect(out.droppedNoBase).toBe(1);
    expect(out.matchups.get(1)!.map((e) => e.opponentHeroId)).toEqual([2, 3]);
    expect(out.matchups.get(1)![0]).toEqual({ opponentHeroId: 2, games: 100, wins: 60 });
    expect(out.synergy.get(1)![0].wins).toBeCloseTo(22);
  });
});

const meta = (): HeroMetaFile => ({
  generatedAt: 'old',
  recentMatchIdThreshold: 1,
  heroes: [
    {
      heroId: 1,
      positions: [{ position: 'Carry', share: 1 }],
      winRate: 0.5,
      synergy: [{ allyHeroId: 2, games: 20, wins: 15 }],
      matchups: [{ opponentHeroId: 2, games: 20, wins: 10 }],
    },
    {
      heroId: 2,
      positions: [{ position: 'Mid', share: 1 }],
      winRate: 0.52,
      synergy: [],
      matchups: [{ opponentHeroId: 1, games: 20, wins: 10 }],
    },
    { heroId: 3, positions: [], winRate: 0.47, synergy: [], matchups: [] },
  ],
});

describe('stratz-refresh proposal and diff', () => {
  const totals = new Map([
    [1, { g: 1000, w: 530 }],
    [2, { g: 1000, w: 515 }],
  ]);
  const cleaned = {
    synergy: new Map([[1, [{ allyHeroId: 2, games: 980, wins: 490 }]]]),
    matchups: new Map([
      [1, [{ opponentHeroId: 2, games: 2000, wins: 1200 }]],
      [2, [{ opponentHeroId: 1, games: 2000, wins: 800 }]],
    ]),
    droppedNoBase: 0,
  };

  it('replaces only winRate and pairs; heroes without stats keep the old winRate', () => {
    const cur = meta();
    const p = buildProposedHeroMeta(cur, { week: 7, totals, cleaned, generatedAt: 'now' });
    expect(cur.heroes[0].winRate).toBe(0.5); // input untouched
    expect(p.heroes[0].winRate).toBeCloseTo(0.53);
    expect(p.heroes[2].winRate).toBe(0.47);
    expect(p.heroes[0].positions).toEqual(cur.heroes[0].positions);
    expect(p.heroes[1].synergy).toEqual([]);
    expect(p.heroes[0].matchups).toEqual(cleaned.matchups.get(1));
    expect(p.recentMatchIdThreshold).toBe(1);
    expect(String(p.pairSource)).toContain('week 7');
  });

  it('mergeParts applies only the requested parts', () => {
    const cur = meta();
    const p = buildProposedHeroMeta(cur, { week: 7, totals, cleaned, generatedAt: 'now' });
    const wrOnly = mergeParts(cur, p, ['winRate']);
    expect(wrOnly.heroes[0].winRate).toBeCloseTo(0.53);
    expect(wrOnly.heroes[0].matchups).toEqual(cur.heroes[0].matchups);
    expect(wrOnly.pairSource).toBeUndefined();
    const pairsOnly = mergeParts(cur, p, ['pairs']);
    expect(pairsOnly.heroes[0].winRate).toBe(0.5);
    expect(pairsOnly.heroes[0].matchups).toEqual(cleaned.matchups.get(1));
  });

  it('diff summary counts >1pp movers and compares shrunk pair rates', () => {
    const cur = meta();
    const p = buildProposedHeroMeta(cur, { week: 7, totals, cleaned, generatedAt: 'now' });
    const s = diffSummary(cur, p, totals, 20);
    expect(s.winRate.updated).toBe(2);
    expect(s.winRate.keptOld).toEqual([3]);
    expect(s.winRate.movedOver1pp).toBe(1); // hero 1: +3 pp; hero 2: −0.5 pp
    expect(s.winRate.topMovers[0]).toMatchObject({ heroId: 1, deltaPp: 3 });
    expect(s.picks).toEqual({
      totalHeroMatches: 2000,
      minHero: { heroId: 3, matches: 0 },
      medianMatches: 1000,
    });
    expect(s.pairs.matchupEntries).toEqual({ before: 2, after: 2 });
    expect(s.pairs.synergyEntries).toEqual({ before: 1, after: 1 });
    // 1 vs 2: before 10/20 → 0.5; after 0.6 at 2000 games, K=20 → 0.5 + 0.1·2000/2020
    const top = s.pairs.topMatchupMovers[0];
    expect(top.after).toBeCloseTo(0.5 + (0.1 * 2000) / 2020);
    expect(Math.abs(top.deltaPp)).toBeCloseTo(9.9, 1);
    // synergy 1+2: before 15/20 shrunk with K=20 → 0.625; after 0.5
    const syn = s.pairs.topSynergyMovers[0];
    expect(syn).toMatchObject({ heroId: 1, otherHeroId: 2 });
    expect(syn.before).toBeCloseTo(0.625);
    expect(syn.after).toBeCloseTo(0.5);
  });
});
