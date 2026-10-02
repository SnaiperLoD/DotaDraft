# Variance Lab harness

Journal and protocol: `Blueprint/16-variance-lab.md`. Outputs go to `artifacts/lab/` (gitignored).

Rules this harness keeps:

- It never writes `server/data/*`, and never patches `axis-weights.json` on disk.
- `realWinRateWeight` is set **in memory** (`setRealWinRateWeightInMemory`). `battle-resolution.ts` reads `axisWeightsConfig.realWinRateWeight` on every call, so the in-process value is the one used.
- Tag sets go through `DOTADRAFT_DISABLED_TAGS`, which is read once at import. That's why every tag set runs in its own child process.
- `DOTADRAFT_BATTLE_SHADOW` is forced off (`assertLabPreconditions`).
- Every run appends one line to `artifacts/lab/runs.jsonl`: config hash, seed, metrics, wall time, git head (`+dirty` marks uncommitted changes), and sha256 prefixes of every Battle input (data + code).

All commands run from `server/`.

## 1. Reproduce R0 (gate Н1.1)

```
npx ts-node scripts/lab/reproduce-r0.ts            # seed 1 × 100k, ~5 min
LAB_SEED=2 npx ts-node scripts/lab/reproduce-r0.ts # other seeds (no expected values)
```

The script runs production `runSimulation()` (`simulate-self-play.ts`) twice, with `rwr=0`:

- Naked+open: hidden tags off.
- Full: all tags on.

It then checks the KPI against the frozen rows (r ±0.01, MAE ±0.15) and the per-hero drift against `artifacts/self-play/r0-2026-09-21/*`. The hero tables land in `artifacts/lab/r0/seed<S>-n<N>/`.

## 2. Feature cache

```
npx ts-node scripts/lab/build-feature-cache.ts   # both tag sets, seed 1 × 100k, ~6 min
npx ts-node scripts/lab/verify-cache.ts          # accuracy gate
```

Cache layout, in `artifacts/lab/cache/seed<S>-n<N>-<naked-open|full>/`:

| file | shape | content |
|---|---|---|
| `heroIdx.bin` Int16 | n×10 | hero index into `meta.heroIds`; slots 0–4 are team A, 5–9 are team B |
| `roleIdx.bin` Int8 | n×10 | assigned role, index into `meta.roles` |
| `T.bin` Float64 | n×2×3×14 | tagged `axisAverage(team, axis, tagEffects, phase)` (role-fit, miscast, tags, hard-carry, utility stack, manual, shutdown) |
| `R.bin` Float64 | n×2×14 | raw `axisAverage(team, axis)`, with no tags (for tag ablations) |
| `side.bin` Float64 | n×5 | `synergyBonusA/B`, `edgeA`, `winRateEdgeA/B` |
| `prod-counts.json` | | production `assessBattle()` favored/even/appearances per hero at rwr 0 and 2 |

`feature-cache.ts › replayCounts(cache, params)` recomputes `advantageDirection` for any phase×axis weights, phase mix, `realWinRateWeight`, `synergyCoeff`/`matchupCoeff` and threshold. It takes about 50–100 ms per 100k matches, versus minutes for a full simulation run.

Why the replay is exact: axis weights enter only `overallPowerForPhase`. Every tag and penalty is built from raw unweighted averages and hero sets, so `T` does not depend on the weights. The replay keeps the production order of floating-point operations.

The build checks each match bit-for-bit: `taggedPower` and `diff` replayed against `assessBattle()`. The verify step checks per-hero counts against production within 1e-9, and favoredRate against `runSimulation()`.

The cache **cannot** replay changes to tag membership or magnitude, role assignment, the axis values themselves (`evaluation_values`), or the team aggregation formula (mean → power-mean etc.). Those need a new cache build, or a lab variant of the build.

## 3. KT1 (steps 1–2): variant caches + analysis

