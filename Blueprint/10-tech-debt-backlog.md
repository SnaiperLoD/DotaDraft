# Tech Debt Backlog

Slim open list. Calibration history lives in `09-hero-knowledge-base.md`,
`05-evaluation-engine.md`, `06-battle-engine.md`. Session order lives in
`12-next-session-priorities.md`.

Last slim: 2026-09-01 night (honest Battle recap grammar). Statuses: `open` | `partial` | `parked` | `rejected`.
Shipped items live in the footnote, not this list.

---

## Shipped (footnote — do not re-open)

Synergy Analyzer + real co-pick WR · Damage Output label (key still
`teamfight`) · Pro tier1 pool · Role-fit · Hard-carry stacking · Phase-aware
resolution · Custom tags + Eval Active Combos · Shutdown · totalScore
percentile · Eval↔Battle shared mid skeleton · Playwright e2e · Artifact
hygiene (`artifacts/`) · Funnel telemetry (local + SQLite) · Named archetypes (incl.
Tempo) · Battle lanes + server story/explanation · Session win streak ·
History / leaderboards · Tapalka (static + 3D) · Hidden calibration tags in
Eval · Synergy Total Score weight 0.25 · Opponent freshness / TI context ·
Fundamentals Active Combos names boosted axes · Hosting Docker prep ·
CI PR/build/Docker (lint/format still soft) · Client + server narrative i18n
(`I18nLine` keys, RU/EN catalogs) · TI grand-finals opponent badge ·
Phantom Lancer / Tinker `late_game_scaling` (split-push is their late plan,
not an early close) · Anonymous draft ownership (`ownerToken` / `X-Owner-Token`)
· Compose Postgres Opponent Pool + live Battle e2e smoke
· Docker Compose live + Prisma OpenSSL 3 slim (`46b4e1c`)
· Friends-alpha Cloudflare quick-tunnel overlay (stopped 2026-08-18;
  volumes kept)
· Even-lanes copy (`|WR−50%| ≤ 3.5pp` → «Линии постояли ровно.»)
· Undying on Healer (Statstealer kept)
· Eval/Battle layout stretch + Fight button top+bottom
· Archetype seals on Eval + Battle faceoff
· Radar vs 50k Ancient+Divine unique drafts (`2a9ddf9`)
· Friends-alpha playtest park (`c94d59e`): global+personal run boards
  (`RUN_MIN_FIGHTS=10`), CM vs AI, TI-run, async clash, Battle tag chips,
  top-contributor floor, Fundamentals weakest-axis chips, draft-card name CSS,
  Razor role `saving` cuts, Tiny Carry aggregate copy, pro-name sanitizer
· 304 null-token host drafts in the live player pool, spread `createdAt`
  (`0145b07`)
· TI main-event groups+playoffs + live TI 2026 (`bf2be35`; 2356 pro rows)
· TI 2026 through GF, Visage Support hole, pro-name `account_id` backfill
  (2026-08-31; snapshot **2374** pro rows)
· Isolated modes (2026-09-01): Battle `/draft`, Captains `/captains`,
  TI Run `/ti-run` — no shared funnel. Challenge-paste Battle-only.
  History mode chip + filters. Leaderboard battle-only.
· Captains homage CM HUD + splash ~2s + `startCaptains`; roles; dual
  eval; one fight vs AI; no pool/leaderboard/Fight Again. Reload/Home
  starts a **new** CM (no sessionStorage persist)
· TI Run occupy-slot double-elim BO1, `TiBracket` tree, team logos,
  eval/fight split views, opponent copy from that team's TI drafts.
  Persists `sessionStorage['ti-run-id']`
· Challenge short draft code (`dd1` + Crockford base32 + checksum in
  `shared/utils/copiedDraft.ts`); sanitize paste; Copy Draft emits short
  code. Coin-flip easter egg: same 5 heroes → skip battle math, 3D coin,
  server 50/50 YOU WIN/YOU LOSE
· Tests: `copiedDraft` + `challenge-mirror` + BattleService coin +
  captains/TI gaps; Stryker `challenge-mirror` 13/13 killed; e2e
  `challenge.spec.ts` + landing 3 CTAs + captains splash reset
· TI Run live bracket projection (`projectLiveBracket` over template;
  `toView` no longer dumps historical `bracket.matches`)
