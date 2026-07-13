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
- Mobility
- Map Control
- Saving
- Objectives
- Pro Similarity

## Initial Weights

- Synergy: 30%
- Teamfight: 20%
- Tempo: 15%
- Scaling: 10%
- Objectives: 10%
- Mobility: 5%
- Map Control: 5%
- Saving: 5%
- Pro Similarity: 5%

## Analyzer System

Each Analyzer:

Input:
Draft

Output:
- score
- explanation

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
