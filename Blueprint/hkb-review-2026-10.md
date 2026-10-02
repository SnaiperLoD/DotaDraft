# HKB review list — October 2026 (from Variance Lab T3)

**What this is.** This is a list of heroes for the author to review by hand. In each case an `evaluation_values` axis in `server/data/heroes.json` disagrees with STRATZ per-minute statistics by at least 2 standard deviations (z-gap ≥ 2). Nothing here was applied, and no automatic edit to `heroes.json` is proposed. Any change goes through the normal Hero Knowledge Base process (`Blueprint/09-hero-knowledge-base.md`). Mechanics have to be confirmed from repository data such as `hero-abilities.json`, not inferred from these numbers.

**Source.**

- STRATZ `heroStats.stats` with `groupByTime` and `groupByPosition`, for the week of 2026-09-14 (`week=1789344000`).
- Brackets `LEGEND_ANCIENT` + `DIVINE_IMMORTAL`, pooled by match count.
- Each hero is measured in its **main position**: the position with the most matches in that week.
- Values are per-match averages, **cumulative up to the stated minute**.
- Raw data: `artifacts/lab/stratz/stats/`. Evidence table: `artifacts/lab/kt6/hkb-review-evidence.json` (script `server/scripts/lab/hkb-review-data.ts`).

**Read with caution.**

1. **Outcome contamination.** Per-minute stats are higher in won games, so heroes that win more look better on every stat. This list says where the *radar* and *what happens in games* diverge. It does not say which one is right.
2. **Role confound.** The stats are measured in the hero's main position. The axes are role-agnostic, so supports naturally have low networth at minute 10. The `tempo` rows are dominated by this; treat them as low priority.
3. **Units not verified.** `stunDuration` + `disableDuration` have very different scales across heroes: Magnus 53 vs Silencer 16 587. The field semantics are unconfirmed.
4. **Likely data artifacts.** These need a check before they are used for anything:
   - Tinker deaths: 38 by minute 30.
   - Spirit Breaker and Magnus disable totals: about 50–100.
5. **Ranks.** "#" is the rank among the 127 heroes (1 = highest). For durability the stat rank is inverted: 1 = fewest deaths.

## Priority A — large gaps with a plausible mechanical question

