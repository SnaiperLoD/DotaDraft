# Next Session Priorities

Updated 2026-08-17 after the i18n + TI-finals + late-split-pusher pass.
Handoff / triage; `10-tech-debt-backlog.md` is the detailed source of truth.
Deploy notes: `13-deploy.md`.

**Status check:** hosting files are in-repo — pick a host and finish DNS/TLS.
Live Eval/Battle copy is RU/EN via `I18nLine`. `npm run lint` / `format:check`
may still be red on an old scripts pile — do not mass-format as a drive-by.

---

## Next session — priorities in order

### 1. Read the funnel (now that it exists)

Use `window.__DOTADRAFT_TELEMETRY__.dump()` after real play sessions, and/or
SQLite History aggregates (completed drafts, % evaluated, fights per draft).
Decide from signal — not taste — whether Story/Explanation still needs work
or whether hosting/instrumented multi-user analytics is the next step.

### 2. Product validation before more surface area

Lock-hero / pool-of-8 / items / build orders stay parked until there is a
signal they are needed. Avoid another broad feature/UI pass driven only by
taste.

### 3. Calibration work: pause by default

Do not start another coefficient/tag/weight pass merely because an outlier
looks ugly. Pick one hypothesis, define a holdout and acceptance metric, get
explicit user approval, run reproducible seeds into `artifacts/` (not
`server/data/` commits), and compare with the production baseline.

## Completed this pass (2026-08-17, later)

- **Full product i18n** — server Eval/Battle narratives emit `I18nLine`
  (`eval.*`, `battle.explain.*`, `battle.highlight.*`); client renders via
  `i18n/narrative.ts` + catalogs. Chrome/axes/tags/badges/percentiles/Tapalka
  already catalogued. Legacy History English strings still display as stored.
- **TI Finals badge** — frozen grand-final match IDs (TI 2012–2025), icon on
  Battle faceoff + result opponent. Not leagueName. Append IDs after TI 2026 GF.
- **Late split-pushers** — Phantom Lancer and Tinker got `late_game_scaling`;
  dual-tagged heroes are not the early side of split_push × late anti-synergy
  (Lycan+Medusa still flags).
- **TI form copy** — dropped the win-rate tie-break sentence on the draft
  waiting-room table.

## Completed this pass (2026-08-17)

- **Artifact hygiene** — ~91 research/self-play/debug dump files
  `git rm --cached` from `server/data/`; gitignore patterns + `artifacts/`
  policy (`artifacts/README.md`, `server/scripts/lib/artifact-paths.ts`).
  Runtime snapshots and compact summaries stay tracked. Files remain on disk
  locally so old scripts still read them.
- **Local telemetry** — `client/src/telemetry/` ring buffer; funnel events
  for session → draft complete → evaluate → battle enter/fight/outcome →
  copy/commit → Tapalka. Devtools dump on `window.__DOTADRAFT_TELEMETRY__`.

## Completed since the previous priority list

- **Battle story on the server** — `server/src/battle/battle-story.ts` emits
  four beats (`opening | turn | conversion | finish`) with `key` / `params` /
  `evidence`. Cast and the converting matchup are taken from the **winning**
  side (`bestMatchupEdge`), not the player's best/worst rows. `cameFromBehind`
  = winner won fewer lanes than the loser. Upset is a beat key (High Skill
  uses `turningUpsetHighSkill` when a swing hero is set). React
  `BattleStory` only interpolates i18n. Jest covers Win / Lose / comeback /
  even lanes / upset. No new invented flavor.
- **Playwright critical path** — `npm run test:e2e`. Nest on `127.0.0.1:3012`
  via `e2e/start-server.cjs` (temp SQLite + seed from existing
  `server/data/heroes.json`, no OpenDota refetch). Vite on `127.0.0.1:5175`.
  Battle is mocked. CI installs Chromium, runs the suite, uploads the HTML
  report. Screenshots are artifacts, not git goldens.
- **Tapalka / a11y / mobile** — static portrait on `max-width: 720px` or
  `prefers-reduced-motion` (three.js chunk not loaded). Keyboard path
  Draft → roles → Eval → Battle. Cool-light `--ink-faint` darkened;
  Evaluation/Battle collapse to one column and wrap matchup rows.
- **Named draft archetypes** — shipped in Evaluation.
- **Win Streak** — shipped as session-run W/L, current win/loss streak and best
  win streak.
