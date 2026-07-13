# Battle Engine

## Purpose

Compare user draft against saved professional teams.

## Input

Team A: User draft

Team B: Stored match draft

## Factors

Battle Engine may consider:

- hero matchups;
- role matchups;
- strategic conflicts;
- power spikes;
- scaling;
- objectives.

## Data Sources (verified against OpenDota)

- Hero matchups: `/api/heroes/{id}/matchups` — direct hero-vs-hero win rate, returned by OpenDota already aggregated. No custom querying needed.
- Strategic conflicts / synergy fit: OpenDota Explorer SQL over `player_matches` (self-joined on `match_id` + team side) for ally win-rate-together data. No built-in endpoint exists for this — queries must be anchored on a specific `hero_id` to stay fast (~1-2s); unfiltered scans over `player_matches`/`public_matches` time out on the shared Explorer.
- Role matchups / power spikes / scaling / objectives: derived from Hero Knowledge Base `evaluation_values`, pending recalibration against `/api/benchmarks?hero_id=X` (see `07-development-plan.md`, Milestone 3).
- No reliable Immortal/6000+ MMR-only data exists in OpenDota's public sample — `public_matches.avg_rank_tier >= 80` returned effectively zero rows in testing, most likely because high-MMR players commonly keep match history private. Practical proxy: average `heroStats` brackets 6+7 (Ancient + Divine) rather than Divine alone, for a larger and still high-skill sample.

## Non-Linearity Rule

Team comparison is NOT a sum of individual hero strengths.

Synergy and counter factors must modify (amplify or dampen) the base comparison, not simply add to it.

Example: a strong counter matchup should reduce the countered team's effective strength, not just subtract a flat number from the total score.

## Accuracy Ceiling

Draft-only comparison has a low accuracy ceiling by nature — outcome is also decided by execution, which Battle Engine does not observe.

Battle Engine must not present output with false precision (e.g. "63.7% win chance").

## Output

Returns:

- Advantage direction (Team A / Team B / Even)
- Confidence tier (Low / Moderate / High) — NOT a raw percentage
- Advantages
- Disadvantages
- Explanation

Explanation is not optional decoration — it is the primary value of the output. A confidence tier without explanation is not useful.

## Important

Battle Engine does NOT use:
Draft Score

Evaluation Engine and Battle Engine are independent.

## Future Calibration (post-MVP)

Once professional matches are imported (see 07-development-plan.md), Battle Engine's confidence tiers should be checked against real outcomes: matches predicted "High confidence" should win noticeably more often than "Low confidence" ones. If not, tiers must be recalibrated — this matters more than raw accuracy.
