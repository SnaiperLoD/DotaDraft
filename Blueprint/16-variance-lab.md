# 16 — Variance Lab

## KT3 summary (2026-10-02) — what we can honestly say

**Data.**

- Self-play: seed 1 × 100k (seeds 1–5 for noise).
- 127 heroes. Target: hero-meta `winRate`, Ancient+Divine, 2026-08-15.
- The "safe" (held-out check), evaluated **once** on the frozen shortlist:
  - `heroStats` from 2026-10-01;
  - 25 074 public ranked All Pick matches. Caveat: **Divine only, one ~8-hour window** (2026-10-01 14:47–23:59 UTC).

**Attempts:** 33 searched variants before the safe, plus 4 frozen shortlist rows.

### 1. What the "dispersion" is

- **Mostly scale.** favoredRate (the sign of diff) spreads 3.5–4.5× wider than real WR by construction. The old MAE, ±7 and ≥10 pp measure that, not understanding of heroes. An affine "scale layer" takes MAE from 6.37 to 1.76 pp and ±7 to 100%, but r does not rise (0.40 → 0.38).
- **The rank signal is modest.** The production base (hidden tags on, `rwr=0`) has r 0.40 [0.25, 0.54] against the August target and **0.29 against October heroStats**. Without hidden tags: 0.12 / 0.03.
- **The 14 axes carry signal that the formula does not use.** A linear readout gives an out-of-fold (OOF) r of 0.27–0.32, significant against the null; the formula gets 0.12. Re-weighting the formula (ES) reaches OOF 0.475 with hidden tags, but the gain over the base is not significant (Δr +0.07 [−0.05, +0.20]).

### 2. Ceiling

- **Hero level, high.** October 6+7 picks: median 60k per hero, binomial reliability 0.99. August → October test-retest r = **0.88**; Ancient vs Divine 0.93. The noise ceiling is not what limits us: the earlier O5 estimate of 0.8 used pro games as the denominator.
- **Match level, low for any draft-only model.** On 25k public matches:
  - the hero-strength Bradley–Terry fitted inside the window, time-split: AUC **0.575–0.588**;
  - the August hero winRate prior: 0.572;
  - team-axis logistic: 0.539–0.548;
  - **production Battle (pair channels off): AUC 0.527**, log-loss 0.6904 vs 0.6914 for the constant.

  Real drafts are close to coin flips. The Accuracy Ceiling holds.

### 3. Leakage and channels

- **Pair channels.** Synergy and matchup use OpenDota **pro** data. In the pub KPI they do not leak signal; they only narrow the scale.
  - On public matches they **hurt**: AUC 0.527 → 0.511 when switched on, ΔAUC −0.016 [−0.025, −0.008].
  - On the pro target they do leak (r 0.27 → −0.04 without them).
  - This was found on the safe, and pair channels were not in the shortlist. So it is **a hypothesis for the next pre-registered window, not a verdict**.
- **Hidden tags hold up out of time.** On the October target:
  - r 0.03 → 0.29, Δr +0.25 [+0.12, +0.41];
  - the 8-hour window: Δr +0.26 [+0.11, +0.40];
  - sign test p 0.05 / 0.02.

  In-sample they were fitted to the August winRate. A persistent correction carries over to October, so they encode a real, stable hero-strength residual: in effect a hand-made hero prior. The explicit WR prior (class C) does far more, though: r 0.88.
- **The in-game roll is over-confident.**
  - On public matches the Battle favourite wins **51.0%**: Low 51.0%, Moderate 50.8%, High 53.2%.
  - The game rolls 0.53 / 0.62 / **1.0**.
  - The tier roll's Brier is 0.262, worse than the constant (0.249).

### 4. Safe results for the frozen shortlist

Pair channels off; differences vs BASE with paired bootstrap over matches.

| Row | AUC | ΔAUC [95%] | Δlog-loss [95%] | Verdict (frozen criteria) |
|---|---:|---|---|---|
| BASE (prod, `rwr=0`) | 0.5274 | — | — | base |
| S1 es-full (A) | 0.5306 | +0.0032 [−0.0009, +0.0069] | −0.0003 [−0.0007, 0.0000] | **inconclusive → not shadow** (hero-level CI also includes 0) |
| S2 no-shutdown (A) | 0.5284 | +0.0010 [−0.0002, +0.0024] | −0.0001 [−0.0002, −0.0000] | **no** (self-play Δr +0.045 < 0.05 floor; the safe effect is negligible) |
| S3 hero-prior-B (B-meta) | 0.5399 | **+0.0125 [+0.0030, +0.0210]** | −0.0013 [−0.0023, −0.0004] | beats the base, but it is a pro-popularity proxy; measurement only, rule change is the author's call |
| ref: shipped (pairs on, `rwr=2`) | 0.5237 | −0.0037 [−0.0117, +0.0041] | +0.0006 | — |
| ref: hero-meta winRate prior (C) | 0.5720 | +0.0446 [+0.0365, +0.0523] | −0.0066 | — |

### 5. Decision matrix

| Option | Cost | Risk | What the player gets | What I need from the author |
|---|---|---|---|---|
| **1. Keep the formula + scale layer** | Lab only: the KPI moves to r / Spearman / MAE_aff, and the old MAE is retired. In-game, optional: re-tune `WIN_WEIGHT_BY_TIER` to the measured favourite win rate | Low for the KPI. A product risk if the roll changes: calibrated favourites win only ~51–53%, so fights feel random, and High=1 cannot be calibrated | Nothing, if lab only. With a calibrated roll: more upsets, honest about the Accuracy Ceiling, but less "my draft mattered" | Decide whether the roll should be *honest* (≈ coin flip) or *legible* (favourite usually wins). That is a product choice, not calibration |
| **2. New formula in shadow** (S1 es-full) | A Battle-only weight block (code: Eval reads the same mid weights), a re-worded recap (teamfight/burst/durability drop out), a new pre-registered window | No proven gain: ΔAUC +0.003 n.s., Δr +0.07 n.s. Narrative conflict | A different "why you won" voice; no measurable accuracy | An ok for a shadow with its own window and pass criteria (ΔAUC CI > 0 on a new ≥25k Ancient+Divine pull spanning ≥3 days) |
| **3. New Battle feature set** (not derived from the Eval radar) | Large: new features (pro popularity, kit, base stats) or a shrunk hero-WR prior (C); new text | B-meta and C are unexplainable to the player; real-WR circularity | Slightly more "correct" winners (+0.01–0.045 AUC) with no story | A rule change: allow a non-mechanic hero-strength prior, and decide how to explain it |
| **4. Accept the ceiling and freeze** (Н6.6) | Zero | Divergence tables keep looking bad on the old MAE (that is scale) | The game as it is | Sign off on "draft-only AUC ≈ 0.55–0.59 is the ceiling; the current 0.53 is close". Freeze calibration, ship the game. Keep the lab ruler for future changes |

**My recommendation: 4 + the lab half of 1.**

- Freeze the formula and retire the old MAE / ±7 / ≥10 as decision metrics.
- Keep the hidden tags: they survived out of time.
- Two open questions are for the author, and neither is a calibration task:
  - the pair channels (pro data hurts pub prediction);
  - how confident the tier roll should be.

  Each needs its own pre-registered check on a new, wider public pull (several days, Ancient+Divine).

Unapplied proposals live in `artifacts/lab/proposals/{es-full,no-shutdown,hero-prior-B}/`.