- **Opponent freshness / pro context** — shipped with weighted selection and
  current TI data. The old generic “100 -> 1000” pool target is no longer an
  immediate task.
- **UI quick wins** — draft copying, history metadata, full-width selection,
  light-theme cleanup and advertising removal are shipped.

## Superseded priority snapshot (historical)

The section below is retained as research history. It is not the current work
order; use the priorities above and `10-tech-debt-backlog.md`.

### 1. Self-play tag divergence — custom tags moved some heroes the WRONG way

> **Обновление 2026-08-10.** Прогнан честный прогон (`realWinRateWeight=0`, заглушка `manual-power-overrides.json` пуста, сиды 1-5, 300k матчей, оба режима ролей) — цифры и полный разбор в `10-tech-debt-backlog.md`, «Честный прогон самоигры без заглушки». Кратко: r=0.177/0.181, **47-49 флагнутых из 127**, разброс между сидами ничтожный. Два вывода, меняющие постановку этого пункта:
> 1. **Стратегию «изолировать и перепрогнать» можно не начинать с нуля** — режимы `blended` и `strict` дали одинаковый результат, значит per-role калибровка и мискаст-фолбэк не являются источником дивергенции, и этот слой из подозреваемых выбывает.
> 2. **Часть тегов расходится на собственных носителях в противоположные стороны** (`Army of Clones`: Naga +17.7 / Terrorblade +11.2 против Phantom Lancer −26.8; `Unseen`: Nyx +14.2 против Riki −12.4). Единый множитель на неоднородный архетип — вероятная корневая причина, а не «слишком много изменений за прогон».
>
> Один архетип уже вылечен: `Summoning Sickness` (см. бэклог) свёл пятёрку переоценённых саммонеров с +13.9..+21.4pp к среднему +0.04pp на полной сетке из 10 прогонов, а по всей базе героев — r 0.177→0.244 и 48→41.6 флагнутых. Остальные кластеры (`Army of Clones`, `Unseen`, `Prone To Burst`) не тронуты и остаются главным содержанием этого пункта.
A fresh no-crutch self-play run (100k matches, after all of today's fixes) found r=0.090 (barely better than July's -0.068) and **22 flagged heroes, up from 16**. Specific regressions: **Riki** (tag: Unseen) got worse, not better (-11.1pp → -14.1pp). **Enchantress** (tag: Prone To Burst) got worse (+11.8pp → +16.0pp). **Bounty Hunter/Nyx Assassin** (also Unseen) are now newly overrated, weren't flagged before. Too many changes landed in one run to attribute cleanly (4 tags + Storm Spirit + Mass Buffer fix + position hybrid + miscast penalty, all at once) — this needs either an isolated revert-and-rerun cycle per change, or accepting the noise and moving on. User hasn't picked a direction yet — ask before diving in, this could easily eat a whole session if done by brute-force isolation.

### 2. Pro-match pool 100 → 1000
Scoped, not started, unchanged from last time this file was written. First step is mechanical: run `fetch-pro-matches-tier1.ts` and read its own `Found X tier1-vs-tier1 matches total` log line — that number (not `TARGET_COUNT`) is the real ceiling given the hardcoded 20-team `TIER1_TEAMS` list. If short of 1000, decide: grow the team list, or relax "tier1 vs tier1."

### 3. Named draft archetypes (Balance/Split-push/Push/4+1 etc.)
Not started. Needs a design decision before code: what rule classifies a drafted team into an archetype (likely a combination of axis percentiles — e.g. high `map_control`+`mobility` → Split-push), and where it displays (Evaluation summary? a badge next to Active Combos?). Don't guess thresholds without checking they produce sensible results against real drafts first.

### 4. Win Streak for a draft
Not started. Needs one clarifying question before code: streak for the specific committed draft as an OPPONENT in the pool (`OpponentPoolService`, needs a new field/aggregation), or the calling player's own personal streak by `submitterToken` (parallel to the existing weak leaderboard)? Different data model either way.

