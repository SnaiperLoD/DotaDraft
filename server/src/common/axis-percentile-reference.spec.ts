// KNOWN DEBT (Blueprint/10-tech-debt-backlog.md, "Percentile reference lags the weights").
// axis-percentile-distributions.json was generated 2026-08-17 with the weights recorded
// in the .weights.json sidecar. The live mid weights have since drifted
// (resource_efficiency 0.5 -> 0). This spec pins the KNOWN drift: any new drift, or a
// regenerated reference, makes it fail and forces the sidecar / expected list to be updated.
import * as fs from 'fs';
import * as path from 'path';
import { EVALUATION_MID_AXES, midAxisWeight } from './axis-weights-config';

interface Sidecar {
  sourceCommit: string;
  referenceGeneratedAt: string;
  midAxisWeights: Record<string, number>;
}

const KNOWN_DRIFTED_AXES = ['resource_efficiency'];

describe('axis percentile reference vs current mid weights (known debt)', () => {
  const dataDir = path.join(__dirname, '..', '..', 'data');
  const sidecar: Sidecar = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'axis-percentile-distributions.weights.json'), 'utf-8'),
  );

  it('sidecar matches the reference generation timestamp', () => {
    const header = fs
      .readFileSync(path.join(dataDir, 'axis-percentile-distributions.json'), 'utf-8')
      .slice(0, 200);
    expect(header).toContain(sidecar.referenceGeneratedAt);
  });

  it('only the known axes differ from the reference weights', () => {
    const drifted = EVALUATION_MID_AXES.filter(
      (axis) => (sidecar.midAxisWeights[axis] ?? 1) !== midAxisWeight(axis),
    ).sort();
    expect(drifted).toEqual(KNOWN_DRIFTED_AXES);
  });
});