---

Research journal. The task is in `Blueprint/prompts/02-variance-lab-session.md`. The harness and how to reproduce it are in `server/scripts/lab/README.md`. Raw outputs and `runs.jsonl` are in `artifacts/lab/` (gitignored); every number cited here is copied from there.

## Protocol

- **Production stays untouched.** Nothing writes `server/data/*`, `calibration-tags.ts`, `custom-tags.ts`, `battle-resolution.ts` or `battle-shadow.ts`. `realWinRateWeight` changes only in process memory. Tag sets are set through `DOTADRAFT_DISABLED_TAGS` in child processes. The shadow is forced off.
- **Pool:** mulberry32 seed=1 × 100k, blended roles, the same draw as `simulate-self-play.ts`. Seeds 2–5 are only for estimating noise.
- **Feature cache:** production `assessBattle()` runs once. For each match × side × phase × axis the cache stores the tagged `axisAverage`, plus synergy/matchup/winRate edges. Replaying it for any axis/phase weights, phase mix, `rwr` and coefficients is exact. Gate on production weights: per-hero favored/even/appearances differ by 0 (within 1e-9) at both rwr 0 and 2. The build checks `taggedPower` and `diff` bit-for-bit on every match. FavoredRate matches `runSimulation()` with a difference of 0.
- **Logging:** every run goes to `runs.jsonl` with the config hash, seed, metrics, wall time, git head and hashes of all Battle inputs.
- **Rules 1–10 of the prompt apply:** bootstrap ≥2000, repeated K-fold by hero, a permutation null ≥200, an attempt counter, and a held-out check ("safe") that is used only once.

## KT0 — 2026-10-02

**My reading of the task.** In honest self-play (`rwr=0`), a hero's favoredRate — the share of matches where their side is ahead on sign(diff) — barely tracks real winRate: r≈0.1 naked, ≈0.4 with hidden tags. Some heroes are off by 15–25 pp. The goal is to split this mismatch into four parts:

1. scale;
2. rank/shape;
3. noise (in the target and in the simulation);
4. overfitting (hidden tags were fitted on this same target).

Then find a fix that holds up out of sample by hero and on an independent target (pro matches). The work does not tune the product.

**"Dispersion".** I agree with splitting it in two.

- *Scale* is SD(favored)/SD(real) and the slope of real on favored. favoredRate is the share of wins by the sign of diff, with no execution noise. It is not a probability, so its range is expected to be several times wider than the real one. MAE, ±7 and ≥10 pp therefore mix scale with rank.
- *Rank/shape* is measured by Spearman, the residuals after the best affine mapping (MAE_aff), the residuals after an isotonic mapping, and tail/decile agreement.
- I add a third component, the *noise floor*. The target's reliability (games per hero) caps the reachable r. Simulation noise is about 0.56 pp per hero at 100k: about 7.9k appearances per hero.

The primary metrics are r, Spearman and MAE_aff. The old ones (MAE, ±7, ≥10) are reported only so results stay comparable.

**Pre-registered criteria (rule 9) — FROZEN 2026-10-02, author approved ("да на всё").** Base for comparisons: B-full below.

The fixed threshold "Δr ≥ 0.10" uses the SE of a single r: about 0.09 at r≈0.1 and about 0.077 at r≈0.4. Variants are compared on the same 127 heroes, though, so what matters is the SE of a *paired* Δr. That SE is ≈ √(2(1−ρ))·SE(r), where ρ is the correlation between the variants' favoredRate vectors. At ρ 0.7–0.9 it comes to about 0.03–0.06, so a fixed 0.10 is too strict for close variants and says nothing about winner's curse for searched ones. Proposal:

- **Shadow**, all of the following must hold:
  - out-of-fold r (10×5 by hero, nested CV whenever anything is fitted) beats the frozen baseline;
  - the 95% CI of the paired bootstrap Δr excludes 0;
  - Δr is above the 95th percentile of the same procedure's permutation null;
  - Δr ≥ 0.05 as the minimum practical effect;
  - Spearman and MAE_aff are not worse (their paired CIs do not sit below 0);
  - the sign of Δr is the same on seeds 1–5.
- **Prod:** shadow criteria + a single "safe" check passed (pro matches: log-loss/AUC not worse than the baseline, with CI) + explainability (the recap and "Explanation" can name what is actually scored) + the author's decision.
- **Kill** if any of these holds:
  - the upper bound of the paired-Δr CI is below +0.05;
  - it fails to beat the null's 95th percentile;
  - the gain vanishes after affine mapping. In that case it is moved to the "scale layer" track and labelled "improved scale, not understanding of heroes".

**Time measured** (16 cores, one process per run):

| Operation | Wall |
|---|---:|
| `runSimulation()` 100k (2 `assessBattle` per match, including the no-role counterfactual) | 133–140 s |
| Build the cache for one tag set, 100k (2 `assessBattle` at rwr 0/2 + capture) | 168–176 s |
| Cache replay, one set of weights, 100k | 20–36 ms |

**Plan budget** (wall, with up to 12 parallel processes):

| Work | Estimate |
|---|---:|
| Caches for seeds 2–5 × 2 tag sets | ~6 min |
| Step 1 (scale/rank, ceiling, bootstrap) | minutes |
| Н2.1 ablations: weight-only via the cache; tag/channel ablations need a cache rebuild (~3 min each, ~10–15 rebuilds) | ~15 min |
| Н4.1 Dirichlet null, 10⁵ sets | ~5 min (≈50 CPU-min) |
| Н4.3 optimizers, nested CV | ~1–1.5 h |
| Permutation null for the optimizers | budget reduced to ~500 evaluations per fit: ~10 min. At full budget, 200 × nested CV would be ~250 CPU-h, out of budget |
| Steps 3/6 (regressions, pro matches, factorisation) | minutes |
| **Total** | **≈2–3 h compute** |

**Data and permissions I'll need:**

1. **Re-freeze the baseline** (see below). This is needed before anything else.
2. A lab variant of the cache that stores per-pick values (n×10×3×14, about 340 MB) for Н4.5 (weights by position) and Н5.1 (non-linear aggregation). Lab only.
3. A lab variant of the tag layer, to switch tags on and off one at a time and to reproduce the old Mirage Tax. A copy in `server/scripts/lab/`, with no edits to production files.
4. **OpenDota — plan only, no calls made.**
   - Check: one call `GET /api/publicMatches?min_rank=70` (1 page, ~100 matches). It answers whether the response carries `radiant_win`, `radiant_team`/`dire_team`, `avg_rank_tier` and `start_time`.
   - If yes, the next step needs a separate ok: about 262 calls for ~25k Ancient+Divine matches, paginated with `less_than_match_id` over a recent window, while respecting 429s. It would answer one question: match-level AUC/log-loss for Н6.1 on the right meta-group.

## Н1.1 — reproducing the base rows: **FAIL by tolerance, cause found exactly**

Pool seed=1 × 100k, `rwr=0`, open tags ON.

| Row | Expected r / MAE / ±7 / ≥10 | Current production (HEAD 14d5c73+dirty) | With pre-74f517b RE weights, via cache |
|---|---|---|---|
| R0 Naked+open | 0.094 / 8.68 / 46.5% / 46 | **0.121** / 8.54 / 47.2% / 41 | **0.0942 / 8.68 / 46.5% / 46** — per-hero difference from `r0-2026-09-21` = 0.0000 pp |
| R0 Full, hidden ON | 0.381 / 6.39 / 61.4% / 27 | **0.403** / 6.37 / 59.8% / 27 | 0.362 / 6.50 / 59.8% / 28 — the remainder is Terrorblade +12.3 pp and Naga Siren +11.5 pp, everyone else within 0.7 pp |