### 5. Support-penalty research — half-answered, the bigger half is still open
Axis-level check (≈65% of Evaluation's weight) found NO penalty for a supportless team — if anything a slight reward, driven by the already-known axis-multicollinearity cluster (teamfight/scaling/burst/durability/objectives). But `synergy` (0.3 weight, the single largest factor) was never tested — it needs `HeroMetaService`/DB and wasn't worth standing up for a first pass. Hypothesis: real co-pick synergy data should punish a 5-core lineup hard (that composition essentially never appears in real pro drafts), which could reverse the axis-side conclusion. Next step if picked back up: run `createSynergyAnalyzer` with a real `SynergyLookup` on the same two test teams (5 cores w/ 2 forced into Support vs. 3 cores + 2 real supports) used for the axis-side check.

### 6. Role-conditional axis values for dual-role heroes (Carry/Mid vs Support) — new, research only
User's request (2026-08-06): heroes who genuinely play both a core and a support role (Windranger, Beastmaster, Batrider, Timbersaw) currently get ONE averaged `evaluation_values` set regardless of which role they're drafted into — `roleFitValue()` only proportionally amplifies an already-high number, it doesn't recompute the axis from role-specific games. Feasible in principle (GPM-rank-filtered OpenDota Explorer queries, same technique `research-role-fit-gpm-rank.ts` already uses for `presumed_positions`) but touches ~6 separate fetch scripts and, if carried all the way through, the `Hero.evaluation_values` type itself plus everything downstream that reads it (axis analyzers, hard-carry/utility-stacking, percentile references, self-play tooling). **Don't build the full pipeline speculatively** — first cheaply check with a point script whether the role-split signal for 3-5 obvious dual-role heroes is actually large enough to justify it.

## Things NOT to redo without a reason

- **`realWinRateWeight`** must stay at production value (2) in `axis-weights.json` — only set to 0 for diagnostic self-play runs, always restored after (verify `git diff` is clean on that file before moving on).
- **Custom tags overcorrection (round 2 tags)** — confirmed side effects on non-target heroes were already accepted as a flavor-layer tradeoff once; item 1 above found NEW divergence since then though, so this is no longer settled — don't assume "already relitigated and closed."
- **`camp_stacking` removal from breakdown** — intentional (>70th-percentile note only). Don't restore as a full category without a new request.
- **Duplicate-line removals (utility-stacking discount, hard-carry penalty)** — deliberately removed, not relocated. If the same "identical sentence repeats across cards" pattern shows up elsewhere, ask show-once-or-nowhere, don't default to new note infrastructure.
- **Evaluation totalScore's percentile-transform** — `axis-percentile-distributions.json` is now load-bearing for the headline score, not just breakdown-card pills. Any change to `WEIGHTS`, `BASE_ANALYZERS`, or `createSynergyAnalyzer`'s scoring in `evaluation.service.ts`/`synergy.analyzer.ts` needs `compute-axis-percentiles.ts` rerun afterward, or the reference population goes stale (exactly what happened mid-session today with the worst-synergy-pair addition — caught and fixed, but easy to forget next time).
- **`RoleAssignment.tsx`'s role-steal** — uniqueness of `roleByHero` is now a construction invariant (every write path removes the previous holder), not a post-hoc check. Don't reintroduce a `rolesAreUnique`-style validation pass; if a bug shows up here, the bug is in `handleRoleChange`, not in a missing check.

## Recurring gotchas (still true, worth re-reading before touching these areas)

- **Playwright E2E binds 127.0.0.1:3012 + 127.0.0.1:5175**, not 3001/5173, and
  seeds a temp SQLite under `os.tmpdir()` — a `file:` URL through the repo path
  dies on the space in `Claude Projects`. Vite needs `--host 127.0.0.1` or the
  ready-probe hits IPv6 localhost and times out. Battle is mocked; draft/eval
  hit the seeded roster. `reuseExistingServer` is false.
- **nodemon doesn't reliably pick up server-side `.ts` changes** — bit us again this session (a live opponent-pool test showed a real hero-overlap bug that turned out to just be a stale server). Restart (`preview_stop`/`preview_start`) before trusting a "the fix didn't work" result.
- **Vite's `optimizeDeps` cache for the `shared` workspace package doesn't auto-invalidate** on a `shared/dist` rebuild — if a shared-package change doesn't seem to reach the client, `rm -rf client/node_modules/.vite` before restarting, not just restart alone.
- **`calibrate-evaluation-values.ts` only writes `heroes.json`** — the running server reads SQLite. Always follow with `npm run seed`.
- **The Browser pane sometimes reports "not displayed" and `requestAnimationFrame` genuinely stops firing** while it's in that state (confirmed this session — not just a screenshot-tool quirk, real app rendering pauses too). A workaround that worked repeatedly: grab a `renderer`/`scene`/`camera` (or whatever's needed) via a temporary `window.__debugHook`, call the render/action manually and synchronously, read the result, then remove the hook before finishing. Small `canvas.toDataURL('image/jpeg', 0.5-0.6)` at a downscaled size (~90-130px) transcribes reliably through the tool round-trip; the full-size PNG capture got corrupted more than once.
- **`axisWeightForPhase()` default for a missing axis key is 1, not 0** — why `resource_efficiency` and custom tags stay out of Battle Engine's real `AXES`/`WEIGHTS`.
- **`resize_window` with custom pixel dimensions renders broken** — only `preset` values are reliable.

