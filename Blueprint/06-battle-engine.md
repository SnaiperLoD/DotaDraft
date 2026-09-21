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
- **Anonymous identification:** guest play is a random UUID in
  `localStorage` (`dotadraft.submitterToken`), sent as `X-Owner-Token`
  and as `submitterToken` on pool commit. Optional accounts (email +
  password or Google) claim that same UUID as `User.ownerToken`. A valid
  session cookie (`dotadraft.sid`) wins over the header. Logout keeps
  the token on this device; login on another device replaces that
  browser's token (no merge of guest drafts).
- **Moderation/anti-spam:** none at MVP. The only guard is structural — only a `Draft` already in `COMPLETED` status (5 heroes, all roles assigned, enforced by existing `draft.service.ts` validation) can be committed. Low user count at launch means low risk; revisit if abuse actually shows up. Tracked as a deferred item in `10-tech-debt-backlog.md`, not built now.
- **UI:** a separate, optional "Commit to Pool" action, shown after Evaluation results (not required to view them) — same idle-button → request → confirmation pattern as `EvaluationPanel`, placed directly after it on the completed-draft screen.

## Session Shape

Guest play is still one browser until you sign in. Optional accounts
claim that browser's `ownerToken` so History follows the account.
No currency, no unlocks. Replayability within a visit still comes from
running a **series of battles** with the same committed draft against
different pulled opponents, not from meta-progression.

Monetization is not planned for the foreseeable future (see
`00-project-overview.md`). Do not reserve ad slots or introduce
interstitial/rewarded-video breakpoints. The series-of-battles loop should stay
uninterrupted because replayability is the core product value, not because the
UI is being shaped around a future advertising model.

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
- Role matchups / power spikes / scaling / objectives: derived from Hero Knowledge Base `evaluation_values`. **Production** `overallPower` still consumes the shared `AXES` list (13 descriptive axes, including `resource_efficiency`) via `axis-weights.json`. That is the live fight. It is no longer the intended win model. See the split below. `map_control` and `camp_stacking` weights are 0. `resource_efficiency` weight is 0 as of 2026-09-21 (all phases). A missing phase/base key still defaults to weight **1**, not 0 — `control` / `mobility` / `initiating` still ride that default wherever a phase block omits them.
- No reliable Immortal/6000+ MMR-only data exists in OpenDota's public sample — `public_matches.avg_rank_tier >= 80` returned effectively zero rows in testing, most likely because high-MMR players commonly keep match history private. Practical proxy: average `heroStats` brackets 6+7 (Ancient + Divine) rather than Divine alone, for a larger and still high-skill sample.

## Non-Linearity Rule

Team comparison is NOT a sum of individual hero strengths.

Synergy and counter factors must modify (amplify or dampen) the base comparison, not simply add to it.

Example: a strong counter matchup should reduce the countered team's effective strength, not just subtract a flat number from the total score.

## Real WinRate Cap