· Challenge paste CSS containment (row `min-width: 0` / overflow hidden)
· Team logos: Keyd Stars alias; Liquipedia slug PNGs for T1, Quincy Crew,
  Team Undying, RNG, G2 x iG, BoomBoys (not recycled Steam ids). Steam
  still empty for those orgs
· Stryker mutate `copiedDraft.ts` via gitignored `server/shared-src`
  copy (`stryker.conf.js`); scoped score ~95%; challenge-mirror 13/13
· TI History placement (`deriveTiPlacement`) + champion trophy icon
· Templar Assassin Mid presumed overlay Carry 0.759 / Mid 0.216 (one-hero,
  0.25 gate kept)
· TI Run GF jersey collision (`liveOpponent`: if the historical foe is the
  player jersey, fight `occupyAs` instead). Remaining-path blanking stays.
  Copy: `tiRun.pickTeam` / `treeNote`
· Opponent pool TI lose-sides (`pro-{id}-lose`) + any-league / SQLite
  fallback. Relabel playoff Steam successor names
  (`relabel-ti-playoff-teams`). Attach: **116/116** bracket nodes have ids.
  TI 2026 UB QF pairings corrected (Yandex–Liquid, Nigma–Falcons)
· Battle DraftLedger rail: tags on a second row, fight screen full-width
  (no more name/tag overlap)
· Captains: splash portraits `/heroes/{id}.png`; AI started using matchups
  + remaining roles (not only `heroPower`). HUD still not Valve-pixel
  complete. Don't retag Medusa `illusion_based`
· Honest Battle recap grammar (no second sim): four-beat lead
  (yours/theirs/even), pit as a window not a take, named thin beat,
  explicit no-ramp on finish. History without the new fields still
  renders. Not a tick log.

---

## Calibration & model

### Confidence tier / synergy×2 / matchup×3 / shrinkage K — `open`
Low/Mod/High still don't stratify real favorite win rate cleanly. Don't retune
without a holdout + explicit approve.

### Heterogeneous custom tags — `open`
`Army of Clones` / `Unseen` / `Prone To Burst`: one multiplier on mixed
archetypes still pulls members opposite ways. Flavor tradeoff accepted once;
revisit only as one isolated hypothesis.

### New predictors (farm-dependence, lane gold@10) — `open`
Axis reshuffles (S1/S2/S3) failed. Next upside is new predictors, not weight
remix. `lane gold@10` as a new axis was **`rejected`** (redundant with
`skirmish_rate`).

### T_camp0 (`camp_stacking` → 0) — `partial`
Offline evidence green (+0.028 r). Production weights **not** written —
needs explicit “пиши в axis-weights” approve.

### Eval absolute weight calibration — `open`
Shared mid skeleton shipped; absolute Eval card weights still not
outcome-calibrated.

### map_control / vision CSV restore — `partial`
Weight 0 + no Eval card. Restore only after `vision_ability_tier` → ability CSV.

### Control-items → control blend — `open`
Researched; **not recommended** as currently formulated.

### IRRELEVANT_AXIS_DAMPEN vs per-role — `open`
Dampen looked dead on small samples; role-fit scheme still needs a pass.

### Manual power overrides / Stub 2.0 — `partial`
File emptied (hurts calibration). Mechanism remains; redesign parked.

### Teamfight key rename — `partial`
UI label “Damage Output” shipped; internal key still `teamfight`.

### Synergy damp thresholds — `partial`
-4.8 / +3.5 applied; still not ~1σ-calibrated.

### Counter Analyzer + real matchups — `rejected` (as proposed)
Architectural mismatch with Eval (no opponent). Aggregate-edge path correlated
with already-overrated cluster — don't ship that shape.

---

## Product / Post-MVP

Playtest park shipped 2026-08-20/21 — Shipped footnote +
`12-next-session-priorities.md`. Further coefficient/tag/weight changes
still need approve.

