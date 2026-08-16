# Axis regression iteration — factor map & B0 (read-only)

Generated from local `heroes.json` / `hero-meta.json` / honest self-play. **No `axis-weights.json` writes.**

Artifacts:
- `server/data/axis-regression-b0.json`
- `server/data/axis-structure-analysis.json`
- `server/data/axis-flagged-factor-decomp.json`
- `server/scripts/analyze-axis-structure.ts`
- `server/scripts/run-axis-regression-b0.ts`
- `server/scripts/validate-axis-candidates.ts`

## B0 — where we stand (honest, `realWinRateWeight=0`)

| Metric | Value |
|--------|-------|
| Self-play | 5 seeds × 100k, blended |
| Honest r (favoredRate ↔ realWinRate) | **0.199 ± 0.008** |
| avg \|div\| | 8.06 pp |
| flagged (≥10 pp) | **≈41.6** / 127 |
| Pro direction hit-rate | **57.6%** (n=637 graded) |
| Pro tiers (favored win%) | Low 53.1 / Mod 59.7 / High 69.2 |

Production still has `realWinRateWeight: 2` — do not use production-r as primary KPI (circular).

Known cores still in the flagged tail (seed 1): Phantom Lancer (−26.7 pp), Treant/support-skirmish cluster (KotL/Snapfire/Treant over), Phoenix-class overperformers.

## Factor map (data-driven, prefer **k=6**)

Hierarchical clustering on \(1-|r|\); k=5 merges `saving` into the combat blob — **k=6 is the usable map**.

| Factor | Members | Role in the map |
|--------|---------|-----------------|
| F1 Tempo | `tempo` | Alone late in the dendrogram; weak \|partial r\|≈0.05 after axisSum control — less independent than earlier sessions claimed on older data |
| F2 Saving | `saving` | Independent support signal; simple/partial r ≈ **+0.20** (best positive combat-adjacent axis) |
| F3 Camp stacking | `camp_stacking` | Alone; **strongest** \|partial r\| ≈ **−0.25** — sign opposite to positive Battle weight |
| F4 Map / move | `map_control`, `mobility` | r≈0.59; Battle `map_control` weight is already 0 |
| F5 Engage | `control`, `initiating` | r≈0.55; modest winRate signal |
| F6 Combat spectrum | `burst`, `teamfight`, `scaling`, `objectives`, `durability`, `skirmish_rate` | PC1 of PCA (~34% var): burst/scaling/objectives/teamfight/durability; `skirmish_rate` loads opposite on PC1 |

PCA: **6 comps ≥80%**, **8 ≥90%** variance. VIF: `scaling` 9.98, `burst` 5.58, `tempo` 4.6 — collinearity still concentrated in F6.

### Where hand composites from the prior agent were wrong

| Hand composite | Within \|r\| | Signal | Verdict |
|----------------|-------------|--------|---------|
| `damage_dealing` (burst+teamfight) | 0.78 | ≈0 | Averaging two near-noise axes — classic “noise+noise” |
| `pushing_power` (objectives+scaling) | 0.55 | ≈0 | Same; high correlation, no winRate signal |
| `supporting` (saving+map_control) | **0.15** | both positive partial | Not one factor — low within-corr; averaging them diluted the real `saving` signal |
| `movement` (mobility+initiating) | 0.25 | ≈0 | Data pairs mobility with map_control, initiating with control |

Lesson matches backlog: combat is one spectrum counted many times; hand pairs were aesthetic, not factor-true.

## Flagged vs factors (seed-1 honest table, n=40)

- Positions: Support 17 / Carry 9 / Offlane 8 / Mid 6; hard-carry share ≥0.5: **14**
- Most common **top factor score** among flagged: **F3 camp_stacking (14)** — not “fix by downweighting combat alone”
- Underperformers (favored≪real) have **higher** mean `skirmish_rate` (6.13) than overperformers (4.41) — Support-heavy tail / mean-vs-tail pattern already documented
- Tags on flagged are mostly generic (`teamfight`, `pick_off`, `poke`) — not a clean tag-only story

## Candidate nested validation (S1/S2/S3)

Honest self-play 3×60k + pro calibrate vs B0 (r≈0.199, flagged≈41.6, proDir 57.6%).

| ID | Honest r | flagged | proDir | Pass? |
|----|----------|---------|--------|-------|
| B0 | 0.199 | 41.6 | 57.6% | baseline |
| S1 equal-share within k=6 factors | **0.128** | 44.7 | 58.1% | **no** (r collapsed; flagged worse) |
| S2 combat mid-budget by \|partial r\| | **0.143** | 44.3 | 58.1% | **no** (r down) |
| S3 within-pos skirmish z vs winRate | r_raw 0.171 → r_z **0.104** | — | — | **no** (worse) |

S1 pathology worth noting: first equal-share pass also revived `map_control` (0→0.5) by pairing with mobility — builder now pins dead axes; even without that, cutting `skirmish_rate` 1.3→0.417 inside F6 equal-share destroys the best positive signal.

**Verdict:** no S1/S2/S3 candidate meets stop criteria. **Do not write those.**

## Applied trial (user approve 2026-08-16): `T_camp0`

Refined trials (keep skirmish/saving; only touch camp / pure-combat):

| ID | Honest r | ΔB0 | flagged | proDir | Pass |
|----|----------|-----|---------|--------|------|
| **T_camp0** | **0.228** | **+0.028** | 42.0 | 57.6% | **yes — applied** |
| T_camp02 | 0.216 | +0.017 | 41.3 | 58.1→57.8 | yes |
| T_combatEq | 0.196 | −0.003 | 42.0 | 57.7% | no |
| T_camp0_combatEq | 0.227 | +0.027 | 42.3 | 57.8% | no |

Production change: **not applied** (agent over-applied; reverted). Offline winner remains `T_camp0`. See `axis-weight-trials.json`.

## Apply gate

Status: **blocked** — write to `axis-weights.json` only after an explicit “пиши веса / apply” approve. Trial numbers are evidence only.



