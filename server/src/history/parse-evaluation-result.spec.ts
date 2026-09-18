import { EVAL_RESULT_SCHEMA_VERSION, parseEvaluationResult, type EvaluationResult } from 'shared';

const V0_BLOB: EvaluationResult = {
  draftId: 'draft-v0',
  totalScore: 6.2,
  breakdown: [],
  summary: { strengths: [], weaknesses: [], gameplan: [] },
  customTags: [],
  campStackingNote: null,
  hiddenCalibrationApplied: false,
};

describe('parseEvaluationResult', () => {
  it('parses v0 blobs without schemaVersion', () => {
    const raw = JSON.stringify(V0_BLOB);
    const parsed = parseEvaluationResult(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBeUndefined();
    expect(parsed!.schemaVersion ?? 0).toBe(0);
    expect(parsed!.totalScore).toBe(6.2);
    expect(parsed!.draftId).toBe('draft-v0');
  });

  it('round-trips v1 blobs with schemaVersion 1', () => {
    const v1: EvaluationResult = { ...V0_BLOB, schemaVersion: EVAL_RESULT_SCHEMA_VERSION };
    const raw = JSON.stringify(v1);
    const parsed = parseEvaluationResult(raw);

    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(1);
    expect(parsed!.schemaVersion ?? 0).toBe(1);
    expect(parsed!.totalScore).toBe(6.2);
  });

  it('returns null for corrupt JSON', () => {
    expect(parseEvaluationResult('{not json')).toBeNull();
    expect(parseEvaluationResult('')).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    expect(parseEvaluationResult('42')).toBeNull();
    expect(parseEvaluationResult('"hello"')).toBeNull();
    expect(parseEvaluationResult('[]')).toBeNull();
    expect(parseEvaluationResult('null')).toBeNull();
  });

  it('best-effort parses unknown future schemaVersion values', () => {
    const future = { ...V0_BLOB, schemaVersion: 99 };
    const parsed = parseEvaluationResult(JSON.stringify(future));

    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(99);
    expect(parsed!.totalScore).toBe(6.2);
  });
});
