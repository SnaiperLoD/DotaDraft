import * as fs from 'fs';
import * as path from 'path';

// Population reference for "where does this draft rank" — built by
// scripts/compute-axis-percentiles.ts (10000 random 5-hero teams, scored
// exactly like axis.analyzer.ts scores a real draft: role-fit + hard-carry
// axisMultiplier applied, same rounding). Loaded once at module load, same
// pattern as axis-weights.json elsewhere in this project.
const DISTRIBUTIONS_PATH = path.join(__dirname, '..', '..', 'data', 'axis-percentile-distributions.json');

interface DistributionsFile {
  generatedAt: string;
  nSamples: number;
  distributions: Record<string, number[]>; // pre-sorted ascending
}

const file: DistributionsFile = JSON.parse(fs.readFileSync(DISTRIBUTIONS_PATH, 'utf-8'));

// Fraction of the reference population scoring <= `score` on `axis`, as a
// 0-100 integer. Binary search over the pre-sorted sample rather than a
// linear scan/filter — N=10000, but this runs on every Evaluation call.
export function percentileFor(axis: string, score: number): number | null {
  const sorted = file.distributions[axis];
  if (!sorted || sorted.length === 0) return null;

  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= score) lo = mid + 1;
    else hi = mid;
  }
  return Math.round((lo / sorted.length) * 100);
}