Real per-hero OpenDota `winRate` (`hero-meta.json`) is blended into `overallPower` as a multiplicative modifier, same shape as the synergy/matchup multipliers (`battle-resolution.ts`'s `realWinRateEdge()`) — but capped at `REAL_WIN_RATE_CAP = 0.3`: it can never account for more than 30% of a team's power, in either direction, independent of how high `realWinRateWeight` (`server/data/axis-weights.json`) is tuned. This is a fixed code-level constant, not a config value — retuning the weight can never accidentally let real winRate dominate or replace the axis-based assessment.

Why a hard ceiling instead of just trusting the weight: real winRate is the single most literal ground-truth signal available (it's literally the hero's win/loss record, not a derived stat), which makes it tempting to lean on heavily to fix calibration gaps — but doing so risks turning Battle/Evaluation Engine into "look up hero winrate" rather than an actual draft analysis (evaluation_values, synergy, matchups). The 30% ceiling keeps it a correction on top of the axis-based assessment, never a replacement for it.

Current status: `realWinRateWeight: 2` (`server/data/axis-weights.json`) — re-enabled at a deliberately weak coefficient after the multicollinearity root-cause finding (`10-tech-debt-backlog.md`). Still flagged as a hard-to-calibrate parameter, not something to iterate on blindly.

## Accuracy Ceiling

Draft-only comparison has a low accuracy ceiling by nature — outcome is also decided by execution, which Battle Engine does not observe.

Battle Engine must not present output with false precision (e.g. "63.7% win chance") — this applies to what's *displayed*, not to internal computation (see Resolution below, which does use a precise internal weight to decide the shown outcome; that number itself is never surfaced).

## Resolution

Battle Mode needs a game-legible result (win/lose, or similar), not just an analytical comparison — but must not fake precision doing it. Approach: Confidence Tier maps to an internal win-weight band, and the shown Win/Lose result is resolved from that weighted random draw. The user sees the resolved outcome, the Confidence Tier, and the Explanation — never the internal weight or a raw percentage.

This keeps the Accuracy Ceiling rule intact: the dishonesty being avoided is claiming false *certainty*, not having a resolved outcome. A weighted coin flip that's honest about being "Low confidence" is not false precision; a headline "63.7%" would be.

**Current win-weight bands** (`WIN_WEIGHT_BY_TIER`, `battle-resolution.ts`) — the favored side's win probability at each tier:

| Tier | Win-weight |
|---|---|
| Low | 0.53 |
| Moderate | 0.62 |
| High | **1.0** |

### Upsets

**Revised this session — High confidence is now deterministic absent an explained mechanic.** The original rule (still true for Moderate/Low) was "never floor the underdog's weight to near-zero regardless of tier, or the tier system is a disguised deterministic outcome." In practice, at High tier this produced upsets that read as *the model being wrong* rather than a meaningful upset — a "sure thing" losing ~28% of the time (the old `High: 0.72`) undermines the point of having a High tier at all. `WIN_WEIGHT_BY_TIER.High` is now `1`: a High-confidence favorite cannot lose to bare random variance.

The only way to beat a High-confidence favorite now is an **explained mechanic** that shifts the win-roll away from certainty — currently only the High Skill Custom Tag (see below) does this, in `resolveBattle()`. This means every High-tier upset has a specific, named cause (a tagged hero's real-data variance), never bare chance. Moderate/Low keep real, unexplained variance — the Upsets rule as originally written (a 55/45 matchup is a genuine coin flip with a lean, not "Team A wins, occasionally randomized") still holds at those tiers.

When the underdog wins (at any tier), the Explanation must not just restate why the favorite should have won — it needs to account for the actual result, in-universe, and never say "the model was wrong." The explanation is built from every available real reason, not just one, in priority order:

1. **Named mechanical cause** — if a High Skill hero's variance flipped the result, it's named explicitly and always leads ("X's own play was the deciding swing here — real match data shows outcomes around this hero carry more variance than the stat sheet alone suggests").
2. **Real matchup edge** — the underdog's best individual hero-vs-hero matchup into the favored team, if the data has one.
3. **Real synergy pair** — the underdog's best real co-pick win-rate pair, if any.
4. **The underdog's own best axis** — even a draft that loses on the overall picture usually leads on at least one real axis; citing it grounds the upset in something concrete.
5. **Generic fallback** — only if none of the above apply: "every draft carries some risk even in a clear matchup, and at [tier] confidence the odds still had to break exactly right for [underdog] — this time they did."

This replaced a terser, single-reason version of the same idea — the goal (never "the model was wrong") is unchanged, the explanation itself is just richer now.

## Custom Tags

A hand-authored gameplay layer sitting on top of the calibrated `evaluation_values`/axis-weights model — **explicitly not trying to track real winRate** the way every other mechanism in `battle-resolution.ts` does. The point is drafting depth/combo-hunting (spot a tag, chase the combo), not another calibration signal. Implemented in `server/src/battle/custom-tags.ts`; the client has a parallel, hand-synced registry (`client/src/data/customTags.ts`) purely for draft-time badge display (`HeroTagBadges`, wired into `HeroPool`/`DraftLedger`) — the two aren't unified into one API-served source yet.

Two categories, both computed as `CustomTagEffects` (four independent multiplicative dimensions — per-hero-every-axis, per-team-one-axis, per-hero-one-axis, per-hero-one-phase — so effects compose regardless of order and can never go negative):

- **blessing** — a team's own tags buff itself (`blessingEffectsFor`).
- **curse** — a team's tags debuff the OPPONENT (`curseEffectsOnOpponent`); Battle Engine checks both categories for both sides before resolving.

Current roster: Mana Booster, Statstealer, Frosty, Agility Crusher, The Fundamentals, Two Heads Better, The Button, Global, High Skill (upset mechanic, see Upsets above, plus a -2.5%/hero self-debuff once 2+ are drafted together — "too many main characters"), Divided Attention (-10% durability/objectives per multi-unit hero — Lone Druid/Lycan/Beastmaster/Nature's Prophet/Arc Warden/Broodmother/Naga Siren/Meepo/Visage — a self-play-outlier-investigation finding that this whole archetype is overrated on those two axes specifically), Tempo Monster (hidden, always-active — +3% power if team tempo>8 else -25% scaling/durability/map_control, further -10% if another hard-carry is drafted alongside), Summoning Sickness (hidden, always-active, unconditional -30% personal power on Beastmaster/Nature's Prophet/Chen/Lone Druid/Lycan).

**Summoning Sickness is the one tag built as a calibration correction rather than as gameplay depth**, so it is the exception to the "explicitly not trying to track real winRate" framing above. It exists because the 2026-08-10 no-crutch self-play run (`realWinRateWeight=0`, manual power overrides empty, seeds 1-5, 300k matches each) found summoners the single most consistently over-rated archetype: Beastmaster +21.8pp, Nature's Prophet +20.7pp, Chen +17.6pp, Lone Druid +16.1pp, Lycan +13.1pp favoredRate above real winRate. Membership is deliberately the intersection of "has real summons" and "over-rated by >=10pp" — Visage (-5.7pp), Broodmother (-1.7pp), Meepo (-6.1pp), Enigma, Warlock and Arc Warden summon too but are not over-rated, and Naga Siren/Terrorblade are illusions (Army of Clones), not summons.

**The magnitude was swept, and the shape had to change to get there.** The first cut debuffed four named axes (scaling/durability/teamfight/skirmish_rate) and measured far too weak: a per-hero axis debuff is diluted twice, once by the 5-hero team average and once by axis weights, so even driving all four axes to ~zero recovered only 11.7pp of an 18pp gap. A flat power multiplier moves roughly 5x further per unit (-10% power bought 5.37pp where -10% on those four axes bought 1.05pp). -30% was picked off that sweep and then confirmed on a full 10-run grid (seeds 1-5 x blended/strict, 300k matches each): pool mean divergence +0.04pp, every carrier inside ±4.4pp (Beastmaster +2.7, Chen +1.7, Nature's Prophet +0.9, Lone Druid -0.7, Lycan -4.4 — Lycan is the one slightly over-corrected, because it also carries Divided Attention). Run-level effect across all 127 heroes: rFavReal 0.176 -> 0.246, mean |divergence| 8.59 -> 8.17pp, heroes flagged at >=10pp 48 -> 41.6. Full sweep tables live in the backlog entry and in the constant's comment in `custom-tags.ts`.

Tags are hand-authored and visible/revealable per a spec set at design time (`CustomTag.visible`/`revealable`/`minCountToReveal` on the client), not derived from data — the informal guardrail (not enforced in code) is that overall draft win-vector direction should still roughly track reality, and no hero's system-average winRate should drift outside 40-60% because of tag effects.

**Measuring significance:** `DISABLED_TAGS` (`custom-tags.ts`, always empty when committed) lets a tag be switched off for a `simulate-self-play.ts` A/B run without deleting it — add the tag's display name, run the sweep, remove it, compare against the all-tags-on baseline. A full sweep across all tags found Agility Crusher the most individually impactful (+1.029 error-mass swing), while Mana Booster and High Skill had net-negative aggregate contributions (worsen calibration on balance, kept anyway — they're gameplay depth, not calibration tools).

## Phase-Aware Resolution

A single flat weighted average across all axes structurally underrates heroes whose win condition is timing-gated — a split-push/late-scaling carry looks weak on every early/clash-relevant axis even when correctly calibrated, because their real strategy is to *avoid* an early clash. Validated against real duration-bucketed winRate before building this: Phantom Lancer's real win rate goes from 25.9% in short games to 50.9% in long ones (the opposite pattern from Treant Protector, 68.3%→52.7%) — a single "right now" snapshot can't represent a hero who is a completely different matchup depending on how long the game runs. (This is effectively an early delivery of `07-development-plan.md`'s Milestone 7 "Time-Phased Evaluation" idea, arrived at from the calibration side rather than as a scheduled milestone.)

`overallPower` is now computed separately for `early`/`mid`/`late` phases (`axisWeightForPhase()`, per-phase overrides in `server/data/axis-weights.json`'s `phaseWeights`, falling back to the base `axisWeights` for any axis not overridden for that phase), then blended by `phaseDistribution` (currently `early: 0.15, mid: 0.35, late: 0.5` — a fixed assumption approximating published Dota match-length distribution, not yet measured from this project's own data). Each phase is its own correctly-normalized weighted average (own denominator) — blending the three resulting scores is not the same as blending the weights first, since each phase's total weight differs.

## Hard-Carry Stacking Penalty

Shared with Evaluation Engine (`server/src/common/hard-carry.ts`) — a hero counts as "hard-carry" if real GPM-rank data (`presumed_positions`) has them playing Carry or Mid more than 50% of the time (either share alone, not summed). A draft's `overallPower` (and, in Evaluation, each axis independently) is penalized by hard-carry count: 0-2 hard-carries — no penalty (a standard Carry+Mid pair plus one flex pick is fine); 3 → -5%, 4 → -15%, 5 → -30%. `scaling` is exempt from the penalty and instead gets a flat +10% boost — a team that stacks hard-carries is, if anything, more built around winning a long game than a normal draft, not less.

## Output

Returns:

- Resolved outcome (Win / Lose, or equivalent) — see Resolution
- Advantage direction (Team A / Team B / Even)
- Confidence tier (Low / Moderate / High) — NOT a raw percentage
- Advantages
- Disadvantages
- Explanation

Explanation is not optional decoration — it is the primary value of the output. A resolved outcome or confidence tier without explanation is not useful.

## Eval radar vs Battle win formula (2026-09-21)

Eval answers «что это за драфт» and keeps the 13-axis radar, synergy, counters, pro similarity. Battle answers «кто выигрывает». Подсовывать радар в `overallPower` не получилось: честный self-play (open tags ON, hidden calibration OFF, `realWinRateWeight=0`, seed=1 × 100k) даёт r(favored, realWR)≈0.094, MAE 8.68 п.п., ±7 coverage 46.5%. Ремикс тех же весов (S1/S2/S3) раньше уже умер.

**Прод сейчас** всё ещё считает фазовое взвешенное среднее 13 осей. Shadow не подключён, пока `DOTADRAFT_BATTLE_SHADOW` пуст.

**Лучшая голая формула, не влитая:** `r2_f_farm` в `server/src/battle/battle-shadow.ts`. Пять combat-осей (burst, scaling, objectives, teamfight, durability) схлопнуты в один PC1; у `summon_based` durability/objectives внутри PC1 ×0.7; пропущенный ключ веса = 0, не 1; `resource_efficiency` = 0; вход scaling в PC1 заменён на `clamp(5 + scaling − tempo)`. На том же пуле, hidden OFF: r 0.186, MAE 8.11, ±7 51.2%, ≥10 п.п. = 43. Hidden на голой формуле всё ещё тащат хвост: MAE героев с тегом 12.2 п.п. против 5.6 без тега.

**Вечер того же дня, hidden ON поверх `r2_f_farm`, величины не менялись.** r 0.372, MAE 6.80, ±7 55.1%, ≥10 = 31. Знаки плоских тегов не перевернулись, ошибка сжалась (Summoning Sickness и Showstopper около нуля; Paper Utility +15→+7, Raid Boss −14→−8, Disable Battery −15→−7). Это проходит порог против голой `r2_f_farm` и проигрывает старой формуле с теми же тегами (r 0.381, MAE 6.39, ±7 61.4%, ≥10 = 27). Прод-`overallPower` из-за этого не меняется. Бестеговые дыры от чужих множителей стали хуже: Pugna +16→+22, Sand King −18→−19, Pangolier −15→−17, Ringmaster −12→−13.

**Убито после заморозки f, без записи весов.** Обнуление saving (вес 1.7 в базе, и в early он наследуется, потому что в блоке early ключа нет): кластер saving≥6 сел с +10.4 до +2.7 п.п., но r 0.186→0.122. Ось несёт и смещение, и сигнал. Фазовый микс (late−early против div) на бестеговых r −0.045. Tempo снаружи тегов r 0.013. Initiating на бестеговых r −0.311: обнуление добило бы Sand King и Pangolier.

Mirage Tax снят (Naga/TB на голой формуле около нуля). Остальные hidden не трогать без нового approve. Recap боя по-прежнему говорит осями Eval. PC1 в текст не переносить: эта формула в прод не идёт. Живой баг текста — #1 driver считается с mid-снимка, а `overallPower` фазовый. Это отдельный пункт бэклога.

Цифры и запреты: `14-analytical-handoff.md`. Артефакты: `artifacts/self-play/r0-2026-09-21`, `r1-2026-09-21`, `r2-2026-09-21`, `r2-farm-2026-09-21`, `r2-residual-farm-2026-09-21`, `r2-noncombat-2026-09-21`, `r2-save0-2026-09-21`, `r2-farm-hidden-2026-09-21`.

## Important

Battle Engine does NOT use:
Draft Score

Evaluation Engine and Battle Engine are independent. The Resolution mechanic above is Battle Engine's own internal weighting, not a reuse of Evaluation Engine's Draft Score. Sharing `axis-weights.json` mid weights with Eval Total Score is a historical coupling, not a requirement that the two scores match.

## Future Calibration (post-MVP)

Once professional matches are imported (see 07-development-plan.md), Battle Engine's confidence tiers *and* resolution weighting should be checked against real outcomes: matches predicted "High confidence" should win noticeably more often than "Low confidence" ones, and the resolved Win/Lose rate at each tier should roughly track the tier's real-world win rate. If not, tiers and weighting must be recalibrated — this matters more than raw accuracy.
