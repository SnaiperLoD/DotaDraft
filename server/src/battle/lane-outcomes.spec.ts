import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  LANE_OUTCOMES_PATH,
  laneOutcomeLookupFrom,
  loadLaneOutcomes,
  shrunkLaneWinRate,
  type LaneOutcomesFile,
} from './lane-outcomes';

const file: LaneOutcomesFile = {
  meta: { shrinkageK: 20 },
  pairs: {
    // hero 1 vs hero 9: 70 wins, 30 draws, 30 losses from hero 1's side.
    '1': { '9': [70, 30, 30] },
    // tiny sample: 3 wins, 0 draws, 0 losses.
    '2': { '5': [3, 0, 0] },
  },
};

describe('lane outcomes loader', () => {
  const lookup = laneOutcomeLookupFrom(file);

  it('shrinks the decided-lane rate toward 0.5 by K pseudo-lanes, draws excluded', () => {
    expect(shrunkLaneWinRate(70, 30, 20)).toBeCloseTo(80 / 120, 10);
    expect(lookup.getLaneWinRate(1, 9)).toBeCloseTo(80 / 120, 10);
    // 3-0 with K=20 reads as a small lean, not 100%.
    expect(lookup.getLaneWinRate(2, 5)).toBeCloseTo(13 / 23, 10);
  });

  it('answers from either side as the complement', () => {
    expect(lookup.getLaneWinRate(9, 1)).toBeCloseTo(1 - 80 / 120, 10);
    expect(lookup.getLaneWinRate(1, 9)! + lookup.getLaneWinRate(9, 1)!).toBeCloseTo(1, 10);
  });

  it('returns null for pairs without data and for a hero against itself', () => {
    expect(lookup.getLaneWinRate(1, 2)).toBeNull();
    expect(lookup.getLaneWinRate(1, 1)).toBeNull();
  });

  it('falls back to no data when the file is missing or malformed', () => {
    expect(
      loadLaneOutcomes(path.join(os.tmpdir(), 'no-such-lane-outcomes.json')).getLaneWinRate(1, 9),
    ).toBeNull();
    const bad = path.join(os.tmpdir(), `lane-outcomes-bad-${process.pid}.json`);
    fs.writeFileSync(bad, '{"pairs": {}}');
    try {
      expect(loadLaneOutcomes(bad).getLaneWinRate(1, 9)).toBeNull();
    } finally {
      fs.unlinkSync(bad);
    }
  });

  it('the tracked data file carries its source metadata and shrinkage policy', () => {
    const tracked = JSON.parse(fs.readFileSync(LANE_OUTCOMES_PATH, 'utf-8')) as LaneOutcomesFile & {
      meta: Record<string, unknown>;
    };
    expect(tracked.meta).toMatchObject({
      week: expect.any(Number),
      brackets: ['LEGEND_ANCIENT', 'DIVINE_IMMORTAL'],
      shrinkageK: 20,
      minLanes: expect.any(Number),
    });
    expect(String(tracked.meta.source)).toMatch(/laneOutcome/);
    const real = loadLaneOutcomes();
    const [lo, row] = Object.entries(tracked.pairs)[0];
    const hi = Object.keys(row)[0];
    const rate = real.getLaneWinRate(Number(lo), Number(hi));
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0);
    expect(rate!).toBeLessThan(1);
  });
});