## Where to start

Start with current priority 1 (Git as calibration artifact store) for repository
health, or priority 2 if the goal is to learn from real play before adding
surface. Do not begin with another calibration sweep or broad visual redesign
without a narrower question and explicit acceptance criteria.

---

## Session log — 2026-08-16 (UI/functionality: Battle story, E2E, cleanup)

Scoped **out**: coefficients / tags / weights / `axis-weights.json` /
`realWinRateWeight`; live OpenDota refetch; Git-LFS artifact move; product
analytics SDK; ads; new mechanics (lock hero, pool of 8, items).

**Battle narrative.** New `buildBattleStory` next to `buildLaneResults` in
`BattleService.fight`. Shared type `BattleStory` is required on
`BattleResultResponse`. Client dropped hero-selection logic; i18n split the
old three-phase copy into four beats and added upset keys. Copy stayed flavor
(rune / triangle / Roshan / buyback) with the existing disclaimer.

**E2E.** Root Playwright. Windows gotchas that will bite the next person:
repo path has a space, so Prisma `file:../../database/e2e.db` is poison —
`start-server.cjs` uses `os.tmpdir()/dotadraft-e2e-{PORT}.db` and `prisma db
push` + local `heroes.json` seed. Vite must bind `--host 127.0.0.1` or
Playwright's `127.0.0.1:5175` probe ECONNREFUSED on IPv6 `localhost`. Do not
kill whatever is already on 3001/5173. Hidden-tag assertions must target
`data-tag` / tag name (Silencer still shows public Global / Disable Battery).
Keyboard picks have to wait for `.draft-progress-count` or Enter races the
in-flight disable.

**UI.** Tapalka `data-testid` `tapalka-static` / `tapalka-3d`. Role tooltips
on the rail drop below portraits and clamp first/last slot. No new chrome.

Follow-up the same day (still UI, still not a redesign): skip-to-content;
mobile nav Escape / click-outside / viewport close / body scroll lock;
Leaderboard stacks into a labelled grid below 700px instead of sideways
scroll; History battle dates wrap; language toggle `aria-pressed`; legend
closes on Escape.

---

## Session log — 2026-08-15 (session 2: role-fit, leaderboard, tags, synergy, UI)