**Cause.** The frozen rows were measured at 18:18 +0300 on 2026-09-21. Commit `74f517b` (20:23 +0300 the same day) changed two things:

- `resource_efficiency` weight went from 0.4/0.5/0.55 (early/mid/late) to 0;
- the hidden tag Mirage Tax was retired (Naga Siren and Terrorblade, ×0.85 to power).

The handoff table (`14-analytical-handoff.md`) mixes rows from before and after that commit. On current code, Naked+open with the old RE weights is reproduced exactly, hero for hero. For Full, the only remaining difference is the two Mirage Tax heroes plus their small knock-on effects. I have not changed tolerances or the protocol. The current code and the harness are correct (cache gate PASS). The baseline the gate is supposed to protect is stale.

**Decision (author, 2026-10-02):** freeze the baseline on current production; reproduce the 09-21 state as a secondary row. **Frozen baseline** (current production, seed 1 × 100k, `rwr=0`):

| Baseline | r | MAE pp | ±7 | ≥10 pp |
|---|---:|---:|---:|---:|
| B-naked (hidden OFF) | 0.121 | 8.54 | 47.2% | 41 |
| B-full (hidden ON) | 0.403 | 6.37 | 59.8% | 27 |

For reference, `rwr=2` (shipped): naked r 0.351, full r 0.659. This is the circular read and is not a KPI.

**Secondary row — exact 09-21 state** (lab-only `full-mirageTax` cache + pre-74f517b RE weights): r 0.381 / MAE 6.39 / ±7 61.4% / ≥10 27. Per-hero it is identical to `artifacts/self-play/r0-2026-09-21/full-heroTable.json`, so the handoff table is now fully reproduced.

Attempt counter: 0. No variants have been tried.

## KT1 — state of the ruler (2026-10-02)

Source: `artifacts/lab/kt1/kt1.json` and `per-hero.json`, produced by `server/scripts/lab/kt1-analysis.ts`. Every bootstrap uses 2000 resamples by hero; [..] is the 95% CI. All rows are seed 1 × 100k, `rwr=0`, unless stated otherwise. Attempt counter: 0. This is measurement only: nothing was fitted except the scale k in Н1.3 and the affine/isotonic maps inside the ruler.

### Н1.2 — new ruler on all old variants

| Variant | r | Spearman | SD(sys)/SD(real) | MAE_aff pp | old MAE | ±7 | ≥10 |
|---|---|---|---:|---:|---:|---:|---:|
| B-naked | 0.121 [−0.05, 0.30] | 0.167 [0.00, 0.34] | 4.50 | 1.87 | 8.54 | 47.2 | 41 |
| **B-full (base)** | **0.403 [0.25, 0.54]** | **0.394 [0.23, 0.54]** | 3.51 | 1.74 | 6.37 | 59.8 | 27 |
| 09-21 naked | 0.094 | 0.140 | 4.49 | 1.88 | 8.68 | 46.5 | 46 |
| 09-21 full | 0.381 [0.22, 0.52] | 0.370 | 3.43 | 1.75 | 6.39 | 61.4 | 27 |
| combat_pc1 (09-21, hidden OFF) | 0.138 | 0.176 | 4.43 | 1.86 | 8.40 | 50.4 | 46 |
| r2_f | 0.177 | 0.233 | 4.37 | 1.83 | 8.17 | 48.0 | 37 |
| r2_f_farm | 0.186 [0.02, 0.37] | 0.248 | 4.32 | 1.82 | 8.11 | 51.2 | 43 |
| r2_f_farm, hidden ON | 0.372 [0.22, 0.52] | **0.399** | 3.77 | **1.69** | 6.80 | 55.1 | 31 |
| r2_f_farm, saving=0 | 0.122 | 0.166 | **4.02** | 1.85 | **7.78** | 53.5 | 39 |
| *constant (everyone at mean real WR)* | — | — | — | *1.90* | — | — | — |

Paired comparisons:

- **r2_f_farm hidden ON vs 09-21 full:**
  - Δr −0.009 [−0.12, +0.12];
  - ΔSpearman +0.029 [−0.11, +0.17];
  - ΔMAE_aff −0.06 [−0.17, +0.08].

  The two are indistinguishable. The "loss" on ±7 (55.1 vs 61.4) is scale (SD ratio 3.77 vs 3.43), not rank. The September refusal to ship the shadow rested on noise plus a scale artifact.
- **Naked shadows vs 09-21 naked:**
  - r2_f_farm: Δr +0.092 [+0.002, +0.19], ΔSpearman +0.108 [+0.01, +0.22];
  - r2_f: +0.082 [−0.001, +0.17];
  - combat_pc1: +0.044 [−0.01, +0.10].

  Only r2_f_farm clears zero, and only just. It was found by search, so under the frozen criteria it would still need OOF and the null.
- **The ranking of variants changes with the ruler.** By r, 09-21 full is ahead of r2_f_farm hidden; by Spearman and MAE_aff the order flips. On the old MAE, "saving=0" looks good (7.78), but only because it narrows the scale: its r is 0.122.

### Н1.3 — scale: three system "winrates"

Real winRate: SD 2.38 pp, range 43.3–55.1%.

| B-full | r | SD pp | SD ratio | slope real~sys | range | old MAE | MAE_aff |
|---|---:|---:|---:|---:|---|---:|---:|
| favoredRate (sign of diff) | 0.403 | 8.33 | 3.51 | 0.115 | 32.7–70.2 | 6.37 | 1.74 |
| expected WR via the battle function (tiers 0.53/0.62/1.0 + High Skill) | 0.380 | 1.54 | 0.65 | 0.585 | 46.3–53.7 | 1.83 | 1.76 |
| σ(k·diff), k=1.01 chosen so that SD = SD(real) | 0.394 | 2.38 | 1.00 | 0.394 | 45.1–55.8 | 2.10 | 1.75 |

B-naked has the same structure: SD ratio 4.50 / 1.29 / 1.00, with r ≈ 0.12 in every row.

**Conclusion: "dispersion" is mostly scale.**

- favoredRate carries no execution noise, so its spread is 3.5–4.5× too wide.
- The game's own roll (the tiers) is already close to the real scale; for B-full it is even 0.65× too narrow.
- A change of scale moves the old MAE from 6.37 to 1.8–2.1, but leaves r and Spearman where they were.
- After the best affine map, the base's MAE is 1.74 pp. The constant "everyone at average" gets 1.90. All of the system's rank information lives in that 0.16 pp gap.
- The old MAE, ±7 and ≥10 pp measure scale. They are retired as decision metrics.

### Н1.4 — ceiling

**Correction to O5.** The two inputs come from different samples (`fetch-hero-meta.ts`):

- `winRate` comes from `/heroStats`: pub 6_/7_ picks and wins (Ancient+Divine).
- `matchups` come from `/heroes/{id}/matchups`, which is OpenDota pro data. `synergy` comes from the Explorer `matches` table.

The numbers confirm it: r(winRate, pooled matchup WR) = −0.06 with a mean |difference| of 2.9 pp, while r(pooled matchup WR, WR in `pro-matches.json`) = 0.24. So the "1800 games per hero" are pro games, and the 0.65 / 0.80 estimates in O5 use the wrong denominator. Pub picks are not stored locally.

