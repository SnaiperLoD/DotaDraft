# Draft Engine

## Purpose

Создать процесс выбора пяти героев.

## Rules

Draft consists of 5 rounds.

Each round:

1. Generate pool of 5 random heroes.
2. User selects one hero.
3. Selected hero is removed from pool.

After selection:
User assigns roles manually.

## Restrictions

- No duplicate heroes.
- No bans.
- No live opponent draft in the Draft flow itself. Battle draws its opponent from the Opponent Pool (see `06-battle-engine.md`).

## Output

Draft object:

- heroes[]
- roles[]
- pick_order[]

## Randomization

Random generation must use controlled logic.

Draft should be reproducible if needed.

### Pool seed and reroll contract (decision 2026-10-01, T2.6 / D4a)

- `DraftService.generatePool()` hands the client a random `seed` plus the round-1 `pool` (`randomPool([], POOL_SIZE, seed)`). Nothing is stored server-side at that point.
- The seed comes from the client: `DraftPage.loadPool()` fetches it, and `create(seed, heroId, rerollUsed, ownerToken)` recomputes the round-1 pool from that seed and validates the pick against it. The server does not trust the seed to describe the pool, but it also does not remember which seeds it issued.
- Consequence: reloading the page calls `loadPool()` again and gives a fresh first pool for free.
- The pre-pick reroll (`handleReroll`) is tracked client-side (`pending.rerollUsed`, sent to `create` as `rerollUsed`; the draft then starts with `rerollsRemaining = 0`). It is not enforced server-side before the draft exists, so a page reload resets it.
- Accepted for friends-alpha. Server-side tracking by `ownerToken` is deferred until a public leaderboard exists.
- After the draft exists, `reroll(draftId, ownerToken)` is enforced server-side (`rerollsRemaining` decrement guarded in the update).
