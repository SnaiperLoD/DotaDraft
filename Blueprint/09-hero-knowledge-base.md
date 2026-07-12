# Hero Knowledge Base

## Purpose

Единый источник знаний о героях. Используется Evaluation Engine и Battle Engine.
Ничего о героях не должно храниться нигде, кроме этого файла (см. Hero Knowledge Rule в 01-core-rules.md).

## Status

Черновик v0.1. Сгенерирован автоматически, требует ручной проверки.

- `id`, `name`, `primary_attribute`, `attack_type`, `roles` — факт, взято из OpenDota API (127 героев, актуально на июль 2026, включая Kez и Largo). Проверять не нужно.
- `tags`, `synergy_tags`, `counter_tags` — черновая экспертная разметка, сделана по фиксированной таксономии ниже. Требует ревью, особенно `counter_tags` — это самое субъективное поле.
- `evaluation_values` — рассчитаны автоматически по формуле из официальных ролей героя (см. ниже). Это стартовая точка, не откалиброванные значения. По плану (07-development-plan.md, Milestone 3) точность должна вырасти после импорта реальных матчей.

## Style Tags (`tags`)

Архетип поведения героя в игре:

`teamfight`, `split_push`, `pick_off`, `deathball`, `poke`, `late_game_scaling`, `early_aggression`, `lane_dominance`, `roshan_focused`, `global_impact`, `illusion_based`, `summon_based`

## Synergy Tags (`synergy_tags`)

Что герой даёт команде или что ему нужно от команды:

`enables_engage`, `needs_setup`, `protects_allies`, `amplifies_magic_damage`, `amplifies_physical_damage`, `needs_space`, `creates_space`, `wave_clear_support`, `vision_provider`

Synergy Analyzer должен искать пары/комбинации внутри одной команды по этим тегам (например: `needs_setup` герой + союзник с `enables_engage` = высокая синергия).

## Counter Tags (`counter_tags`)

Против чего герой особенно эффективен:

`counters_illusions`, `counters_summons`, `counters_invisibility`, `counters_channeled_ultimates`, `counters_low_mobility`, `counters_high_mobility`, `counters_squishy_backline`, `counters_mana_reliant`, `counters_tanky_durable`

Counter Analyzer должен сопоставлять `counter_tags` одной команды с `style_tags`/атрибутами героев другой команды.

## Evaluation Values — формула первого прохода

9 числовых осей (0–10), стартовое значение каждой оси — 3:

`teamfight`, `tempo`, `scaling`, `mobility`, `objectives`, `control`, `durability`, `burst`, `vision`

За каждую официальную роль (OpenDota) к соответствующим осям прибавляется вес:

- Carry → scaling +2, tempo −1
- Support → vision +2, teamfight +1
- Nuker → burst +2
- Disabler → control +3
- Initiator → teamfight +2, tempo +1
- Durable → durability +3
- Escape → mobility +3
- Pusher → objectives +3

Результат ограничен диапазоном 0–10.

## Data File

`heroes.json` — 127 объектов, схема соответствует Hero из 03-data-model.md плюс поля выше.

## Next Review Pass

Приоритет ручной проверки:

1. `counter_tags` — самое субъективное поле, автор (ChatGPT/Claude) чаще всего мог ошибиться именно здесь.
2. `evaluation_values` — сейчас чисто формула от ролей, не учитывает нюансы конкретного героя (например Meepo и Zeus получат одинаковый `burst`, хотя в реальности это не так). Потребует ручной коррекции точечно.
3. `tags`/`synergy_tags` — в целом надёжнее, но стоит выборочно свериться.
