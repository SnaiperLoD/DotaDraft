import * as fs from 'fs';
import * as path from 'path';

// Real hero-vs-hero LANE results for the Battle lane cards (STRATZ
// `laneOutcome`, built by server/scripts/build-lane-outcomes.ts into
// server/data/lane-outcomes.json). Display/story only — the Battle roll never
// reads this (Blueprint/06-battle-engine.md, "Lane cards: real lane win rates").

export interface LaneOutcomeLookup {
  // Shrunk decided-lane win rate of `heroId` laning against `vsId`
  // (draws excluded), or null when the pair has no lane data.
  getLaneWinRate(heroId: number, vsId: number): number | null;
}

export interface LaneOutcomesFile {
  meta: { shrinkageK: number; [key: string]: unknown };
  // pairs[lo][hi] = [wins, draws, losses] from the lower hero id's side.
  pairs: Record<string, Record<string, [number, number, number]>>;
}

export const NO_LANE_OUTCOMES: LaneOutcomeLookup = { getLaneWinRate: () => null };

export const LANE_OUTCOMES_PATH = path.join(__dirname, '..', '..', 'data', 'lane-outcomes.json');

export function shrunkLaneWinRate(wins: number, losses: number, shrinkageK: number): number {
  return (wins + shrinkageK / 2) / (wins + losses + shrinkageK);
}

export function laneOutcomeLookupFrom(file: LaneOutcomesFile): LaneOutcomeLookup {
  const k = file.meta.shrinkageK;
  return {
    getLaneWinRate(heroId, vsId) {
      if (heroId === vsId) return null;
      const lo = Math.min(heroId, vsId);
      const hi = Math.max(heroId, vsId);
      const counts = file.pairs[String(lo)]?.[String(hi)];
      if (!counts) return null;
      const [wins, , losses] = counts;
      const loRate = shrunkLaneWinRate(wins, losses, k);
      return heroId === lo ? loRate : 1 - loRate;
    },
  };
}

// Missing or unreadable file → no lane data, so every lane falls back to the
// matchup proxy (flagged as `rateSource: 'matchup'` on the lane result).
export function loadLaneOutcomes(filePath: string = LANE_OUTCOMES_PATH): LaneOutcomeLookup {
  try {
    if (!fs.existsSync(filePath)) return NO_LANE_OUTCOMES;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LaneOutcomesFile;
    if (typeof parsed?.meta?.shrinkageK !== 'number' || typeof parsed.pairs !== 'object') {
      return NO_LANE_OUTCOMES;
    }
    return laneOutcomeLookupFrom(parsed);
  } catch {
    return NO_LANE_OUTCOMES;
  }
}

let cached: LaneOutcomeLookup | null = null;

export function defaultLaneOutcomes(): LaneOutcomeLookup {
  cached ??= loadLaneOutcomes();
  return cached;
}
