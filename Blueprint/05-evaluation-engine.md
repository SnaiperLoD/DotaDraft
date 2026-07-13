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
