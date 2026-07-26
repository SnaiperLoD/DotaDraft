# Next Session Priorities

Written at the end of the 2026-07-26 session (dispersion fixes: Phantom Lancer late-phase discount restore, `common/utility-stacking.ts`, saving/camp_stacking reweight, role-conditional Support durability/objectives dampening, and finally a 70-hero MVP manual power-override patch) as a triage/reading guide — not a new source of truth. Full detail lives in `10-tech-debt-backlog.md`. Read this before `10-tech-debt-backlog.md`, not instead of it.

**Status check:** still no production hosting, still not preparing for a real release. Git is clean, everything from this session committed (check `git log` for the actual hash).

---

## ⚠️ Headline number is a stub, not a fix — read this before trusting r=0.52

Session started at 45 flagged heroes (|divergence|≥10pp), r=0.336. Four structural fixes (Phantom Lancer late-phase restore, `utility-stacking.ts` diminishing-returns, saving↑/camp_stacking↓ reweight, role-conditional Support dampening) got it to 42 flagged, r≈0.34-0.35 — that part is real calibration progress. Then, by explicit user request, a **70-hero manual power-multiplier patch** (`server/data/manual-power-overrides.json`, `common/manual-power-overrides.ts`, Battle Engine only) drove the numbers to **0-1 flagged heroes, r=0.52-0.53**.

**That second number is NOT a calibration result — it's a manual patch that masks the fact that the underlying problem (axis multicollinearity, the caster-support cluster, Treant Protector, Phoenix/Monkey King — see item 2 below and the rest of `10-tech-debt-backlog.md`) is still unsolved.** Don't cite r=0.52 as "the model got twice as accurate" — cite it as "70 of 127 heroes are currently wearing a hand-tuned coefficient fit to one self-play sample, and the real structural work underneath is exactly where this session left it." Read the caveats below and the full warning in `10-tech-debt-backlog.md` before trusting these numbers at face value:
- Coefficients are fit against one specific 100k-match self-play sample (~1-2pp run-to-run noise per hero, documented all session). Some of the "under 10pp" precision is fitting that sample's noise, not a real pattern — expect occasional heroes to drift back over the line on a fresh self-play run without that being a regression.
- 70 heroes now carry a manual override — more than half the roster. This is a different category of decision than the project's earlier point overrides (Kez, KotL's `camp_stacking`, the 21-hero batch) — treat it as a stopgap, not a finished calibration.
- Not adaptive: if `axis-weights.json` or any of this session's other mechanisms (utility-stacking, role-fit dampening) get retuned later, these 70 multipliers will likely need recomputing, not just carrying forward.

## 1. If dispersion drifts back up on a fresh self-play run

Don't reach for the manual-override iteration script reflexively — check first whether it's noise (rerun self-play 1-2 more times, see if it's the same heroes recurring or different ones each time) before deciding it needs another patch round. The driver scripts used this session (`_calibrate-manual-overrides*.js`) were throwaway, not committed — if this needs doing again, rewrite them following the same coordinate-descent pattern documented in the backlog entry, not from scratch.

## 2. Structural work is still open underneath the patch

The patch didn't fix the underlying causes — it papered over them for MVP purposes. Still true and still worth returning to eventually:
- **Silencer/Lich/Skywrath/Disruptor caster-support cluster** — role-conditional dampening (this session) helped Disruptor/Skywrath/Ancient Apparition but barely moved Silencer itself. Now masked by its manual override, not actually resolved.
- **Treant Protector** — resistant to every structural mechanism tried this session (utility-stacking helped some, saving/camp_stacking reweight hurt slightly). Now masked by its manual override (0.695, the single largest debuff in the file).
- **Phoenix/Monkey King/Snapfire** — never actually investigated this session (or the one before). Now under manual overrides too, so the underlying "why" is still unknown.

## 3. Electric custom tag — still waiting on a decision

Unchanged for two sessions now. Needs the user to pick a final roster and sign off on magnitude, not more analysis.

## Roadblocks to expect

- **"Mean improves, tail reshuffles" — now systematically exploited rather than fought.** This session's late pivot (iterate the manual override across the WHOLE population, not just the original 42) worked specifically because each round's new tail was smaller than the last — the pattern converges instead of just shuffling, when the correction targets the actual worst offenders each round instead of a fixed list decided once. Worth remembering next time a structural fix creates a new tail: check whether one more targeted round closes it before treating the new tail as a permanent side effect.
- **The ability-tagging edit cycle is 3 steps, not 2** (`ability-tagging.csv` → `import-ability-tagging.ts` → `aggregate-ability-tags.ts` → `calibrate-evaluation-values.ts`).
- **Manual per-hero overrides IN `heroes.json`** (not `manual-power-overrides.json`, which is separate and NOT touched by calibration) still get silently wiped by `calibrate-evaluation-values.ts` runs.
- Accounts/persistence, dual datastore — same intentional MVP deferrals as always.

## Where to start

Nothing is urgent on dispersion right now — it's in the best state it's ever been, even if by a patch rather than a finding. If picking this up again, item 1 (verify the patch is still holding) is the cheap first check. Item 2 (the underlying structural causes) is where real, durable progress would come from, but it's exploratory, not a quick win — treat it the way this session treated the caster-support cluster: diagnose, try a scoped mechanism, expect a partial result, report honestly. Item 4 (Electric tag) needs the user, not more analysis.
