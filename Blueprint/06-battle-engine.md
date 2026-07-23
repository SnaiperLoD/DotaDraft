# Battle Engine

## Purpose

Compare the user's draft against an opponent draft pulled asynchronously from the Opponent Pool, and resolve a game-legible outcome — not just an analytical comparison. See Project Overview (`00-project-overview.md`) for why: this project is a browser strategy draft game first, an analytics tool second.

## Input

Team A: User draft

Team B: A draft pulled from the Opponent Pool (see below) — a snapshot/copy, not a live opponent.

## Opponent Pool

Two sources, different roles:

- **Player-submitted drafts** — the primary, ongoing pool. Players commit their own completed drafts; other players' Battle Mode runs asynchronously pull a copy to fight against. Requires shared, dynamically-updated storage (explicit exception to the Data Rule / MVP Rule in `01-core-rules.md` — the rest of the app stays local).
- **Imported professional drafts** (`07-development-plan.md`, Milestone 3) — initially used to bootstrap/calibrate the system (known-strong compositions to test Evaluation/Battle output against). Longer-term, these settle into a premium-tier or easter-egg role in the pool rather than being the primary opponent source, contingent on Evaluation Engine actually confirming their strength.

Matching is asynchronous by design: no live opponent, no real-time negotiation — a draft is pulled from storage as a fixed snapshot at battle time.

Difficulty brackets / strength-based rating of pooled drafts (so stronger drafts face stronger opponents, with pro drafts as the practical ceiling) is post-MVP — tracked in `10-tech-debt-backlog.md`, not required for the first version of Battle Mode.

### Implementation Decisions (MVP)

Closed before Milestone 4 code, per `01-core-rules.md` MVP Rule / Data Rule exception:

- **Hosting:** no new VPS, no separate microservice (keeps MVP Rule intact). Opponent Pool lives inside the existing NestJS server, but reads/writes through a second, isolated Prisma client pointed at a managed free-tier Postgres (e.g. Neon/Supabase) — not the local SQLite datasource used by `Draft`/`Hero`/`History`. Keeps the exception contained to this one subsystem rather than migrating the rest of the app off SQLite.
- **Anonymous identification:** no accounts. A random UUID token is generated client-side on first visit, stored in `localStorage`, and sent as `submitterToken` on commit. It exists only as a loose anti-abuse handle (e.g. future per-token rate limiting), not an identity system.
- **Moderation/anti-spam:** none at MVP. The only guard is structural — only a `Draft` already in `COMPLETED` status (5 heroes, all roles assigned, enforced by existing `draft.service.ts` validation) can be committed. Low user count at launch means low risk; revisit if abuse actually shows up. Tracked as a deferred item in `10-tech-debt-backlog.md`, not built now.
- **UI:** a separate, optional "Commit to Pool" action, shown after Evaluation results (not required to view them) — same idle-button → request → confirmation pattern as `EvaluationPanel`, placed directly after it on the completed-draft screen.

## Session Shape

One draft per visit, no persistent cross-session progress in the MVP (no accounts, no currency, no unlocks — see `00-project-overview.md` Future Possibilities for when that might change). Replayability within a visit comes from running a **series of battles** with the same committed draft against different pulled opponents, not from meta-progression.

Monetization note (see `00-project-overview.md`): the series-of-battles loop must not introduce interstitial/rewarded-video breakpoints between battles — ads are static banner slots reserved in the screen layout (Draft/Evaluation/Battle result), not triggered by flow events.

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
- Role matchups / power spikes / scaling / objectives: derived from Hero Knowledge Base `evaluation_values` — 10 of 11 axes are calibrated against real OpenDota data blended with hand-tagged ability data (benchmarks + Explorer composite queries + per-ability CSV tagging), not the original role-formula; see `09-hero-knowledge-base.md` for the full methodology. The 11th axis, `initiating`, is calibrated but not yet consumed by Battle Engine's own `AXES` list (see `10-tech-debt-backlog.md`).
- No reliable Immortal/6000+ MMR-only data exists in OpenDota's public sample — `public_matches.avg_rank_tier >= 80` returned effectively zero rows in testing, most likely because high-MMR players commonly keep match history private. Practical proxy: average `heroStats` brackets 6+7 (Ancient + Divine) rather than Divine alone, for a larger and still high-skill sample.

## Non-Linearity Rule

Team comparison is NOT a sum of individual hero strengths.

Synergy and counter factors must modify (amplify or dampen) the base comparison, not simply add to it.

Example: a strong counter matchup should reduce the countered team's effective strength, not just subtract a flat number from the total score.

## Accuracy Ceiling

Draft-only comparison has a low accuracy ceiling by nature — outcome is also decided by execution, which Battle Engine does not observe.

Battle Engine must not present output with false precision (e.g. "63.7% win chance") — this applies to what's *displayed*, not to internal computation (see Resolution below, which does use a precise internal weight to decide the shown outcome; that number itself is never surfaced).

## Resolution

Battle Mode needs a game-legible result (win/lose, or similar), not just an analytical comparison — but must not fake precision doing it. Approach: Confidence Tier maps to an internal win-weight band (e.g. High -> weighted strongly toward the favored side, Moderate -> moderately, Low -> close to a coin flip), and the shown Win/Lose result is resolved from that weighted random draw. The user sees the resolved outcome, the Confidence Tier, and the Explanation — never the internal weight or a raw percentage.

This keeps the Accuracy Ceiling rule intact: the dishonesty being avoided is claiming false *certainty*, not having a resolved outcome. A weighted coin flip that's honest about being "Low confidence" is not false precision; a headline "63.7%" would be.

### Upsets

The underdog must have a real, non-trivial chance to win — a 55/45 matchup is not "Team A wins, occasionally randomized," it's a genuine coin flip with a lean. Never floor the underdog's internal weight to near-zero regardless of Confidence Tier; even "High confidence" favorites should lose sometimes, or the tier system is just a disguised deterministic outcome.

When the underdog wins, the Explanation must not just restate why the favorite should have won — it needs to account for the actual result, in-universe: real, specific advantages the underdog draft did have (every draft has some, even a losing matchup isn't advantage-free) framed as "why this could plausibly happen," not "the model was wrong." E.g. "Team B's draft leaned Team A's way overall, but Team B's pick-off potential and Team A's lack of vision control made an early upset plausible." This means Explanation generation has to branch on the resolved outcome, not just describe the static pre-battle comparison — a template that only ever justifies the favorite winning will read as broken the first time an underdog does.

## Output

Returns:

- Resolved outcome (Win / Lose, or equivalent) — see Resolution
- Advantage direction (Team A / Team B / Even)
- Confidence tier (Low / Moderate / High) — NOT a raw percentage
- Advantages
- Disadvantages
- Explanation

Explanation is not optional decoration — it is the primary value of the output. A resolved outcome or confidence tier without explanation is not useful.

## Important

Battle Engine does NOT use:
Draft Score

Evaluation Engine and Battle Engine are independent. The Resolution mechanic above is Battle Engine's own internal weighting, not a reuse of Evaluation Engine's Draft Score.

## Future Calibration (post-MVP)

Once professional matches are imported (see 07-development-plan.md), Battle Engine's confidence tiers *and* resolution weighting should be checked against real outcomes: matches predicted "High confidence" should win noticeably more often than "Low confidence" ones, and the resolved Win/Lose rate at each tier should roughly track the tier's real-world win rate. If not, tiers and weighting must be recalibrated — this matters more than raw accuracy.
