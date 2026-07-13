# Development Plan

## Milestone 1 — Local Draft MVP

Implement:

- project initialization;
- React frontend;
- NestJS backend;
- SQLite;
- hero database;
- draft process;
- role assignment;
- local history.

## Milestone 2 — Evaluation Engine

Implement:

- hero tags;
- hero vectors;
- synergy analysis;
- counter analysis;
- team evaluation.

## Milestone 3 — Professional Match Data

Implement:

- OpenDota importer;
- storage of 100 professional matches;
- processing of stored teams.

Data sources (verified against OpenDota's public API/Explorer):

- Hero-vs-hero win rates: `/api/heroes/{id}/matchups` — built-in, no custom querying needed.
- Ally synergy (hero-pair win rate together): OpenDota Explorer SQL (`player_matches` self-joined on `match_id` + team side, anchored on `hero_id` to stay fast — unfiltered scans time out on the shared Explorer).
- Hero positions: `player_matches.lane_role` + `is_roaming` via Explorer, sampled over a recent match_id window (~last 2-3 months of public matches).
- Win rate baseline: `heroStats` rank-bracket buckets (1-7, Herald→Divine). True Immortal/6000+ MMR data is not reliably available — `public_matches.avg_rank_tier >= 80` returns near-zero rows in testing, most likely because high-MMR players commonly keep match history private. Practical proxy: average buckets 6+7 (Ancient + Divine) rather than Divine alone, for a larger and still high-skill sample.
- Stat calibration: `/api/benchmarks?hero_id=X` gives percentile GPM/XPM/kills-per-min/hero damage/hero healing/tower damage per hero — usable to recalibrate Hero Knowledge Base `evaluation_values` beyond the current role-based formula (see `09-hero-knowledge-base.md`).
- All of the above are one-time/periodic snapshot fetches into local JSON, consistent with the Data Rule (MVP works locally) — not live queries at request time.

## Milestone 4 — Battle Mode

Implement:

- user team vs stored team;
- comparison;
- explanation.

The hero-matchup factor should read from data collected during Milestone 3's import (`/api/heroes/{id}/matchups` snapshot), not be queried live.

## Milestone 5 — UI Improvements

Add:

- animations;
- better visualization;
- improved UX.

## Milestone 6 — Battle Engine Calibration (post-MVP)

Implement:

- run Battle Engine confidence tiers against real outcomes of imported professional matches;
- measure calibration (does "High confidence" actually win more than "Low confidence"?), not just raw accuracy;
- adjust evaluation_values / weights in Hero Knowledge Base where calibration is poor;
- do NOT introduce a trained ML model at this stage — recalibrate the existing heuristic first, only consider ML if heuristic recalibration plateaus.

## Milestone 7 — Time-Phased Evaluation & Statistical Counter/Synergy Mining (post-MVP)

Rationale: comparable tools (e.g. DotaDraftWars, Batru, LoLDraftAI) do not use hand-authored hero tags for counters/synergies — they compute win-rate deltas directly from real match co-occurrence data, and split hero strength by game-time phase rather than a single flat number.

Implement:

- split `evaluation_values` into game-time phases (e.g. early / mid / late) instead of one static value per axis;
- Draft Engine / Evaluation Engine UI should be able to show how a draft's strength shifts across phases, not just a single aggregate score;
- once enough matches are imported (builds on Milestone 3), compute `synergy_tags`/`counter_tags` statistically from actual hero-pair win-rate co-occurrence in the imported match set, instead of relying solely on the manual draft in Hero Knowledge Base;
- treat manually-authored tags (09-hero-knowledge-base.md) as the fallback for heroes/pairs with insufficient match data, not as the permanent source of truth;
- do NOT attempt full match simulation (no in-game engine) — this stays a statistical/heuristic model, consistent with the Accuracy Ceiling rule in 06-battle-engine.md.

Data sources (status against what Milestone 3 already collects):

- Ally synergy and hero-vs-hero win rate: already captured per-hero in `server/data/hero-meta.json` (`synergy`/`matchups` fields) by `server/scripts/fetch-hero-meta.ts`, built during the position-data work discussed alongside this milestone. Not yet wired into `synergy_tags`/`counter_tags` — that wiring is this milestone's job, not a new data pipeline.
- Fallback-when-thin pattern: already implemented once, for hero position classification (`client/src/utils/heroRoleColor.ts`'s `classifyPresumedRoleFallback`, used when a hero has no sampled position ≥25% share). The same manual-tag-as-fallback shape should be reused here rather than invented fresh.
- Time-phased stats: NOT yet validated. `/api/benchmarks?hero_id=X` only gives whole-game percentiles, not phase-split. Getting real early/mid/late splits will need new Explorer queries (e.g. `gold_t`/`xp_t` time-series arrays on parsed matches) — this is unverified and should be spiked at the start of this milestone, not assumed to already work like the Milestone 3 sources.
