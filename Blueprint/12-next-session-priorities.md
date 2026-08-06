# Next Session Priorities

Written at the end of the 2026-08-06 session. This session had three parts: (1) `resource_efficiency` axis (Evaluation-only, damage-per-networth-share) shipped end-to-end; (2) self-play run with the real-winRate crutch disabled (`realWinRateWeight=0`) quantified a structural blind spot (r=-0.068 vs r=0.573 with the crutch) and led to 4 new custom tags (Unseen, Army of Clones, Mass Buffer, Prone To Burst) plus a Statstealer extension; (3) a large batch of UI/product feedback from live use — Evaluation now shows active custom tags, camp_stacking demoted to a >70th-percentile note, win/lose color coding, multi-card top-contributor highlight, bigger font/bolded hero names, and two duplicate-narrative-line cleanups (utility-stacking discount, hard-carry stacking penalty). Full detail lives in `10-tech-debt-backlog.md` — this file is a triage/reading guide, not a new source of truth.

**Status check:** git is clean, everything pushed to `origin/master` (`3a26c15` at session end) — check `git log` for the actual current hash rather than trusting this one. Still no production hosting, still not preparing for a real release.

---

## Open backlog items, in rough priority order

### 1. Tapalka 3D model — bad bind pose (Task #48)
Cosmetic but visible on every page load — the Brewmaster glTF model (`pissang/dota2hero`, no skeletal animation, only raw `.smd` source) renders in its baked bind pose, which reads as awkward/vulgar mid-rotation. User explicitly flagged this. Options already scoped in `10-tech-debt-backlog.md` ("Тапалка — 3D-модель стоит в некрасивой позе"): manual bone-transform override in three.js, narrower wobble instead of full 360° turntable, or fall back to the already-working CSS-only animation for just this widget. Pick one and ship it — this is the most user-visible unfinished thing right now.

### 2. Pro-match pool 100 → 1000 (Task #43)
Scoped, not started. First step is mechanical, not a design decision: run `fetch-pro-matches-tier1.ts` and read its own `Found X tier1-vs-tier1 matches total` log line — that number (not `TARGET_COUNT`) is the real ceiling given the hardcoded 20-team `TIER1_TEAMS` list. If it's well short of 1000, the next decision is whether to grow the team list (manual Liquipedia + OpenDota team_id work, same as the original 20) or relax "tier1 vs tier1" — don't guess, measure first.

### 3. Two research backlog items (Tasks #49, #50)
Both are diagnostic, not implementation:
- **Support-penalty check** — how much does the system (Evaluation + Battle) punish a team with no natural support (`presumed_positions`) vs. one with 1-2 real supports? Likely several mechanisms compounding (`role-fit.ts` dampening, hard-carry stacking penalty, low saving/control on core-heavy teams) rather than one explicit penalty — needs a comparison script, not a code change yet.
- **Strongest/weakest possible draft** — use `simulate-self-play.ts`/`check-axis-distribution.ts` to find what the current system rates as the best/worst 5-hero draft, and whether top-5/bottom-5 hypothetical drafts share a pattern. This is the kind of exercise that already found the axis-multicollinearity issue once — worth doing before the next calibration pass, not after.

### 4. Opponent-pool hero overlap (Task #51)
New this session, not scoped beyond the one-paragraph backlog note. `OpponentPoolService.pullRandom()` has no check against the puller's own drafted heroes appearing on the matched opponent's side — real Dota can't produce that, the current pool can. Needs a decision before code: exclude any overlap entirely, or only exclude full-roster duplicates. Cheap to build once decided (`opponent-pool.service.ts`, same file as the existing `excludingOwn` token check).

## Things NOT to redo without a reason

- **`realWinRateWeight`** must stay at its production value (2) in `axis-weights.json` — it was only set to 0 for the diagnostic self-play run this session and restored after (`git diff` was confirmed clean). Don't disable it again without a specific reason to re-measure the gap.
- **Custom tags overcorrection** — the 4 new tags (round 2) were confirmed to have side effects on non-target heroes during A/B testing. User explicitly accepted this as a flavor-layer tradeoff and declined to reduce magnitudes — don't re-litigate this without new data prompting it.
- **`camp_stacking` removal from breakdown** — intentional (>70th-percentile note only, not a full card). Don't restore it as a category without a new user request.
- **Duplicate-line removals (utility-stacking, hard-carry)** — deliberately removed, not relocated to a note. If a similar "identical sentence repeats across cards" pattern turns up elsewhere, this is the established precedent: ask whether to show once or nowhere, don't default to inventing new note infrastructure.

## Recurring gotchas (still true, worth re-reading before touching these areas)

- **nodemon doesn't reliably pick up server-side `.ts` changes** — if a newly-added field on a shared type causes a client crash right after a server-side edit, restart the server (`preview_stop`/`preview_start`) before assuming it's a real bug.
- **`calibrate-evaluation-values.ts` only writes `heroes.json`** — the running server reads from SQLite. Always follow a calibration run with `npm run seed`.
- **`axisWeightForPhase()` default for a missing axis key is 1, not 0`** — this is why `resource_efficiency` and the new custom tags stayed out of Battle Engine's real `AXES`/`WEIGHTS` rather than being wired in directly; an uncalibrated signal would otherwise pull at full weight.
- **`resize_window` with custom pixel dimensions renders broken** (content squeezed into a corner) — only `preset` values (`desktop`/`tablet`/`mobile`) are reliable in the Browser pane.

## Where to start

Item 1 (tapalka pose) is the cheapest, most visible fix and needs no research — good first pick if the session opens with "what's next." Item 2 (pro-match pool) needs one script run before any real decision. Items 3 and 4 are genuinely exploratory/decision-needed — expect a scoping conversation with the user before code, same as the UI backlog items were handled last session.
