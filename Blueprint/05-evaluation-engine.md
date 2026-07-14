# Evaluation Engine

## Purpose

Оценить характеристики состава.

## Does Not

Evaluation Engine does NOT:

- calculate winner;
- simulate match;
- compare against enemy team.

## Output

Returns:

Total Score

Breakdown:

- Synergy
- Counter
- Teamfight
- Tempo
- Scaling
- Burst
- Control
- Durability
- Mobility
- Map Control
- Saving
- Objectives
- Pro Similarity

Burst/Control/Durability добавлены вместе с Role-fit модификатором (см. ниже) — были откалиброваны в `evaluation_values` с самого начала (`server/scripts/calibrate-evaluation-values.ts`), но не выведены как отдельные строки breakdown до того, как Role-fit понадобилось их бустить для Carry/Mid/Offlane.

## Initial Weights

- Synergy: 30%
- Teamfight: 20%
- Tempo: 15%
- Scaling: 10%
- Objectives: 10%
- Burst: 5%
- Control: 5%
- Durability: 5%
- Mobility: 5%
- Map Control: 5%
- Saving: 5%
- Pro Similarity: 5%

## Analyzer System

Each Analyzer:

Input:
Draft (heroes + assigned roles — see Role-fit Modifier below)

Output:
- score
- explanation

`server/src/evaluation/analyzer.interface.ts`'s `Analyzer.analyze()` takes `DraftPick[]` (`{ hero: Hero; assignedRole: string | null }[]`), not just `Hero[]` — this was a gap the Analyzer Rule (`01-core-rules.md`) already described ("Input: Draft") but the code didn't implement until Role-fit needed the role.

## Role-fit Modifier

Реализовано (`server/src/evaluation/role-fit.ts`, применяется внутри `createAxisAnalyzer`): при назначении роли герою бустятся значения существующих осей, релевантных этой роли, но только если герой уже выше базовой линии (5/10) на этой оси — модификатор усиливает уже сильную сторону, не спасает плохую подгонку. Буст пропорционален превышению над базовой линией (вес 0.15): `effectiveValue = min(10, rawValue + 0.15 × (rawValue − 5))`.

Карта осей по ролям:
- Carry → `scaling`, `burst`
- Mid → `tempo`, `burst`
- Offlane → `durability`, `control`
- Hard Support → `saving`, `map_control`
- Soft Support → `saving`, `control`

**Веса и карта осей — ручная эвристика, не откалиброванный факт.** Два захода на калибровку через реальные данные (полное описание — `10-tech-debt-backlog.md`): позиционные бакеты по `lane_role`/`is_roaming` не смогли представить Support как natural role вообще (саппорты, стоящие в лейне без роуминга, попадают в Carry/Offlane bucket); бакеты по per-match GPM-рангу внутри команды (`server/scripts/research-role-fit-gpm-rank.ts`) дали все 5 ролей, но корреляция между кандидатными осями роли и реальной win-rate delta оказалась статистически неотличима от нуля при доступном n (17-37 героев на роль, |r|<0.2 везде). Карта выше сохраняет то же направление, что эти слабые корреляции указывали (Carry/Hard Support положительно, Mid/Offlane/Soft Support слабо отрицательно, но не значимо) — не опровергнута данными достаточно сильно, чтобы отказаться, но и не подтверждена.

Область применения: только Evaluation Engine. Battle Engine (`battle-resolution.ts`) роль не учитывает — вне скоупа этого захода.

## Counter Analyzer

Counter analysis should evaluate:

- how many enemy strategies the draft can counter;
- how strong these counters are;
- how well the counter fits the team's own strategy.

Simple hero-to-hero counters are not enough.

## Synergy Analyzer

Should evaluate combinations of heroes.

Examples:

- initiation + follow-up;
- mobility combinations;
- sustain;
- teamfight combinations.

Individual hero strength is less important than interaction.

Реализовано (`server/src/evaluation/analyzers/synergy.analyzer.ts`, `createSynergyAnalyzer(lookup)`): реальный co-pick винрейт (`hero-meta.json`, через `HeroMetaService`) используется как равноправный сигнал наравне с ручными архетипными тегами, не только как fallback:

- если фактический совместный винрейт пары падает на 4.5 п.п.+ относительно ожидаемого (среднее индивидуальных `winRate`), вес совпавшего архетипного правила для этой пары уменьшается вдвое, а не обнуляется;
- независимо от тегов, лучшая по данным пара во всём драфте получает бонус (до +3), если её реальное превышение ожидаемого винрейта ≥3 п.п. — это может выявить синергию, которую ручная разметка тегов не покрывает вообще.

Оба порога (-4.5 п.п. / +3 п.п.) выбраны на глаз, не откалиброваны — см. `10-tech-debt-backlog.md`, Research.