**Ceiling as a function of pub picks per hero** (binomial noise only):

| Pub picks per hero | Noise SD pp | Reliability | Ceiling r |
|---:|---:|---:|---:|
| 1k | 1.58 | 0.56 | 0.75 |
| 2k | 1.12 | 0.78 | 0.88 |
| 5k | 0.71 | 0.91 | 0.95 |
| 20k | 0.35 | 0.98 | 0.99 |

Pinning the real number down takes one `/heroStats` call, which is not allowed yet. Drift between patches is not measured either; that would need a second snapshot.

- **Simulation noise is negligible.** At 100k, favoredRate correlates 0.993–0.997 between seeds, so its reliability is 0.994. Over seeds 1–5, r is 0.386–0.408 for B-full (SD ≈ 0.009) and 0.104–0.122 for B-naked.
- **Popularity:** r(pro games, WR) = −0.42, Spearman −0.46. Unpopular heroes win more, or are picked by specialists. This is a candidate covariate for step 3.
- **Pro target** (`pro-matches.json`): 2374 matches, 126 heroes with ≥30 games, median 176 games. SD 4.8 pp, binomial reliability **0.21**, so the r ceiling against pro is ≈ 0.45. Pub WR predicts pro WR at r 0.19.

### Н1.5 — statistical power

- **SE of a single r:** 0.089 for naked, 0.075 for full. The analytic and bootstrap values agree.
- **SE of a paired Δr depends on corrX**, the correlation between the two variants' favoredRate vectors:

  | corrX | Example | SE(Δr) | MDE₈₀ |
  |---|---|---:|---:|
  | ≈ 0.99 | no shutdown | 0.011 | 0.03 |
  | ≈ 0.95 | utility, rwr | 0.018–0.029 | 0.05–0.08 |
  | ≈ 0.9 | synergy, hard-carry, phase 1/3 | 0.030–0.038 | 0.08–0.11 |
  | ≈ 0.4–0.6 | structurally different formulas, phases, weight sets | 0.065–0.10 | **0.18–0.29** |

- **What this means for steps 3–5.** At n=127, a substantially *different* formula needs to improve r by about 0.2 before the gain is detectable. The Δr ≥ 0.05 floor only constrains close variants. Searches (CMA-ES etc.) will mostly come back "not significant", so the permutation null is mandatory.

### Н2.1 — channel ablations (relative to B-full)

Δr is the paired "variant − B-full". A negative Δr means the channel helps.

| Change | r | Δr [CI] | SD ratio | Reading |
|---|---:|---|---:|---|
| all tags off (open+hidden) | 0.098 | −0.305 [−0.47, −0.15] | 4.58 | all of r comes from tags |
| hidden off (= B-naked) | 0.121 | −0.282 [−0.44, −0.13] | 4.50 | most of it is hidden |
| hard-carry penalty off | 0.294 | −0.109 [−0.18, −0.03] | 3.87 | helps |
| role-fit off (roles = null) | 0.362 | −0.041 [−0.075, −0.005] | 3.79 | helps a little |
| utility-stack penalty off | 0.381 | −0.021 [−0.06, +0.01] | 3.73 | ≈ 0 |
| manual power overrides off | 0.403 | 0 | 3.51 | no-op (empty list in the pool) |
| **shutdown off** | **0.448** | **+0.045 [+0.025, +0.066]** | 3.55 | **hurts r** (class A); below the 0.05 floor |
| synergy off | 0.417 | +0.014 [−0.05, +0.08] | 4.53 | ≈ 0 on r, but narrows the scale |
| matchup off | 0.438 | +0.035 [−0.10, +0.17] | 3.88 | ≈ 0 |
| synergy + matchup off | 0.383 | −0.020 [−0.19, +0.15] | **5.77** | r unchanged, scale ×1.6 wider |
| phase: early / mid / late only | 0.304 / 0.362 / 0.163 | late: −0.239 [−0.37, −0.09] | — | late weights alone are the worst |
| phase mix 1/3 each | 0.413 | +0.011 [−0.06, +0.08] | 3.63 | 0.15/0.35/0.5 ≈ uniform |
| one weight set (mid) for every phase | 0.362 | −0.040 [−0.17, +0.09] | 4.28 | phase weights not proven |
| all axis weights = 1 | 0.160 | −0.242 [−0.37, −0.12] | 3.80 | weights matter, so the Н4.1 null is needed |
| ONLY raw axes (no tags, penalties, syn/mat) | 0.146 [−0.05, 0.33] | −0.257 | 6.45 | axes alone ≈ noise |
| ONLY synergy / ONLY matchup / both (axes = const 4.20) | 0.027 / −0.042 / −0.026 | −0.43 | — | pair channels carry no rank signal about pub WR |
| full at rwr=2 (shipped) | 0.659 | +0.256 [+0.20, +0.31] | 3.95 | class C, circular |
| ONLY rwr=2 (axes = const) | 0.990 | — | 9.8 | class C, a trivial echo of the target |

### Н2.2 — leakage through matchup/synergy

**Into the pub target there is no leakage:**

