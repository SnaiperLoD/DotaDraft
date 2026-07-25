# Next Session Priorities

Written at the end of the 2026-07-26 session (dispersion fixes — Phantom Lancer late-phase discount restore, new `common/utility-stacking.ts` diminishing-returns mechanism, support-cluster research) as a triage/reading guide — not a new source of truth. Full detail lives in `10-tech-debt-backlog.md`, "Дисперсия: late-phase durability/objectives восстановлены, добавлен utility-stacking diminishing-returns"; this file just says what to look at first and why. Read this before `10-tech-debt-backlog.md`, not instead of it.

**Status check:** still no production hosting, still not preparing for a real release. Git is clean, everything from this session committed (check `git log` for the actual hash — not recorded here to avoid staleness).

---

## 1. Dispersion — a new, different tail: dampened caster-support cluster (Silencer/Lich/Skywrath/Disruptor/Dark Willow/Ancient Apparition/Jakiro/Crystal Maiden/Ringmaster/Shadow Shaman)

Restoring `late.durability`/`late.objectives` to fix Phantom Lancer (mechanism from last session, now applied) fixed PL (−24.6pp → −20pp) and the whole utility-overperform cluster (Treant/Batrider/KotL/Nyx/Chen/Io — see item 2, now much better), but created a new underperform tail: pure-caster supports with near-zero `durability`/`objectives` (structurally correct — they're not tanks) now get dragged down harder by that same late-phase weight (−17…−24pp each).

Two levers tested, neither adopted outright:
- Re-enabling `map_control` (0→0.6, already-collected real data — wards/vision, currently disabled pending `vision_ability_tier` review) helps this cluster substantially (r 0.33→0.35, cluster improves 3-4pp each) but partially undoes the PL fix (−20.6→−22.5) and costs ~1.5pp pro-match hit-rate. Not applied.
- `assists_per_min` as a new axis — researched (`server/scripts/fetch-support-signal-data.ts`), rejected: 60% redundant with `map_control`, doesn't discriminate this underperform cluster from the Treant/Chen/Io overperform cluster (both score similarly high).

Best entry point: this needs something role-conditional and specific to this cluster (not a global weight, not diminishing-returns — both already tried this session and produced the same over/under-performer trade-off). Same class of fix as the `skirmish_rate`/Support group-relative ranking fix from two sessions ago (`percentileRankScaleByGroup`) — that's the playbook to reach for, not a fresh weight sweep.

## 2. Utility-stacking mechanism — landed, but only partially closes the Treant/Batrider/KotL cluster

New `common/utility-stacking.ts` (diminishing-returns on simultaneously-high `control`/`initiating`/`mobility`/`saving`/`skirmish_rate`/`map_control`) cut Treant Protector 24.8→18.8pp, fixed Nyx Assassin and Io outright (both now under/near the 10pp threshold), improved Batrider/Chen/KotL by 2-5pp each. None are fully clean yet — Treant/Batrider/KotL still flagged. Tuning knobs not yet swept: `utilityStackThreshold` (currently 7), `utilityStackFreeCount` (currently 2), and the exact per-breadth penalty curve (`axis-weights.json`'s `utilityStackPenalty`) — only one configuration was tested and locked in this session, not a full sweep like durability/objectives got. Worth a proper sweep before assuming these numbers are final.

## 3. Unreviewed new anomalies — Phoenix / Monkey King / Snapfire

Still not investigated (carried over from last session, untouched this session — this session's work was entirely about the Phantom Lancer/utility-stacking/support-cluster thread). Phoenix (+21-23pp), Monkey King (+21pp), Snapfire (~+17-19pp) could be hiding another systemic pattern the way `camp_stacking`'s sign problem did, or could be individual cases. Worth a profile check (same method as Treant/Batrider/Nyx: pull `evaluation_values` + `presumed_positions`, look for a shared pattern) before assuming either way.

## 4. Electric custom tag — still waiting on a decision

Unchanged from last session. Candidates (Storm Spirit/Leshrac/Zeus/Razor/Dark Seer/Disruptor/Arc Warden) have very high internal dispersion — recommendation was common/uncommon-tier magnitude (~3-10% on one axis), not legendary-tier. Not implemented — needs the user to pick a final roster and sign off on magnitude.

## Roadblocks to expect

- **"Mean improves, tail reshuffles" keeps happening — now confirmed a 4th time.** Every fix this session (durability/objectives restore, utility-stacking) improved its target cluster while creating or shifting a different one. Budget time to check what got worse, not just what got better, every single time — this is now a structural property of the model (11-13 correlated axes forced into one linear sum), not a one-off surprise.
- **Combining two mitigations is not free — tested and rejected once already.** utility-stacking + `map_control=0.6` together was WORSE on every metric (flagged count, PL) than either alone. Don't assume two independently-good levers compose additively; test the combination explicitly before stacking fixes.
- **The ability-tagging edit cycle is 3 steps, not 2** (`ability-tagging.csv` → `import-ability-tagging.ts` → `aggregate-ability-tags.ts` → `calibrate-evaluation-values.ts`) — still easy to forget the middle step.
- **Manual per-hero overrides get silently wiped** by the next full `calibrate-evaluation-values.ts` run (Keeper of the Light's `camp_stacking` override, the Kez/21-hero batch). Check before assuming an old override is still live.
- **Accounts/persistence, dual datastore** — same intentional MVP deferrals as always, not tasks.

## Where to start

Item 1 (caster-support cluster) is the most valuable and best-understood next step — the diagnosis is solid (it's the same late-phase weight that just fixed PL, hitting a structurally-different group of heroes), and the playbook (group-relative ranking, like `skirmish_rate` got) already exists in the codebase to copy. Item 2 (sweep utility-stacking's thresholds) is smaller and mechanical — useful if item 1 doesn't fully absorb the session. Item 3 is a cheap diagnostic pass. Item 4 needs the user, not more analysis.
