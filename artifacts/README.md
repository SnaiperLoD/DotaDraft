# Artifacts (not runtime)

Calibration / research / self-play dumps live here — **not** in Git as
product inputs.

## Runtime vs evidence

**Tracked in `server/data/` (runtime / production pipeline):**

- `heroes.json`, `hero-meta.json`, `hero-abilities.json`, `pro-matches.json`
- `axis-weights.json`, `axis-percentile-distributions.json`, `battle-diff-inputs.json`
- `manual-power-overrides.json`
- Ability tagging pipeline: `ability-tagging.csv`, `ability-tag-aggregates.json`,
  `ability-tag-weights.json`, `hero-constants.json`, `map-control-weights.json`
- Tiny config: `control-item-families.json`
- Compact summaries kept on purpose (not full seed matrices):
  `axis-regression-b0.json`, `axis-weight-*.json`, `tag-batch-measure.json`,
  `axis-candidate-validation.json`, `axis-structure-analysis.json`,
  `axis-flagged-factor-decomp.json`, `axis-regression-factor-map.md`,
  `winrate-divergence-report.csv`

**Local / gitignored under `server/data/` (still readable by old scripts):**

- `self-play-*.json`, `axis-{cand,final,trial}-*`, per-seed summaries
- `research-*-output.json` and other research dumps
- `debug-ds-*.json`, sweep JSONs, `*-data.json` / `*-screen.json` fetch intermediates

Those files may still exist on disk after clone history; they are no longer
committed. Regenerate with the matching `server/scripts/*` when needed.

## New runs

Prefer writing new experiment outputs under this tree:

```
artifacts/
  manifests/<run-id>.json
  self-play/<run-id>/
  axis-trials/<run-id>/
  research/<script>/<run-id>.json
  debug-matrix/
  sweeps/
```

Helper: `server/scripts/lib/artifact-paths.ts` (`artifactsRoot()`, `ensureArtifactDir()`).

## Manifest (minimum fields)

```json
{
  "runId": "2026-08-17-selfplay-nocrutch",
  "createdAt": "ISO-8601",
  "gitCommit": "sha",
  "gitDirty": false,
  "command": "npm run simulate-self-play --workspace server -- ...",
  "script": "scripts/simulate-self-play.ts",
  "seeds": [1, 2, 3, 4, 5],
  "configHashes": {
    "axis-weights.json": "sha256…",
    "heroes.json": "sha256…"
  },
  "outputs": [{ "path": "self-play/…/summary.json", "bytes": 0, "sha256": "…" }],
  "metrics": { "rFavRealMean": 0.0, "flaggedCount": 0 }
}
```

Compact `metrics` may be copied into Blueprint / a tracked summary JSON;
raw seed dumps stay here (or on another machine), not in `server/data/` commits.