- r(hero's mean matchup edge, winRate) = −0.09; r(mean synergy edge, winRate) = +0.07.
- Turning off synergy + matchup + shutdown leaves B-full at 0.403 → 0.403 (Δ 0.000 [−0.17, +0.18]). B-naked goes 0.121 → 0.234.
- The pair channels are pro data (Н1.4). For the pub KPI they act as **noise that narrows the scale**: the SD ratio drops from 5.8 to 3.5. That is where the old MAE's "improvement" from 10.3 to 6.4 came from.

**Into the pro target there is leakage:**

- B-full against pro WR: r 0.267. With the pair channels off: r −0.043.
- B-naked: 0.199 → 0.008.
- **Consequence for the "safe" (rule 8):** a check on `pro-matches.json` must run with the pair channels off, or on matches outside the matchup window. Otherwise it measures the leak, not the model.

### Н2.3 — hidden tags out of sample

**Tagged vs untagged heroes:**

| Heroes | n | Naked r | Full r |
|---|---:|---:|---:|
| untagged | 80 | 0.552 | 0.557 |
| tagged | 47 | −0.204 | 0.171 |

The 0.55 is **selection-biased**: tags were placed exactly on the heroes the model missed. It is not evidence that "the axes work across the middle of the roster".

**Sign test.** A tag's sign is the direction of Δ(full − naked). A hero's miss is measured in rank space as z(real) − z(naked). Hit rates:

- in-sample: 0.92;
- leave-one-out (do the tag's other members predict this hero's sign?): 0.92;
- on the pro target: 0.86. **But the permutation null (2000×) is also 0.86 (p = 0.61).** The hits come entirely from the shared −z(naked) term, not from the target.

**Leak-free pro target:** full vs naked Δr −0.052 [−0.20, +0.11]. Both r are ≈ 0 (−0.04 and +0.01).

**Conclusion:** local data cannot confirm the hidden tags out of sample. Their entire effect (+0.28 r) is in-sample on the very target they were fitted to. The independent target (pro) is too noisy (reliability 0.21) and contaminated by the pair channels. A real check needs the pub-match pull (plan below).

### Н2.4 — which heroes hold r up

**B-naked:** dropping the 10 most influential heroes takes r from 0.121 to **−0.035**. The naked r is an effect of these 10 heroes, each worth Δr ≈ 0.01–0.02:

- Tiny, Gyrocopter, Bounty Hunter, KotL, Legion Commander;
- Lycan, Wraith King, Timbersaw, Sand King, Lifestealer.

**B-full:** without its top 10, r falls from 0.403 to 0.230; those 10 account for 57% of the covariance:

- Bounty Hunter, Tiny, Gyrocopter, Wraith King, Lifestealer;
- Nature's Prophet, Nyx, Arc Warden, Night Stalker, Sand King.

**Heroes that pull r down:** Phantom Lancer, Kez, Spectre, plus Terrorblade and Naga in B-full.

### OpenDota probe (1 call, approved by the author)

`GET /api/publicMatches?min_rank=70` returned HTTP 200 with 100 matches: rank tier 71–75, spanning 0.4 h.

**Fields present:** `radiant_win` (never null), `radiant_team` and `dire_team` (5+5 hero ids), `avg_rank_tier`, `start_time`, `duration`, `game_mode`, `lobby_type`.

**Filters needed:**

- 2/100 matches have duration 0 and hero ids of 0;
- 40/100 are **Turbo (game_mode 23)**;
- 56/100 are ranked All Pick (game_mode 22); 53/100 are in a ranked lobby (`lobby_type 7`).

**Plan (not run, needs a separate ok):**

- About 470 pages via `less_than_match_id`, giving ~25k usable ranked AP matches. That is more than the 262 pages estimated earlier, because about half of each page is filtered out.
- Store only match_id, start_time, duration, radiant_win, both lineups and avg_rank_tier.
- Purpose:
  - a match-level target for Н6.1;
  - a pub out-of-sample check of the hidden tags;
  - a "safe" free of the pro leak.
- One separate `/heroStats` call would give pub picks per hero and pin down the ceiling in Н1.4.

### KT1 conclusions

1. **Scale ≠ rank.**
   - Most of the "dispersion" is scale: favoredRate is 3.5–4.5× wider than real WR. That is built into the sign-of-diff metric; the game's own roll is already at the real scale.
   - The old MAE, ±7 and ≥10 measure scale. From now on decisions use only r, Spearman and MAE_aff.
2. **The rank signal is weak and narrow.**
   - The base is r 0.40 [0.25, 0.54], of which 0.28 is hidden tags (in-sample).
   - Without them r is 0.12, and 10 heroes hold it up. Raw axes alone give 0.15 [−0.05, 0.33].
   - After affine mapping, the model beats "everyone at average" by 0.16 pp of MAE.
3. **Leakage into the pub KPI is none.** The pair channels are pro data and only narrow the scale. Into the pro target they do leak, and the safe has to account for that.
4. **The ceiling is not the bottleneck.** Even at a pessimistic 1k picks per hero it is 0.75; the system sits at 0.12 (naked) / 0.40 (full).
5. **Power:** for structurally different formulas, MDE₈₀ ≈ 0.2 in r. Small improvements cannot be proven at n=127.
6. **Side findings** (class A, not proposals yet):
   - the shutdown channel slightly hurts r (+0.045 [0.025, 0.066] when turned off);
   - the hard-carry penalty and role-fit help;
   - the phase mix 0.15/0.35/0.5 is indistinguishable from uniform.

## KT2 progress — Н4.1, Н3.1, Н5.2, Н4.3 (2026-10-02)

No new external data was used. The results are in:

- `artifacts/lab/kt2/dirichlet-summary.json`
- `artifacts/lab/kt2/regress/regress.json`, `artifacts/lab/kt2/regress/oof-preds.json`
- `artifacts/lab/kt2/scale.json`
- `artifacts/lab/kt2/optimize/optimize.json`

Scripts: `kt2-dirichlet.ts` (+ `-report`), `kt2-regress.ts` (+ `lab-ml.ts`), `kt2-scale.ts`, `kt2-optimize.ts`.

**Attempt counter: 33.** This counts the 31 regression procedures (one family) plus 2 weight-optimiser configs. Dirichlet and the scale layer are measurements, not attempts.

### Н4.1 — Dirichlet null for axis weights

Setup: 20k random weight sets per row (α=1), with the production phase mix and `rwr=0`, replayed exactly on the cache.

| Space | Cache | r of random sets p05 / p50 / p95 / max | Production: r, percentile | All = 1: r, percentile |
|---|---|---|---|---|
| 14 axes, independent per phase | naked | −0.10 / −0.01 / 0.08 / 0.22 | 0.121, **p99.0** | −0.012, p48 |
| 11 axes (prod zeros held) | naked | 0.00 / 0.06 / 0.16 / 0.29 | 0.121, **p84** | −0.012, p3 |
| one set for all phases, 14 axes | naked | −0.13 / −0.01 / 0.12 / 0.29 | 0.121, p95 | −0.012, p48 |
| 14 axes, independent per phase | full | 0.02 / 0.14 / 0.28 / 0.45 | 0.403, p99.9 | 0.160, p58 |
| 11 axes (prod zeros held) | full | 0.12 / 0.24 / 0.40 / 0.53 | 0.403, p95 | 0.160, p16 |

- **Production weights do differ from random**, but most of that is the choice to zero `camp_stacking` and `resource_efficiency`. Inside the 11-axis space, naked production sits only at p84.
- These weights were tuned in previous sessions on the same target, so their percentile is not out-of-sample evidence.
- The median random set leaves the legacy MAE as bad as ever (SD ratio ≈ 4–4.6). Scale does not depend on the weights.
- **Which axes raise r** (Spearman of an axis's weight share vs r over the 20k draws, naked/full, 11-axis space):
  - push r up: `skirmish_rate` +0.63 / +0.61, `saving` +0.45 / +0.47, `control` +0.13 / +0.20;
  - push r down: `teamfight` −0.37 / −0.39, `durability` −0.33 / −0.27, `scaling` −0.23 / −0.19;
  - in the 14-axis space: `camp_stacking` −0.57, `resource_efficiency` −0.29, and `map_control` **+0.21** (production has it at 0).

### Н3.1 / Н3.3 — out-of-fold regressions of real WR on hero features

Protocol:

- Repeated 10×5 K-fold by hero, with an inner 5-fold for every hyper-parameter (ridge, lasso, PLS, stump boosting).
- Null: 204 permutations of the target. For speed the null uses 3×5 repeats, and the p-values compare against the main run at the same 3×5.
- **Family null** (the best of all 30 procedures on each permutation): p95 0.224, p99 0.283.
- Features: axes = 14 `evaluation_values`; pos = position shares; attr; kit = attack type, 8 roles, mobility/vision tiers; consts = 14 base stats from `hero-constants.json`; pop = log of pro matchup games and pro-match picks; bench = 10 per-minute medians from `benchmarks`.

| Procedure | OOF r (10×5) | 95% CI | p (own null) | p (family) | MAE_aff |
|---|---:|---|---:|---:|---:|
| constant / position / attribute | ≤ 0 | — | > 0.3 | 1 | 1.65–1.90 |
| **PLS · axes** (class A information) | **0.317** | [0.13, 0.52] | 0.005 | **0.024** | 1.73 |
| ridge · axes | 0.272 | [0.09, 0.48] | 0.010 | 0.054 | 1.76 |
| lasso · axes | 0.227 | [0.05, 0.45] | 0.015 | 0.14 | 1.78 |
| boosting · axes | 0.045 | — | 0.50 | 0.96 | 1.89 |
| ridge · axes+pos+attr | 0.190 | — | 0.029 | 0.23 | 1.81 |
| any model · B:design (axes+pos+attr+kit+consts) | −0.01…0.07 | — | ≥ 0.1 | ≥ 0.8 | ~1.89 |
| ridge · popularity alone (B-meta) | **0.451** | [0.32, 0.57] | 0.005 | 0.005 | 1.71 |
| **lasso · B:design + popularity** | **0.473** | [0.38, 0.61] | 0.005 | 0.005 | **1.62** |
| ridge · bench (outcome-leaky) | 0.300 | [0.17, 0.48] | 0.010 | 0.024 | 1.78 |
| lasso · everything including bench (leaky) | 0.483 | [0.40, 0.65] | 0.005 | 0.005 | 1.55 |

- **The axes do carry rank information that the Battle formula does not use.**
  - A linear readout of the 14 axes gives OOF r 0.27–0.32, significant against the family null.
  - The Battle formula on the same axes (B-naked) gives r 0.12.
  - The correlation between ridge·axes predictions and B-naked favoredRate is only 0.15.
- **More features make things worse:** 127 heroes are not enough for 60 features. Boosting does not work at all at this n.
- **Popularity is the strongest single factor:** heroes rarely picked by pros have a higher pub WR (r −0.42).
  - It is not a design feature. It is an external "meta" signal (class B-meta, close to C).
  - It does not explain *why* a hero wins, so a player could not be told about it in the recap.
- **Best B model vs the base:**
  - vs B-full: Δr +0.097 [−0.08, +0.28], not significant.
  - vs B-naked: Δr +0.38 [+0.17, +0.57].
- **`benchmarks` are outcome-contaminated.** A hero that wins posts better per-minute numbers *because* it wins. They are reported only as a reference point.

### Н4.3 — optimising the formula's own weights (gate: Н3.1 axes ≥ 0.3 → run)

- **Setup:** a separable ES on log-weights; 11 axes; one weight set for all phases; started from "all = 1", not from production, to avoid leakage. The search uses a 30k-match subset; the final OOF favoredRates are recomputed exactly on 100k.
- **Validation:** 4×5 folds by hero. Null: 204 permutations (1×5 folds, half the generations).

| Cache | In-sample r (upper bound) | OOF r (exact, 100k) | Null p95 | p | Paired Δr vs base | ΔSpearman | ΔMAE_aff |
|---|---:|---|---:|---:|---|---|---|
| naked | 0.362 | 0.229 [0.04, 0.42] | 0.174 | 0.005 | +0.108 [−0.05, +0.26] vs B-naked | +0.109 [−0.06, +0.28] | −0.08 [−0.20, +0.01] |
| full | 0.561 | **0.475 [0.32, 0.61]** | 0.171 | 0.005 | +0.072 [−0.05, +0.20] vs B-full | +0.084 [−0.05, +0.22] | −0.10 [−0.25, +0.06] |

- **Verdict under the frozen criteria: "inconclusive".** It is not shadow (the paired CI includes 0), and it is not kill (the CI's upper bound is above +0.05). The procedure does find signal (p 0.005 against its null), but the improvement over the base cannot be told from noise at n=127. That is exactly the MDE ≈ 0.1–0.2 regime described in KT1.
- **What the optimiser chooses**, as the mean share across OOF fits (naked / full):
  - large shares: `skirmish_rate` 0.44 / 0.25, `saving` 0.16 / 0.21, `objectives` 0.15 / 0.18, `scaling` 0.13 / 0.07, `mobility` 0.05 / 0.14;
  - ≈ 0: `teamfight`, `tempo`, `durability`, `burst`, `initiating`.
- This agrees with the Dirichlet sensitivity map. For the player's story it would mean "fights and saving decide, burst/teamfight do not", which conflicts with the current recap voice. Explainability cost: high.

### Н5.2 — scale layer (fixes SCALE ONLY, not understanding of heroes)

**KPI side** (B-full, OOF maps by hero):

| Map | r | old MAE | ±7 | ≥10 | MAE_aff |
|---|---:|---:|---:|---:|---:|
| none (favoredRate) | 0.403 | 6.37 | 59.8% | 27 | 1.74 |
| OOF affine | 0.378 | **1.76** [1.55, 1.99] | 100% | 0 | 1.76 |
| OOF isotonic | 0.331 | 1.84 | 100% | 0 | 1.81 |

- On B-naked, the OOF affine map gives r −0.02 and MAE 1.90, which equals the constant.
- **The layer "solves" the old metrics completely without adding any understanding.** That is why it must not be counted as a win: r even drops slightly, because the map's parameters have to be estimated.

**Game side** (the tier roll in the random 5v5 pool, B-full):

- Even 20%. Of the remaining fights: Low 50%, Moderate 45%, High 4.7%. The favourite wins **57.5%** of the time.
- Per hero, the production roll gives an SD ratio of 0.65 and a slope real~sys of 0.585.
- So the game *is already over-confident relative to its own accuracy*. A calibrated roll needs slope 1, which comes out to:
  - with High = 1 kept: Low 0.508, Moderate 0.530; the favourite would win 53.3%;
  - with High scaled too: 0.519 / 0.575 / High 0.81; the favourite would win 54.3%.
- Matching the *spread* of real WR instead would take Low 0.554, Moderate 0.718, High 1. The favourite would win 62.7%. That is overconfidence: the spread is bought without accuracy.

**What the player would notice:**

- A calibrated roll means more upsets: about 46% instead of 42.5%. Moderate fights would feel almost like coin flips. High = 1 goes against calibration, since a deterministic win is not backed by the model's accuracy.
- Matching the spread means fewer upsets (37%) and more "predictable" fights.
- The tier thresholds (`moderateAbsDiff` 0.5, `highAbsDiff` 1.3) are not the bottleneck: High already covers only 4.7% of fights.

**Recommendation for Н5.2:**

- Use the scale layer **only in the lab ruler**, to put metrics into WR units and stop optimising for the old MAE.
- Do not change the in-game roll on these numbers. The pool is random 5v5 drafts, not real player-vs-pool battles, and the match-level k can only be identified from real match outcomes (the pub pull).
- Any decision about the roll is a product decision: "how often favourites lose".

### External data — the pull was NOT run

The author's "ok" for ~470 `publicMatches` pages + 1 `/heroStats` call reached me through the coordinator. The environment's permission guard blocked launching the pull: an agent's message does not count as the user's consent.

The script is ready and unused: `server/scripts/lab/fetch-public-matches.ts`.

- Sequential calls, a 1.2 s gap, backoff on 429.
- Resumable; raw pages go only to `artifacts/lab/opendota/`.
- Filters: ranked All Pick (game_mode 22, lobby_type 7), no Turbo, no rows with duration 0 or hero id 0.

It needs to be launched by the author, or by me after a direct permission from the user.

**Update:** the pull was run under the author's direct ok. Result: `heroStats` + 301 pages, **25 074 usable matches** (305 calls, three 429s), stored in `artifacts/lab/opendota/`.

Caveats:

- All matches come from **one ~8-hour window, 2026-10-01 14:48–22:25 UTC**.
- **Divine only** (`min_rank=70`). The hero-meta target is Ancient+Divine as of 2026-08-15.

## Frozen shortlist — FIXED 2026-10-02, BEFORE the safe was touched

Nothing from the safe may be used to change this list or its parameters. The safe is evaluated **once**.

| id | Class | What | Parameters |
|---|---|---|---|
| **BASE** | — | B-full: production formula, all tags, `rwr=0` | production `axis-weights.json` |
| **S1 `es-full`** | A | B-full with **one shared axis-weight set for all phases** (pd 0.15/0.35/0.5 kept); the ES in-sample fit on all 127 heroes (Н4.3, full cache) | shares: skirmish_rate 0.2381, mobility 0.1738, saving 0.1718, objectives 0.1667, scaling 0.1291, control 0.0782, durability 0.0130, tempo 0.0117, burst 0.0084, teamfight 0.0046, initiating 0.0044, map_control / camp_stacking / resource_efficiency 0 |
| **S2 `no-shutdown`** | A | B-full with the shutdown multiplier removed (KT1 side finding) | — |
| **S3 `hero-prior-B`** | B-meta (measurement only) | each team's mean of the hero-level OOF prediction from `lasso · B:design+pop` (Н3.1, `oof-preds.json`) | none fitted on the safe |

**Reference rows (not candidates):**

- B-naked: hidden tags off, used for the hidden-tag check.
- Shipped `rwr=2` (class C).
- Hero-meta winRate prior (class C): the team-mean difference in winRate.
- Constant.

**Primary safe metric:** match-level AUC of the signed score for Radiant, with **pair channels (synergy/matchup) OFF** in every Battle-based row. Brier and log-loss come from a logistic calibration a + b·score, cross-fitted on 2 time halves. Paired bootstrap over matches (1000×). Pair-channel-ON rows are reported separately, for information only.

**Roles:** public matches carry none. (This paragraph continues below the KT3 details.)

## KT3 details (safe run 2026-10-02, `artifacts/lab/kt3/kt3.json`, script `kt3-safe.ts`)

**Ceiling inputs** (`heroStats` 6+7 brackets):

- Picks per hero: min 3 990, median 60 334, max 247 817.
- SD of winRate: August 2.38 pp, October 2.50 pp, window 3.15 pp.
- Reliability: October 0.99; the window 0.77 (median 1 531 games per hero).
- Correlations between targets:

  | Pair | r |
  |---|---:|
  | August vs October | 0.884 |
  | Ancient vs Divine (October) | 0.935 |
  | August vs window | 0.707 |
  | October vs window | 0.836 |

**Hidden tags vs the new targets.** Per-tag mean z of the target, August → October:

| Tag | Direction | August z | October z |
|---|---|---:|---:|
| Summoning Sickness | − | −1.09 | −0.90 |
| Agility Crusher | + | +1.53 | +1.15 |
| Haunt Absolute | + | +1.64 | +1.15 |
| Paper Utility | − | −0.22 | −0.85 |
| Disable Battery | + | +0.31 | +0.46 |
| Raid Boss | + | +0.29 | +0.38 |
| Showstopper Tax | − | +0.46 | +0.43 |
| Tempo Monster | − | −0.28 | −0.27 |
| False Immortal | − | −0.29 | −0.11 |
| Siege Voltage | + | +0.41 | +0.30 |

- Members' standing persists, so the tags track stable hero strength, not August noise.
- Showstopper Tax members are *above* average in real WR while the tag penalises them. Their naked favoredRate was even higher, so the penalty is relative.

**Н6.1, match-level logistic** (time-split halves of the window):

- Team mean-axis differences: AUC 0.539 / 0.548.
  - Positive coefficients: saving, control, skirmish_rate, map_control.
  - Negative coefficients: camp_stacking, tempo, initiating, burst.
  - The hero score this model implies correlates with August WR at r 0.39, but with B-naked favoredRate only at 0.19. The axes are read differently from the formula.
- Hero one-hot Bradley–Terry (L2 λ=1): AUC 0.575 / 0.588. Its strengths correlate with August WR at r 0.68 and with October at 0.79.

**In-game tier roll on real matches:**

| Tier | Fights | Favourite win rate |
|---|---:|---:|
| Low | 9 822 | 51.0% |
| Moderate | 9 253 | 50.8% |
| High | 1 033 | 53.2% |

- Roll Brier 0.262 and log-loss 0.855, against 0.249 / 0.691 for the constant.
- Radiant win rate in the window: 52.98%.

**Roles (continued):** Each side gets the deterministic assignment of 5 roles that maximises Σ log(blended position weight), using the same weights as the self-play pool.

## Решения автора после КТ3 (2026-10-02)

- Парные каналы (синергия/матчапы из про-данных) — проверить на более широкой выгрузке публичных матчей (отдельный предрегистрированный тест).
- Бросок по ярусам: приоритет — читаемость, не калибровка к реальным матчам. Игра сравнивает драфты без исполнения игроков, поэтому явно более сильный драфт должен побеждать чаще, чем в реальных матчах. Калибровку броска к ~51% не делаем.
- Ответы автора на вопросы (2026-10-02): (1) широкая выгрузка — 7 дней, Ancient+Divine; (2) игра стоит на паблик-данных: если проверка подтвердит вред про-пар, пары переводятся на паблик-данные (рефетч с отдельным «ок»); (3) рассказ важнее точности — оси, на которых держится текст боя, остаются; (4) `shutdown` остаётся; (5) ярусы броска 0.53/0.62/1.0 не меняются; (6) код лаборатории коммитится вместе с фазами 1–5.

## Pre-registration: pair channels on public matches — FROZEN 2026-10-02, BEFORE the wide pull

**Origin.** On the 2026-10-01 safe (25k Divine matches, 8 h), production with pairs ON scored AUC 0.511 against 0.527 with pairs OFF: ΔAUC −0.016 [−0.025, −0.008]. That was found *on the safe*, outside the shortlist, so it is a hypothesis to test, not a result.

**Hypothesis H-pairs.** The production synergy and matchup channels (`synergyCoeff` 2, `matchupCoeff` 3, fed by OpenDota **pro** data in `hero-meta.json`) **lower** match-level predictive power on public Ancient+Divine matches.

### Data

- Collected by `server/scripts/lab/fetch-public-matches-wide.ts`:
  - `publicMatches?min_rank=60&max_rank=75`;
  - 168 hourly anchors over 7 days, 8 contiguous pages per anchor;
  - plan: 1 345 calls, ~112k usable matches.
- Filters:
  - ranked All Pick (`game_mode` 22, `lobby_type` 7);
  - duration > 0, no hero id 0;
  - 60 ≤ `avg_rank_tier` ≤ 75;
  - dedup by `match_id`;
  - **exclude every match_id that is in the 2026-10-01 pull**, because that pull generated the hypothesis.
- Roles: same as the KT3 safe — per side, the argmax of Σ log(blended position weight).
- **Minimum for a verdict:** ≥ 50k usable matches, ≥ 5k in each bracket, ≥ 5 distinct days. If it falls short, report "underpowered" and give no verdict.

### Rows (fixed)

All rows use production code, `rwr=0`, all tags ON and production weights:

- **OFF:** `synergyCoeff = matchupCoeff = 0`.
- **ON:** production coefficients.

Secondary rows, for attribution only — they do not enter the decision:

- **SYN:** synergy only.
- **MAT:** matchup only.
- **SHIPPED:** pairs ON and `rwr=2`.

### Metrics

- **Primary:** ΔAUC = AUC(ON) − AUC(OFF) on the signed Radiant score. 95% CI from a paired bootstrap by match, 2 000 resamples.
- **Secondary:**
  - Δlog-loss and ΔBrier. Each row is calibrated by logistic a + b·score, fitted leave-one-day-out (each day is predicted from the other days).
  - ΔAUC split by bracket: Ancient (`avg_rank_tier` < 70) vs Divine (≥ 70).
  - ΔAUC for each calendar day (UTC).
- **Expected power:** SE(ΔAUC) at 25k was ≈ 0.0042, so at ~100k it should be ≈ 0.002 and the minimum detectable effect (MDE₈₀) ≈ 0.006.

### Decision rule (fixed)

**"Hurts" (confirmed)** requires all four:

1. The upper bound of the ΔAUC CI is < 0.
2. The lower bound of the Δlog-loss CI is > 0.
3. The ΔAUC point estimate is < 0 in both brackets.
4. ΔAUC is < 0 on at least 5 of 7 days.

**Other outcomes:**

| Outcome | Condition |
|---|---|
| Neutral | the ΔAUC CI lies inside [−0.005, +0.005] |
| Helps | the lower bound of the ΔAUC CI is > 0 |
| Inconclusive | anything else; report the CI and do not change anything |

- The SYN and MAT rows only say which channel carries the effect.
- One pass, no re-runs with other filters or roles. The analysis script (`kt4-pairs.ts`) is written and committed to this protocol **before** the pages are read.

### Follow-up if "hurts" is confirmed (plan only, no calls)

- **Do not switch the channels off.** The author decided the game stands on public data, so the pair data moves to public.
- **Source.** `/heroes/{id}/matchups` is pro-only, and Explorer `matches` is pro. The pair statistics would therefore be built ourselves from `publicMatches` lineups and outcomes. No new endpoint is needed.
- **Volume per match:** 2·C(5,2) = 20 ally pairs and 25 enemy pairs. There are 8 001 unordered hero pairs.

  | Matches | Ally games per pair | Enemy games per pair (unordered) |
  |---:|---:|---:|
  | 100k | ≈ 250 | ≈ 310 |
  | 300k | ≈ 750 | ≈ 940 |

  These counts are far above the `MIN_GAMES` 10 gate, and above the current pro coverage. `shrinkageK` would still apply.
- **Calls:** ~300k matches over ≥ 14 days, Ancient+Divine, sampled the same way. That is about 3 600 calls, roughly two days at the assumed ~2 000 calls/day free limit.
- **Leakage guard.** Pair statistics come from window A, and any re-evaluation uses a later, disjoint window B.
- **Writes `hero-meta.json`.** That is a Real-Data Recompute and needs its own explicit "ok". The lab would first build it into `artifacts/lab/` and re-run self-play plus a new safe before any production write.

## Result: pair-channel test — **HURTS (confirmed)** (2026-10-02, `artifacts/lab/kt4/kt4-pairs.json`)

Scripts: `kt4-pairs-prepare.ts`, then `build-feature-cache.ts` with `LAB_POOL_FILE=…/wide-pool.json`, then `kt4-pairs.ts`. All three were written before the pages were read. The run was single-pass.

### Data checks

| Check | Result |
|---|---|
| Raw rows | 134 500 |
| `avg_rank_tier` range | 61–75 (0 rows outside 60–75; the rank filter works as assumed) |
| Duplicates | 15 |
| Excluded (also in the 2026-10-01 pull) | 2 875 |
| Unknown heroes | 0 |
| **Usable matches** | **100 078**: Ancient 59 612, Divine 40 466 |
| UTC dates | 8, of which 7 have ≥ 1 000 matches |

All minimums are met.

**Declared deviation.** The rule says "≥ 5 of 7 days". The pull spans 8 UTC dates, and 2026-10-02 holds only 475 matches, so the day criterion was applied to the 7 dates with ≥ 1 000 matches. The outcome does not depend on this: ΔAUC < 0 on all 8 dates.

### Main table

Production code, all tags, `rwr=0`. OFF is the reference.

| Row | AUC | Log-loss | Brier | ΔAUC vs OFF [95% CI] | Δlog-loss [95% CI] | ΔBrier [95% CI] |
|---|---:|---:|---:|---|---|---|
| OFF (pairs 0) | 0.5276 | 0.6901 | 0.2485 | — | — | — |
| **ON (production)** | 0.5154 | 0.6910 | 0.2489 | **−0.0122 [−0.0163, −0.0082]** | **+0.0008 [+0.0006, +0.0011]** | +0.0004 [+0.0003, +0.0006] |
| SYN only | 0.5184 | 0.6908 | 0.2488 | −0.0092 [−0.0126, −0.0061] | +0.0007 [+0.0004, +0.0009] | +0.0003 [+0.0002, +0.0005] |
| MAT only | 0.5228 | 0.6906 | 0.2487 | −0.0048 [−0.0079, −0.0017] | +0.0004 [+0.0002, +0.0007] | +0.0002 [+0.0001, +0.0003] |
| SHIPPED (pairs on, `rwr=2`) | 0.5274 | 0.6902 | 0.2485 | −0.0001 [−0.0041, +0.0036] | +0.0001 [−0.0002, +0.0004] | 0.0000 [−0.0001, +0.0002] |

### By bracket

| Bracket | n | AUC OFF | AUC ON | ΔAUC | Δlog-loss |
|---|---:|---:|---:|---:|---:|
| Ancient | 59 612 | 0.5289 | 0.5161 | −0.0128 | +0.0009 |
| Divine | 40 466 | 0.5256 | 0.5143 | −0.0113 | +0.0007 |

### By day (UTC)

| Day | n | AUC OFF | AUC ON | ΔAUC |
|---|---:|---:|---:|---:|
| 09-25 | 12 241 | 0.5318 | 0.5205 | −0.0113 |
| 09-26 | 14 538 | 0.5240 | 0.5149 | −0.0091 |
| 09-27 | 17 076 | 0.5241 | 0.5154 | −0.0087 |
| 09-28 | 14 900 | 0.5224 | 0.5138 | −0.0086 |
| 09-29 | 15 369 | 0.5293 | 0.5193 | −0.0100 |
| 09-30 | 14 796 | 0.5294 | 0.5066 | −0.0228 |
| 10-01 | 10 683 | 0.5336 | 0.5173 | −0.0163 |
| 10-02 (partial) | 475 | 0.5660 | 0.5571 | −0.0089 |

### Rule check

| Criterion | Result | Met |
|---|---|---|
| Upper bound of the ΔAUC CI < 0 | −0.0082 | ✓ |
| Lower bound of the Δlog-loss CI > 0 | +0.0006 | ✓ |
| ΔAUC < 0 in both brackets | Ancient and Divine both negative | ✓ |
| ΔAUC < 0 on ≥ 5 of 7 days | 7 / 7 | ✓ |

**Verdict: the pro pair channels hurt prediction on public Ancient+Divine matches.**

- Synergy carries most of the damage; matchups carry less.
- In the shipped configuration, `rwr=2` hides the loss: SHIPPED ≈ OFF, because the real-winRate channel offsets it.
- Following the author's decision, the pairs are **not switched off**. The next step is the follow-up planned above: pair statistics from public data. It needs a separate "ok" for about 3 600 calls (~300k matches, ≥ 14 days, Ancient+Divine; window A to build, a later window B to evaluate). The `hero-meta.json` write needs its own Real-Data Recompute "ok".