### TI / pro names in pool — shipped (2026-08-31)
OpenDota `proPlayers[account_id]` overlay on all 2374 snapshot rows;
`accountId` stored on `PooledHeroRole`. Display keeps official CJK
handles. 89 matches still have no team name (OpenDota empty) — league
fallback already handles that.
### Visage / dual-role Support holes — `partial`
Visage Support plugged (aggregate copy + presumed Support 0.605 /
Offlane 0.395). Carry/Mid still `no_info` on purpose. Tiny / Sand King /
Night Stalker / Naga Support eval copied; their presumed Support share
is still 0 (miscast still fires). Don't rewrite those shares without
Nick.
### Captains friend lobby — `parked`
CM vs AI shipped on isolated `/captains` (homage HUD, not Valve-pixel).
Don't also build a lobby unless Nick picks that shape.
### Captains HUD pixel-parity — `partial` (Nick asked 2026-09-01)
Homage is no longer the contract. Valve 1:1 + splash. Side columns and
icon grid started; not pixel-complete. Don't mix this with a calibration
pass.
### TI occupy-slot live-tree contract — `partial`
Copy + GF self-vs-self fix shipped. Playoff match ids attached (incl.
TI10 holes + TI 2026 QF). Next: real browser QA win → upper / loss →
lower / champ / elim. Attach still mixes some **group** games into the
same pair as the playoff series — don't treat that as empty nodes.
### Captains AI draft diversity — `partial`
`chooseAiBan` / `chooseAiPick` now take opponent picks + remaining role
slots + OpenDota matchups. Still deterministic (no session seed). Finish
HUD before another AI rewrite.
### Battle result narrative (honest four-beat recap) — shipped (2026-09-01)
Sheet grammar only: lane tally → lead after opening; invert lives on
`turn`; conversion does **not** resolve Roshan; finish does **not** walk
high ground. `thinPhase` is empty when High/A held the lanes. No clocks,
no smoke, no second HG. Don't retune coefficients to juice the copy.
### Realtime match-feed narration (DotaCaptain-style tick log) — `open` (research)
**Possibility / necessity — not a build.** Their public feed is
`[clock] [hero] [motion] [place] — [result]` over verified in-game
events (Pixel Stage). We do not have those events. Honest recap above
is four samples of the lead, not a curve. Research questions before any
code: (1) do we need a living log at all if the sheet recap is honest;
(2) if yes, what event source exists without inventing a second Battle
simulator; (3) would a fake 18:39 clock destroy trust faster than
silence. Plan-status / on-plan / draft-fit meters stay **rejected**.
Don't start a tick UI as a side quest.
### Templar Assassin Mid presumed overlay — shipped (2026-09-01)
One-hero exception: Carry 0.759 / Mid 0.216 in `hero-meta.json`
positions. Eval Mid already existed. Global 0.25 threshold unchanged.
`POSITION_OVERRIDES[46]` in `apply-role-classification.ts` and
`recompute-presumed-positions.ts` so a recompute does not wipe it.
### Opponent difficulty brackets — `open`
### Persistent progress / accounts — `open`
### Draft modes (constrained, Pure Draft) — `open`
Battle / Captains / TI Run are isolated routes. Don't invent a third CM.
Pure Draft / constrained still not built.
### Lock hero / pool-of-8 / random pick — `parked`
Wait for funnel signal (`client/src/telemetry/`).
### Fight own history drafts — `open`
Challenge paste is Battle-only (`dd1` short code). Fighting own History
rows is still separate.
### Team Steam logos — `partial`
Local `client/public/team-logos/` + initials fallback. Keyd Stars alias
+ Liquipedia slug PNGs for T1 / Quincy Crew / Team Undying / RNG /
G2 x iG / BoomBoys. Steam still empty for those orgs.
### Pooled draft as opponent — win streak — `open`
Session streak shipped; opponent-side streak not.
### More archetypes beyond current set — `partial`
Archetype seals shipped on Eval + Battle faceoff (2026-08-18).
### Badges & lore tags — `open`
Calibrate All Melee/Ranged numbers · Split Pushers · Void/Undead/Demon ·
Spirits (feasibility done, pending build) · jungler anti-synergy
(Chen/Enchantress membership research next).
### Laning Efficiency axis — `partial`
Per-lane Battle cards + story shipped. New Eval axis still research-only.
### Humorous 404 — `open`
### Radar axis reorder by correlation — `open`
### Pool core/support guarantee audit — `partial`
`ensureRoleCoverage` + Jest smoke (300 pools / 200 drafts on heroes.json +
hero-meta). Deep `npm run audit-pool-coverage` remains the occasional
manual 50k check — not a CI job.

---

## Research (no build without signal)

### Full match timeline simulation — `parked`
Accuracy Ceiling / MVP boundary — likely never. Distinct from the
**research** item on a DotaCaptain-style tick log: that one is
"do we even want a feed"; this one is "don't build a second sim."
### Items / build orders / pro-player persona — `parked`
### Supportless-lineup synergy half-check — `partial`
Axes checked; synergy half never run (weight now 0.25).
### User research — `open`
Prefer `GET /telemetry/funnel` (plus hosting) over more survey guesswork.

