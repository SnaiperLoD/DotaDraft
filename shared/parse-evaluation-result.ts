import type { EvaluationResult } from './types/evaluation';

/** Current schema version stamped on newly saved EvaluationResult payloads. */
export const EVAL_RESULT_SCHEMA_VERSION = 1;

/**
 * Parse a persisted EvaluationResult JSON blob.
 * Missing schemaVersion is treated as v0; corrupt JSON returns null.
 * Unknown future schemaVersion values still parse best-effort for display.
 */
export function parseEvaluationResult(raw: string): EvaluationResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  return parsed as EvaluationResult;
}
