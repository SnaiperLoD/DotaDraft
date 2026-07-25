# Next Session Priorities

Written at the end of the 2026-07-25 session as a triage/reading guide — not a new source of truth. Full detail on every item here already lives in `10-tech-debt-backlog.md`; this file just says what to look at first and why. Read this before `10-tech-debt-backlog.md`, not instead of it.

**Status check:** no production hosting yet, not preparing for a real release. Priorities below are about codebase health and finishing the core loop properly, not launch-readiness — don't let "is this release-blocking" drive triage right now.

---

## 1. Fix the Custom Tags client/server duplication

`server/src/battle/custom-tags.ts` (drives actual battle math) and `client/src/data/customTags.ts` (drives badge display) are two hand-synced copies of the same tag roster — flagged as tech debt when Custom Tags were built, and this session made the surface area bigger (badges wired into `HeroPool`/`DraftLedger`) without fixing the duplication itself. This is the single most likely source of a *silent* future bug: a badge shows on a hero whose battle math doesn't match, or vice versa, and nothing will error — it'll just be quietly wrong.

Worth doing before adding anything else to Custom Tags. Shape of the fix: one server-served source (e.g. an API endpoint or a shared JSON the client fetches) instead of two TypeScript files kept in sync by hand.

## 2. Stop patching individual heroes, revisit the structural fix

The root cause of most calibration divergence was correctly diagnosed this session: `durability`/`burst`/`teamfight`/`objectives`/`scaling` are highly correlated (the "battle/core-impact" spectrum), so `overallPower`'s equal-weighted average effectively counts that one signal 4-5 times. Phase-aware resolution fixed *part* of this (timing-gated win conditions), but the regression/PCA-based reweighting that was proposed to address the collinearity directly (`regress-composite-clusters-v2.ts` and friends, see `10-tech-debt-backlog.md`) was never finished — the response instead became a long chain of manual per-hero `evaluation_values` edits (Kez, then a 21-hero batch, then partial reverts).

That manual chain works but doesn't scale and will keep needing another batch every time new anomalies surface (classic whack-a-mole — already observed once this session: fixing the top 25 overperformers left new ones at the top of the list). Before doing another manual batch, it's worth finishing the structural approach: use the already-collected data (axis sums, real winRate, duration splits) to derive `overallPower`/`WEIGHTS` coefficients directly instead of hand-tuning one axis at a time.

## 3. UI polish backlog (lower priority, but genuinely close to done)

Still open, all fairly mechanical, no product decisions needed: button redesign, Evaluation panel typography, 5-star rating display for Total Score, `DraftLedger` centering/sizing (the item description is stale — component was renamed from `PickedHeroesStrip`, re-check what's actually still wrong before touching it). Good "finish the last mile" work whenever the two items above are done or paused.

## Roadblocks to expect

- **Accounts/persistence is a deferred fork in the road**, not a task — leaderboard, "series of battles" history, and cross-session progress all sit behind it. Don't half-build one of those without first deciding whether accounts are in scope.
- **Dual datastore** (local SQLite for Draft/Hero/History, separate Postgres for Opponent Pool) is an intentional MVP exception — fine for now, but keep in mind if Opponent Pool ever needs to grow past "one extra Prisma client."
- **No e2e test automation** — every UI change this session was verified by hand in the Browser pane. That's sustainable at current size but won't stay that way; if the UI surface keeps growing, this will start costing real time per session.

## Where to start

Item 1 (Custom Tags dedup) is the best entry point: small, well-scoped, real risk removed, doesn't require any product decision first. Item 2 is bigger and more valuable long-term but benefits from a fresh, unhurried session rather than being squeezed in. Item 3 whenever there's appetite for pure UI work.
