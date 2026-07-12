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
- No opponent draft during MVP.

## Output

Draft object:

- heroes[]
- roles[]
- pick_order[]

## Randomization

Random generation must use controlled logic.

Draft should be reproducible if needed.