Long session, all committed and pushed straight to master (last hash `216add0`
at time of writing — check `git log` for the true tip). Dates in the individual
entries below are labelled 2026-08-13 (continuing the prior session's header);
the actual calendar date was 2026-08-15. Index of what landed, newest first:

- **Synergy negative signals** — game-plan-conflict archetype rules
  (split_push/deathball × late_game_scaling, e.g. Lycan+Medusa) + always-show the
  worst real pair when negative. Reran compute-axis-percentiles.
- **Battle question answered** (no code): our tags + weights apply to the
  opponent draft symmetrically, player or pro.
- **Verdict relabel**: 2★ Even→Weak/Слабо, 3–3.5★ Strong→Workable/Рабочий драфт.
- **Bold hero names** in the Battle outcome write-up.
- **Extreme axis-narrative bands** (veryLow <10 / veryHigh >90).
- **No-repeat matchmaking** within a run (hard constraint).
- **Tag fixes**: Treant→Unseen, Legion Commander + KotL→Healer; Spirit Breaker
  Global was a stale-dist/Vite-cache issue (rebuilt, cleared).
- **Two-part leaderboard**: added "Best Runs" (player session drafts) alongside
  the existing pool-opponent board.
- **ROLE_AXES revision (E)**: Mid +tempo, Soft Support −skirmish_rate, Offlane
  initiating boost strengthened (ROLE_AXIS_BOOST_WEIGHT); map_control→Carry
  skipped (inert). Recomputed round-3 correlations to drive it.
- **Core-miscast penalty** (backlog item 1): symmetric −10% for a support forced
  into a core slot.
- **Pool coverage audit** (backlog item 8): CLOSED, no bug.

Backlogged this session (see 10-tech-debt-backlog.md items 12-16): creature-type
tags (Void/Undead/Demon), active-jungler counter-synergy + jungle-farm research,
Pure Draft mode, Spirits tag (feasibility assessed), Laning Efficiency axis +
per-lane Battle verdict. Position-weighted scaling (D) validated and NOT built
(no signal on the 100-match pool).

Detail entries follow (labelled 2026-08-13):

**Backlog item 8 (draft pool core/support spread) — audited, CLOSED, no bug.**
New repeatable check `npm run audit-pool-coverage [numDrafts]`
(`server/scripts/audit-pool-coverage.ts`) drives the real
`HeroService.randomPool` + `ensureRoleCoverage` over full 5-round draft chains.
Findings on live data: the binary guarantee (>=1 Support AND >=1 core per pool)
holds with **0 violations across 100k pools**; live SQLite matches the data
files (all 127 heroes have populated `presumed_positions`, no roles-tag
fallback in use, so no stale-seed drift). The user's "feels like it isn't
working" is explained by the guarantee being weaker than the mental model: it
promises only >=1 of each, not a balanced split — 36.6% of pools show exactly 1
Support, 18% show only 2 distinct primary positions. Granular gaps the
guarantee never covered (Carry/Mid/Offlane) are small: <0.5% of drafts never
offer a Mid or Offlane, ~0.9% can't source a standard 1C/1M/1O/2S. Not a bug;
strengthening to positional coverage is an open design choice, not done.

**Backlog item 1 (role-fit under-weight; 4-support+carry scored Elite) —
core-miscast penalty ADDED.** `common/role-fit.ts` gains
`coreMiscastMultiplier`, the symmetric complement to `supportMiscastMultiplier`:
a hero with ~0 combined core share (Carry+Mid+Offlane summed) forced into a
core slot takes a flat -10%, just as a non-support forced into Support already
did. Threshold 0.05 (presumed_positions is cleanly bimodal — 41 heroes at
exactly 0 core share, 86 at >=0.30, nothing between — so it's robust anywhere in
(0.05,0.30)). Applied at both call sites (`axis.analyzer.ts`,
`battle-resolution.ts`'s `axisAverage`) alongside the support one; the two are
disjoint by role so at most one fires. 316/316 jest green (two pre-existing
role-fit tests were under-specified — synthetic cores with empty
`presumed_positions` — and got real positions). Measured on the exact
Terrorblade(Carry)+4-support draft (two supports miscast into Mid/Offlane): the
weighted **axis subtotal drops 4.06 -> 3.93 (-3.4%)** (Control/Skirmish -0.30,
Tempo -0.20). Real but modest — it's -10%/miscast-hero, and the headline is
further diluted by synergy's unchanged 0.3 weight + the percentile transform.
CALIBRATION DEBT: the -10% is eyeballed, mirrored from the support side, NOT
self-play calibrated. Flagged hypothesis in the code: a pure support at Carry
may be a worse miscast than a carry at Support (no scaling/farm fallback),
which would argue for a harsher core penalty — the lever to pull if the intent
is to actually knock 4-support drafts out of Elite rather than just dent them.

**ROLE_AXES revision (E, backlog item 9) — partial, data-driven.** Recomputed
the round-3 role-fit correlations from scratch (evaluation_values_by_role vs
per-role overperformance, restricted to heroes with real data in >=2 roles,
n=25-38 — matches the methodology the role-fit.ts header cites). Applied the
user's calls after seeing the table: **Mid gained `tempo`** (r=+0.211, a
fully-weighted axis) and **Soft Support lost `skirmish_rate`** (r=-0.202 — a
reward-only boost was pushing the wrong way). Two requests were flagged and NOT
applied as-is: (a) **`map_control` -> Carry is inert** — map_control is weight 0
in all axis-weights.json blocks AND absent from Evaluation's BASE_ANALYZERS, so
adding it does literally nothing (same class as the "Reunion does nothing"
finding); (b) **"boost initiating for Offlane" contradicts the data** —
initiating is the WEAKEST kept Offlane axis (+0.148) and would need a new
per-(role,axis) boost-weight mechanism the current single global BOOST_WEIGHT
doesn't have; camp_stacking (+0.249) would be the data-driven pick instead.
**Both resolved by the user afterward:** (a) map_control->Carry — ignore (not
added); (b) implement the initiating boost anyway (intent over data), do NOT add
camp_stacking. Done via a new `ROLE_AXIS_BOOST_WEIGHT` per-(role,axis) override
(Offlane.initiating = 0.5 vs the global 0.3) — eyeballed, flagged as calibration
debt in-code. `resource_efficiency` kept on Soft Support
by explicit user call despite r=-0.001 (near-neutral, and its boost is cosmetic
— outside Battle AXES, unweighted in Evaluation total). Note also `control` was
NOT re-added to Carry despite being its strongest predictor (+0.444) — user's
2026-08-13 removal stands. 45 role-fit / 324 total jest green.

**Position-weighted scaling (D, backlog item 2) — validated, DOES NOT hold.**
Read-only check against the 100 pro matches (roles + outcomes): a scaling
aggregate weighted 35/25/15/12.5/12.5 by position predicts the winner NO better
than a flat team mean (point-biserial |r| 0.026 -> 0.010, both negligible;
directional accuracy 47% -> 43%, both sub-coin-flip), for both aggregate and
role-specific scaling values. Caveat: n=100 is tiny and scaling is a near-zero
predictor either way (its role-fit correlation is negative in every role), so
the test is underpowered — but there is no signal to justify building D as
proposed. Recommend NOT implementing without a bigger pool (backlog item 2) or a
different framing of the scaling signal.

**Leaderboard split into two parts (user feature).** The old single `/leaderboard`
board was only the "pool opponent" half (pooled drafts ranked by their passive
record as opponents other players pull — recordDraftOutcome/getLeaderboard,
already built). Added the missing half: **"Best Runs"** — the calling player's
own best single-session drafts, ranked by wins then win rate across the Battle
Mode fights they played WITH each. Built entirely from existing data
(`BattleResult` rows, player-perspective outcomes keyed by draftId) — no schema
change, no new writes. `DraftService.getBestRuns(limit, minFights)` aggregates,
gates (`RUN_MIN_FIGHTS=5`, chosen high "for the future" — only 3 qualifying runs
in the dev DB today), ranks. `/leaderboard` now returns `{ runs, pool }`;
`LeaderboardPage` renders two sections. Runs are anonymous (Draft has no
submitterToken, no accounts) — identified by their five heroes. 6 new jest tests
for getBestRuns (tally/sort/minFights/limit/roles/eval-parse), verified live in
the browser (both boards render).

**Extreme axis-narrative bands (user).** Evaluation axis descriptions now get a
distinctly more critical / more positive frame at the tails: a new 5-value
`axisNarrativeBracket` (veryLow <10th percentile, veryHigh >=90th) drives
AXIS_NARRATIVE, and percentileClause calls a >=90th axis "one of this draft's
defining strengths" / a <10th "one of its most serious weaknesses". Kept SEPARATE
from the 3-value `percentileBracket` (evaluation.service's win-condition summary
branches on `tempoBracket === 'high'` and must keep the old bracket). Extremes
reuse the high/low tactical body — the emphasis lives in the lede — so bespoke
per-axis extreme copy can be added later without rework. New score-narrative.spec
(6 tests) locks the boundaries + wording.

**No-repeat matchmaking within a run (user, HARD constraint).** A player never
faces the same opponent draft twice in one run. `DraftService.getFacedOpponentHeroSets`
reads this run's (draftId's) BattleResult.opponentHeroIds; pullRandom takes an
`excludeFacedHeroSets` param and hard-filters them by hero SET (order-independent).
Unlike the hero-overlap/own-token filters it does NOT fall back to a repeat — it
throws "No new opponents left in the pool for this run" if the pool is exhausted
(~150 rows vs runs of a few fights, so effectively never hit). 2 new tests.

