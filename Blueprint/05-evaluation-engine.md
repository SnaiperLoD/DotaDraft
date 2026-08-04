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
- Initiating
- Mobility
- Saving
- Objectives
- Skirmish Rate
- Camp Stacking
- Pro Similarity

Burst/Control/Durability добавлены вместе с Role-fit модификатором (см. ниже) — были откалиброваны в `evaluation_values` с самого начала (`server/scripts/calibrate-evaluation-values.ts`), но не выведены как отдельные строки breakdown до того, как Role-fit понадобилось их бустить для Carry/Mid/Offlane. Initiating добавлена тем же путём позже. Skirmish Rate/Camp Stacking — переименованы из aggression/farm_priority (`10-tech-debt-backlog.md`, self-play outlier investigation) после уточнения, что они реально измеряют (deaths_per_min+инвертированный last_hits_per_min и camps_stacked_per_min соответственно) — см. `09-hero-knowledge-base.md`.

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
- ~~Map Control: 5%~~ — **⚠️ ЯВНЫЙ КОСТЫЛЬ: убрана из breakdown Evaluation Engine (2026-08-03, по прямому запросу пользователя).** Слабо проработанный сигнал — `vision_ability_tier` так и не мигрирован на per-ability CSV-разметку (в отличие от mobility/saving/initiating/control), эффективный вес и так был 0% давно. Данные по-прежнему считаются (`evaluation_values.map_control`) и используются Battle Engine (тоже с весом 0 в `axis-weights.json`) — убрано только отображение строки в Evaluation breakdown, не сама ось. Вернуть в список, когда `vision_ability_tier` будет пересмотрен, см. `10-tech-debt-backlog.md`.
- Saving: 5%
- Initiating: 5%
- Skirmish Rate: 5%
- Camp Stacking: 5%
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

Реализовано (`server/src/common/role-fit.ts`, общий модуль для Evaluation и Battle Engine — см. Core Rules Separation в `01-core-rules.md`, применяется внутри `createAxisAnalyzer`): при назначении роли герою бустятся значения существующих осей, релевантных этой роли, но только если герой уже выше базовой линии (5/10) на этой оси — модификатор усиливает уже сильную сторону, не спасает плохую подгонку. Буст пропорционален превышению над базовой линией (вес 0.15): `effectiveValue = min(10, rawValue + 0.15 × (rawValue − 5))`.

Карта осей по ролям:
- Carry → `scaling`, `burst`
- Mid → `tempo`, `burst`
- Offlane → `durability`, `control`, `initiating`
- Hard Support → `saving`, `map_control`
- Soft Support → `saving`, `control`

**Веса и карта осей — ручная эвристика, не откалиброванный факт.** Два захода на калибровку через реальные данные (полное описание — `10-tech-debt-backlog.md`): позиционные бакеты по `lane_role`/`is_roaming` не смогли представить Support как natural role вообще (саппорты, стоящие в лейне без роуминга, попадают в Carry/Offlane bucket); бакеты по per-match GPM-рангу внутри команды (`server/scripts/research-role-fit-gpm-rank.ts`) дали все 5 ролей, но корреляция между кандидатными осями роли и реальной win-rate delta оказалась статистически неотличима от нуля при доступном n (17-37 героев на роль, |r|<0.2 везде). Карта выше сохраняет то же направление, что эти слабые корреляции указывали (Carry/Hard Support положительно, Mid/Offlane/Soft Support слабо отрицательно, но не значимо) — не опровергнута данными достаточно сильно, чтобы отказаться, но и не подтверждена.

Область применения: `common/role-fit.ts` — общий модуль, тот же `roleFitValue()` используется и Battle Engine (`battle-resolution.ts`'s `axisAverage()`), не только Evaluation.

## Hard-Carry Stacking Penalty

Общий с Battle Engine механизм (`server/src/common/hard-carry.ts`, полное описание — `06-battle-engine.md`) — герой считается "hard-carry" по реальной GPM-rank доле Carry/Mid (>50%). В отличие от Battle Engine (где штраф применяется один раз к `overallPower`), Evaluation не имеет единой "суммы осей" — штраф применяется **по-осевому**, внутри `createAxisAnalyzer`, к среднему скору команды на каждой из 13 осей отдельно (Synergy/Counter/Pro Similarity не затронуты — не axis-based). Порог 3+ (0-2 hard-carries — без штрафа), `scaling` исключена из штрафа и вместо этого получает +10% буст. Explanation-строка появляется в breakdown только когда штраф ненулевой.

## Summary (Strengths / Weaknesses / Gameplan)

`EvaluationService.buildSummary()` формирует три поля (`EvaluationSummary`: `strengths`, `weaknesses`, `gameplan`):

- **Strengths/Weaknesses** — топ-3/боттом-3 акси-анализатора по percentile (population-relative ранг против 10000 случайных драфтов, `axis-percentiles.ts`, не сырой score — иначе ось вроде `saving`, которая по природе кластеризуется низко у всей популяции, выглядела бы более слабой стороной, чем реально просевшая ось). Каждый пункт — это ровно нарративное предложение анализатора (`AXIS_NARRATIVE`, `score-narrative.ts`), без числового префикса вида "Label (n/10):" — убран сознательно, как и баг, из-за которого иногда бралась не нарративная строка, а последняя техническая (role-fit/hard-carry) реплика explanation-массива (исправлено переносом нарратива на гарантированно последнюю позицию в `axis.analyzer.ts`).
- **Gameplan** — отдельный синтезирующий абзац поверх списка, не просто ещё один пункт: комбинирует `tempo`+`scaling` (единственные две оси, которые напрямую определяют предполагаемую длину игры и её win condition — быстрая игра / патиентная / гибкая / без чёткого форсинга) с явной привязкой к главному плюсу и главному минусу драфта ("Lean on this... Cover for this..."). Пересобирает уже откалиброванные нарративы этих осей, не вводит новый сигнал.

Мотивация — пользовательский фидбек: слишком много формальных/циферных формулировок, недостаточно нарратива о том, как реально прошла бы игра с таким составом.

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
