# Next Session Priorities

Written at the end of the 2026-07-25 session (a long one — Custom Tags dedup, axis multicollinearity structural fix, battle history redesign, synergy highlight, lore tags, lint cleanup) as a triage/reading guide — not a new source of truth. Full detail on every item here already lives in `10-tech-debt-backlog.md`; this file just says what to look at first and why. Read this before `10-tech-debt-backlog.md`, not instead of it.

**Status check:** still no production hosting, still not preparing for a real release. Both items from the *previous* version of this file are now done — Custom Tags dedup (`shared/customTags.ts`, single source) and the axis-multicollinearity structural fix (composite-weighting the correlated "battle spectrum" cluster) both landed and are validated. This file replaces that one; git is clean, everything from this session is committed and pushed (`ee2a5e5`, `d9c22c8`).

---

## 1. Phantom Lancer — worst remaining underperformer, mechanism already understood

Currently −24.5pp (favoredRate 28.2% vs real 52.7%), the single biggest divergence in either direction. This is the well-documented "avoid the clash" categorical mismatch (his win condition is *not* fighting until he's scaled) — Phase-Aware Resolution fixed most of it earlier in the project's history, but this session's axis-composite discount (durability/objectives/burst/teamfight/scaling all cut to ~1/5 weight) partially undid that improvement, since it touched the late-phase weights those heroes lean on. `scaling`'s late-phase weight was already restored to its original 2.2 (see backlog) — PL improved from −28.5 back to −24.5 but is still worse than the −13.1 baseline before this session's fix.

Best entry point: the mechanism is understood, the fix direction is known (something in late-phase `durability`/`objectives` discount is still hurting him), it just needs the next iteration of digging rather than starting cold.

## 2. Residual overperform cluster — Treant Protector / Nyx Assassin / Keeper of the Light / Batrider

All four still above the 10pp threshold after this session's fixes (camp_stacking sign correction + hand-tuned ability tags for Treant's Eyes in the Forest/Nature's Guise and Batrider's Firefly). Movement was real but modest (~2-3pp each). Treant Protector (+27.3pp) is the extreme case — the *only* hero in the 127-hero pool maxing all 6 "utility" axes (`control`/`initiating`/`mobility`/`saving`/`skirmish_rate`/`map_control`) simultaneously; average real winRate does **not** keep rising with that kind of breadth past ~3 axes, but the additive model has no diminishing-returns mechanism, so it keeps counting each axis at full value.

Not yet touched: Treant's `Nature's Grasp`/`Overgrowth` initiating tags, and Nyx Assassin's ability tags entirely (his profile wasn't reviewed this session). Worth a decision before continuing: keep chasing this cluster hero-by-hero (diminishing returns, same pattern as PL), or treat it as accepted residual noise and move on.

## 3. Unreviewed new anomalies — Phoenix / Monkey King / Snapfire

Not investigated at all this session. Phoenix (+22.4pp, camp stacking topAxis) and Monkey King (+20.6pp, mobility topAxis) and Snapfire (+18.9pp, burst damage topAxis) could be hiding another systemic pattern the way camp_stacking's sign problem was hiding behind the "new" post-fix tail — or they could just be individual cases. Worth a quick profile check (same method as the Treant/Batrider/Nyx investigation: pull `evaluation_values` + `presumed_positions`, look for a shared pattern) before assuming either way.

## 4. Electric custom tag — researched, waiting on a decision

Candidates (Storm Spirit/Leshrac/Zeus/Razor/Dark Seer/Disruptor/Arc Warden) have very high internal dispersion (−25.2pp to +17.5pp real-winRate divergence) — recommendation from the research pass was **not** to make it strongly buffing, something in the common/uncommon-tier magnitude range (~3-10% on one axis), not legendary-tier. Not implemented — needs the user to pick a final roster and sign off on magnitude before it's wired into `shared/customTags.ts`.

## Lower priority / explicitly deferred

- **Lore tags not approved this session**: Nemeton-Touched, Blood Debt, World Tree's Ward — user explicitly declined these three (kept Old Rivals and Reunion, both now live). Don't revisit unless asked.
- **Contributor-highlight UI feature** — blocked on an analyzer output shape change (contributor names are baked into pre-formatted text, not structured per-hero data) plus a UI placement decision. Not started.
- **E2E test automation** — still nonexistent, still verified by hand in the Browser pane every session. Sustainable at current size, flagged every session as something that won't stay that way.
- **Battle Mode pro-match link, contributor highlight, live synergy border** — all previously-blocked candidates from earlier sessions are now either done (pro-match link, synergy border, battle history) or still explicitly blocked (contributor highlight) — see `10-tech-debt-backlog.md` for the up-to-date status of each, don't assume the old blocked-list is still accurate.

## Roadblocks to expect

- **The "mean improves, tail reshuffles" pattern will keep happening.** It's shown up three times this session now (skirmish_rate fix, camp_stacking weight sweep, axis-composite discount) — every structural fix so far has improved the aggregate correlation while shifting *which* heroes are the worst outliers, not eliminating outliers wholesale. Don't expect a single change to produce a clean win with no new tail; budget time to check what got worse, not just what got better.
- **The ability-tagging edit cycle is 3 steps, not 2.** `ability-tagging.csv` → `import-ability-tagging.ts` → **`aggregate-ability-tags.ts`** (easy to forget — this session's first attempt at editing Treant/Batrider showed *zero* effect until this step was found and run) → `calibrate-evaluation-values.ts`. `calibrate-evaluation-values.ts` reads from `ability-tag-aggregates.json`, not directly from `hero-abilities.json`.
- **Manual per-hero overrides (Keeper of the Light's `camp_stacking` −1.5) get silently wiped** by the next full `calibrate-evaluation-values.ts` run, same as the Kez/21-hero batch before it. If revisiting KotL, check whether the override is still in `heroes.json` before assuming it is.
- **Accounts/persistence is still a deferred fork in the road**, not a task — leaderboard, cross-session progress sit behind it.
- **Dual datastore** (local SQLite + separate Postgres for Opponent Pool) is still an intentional MVP exception, fine as-is.

## Where to start

Item 1 (Phantom Lancer) is the best entry point — same reasoning as last time favored Custom Tags: small, well-scoped, mechanism already diagnosed, no product decision needed first. Item 2 needs a judgment call up front (keep chasing vs. accept residual) before diving in. Item 3 is a quick, cheap diagnostic pass that might turn up nothing or might turn up the next camp_stacking-sized finding. Item 4 needs the user, not more analysis.