Note: adding KotL to Healer broke 3 custom-tags "The Fundamentals" specs (their
fixtures use KotL, now also a Healer → extra team-durability multiplier). Fixed:
2/3-hero fixtures swapped to non-Healer Fundamentals heroes (Io/CK/Enigma); the
4-hero one keeps KotL and asserts the +2% Healer durability explicitly. 333 tests.

**Negative synergies in Evaluation (user, two parts).** (A) Game-plan conflict
rules: a new `ANTI_SYNERGY_RULES` layer in synergy.analyzer reads the archetype
`tags` field (not synergy_tags) and SUBTRACTS for win-condition conflicts —
`split_push`/`deathball` × `late_game_scaling` (e.g. the user's Lycan+Medusa),
with an explanation ("wants to end early ... needs the game to go long —
conflicting game plans"). Deliberately a hand-authored heuristic, NOT real-data
validated: measured the classic pairs and they have NO co-pick data at all
(Lycan+Medusa null, like Chen+Ench) and the split_push×late_scaling pairing
roster-wide shows a ~-0.006 mean delta (coin-flip) — so real data cannot carry
this signal, it's the flavour/draft-literacy layer (magnitudes eyeballed,
calibration debt). (B) The worst real-data pair is now SHOWN whenever it's
negative at all, not only past the -0.035 significance bar (a 5000-draft check
found the old gate fired in just 37% of drafts — why the user "didn't see bad
pairs"); the SCORE penalty still only applies past significance, so a marginal
pair is reported but not punished. Text "weak" -> "below-average". Reran
compute-axis-percentiles afterward (synergy scoring feeds totalScore's percentile
reference — operational note). 337 tests + new anti-synergy specs.

Also answered a user question (no code): Battle applies OUR custom tags AND
weights (role-fit, hard-carry, utility-stacking, manual-power, axis weights) to
the OPPONENT draft symmetrically — resolveBattle builds tagEffectsB the same way
as tagEffectsA. Player-vs-player and player-vs-pro are the same code path; the
only difference is where the opponent's roles come from (pro: GPM-rank; player:
assigned; legacy rows without roles get no role-fit but tags still apply).

---

## Session log — 2026-08-13 (long UI + calibration session)

~24 commits, all straight to master. Themes:

**UI / Battle Mode.** Battle Mode promoted to its own screen (enter from
Evaluation, back button, Evaluation kept mounted so its state survives).
Opponent roll reworked to settle the real opponent one hero at a time, then
enlarged to ~60vh, forced onto one row, hero names bolded, page jumps to top
on result. Evaluation headline reveal synced into one rAF count-up (ring +
number + stars). Draft pool got pick-commit feedback. Radar enlarged, labels
made high-contrast, polygon recoloured green. Shutdown reworked twice, landing
on a procedural pale-blue glowing shattered-glass web.

**Battle results data.** Best/worst matchups + real pairs surfaced with hero
icons, a "real games (OpenDota)" label, and a baseline→matchup delta. Fixed a
semantics bug: matchups now rank by delta from the hero's own baseline, not
absolute win rate (a 51% lane for a 52% hero is now correctly "worst").

**Custom tags (all user-directed, magnitudes NOT yet self-play calibrated).**
Wired Mechanical (upset + curse immunity), Healer (team durability, scaling
count), Gold Generator (team scaling). Expanded Global (Clockwerk, KotL, Storm,
AA, Spirit Breaker, Underlord), Healer (Phoenix, Pugna, Dawnbreaker). Added
All Melee / All Ranged badges (display-only). Fundamentals/Fundamentals-axis
and Split Pushers left in backlog.

**Role-fit.** Removed `control` from Carry; added `saving` to both supports
(not cores); Soft Support (pos 4) additionally gets skirmish_rate +
resource_efficiency. Broader role-fit rework is backlog item 9.

**Draft.** No hero repeats between consecutive rounds (pool now excludes the
whole previous pool, not just picked heroes).

**CALIBRATION DEBT (important).** This session added/changed a large number of
tag memberships, three new tag effects, two badges, and four role-fit axis
changes — ALL with eyeballed magnitudes. None have been through a self-play
regression yet. Next serious analytics pass should run the no-crutch harness
(realWinRateWeight=0, manual overrides empty) and re-check divergence, the way
Summoning Sickness was calibrated, before trusting any of these numbers.
Backlog items 1-11 track the rest (map_control inert, badge-effects-in-math,
percentile 100k+compact-storage, radar axis reorder, draft distribution audit,
new draft modes).
