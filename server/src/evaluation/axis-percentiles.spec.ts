import * as fs from 'fs';
import * as path from 'path';
import { percentileFor } from './axis-percentiles';

const FILE = path.join(__dirname, '..', '..', 'data', 'axis-percentile-distributions.json');

describe('axis-percentile-distributions snapshot', () => {
  const file = JSON.parse(fs.readFileSync(FILE, 'utf-8')) as {
    nSamples: number;
    generatedAt: string;
    metadata?: { source?: string; bracket?: string; uniqueness?: string };
    distributions: Record<string, number[]>;
  };

  it('is 50k unique OpenDota Ancient+Divine drafts', () => {
    expect(file.nSamples).toBe(50000);
    expect(file.distributions.totalScore).toHaveLength(50000);
    expect(file.distributions.saving).toHaveLength(50000);
    expect(file.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(file.metadata?.source)).toMatch(/opendota/i);
    expect(String(file.metadata?.bracket)).toMatch(/Ancient/i);
    expect(String(file.metadata?.uniqueness)).toMatch(/5-hero/i);
  });

  it('percentileFor covers the totalScore range', () => {
    const xs = file.distributions.totalScore;
    expect(percentileFor('totalScore', xs[0] - 1)).toBe(0);
    expect(percentileFor('totalScore', xs[xs.length - 1])).toBe(100);
  });
});
