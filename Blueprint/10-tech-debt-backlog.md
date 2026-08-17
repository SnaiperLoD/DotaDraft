# Tech Debt Backlog

Slim open list. Calibration history lives in `09-hero-knowledge-base.md`,
`05-evaluation-engine.md`, `06-battle-engine.md`. Session order lives in
`12-next-session-priorities.md`.

Last slim: 2026-08-17. Statuses: `open` | `partial` | `parked` | `rejected`.

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
· Compose Postgres Opponent Pool + live Battle e2e smoke.

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

### Opponent difficulty brackets — `open`
### Persistent progress / accounts — `open`
### Draft modes (constrained, Captains AI, Pure Draft) — `open`
### Lock hero / pool-of-8 / random pick — `parked`
Wait for funnel signal (`client/src/telemetry/`).
### Fight own history drafts — `open`
### Pooled draft as opponent — win streak — `open`
Session streak shipped; opponent-side streak not.
### More archetypes beyond current set — `partial`
### Badges & lore tags — `open`
Calibrate All Melee/Ranged numbers · Split Pushers · Void/Undead/Demon ·
Spirits (feasibility done, pending build) · jungler anti-synergy
(Chen/Enchantress membership research next).
### Laning Efficiency axis — `partial`
Per-lane Battle cards + story shipped. New Eval axis still research-only.
### Fundamentals Active Combos names boosted axes — `done` (2026-08-17)
Eval Active Combos now lists the same weakest-axis set Battle boosts
(`fundamentalsTargetAxes` + `formatFundamentalsDescription`).
### Humorous 404 — `open`
### Radar axis reorder by correlation — `open`
### Pool core/support guarantee audit — `partial`
`ensureRoleCoverage` + Jest smoke (300 pools / 200 drafts on heroes.json +
hero-meta). Deep `npm run audit-pool-coverage` remains the occasional
manual 50k check — not a CI job.

---

## Research (no build without signal)

### Full match timeline simulation — `parked`
Accuracy Ceiling / MVP boundary — likely never.
### Items / build orders / pro-player persona — `parked`
### Supportless-lineup synergy half-check — `partial`
Axes checked; synergy half never run (weight now 0.25).
### User research — `open`
Prefer `GET /telemetry/funnel` (plus hosting) over more survey guesswork.

---

## Engineering hygiene

### Broader unit coverage (controllers/services) — `partial`
Health + pool smoke + Fundamentals helpers + battle-cast + expanded
`battle-explanation` branch coverage landed; controller gaps remain.
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
Long-horizon; freshness/TI covers immediate need.
### Hosting / release process — `partial`
Docker Compose + Dockerfiles + `.env.example` + `Blueprint/13-deploy.md` +
`start:prod` + `/health` (`sqlite`/`pool`). Host/DNS/TLS still manual.
SQLite backup/restore commands are in `13-deploy.md`.
### CI hardening — `partial`
PR trigger, full monorepo build, Playwright cache, Docker build, server
integration suite. Lint and Prettier are blocking for production source
(`server/scripts`, Blueprint, generated data, gltf ignored). Dependabot
weekly + `npm audit` in CI (`continue-on-error`).
### Mutation testing — `partial`
Full suite (2026-08-17): **69.92%** total. Re-run on
`battle-explanation.ts` after deeper Jest: **~65%** on that file alone
(was **38.55%**). Next: keep killing survivors / optional CI mutation job.

---

## Numbered session leftovers (2026-08-12/13)

1. Edge-case drafts / role-fit underweight on total — `open`
2. Position-weighted scaling axis — `open` (validated, not built)
3. `saving` diminishing returns — `open`
4. Humorous 404 — `open`
5. Fundamentals names boosted axes — `done` (2026-08-17)
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