---

## Engineering hygiene

### Broader unit coverage (controllers/services) — `partial`
Health + pool smoke + Fundamentals helpers + battle-cast + expanded
`battle-explanation` + `copiedDraft` + `challenge-mirror` + BattleService
coin path + captains/TI gaps. **No client Jest/Vitest** — next session
§2 in `12-next-session-priorities.md`. Controller gaps remain.
### Server narrative i18n — `partial`
Product chrome + Eval/Battle live copy go through client i18n (`eval.*`,
`battle.explain.*`, `battle.highlight.*`, axes/tags/badges). Remaining:
legacy History snapshots stored as English strings; `AXIS_NARRATIVE` English
fixtures (tests only). Debug matrix stays untranslated on purpose.
### Tapalka skeletal animation — `partial`
### Report-a-bug pre-release — `partial`
mailto shipped.
### History eval backfill after percentile regen — `open`
Also: History fights have no `matchId`, so the TI Finals badge cannot show
there without a schema add.
### HKB tag revision (`heroes.json`) — `partial`
PL and Tinker gained `late_game_scaling` (2026-08-17) so split-push × late
anti-synergy no longer calls them an early-end plan. Rest of HKB still open.
### Ability-tag coverage expansion — `partial`
### Pro pool expand 100→1000 — `partial`
TI main-event (groups + playoffs, 2012–2025) + live TI 2026 through GF
landed 2026-08-31: **2374** pro rows. Regionals/quals still excluded.
Tier1 non-TI pubs are not the 1000-target path anymore; freshness/TI
covers the immediate need.
### Hosting / release process — `partial`
Docker Compose + Dockerfiles + `.env.example` + `Blueprint/13-deploy.md` +
`start:prod` + `/health` (`sqlite`/`pool`). Friends-alpha TLS overlay
(`docker-compose.tunnel.yml`) shipped; **tunnel stopped 2026-08-18**,
volumes kept (no `down -v`). Local compose at `:8080` is how to bring it
back. Named tunnel + domain + VPS stay deferred — not next-session P0.
SQLite backup/restore commands are in `13-deploy.md`. Nonempty pool
entrypoint upserts `legacy-player-pool.json` (`0145b07`) but does **not**
re-seed pro rows / heroes — after a snapshot bump, exec `seed` +
`seed-opponent-pool` in the api container (or recreate volumes).
### CI hardening — `partial`
PR trigger, full monorepo build, Playwright cache, Docker build, server
integration suite. Lint and Prettier are blocking for production source
(`server/scripts`, Blueprint, generated data, gltf ignored). Dependabot
weekly + `npm audit` in CI (`continue-on-error`).
### Mutation testing — `partial`
Full suite (2026-08-17): **69.92%** total. Re-run on
`battle-explanation.ts` after deeper Jest: **~65%** on that file alone
(was **38.55%**). `challenge-mirror.ts` mutate: **13/13 killed**.
`copiedDraft.ts` mutates via gitignored `server/shared-src` copy
(`stryker.conf.js`); scoped score **~95%**. Next: keep killing survivors
/ optional CI mutation job. **No client Jest/Vitest.**

---

## Numbered session leftovers (2026-08-12/13)

1. Edge-case drafts / role-fit underweight on total — `open`
2. Position-weighted scaling axis — `open` (validated, not built)
3. `saving` diminishing returns — `open`
4. Humorous 404 — `open`
5. Fundamentals names boosted axes — shipped (2026-08-20)
6. Calibrate All Melee / All Ranged — `open`
7. Radar reorder — `open`
8. Pool core/support audit — `partial` (Jest smoke shipped)
9. Rework role-fit scheme — `open`
10. New draft modes — `open`
11. Split Pushers badge — `open`
12. Creature tags Void/Undead/Demon — `open`
13. Active-jungler counter-synergy — `open`
14. Pure Draft mode — `open`
15. Spirits tag — `open` (feasibility done)
16. Laning Efficiency axis — `partial` (lanes/story shipped)

---

## Governance reminders

- Do not change coefficients / tags / weights without explicit go-ahead.
- Do not refetch OpenDota / recalibrate pipelines without a request.
- `realWinRateWeight` production value is **2** (0 only for diagnostic runs).
- New experiment dumps go under `artifacts/`, not tracked `server/data/`.
