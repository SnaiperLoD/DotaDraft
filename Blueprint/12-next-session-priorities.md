# Next Session Priorities

Written at the end of the 2026-07-26 session — a long one, two distinct halves: (1) dispersion/anomaly fixing (Phantom Lancer late-phase discount restore, `common/utility-stacking.ts`, saving/camp_stacking reweight, role-conditional Support durability/objectives dampening, and finally a 70-hero MVP manual power-override patch), (2) 13 new UI/product backlog items logged by user request (pages, i18n, bug reporting, visual polish, battle FX) — none of them started, pure documentation. This file is a triage/reading guide, not a new source of truth. Full detail lives in `10-tech-debt-backlog.md`. Read this before that file, not instead of it.

**Status check:** still no production hosting, still not preparing for a real release. Git is clean, everything from this session committed and pushed to `origin/master` — check `git log` for the actual hashes rather than trusting any specific hash recorded here.

---

## ⚠️ Headline calibration number is a stub, not a fix — read this before trusting r=0.52

Session started at 45 flagged heroes (|divergence|≥10pp), r=0.336. Four structural fixes (Phantom Lancer late-phase restore, `utility-stacking.ts` diminishing-returns, saving↑/camp_stacking↓ reweight, role-conditional Support dampening) got it to 42 flagged, r≈0.34-0.35 — that part is real calibration progress. Then, by explicit user request, a **70-hero manual power-multiplier patch** (`server/data/manual-power-overrides.json`, `common/manual-power-overrides.ts`, Battle Engine only) drove the numbers to **0-1 flagged heroes, r=0.52-0.53**.

**That second number is NOT a calibration result — it's a manual patch that masks the fact that the underlying problem (axis multicollinearity, the caster-support cluster, Treant Protector, Phoenix/Monkey King) is still unsolved.** Don't cite r=0.52 as "the model got twice as accurate" — cite it as "70 of 127 heroes are currently wearing a hand-tuned coefficient fit to one self-play sample, and the real structural work underneath is exactly where this session left it." This is marked with the same explicit ⚠️ warning in `10-tech-debt-backlog.md` — read it there too before acting on these numbers.

- Coefficients are fit against one specific 100k-match self-play sample (~1-2pp run-to-run noise per hero, documented all session). Some of the "under 10pp" precision is fitting that sample's noise, not a real pattern — expect occasional heroes to drift back over the line on a fresh self-play run without that being a regression.
- 70 heroes now carry a manual override — more than half the roster. Different category of decision than the project's earlier point overrides (Kez, KotL's `camp_stacking`, the 21-hero batch) — treat it as a stopgap, not a finished calibration.
- Not adaptive: if `axis-weights.json` or any of this session's other mechanisms (utility-stacking, role-fit dampening) get retuned later, these 70 multipliers will likely need recomputing, not just carrying forward.

## 1. If dispersion drifts back up on a fresh self-play run

Don't reach for a fresh override-iteration script reflexively — check first whether it's noise (rerun self-play 1-2 more times, see if it's the same heroes recurring or different ones each time) before deciding it needs another patch round. This session's driver scripts (`server/scripts/_calibrate-manual-overrides*.js`) were throwaway, not committed — if this needs doing again, rewrite following the same coordinate-descent pattern documented in `10-tech-debt-backlog.md` ("ЯВНАЯ ЗАГЛУШКА"), not from scratch.

## 2. Structural work is still open underneath the patch

The patch didn't fix the underlying causes — it papered over them for MVP purposes. Still true and still worth returning to eventually:
- **Silencer/Lich/Skywrath/Disruptor caster-support cluster** — role-conditional dampening (this session) helped Disruptor/Skywrath/Ancient Apparition but barely moved Silencer itself. Now masked by its manual override, not actually resolved.
- **Treant Protector** — resistant to every structural mechanism tried this session (utility-stacking helped some, saving/camp_stacking reweight hurt slightly). Now masked by its manual override (0.695, the single largest debuff in the file).
- **Phoenix/Monkey King/Snapfire** — never actually investigated this session (or the one before). Now under manual overrides too, so the underlying "why" is still unknown.

## 3. Electric custom tag — still waiting on a decision

Unchanged for two sessions now. Needs the user to pick a final roster and sign off on magnitude, not more analysis.

## 4. 13 new UI/product backlog items — none started, all need scoping decisions before code

Logged this session by direct user request (`10-tech-debt-backlog.md`, `## UI` and `## Новый функционал` sections). Grouped by what they need before implementation can start:

- **Cheap, ready to just build**: darken the already-picked role in the role-assignment dropdown; hero-name contrast fix (text-shadow/outline vs. flat recolor — needs one small design call, not research).
- **Need a design/content decision first, then cheap to build**: main/landing page (content? CTA? does it slow down the "quick browser game" identity?), About/Methodology page (write the actual player-facing copy — not a `Blueprint/*.md` dump), footer contacts (which channels?), gradient recolor (what exactly reads wrong about the current red? what's meant by "hard-laner" as distinct from other core roles?).
- **Need a mechanism decision, moderate scope**: language switcher (i18n layer + what happens to server-generated narrative text, which isn't static strings); Report a Bug (mailto/external form vs. own endpoint + Prisma model — different scope depending on choice); battle-result matchup commentary (extend `bestMatchupEdge()`/`bestSynergyPair()`, already used for upset explanations, into a general non-upset feature — format/placement undecided).
- **Bigger scope, needs its own design pass**: opponent-roll animation (cheap, client-only) + team-collision animation (needs an art concept first — what does "collision" mean visually); animated portraits/3D hero models (research-level — asset sourcing is the real blocker, not the rendering).
- **Data/schema work, not UI**: player nicknames for pro-draft opponents in Battle (merged into the pre-existing backlog entry — needs `ProMatch`/`PooledDraft` schema extension + `personaname` added to the existing `/api/matches/{id}` pull that already fetches `gold_per_min` for roles, same call, no extra API cost).

None of these were investigated or scoped further than the one-paragraph description in the backlog — first step for any of them is a scoping conversation with the user, not diving into code.

## Roadblocks to expect

- **"Mean improves, tail reshuffles" — now systematically exploited rather than fought.** This session's late pivot (iterate the manual override across the WHOLE population, not just a fixed list) worked specifically because each round's new tail was smaller than the last — the pattern converges instead of just shuffling, when the correction targets the actual worst offenders each round. Worth remembering next time a structural fix creates a new tail: check whether one more targeted round closes it before treating the new tail as permanent.
- **The ability-tagging edit cycle is 3 steps, not 2** (`ability-tagging.csv` → `import-ability-tagging.ts` → `aggregate-ability-tags.ts` → `calibrate-evaluation-values.ts`).
- **Manual per-hero overrides IN `heroes.json`** (not `manual-power-overrides.json`, which is separate and NOT touched by calibration) still get silently wiped by `calibrate-evaluation-values.ts` runs.
- Accounts/persistence, dual datastore — same intentional MVP deferrals as always.

## Where to start

Nothing is urgent on dispersion right now — it's in the best state it's ever been, even if by a patch rather than a finding (item 1 is the cheap first check if it drifts). Item 2 (the underlying structural causes) is where real, durable calibration progress would come from, but it's exploratory — treat it the way this session treated the caster-support cluster: diagnose, try a scoped mechanism, expect a partial result, report honestly. Item 3 (Electric tag) needs the user, not more analysis. Item 4 (the 13 new items) is likely where the next session actually starts, if the user wants to shift from calibration to product/UI work — but every one of them needs a short scoping conversation before any code, not a jump straight to implementation.