```
# all caches KT1 needs (~15 min wall at LAB_PAR=9)
LAB_PAR=9 LAB_BUILDS="1:full,1:naked-open,1:notags,1:full:mirageTax,1:full:noHardCarry,1:full:noUtility,1:full:noManual,1:full:noShutdown,1:full:noRoles,1:naked-open:noShutdown,2:naked-open,2:full,3:naked-open,3:full,4:naked-open,4:full,5:naked-open,5:full" npx ts-node scripts/lab/build-feature-cache.ts
npx ts-node scripts/lab/kt1-analysis.ts   # ~70 s, writes artifacts/lab/kt1/{kt1.json,per-hero.json}
```

Build specs have the form `seed:tagset[:variant+variant]`.

Tag sets:

- `full`: every tag on.
- `naked-open`: hidden tags off.
- `notags`: every custom tag off.

Lab-only variants (implemented in `build-feature-cache.ts`; no production file is touched):

| Variant | What it does |
|---|---|
| `noHardCarry`, `noUtility`, `noManual`, `noShutdown` | drop that multiplier source |
| `noRoles` | sets `assignedRole=null` |
| `mirageTax` | re-adds the retired Mirage Tax so the 09-21 state can be reproduced |

For variant builds, `buildChecks` and `prod-counts.json` compare against production and are expected to differ.

`flags.bin` (n×3: High Skill on A, High Skill on B, Mechanical present) feeds `replayHeroProb` (expected WR through the tier roll).

Ruler: `lab-metrics.ts` gives r, Spearman, slope, SD ratio, MAE_aff, MAE_iso, decile overlap and the legacy metrics, with bootstrap and paired bootstrap.

## 4. KT2 progress (Н4.1, Н3.1, Н5.2, Н4.3)

These steps need the seed-1 `full` / `naked-open` caches and `artifacts/lab/kt1/per-hero.json`.

```
npx ts-node scripts/lab/kt2-dirichlet.ts          # Н4.1: 6 configs × 20k Dirichlet sets, ~9 min at LAB_PAR=12
npx ts-node scripts/lab/kt2-dirichlet-report.ts   # → artifacts/lab/kt2/dirichlet-summary.json
LAB_PERMS=204 npx ts-node scripts/lab/kt2-regress.ts   # Н3.1: 10×5 nested OOF + permutation null, ~4 min
npx ts-node scripts/lab/kt2-scale.ts              # Н5.2: OOF affine/isotonic maps + tier-roll scaling
LAB_PERMS=204 npx ts-node scripts/lab/kt2-optimize.ts  # Н4.3: ES on shared 11-axis weights, OOF + null, ~7 min
```

- `lab-ml.ts` is a dependency-free toolkit: ridge, lasso, PLS, stump boosting, nested CV.
- `fetch-public-matches.ts` is the OpenDota pull: ~470 × `publicMatches?min_rank=70` plus 1 × `/heroStats`, written to `artifacts/lab/opendota/`.
  - It is resumable, sequential, has a 1.2 s gap between calls and backs off on 429.
  - It runs **only** with the user's explicit permission.

## 5. KT3 (safe — evaluated once)

```
npx ts-node scripts/lab/pub-prepare.ts      # pages → artifacts/lab/opendota/pub-pool.json + pub-outcome.json (roles = argmax Σ log blended weight)
LAB_POOL_FILE="<repo>/artifacts/lab/opendota/pub-pool.json" LAB_BUILDS="0:full,0:naked-open,0:full:noShutdown" npx ts-node scripts/lab/build-feature-cache.ts
npx ts-node scripts/lab/kt3-safe.ts         # ceiling, hidden-tag OOS, shortlist safe (AUC/log-loss/Brier), Н6.1 → artifacts/lab/kt3/kt3.json
```

The shortlist is frozen in `Blueprint/16-variance-lab.md` **before** the safe. Do not re-run the safe to choose between variants; a new safe needs a new public window.

Unapplied proposals live in `artifacts/lab/proposals/<id>/`.