| Hero | Axis | Axis value (rank) | STRATZ evidence (main pos, minute window) | Stat rank | Direction | z-gap |
|---|---|---|---|---|---|---:|
| Silencer | control | 3.3 (#96) | stun+disable ≈ 16 587 by min 30 (pos5, 43.8k matches) | #1 | stat ≫ axis | +5.0 |
| Bloodseeker | control | 2.6 (#106) | stun+disable ≈ 10 378 by min 30 (pos1, 13.9k) | #5 | stat ≫ axis | +3.4 |
| Keeper of the Light | skirmish_rate | 0.5 (#125) | (kills+assists)/min 0.56 to min 30 (pos2, 33.9k) | #15 | stat ≫ axis | +3.0 |
| Broodmother | objectives | 9.8 (#3) | tower damage 6 578 by min 30 (pos2, 7.6k) | #1 | stat ≫ axis (consistent; axis already near the top) | +2.8 |
| Ember Spirit | skirmish_rate | 2.7 (#100) | (k+a)/min 0.59 to min 30 (pos2, 96.9k) | #5 | stat ≫ axis | +2.6 |
| Slardar | control | 6.4 (#35) | stun+disable ≈ 13 192 by min 30 (pos3, 69.6k) | #3 | stat ≫ axis | +2.5 |
| Riki | control | 2.4 (#111) | stun+disable ≈ 6 919 by min 30 (pos2, 17.3k) | #15 | stat ≫ axis | +2.5 |
| Nature's Prophet | scaling | 4.0 (#87) | networth growth min 10→30 ≈ 14 181 (pos1, 29.9k) | #2 | stat ≫ axis | +2.4 |
| Puck | control | 4.2 (#79) | stun+disable ≈ 9 302 by min 30 (pos2, 36.5k) | #7 | stat ≫ axis | +2.3 |
| Anti-Mage | burst | 8.2 (#24) | hero damage 10 029 by min 30 (pos1, 88.5k) | #112 | axis ≫ stat | −2.3 |
| Phantom Assassin | burst | 9.8 (#3) | hero damage 12 167 by min 30 (pos1, 91.8k) | #85 | axis ≫ stat | −2.2 |
| Marci | teamfight | 2.8 (#92) | hero damage 18 521 by min 30 (pos2, 14.2k) | #16 | stat ≫ axis | +2.2 |
| Night Stalker | control | 3.5 (#93) | stun+disable ≈ 7 336 by min 30 (pos3, 88.9k) | #14 | stat ≫ axis | +2.1 |
| Dawnbreaker | skirmish_rate | 2.9 (#97) | (k+a)/min 0.56 to min 30 (pos3, 101.2k) | #11 | stat ≫ axis | +2.1 |
| Bane | skirmish_rate | 9.0 (#4) | (k+a)/min 0.46 to min 30 (pos5, 22.7k) | #89 | axis ≫ stat | −2.1 |
| Bristleback | durability | 8.6 (#2) | deaths 6.0 by min 30 (pos3, 38.7k) | #89 (few deaths = high rank) | axis ≫ stat | −2.1 |
| Enigma | control | 6.4 (#35) | stun+disable ≈ 11 665 by min 30 (pos3, 22.6k) | #4 | stat ≫ axis | +2.0 |

Notes on the table:

- **Burst** (Anti-Mage, Phantom Assassin): burst is about damage concentrated in a short window, while total hero damage is the wrong unit. The gap may be a mapping artifact.
- **Bristleback durability:** deaths also depend on how aggressively the hero is played.

## Priority B — likely artifacts or role confound (check data first)

| Hero | Axis | Axis value (rank) | STRATZ evidence | Stat rank | Direction | z-gap | Why low priority |
|---|---|---|---|---|---|---:|---|
| Tinker | durability | 3.8 (#65) | deaths 38.3 by min 30 (pos2, 31.5k) | #127 | axis ≫ stat | −9.9 | implausible value, probably the field's semantics |
| Magnus | control | 9.1 (#3) | stun+disable 52.9 by min 30 (pos3, 71.3k) | #103 | axis ≫ stat | −2.8 | units / field semantics (Reverse Polarity is a stun) |
| Spirit Breaker | control | 7.5 (#15) | stun+disable 100 by min 30 (pos4, 98.2k) | #97 | axis ≫ stat | −2.0 | same as Magnus |
| Chen | durability | 1.7 (#101) | deaths 16.0 by min 30 (pos5, 2.3k) | #126 | axis ≫ stat | −2.1 | small sample (2.3k) |
| Io, Abaddon, Oracle | saving | 7.3 / 7.0 / 10.0 (#5 / #6 / #1) | ally healing 6 891 / 6 052 / 8 181 by min 30 (pos5) | #2 / #3 / #1 | stat ≫ axis | +2.0…2.5 | consistent: these axes are already near the top, and the gap is the stat's long tail |
| Tempo group | tempo | high axis: Pugna 8.0, Clockwerk 6.8, Bounty Hunter 7.4, Chen 6.8, Treant 6.7, Io 7.0, Techies 7.3, Winter Wyvern 6.8, Hoodwink 6.8; low axis: Medusa 0.4, Spectre 1.5, Tinker 1.7, Omniknight 1.6, Phantom Lancer 2.0, Arc Warden 2.2, Alchemist 2.5 | networth at min 10 (supports low, cores high) | — | role-driven | ±2.0…2.9 | networth at 10 is mostly a position effect; a fair test needs within-position z |

## Not in scope

- No axis change proposal is made here.
- The radar (Eval) and Battle both read these axes, so any edit affects both.
- An edit is a calibration change and needs the author's explicit ok.
