# Hero Knowledge Base

## Purpose

Единый источник знаний о героях. Используется Evaluation Engine и Battle Engine.
Ничего о героях не должно храниться нигде, кроме этого файла (см. Hero Knowledge Rule в 01-core-rules.md).

## Status

Черновик v0.1. Сгенерирован автоматически, требует ручной проверки.

- `id`, `name`, `primary_attribute`, `attack_type`, `roles` — факт, взято из OpenDota API (127 героев, актуально на июль 2026, включая Kez и Largo). Проверять не нужно.
- `tags`, `synergy_tags`, `counter_tags` — черновая экспертная разметка, сделана по фиксированной таксономии ниже. Требует ревью, особенно `counter_tags` — это самое субъективное поле.
- `vision_ability_tier`, `mobility_ability_tier` — новые черновые ручные теги (см. Ability Tiers ниже), вход для калибровки `map_control`. Тоже требуют ревью, как и остальные ручные теги.
- `evaluation_values` — все 10 осей откалиброваны по реальным данным OpenDota (`server/scripts/calibrate-evaluation-values.ts`), см. ниже.

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

## Evaluation Values

10 числовых осей (0–10). `server/scripts/calibrate-evaluation-values.ts` пересчитывает все 10 при каждом запуске.

### Прямые от одной метрики OpenDota (4 оси)

Медиана (перцентиль 0.5) нужной метрики из `server/data/hero-meta.json` (`benchmarks`, собрано `fetch-hero-meta.ts`), ранжированная по всем 127 героям друг относительно друга (rank-based нормализация в 0–10 — устойчива к отдельным героям-выбросам, в отличие от min-max; см. `percentileRankScale` в `server/src/hero-meta/benchmark-calibration.ts`).

- `teamfight` ← `hero_damage_per_min`
- `burst` ← `kills_per_min`
- `scaling` ← 60% среднее из нормализованных `gold_per_min`/`xp_per_min` + 40% тренд "винрейт растёт с длительностью матча" (см. ниже)
- `objectives` ← `tower_damage`

Пример реального эффекта: Meepo и Zeus раньше получали одинаковый `burst` по формуле — теперь `burst` 7.5 у Meepo против 6.1 у Zeus, на основе фактического `kills_per_min`.

### Составные метрики из OpenDota Explorer SQL (3 оси)

Считаются напрямую по `player_matches`/`matches` (не через `/api/benchmarks`), одним SQL-запросом на героя (`server/scripts/research-tempo-metric-v3.ts`, `research-tempo-mobility-data.ts`, `fetch-control-durability-vision-data.ts`).

- **`tempo`** — блендинг трёх сигналов (`weightedBlend`, веса 0.375/0.375/0.25):
  - win/loss duration gap: для одного и того же героя средняя длительность его побед минус средняя длительность его поражений (не "все победы героя vs средняя по всей базе" — та первая версия путала "герой навязывает быструю игру" с "команда героя обычно проигрывает долгие матчи");
  - win-rate trend: винрейт героя в матчах <25мин минус винрейт в матчах 40+мин, со знаком (падает с длительностью = высокий tempo; тот же сырой тренд с обратным знаком идёт в `scaling`, см. выше);
  - early kills per game: количество килов героя (`kills_log`) до 25-й минуты, в среднем за матч.
  - First Blood rate рассматривался и отклонён — слишком шумная метрика, сильно зависит от остальной команды.
- **`control`** ← `stuns` (суммарная секунда оглушения, per-minute) — прямая метрика OpenDota, лучше изначально предполагавшегося "среднего оглушения".
- **`durability`** ← `SUM(damage_taken) / SUM(deaths)` по всем матчам героя (не среднее по матчам — так не ломается на матчах с 0 смертей).

### `mobility` — отдельная ось, из submetric'а `map_control`

```
mobility = percentileRankScale(mobilityScore)

mobilityScore = 0.3×moveSpeedExtremity(move_speed, z-score с усилением хвостов, exponent=1.6) + 0.7×abilityMobilityBonus(ручной тег mobility_ability_tier)
```

Раньше `mobility` была единственной осью на исходной ролевой формуле (хардкод 3 или 6, без вариации внутри группы) — заменена на уже существовавший `mobilityScore` (раньше использовался только как внутренний компонент `map_control`, см. ниже), с финальным перцентильным проходом. `mobility_ability_tier` есть только у ~15% героев (см. Ability Tiers ниже), у остальных честный `0` — без финального `percentileRankScale` композит компрессировался бы к низу шкалы просто по формату данных, а не по реальной слабости героя.

### `map_control` (заменяет старую `vision`) — композитная метрика

Vision был признан устаревшей метрикой (только "покупка вардов" ≈ метрика саппорта, а не реального контроля карты героем). Формула и веса — в отдельном файле `server/data/map-control-weights.json` (специально вынесены из кода, ожидаются частые правки):

```
map_control = percentileRankScale(0.35×visionScore + 0.35×mobilityScore + 0.3×abilityVisionBonus)

visionScore   = 0.7×wardScore(obs_placed+sen_placed per-min) + 0.3×innateVisionRange(day_vision+night_vision, /api/constants/heroes)
mobilityScore = 0.3×moveSpeedExtremity(move_speed, z-score с усилением хвостов, exponent=1.6) + 0.7×abilityMobilityBonus(ручной тег)
```

`moveSpeedExtremity` (см. `zScoreExtremityScale`) — не рядовая ранговая нормализация: небольшое отклонение от среднего move_speed почти не влияет на счёт, а сильный выброс (например, Crystal Maiden, move_speed 280 против ~310 у большинства) получает непропорционально больший штраф — это и есть "низкий вес, растущий к крайним случаям".

`abilityVisionBonus`/`abilityMobilityBonus` берутся напрямую из ручных тегов `vision_ability_tier`/`mobility_ability_tier` (0-10, см. Ability Tiers ниже) — отсутствие тега (0) осознанно считается частью блендинга, а не "нет данных" (герой без специальных способностей реально не должен получать бонус).

Изначально композит писался в `evaluation_values.map_control` без финального перцентильного прохода — поскольку `vision_ability_tier` тоже есть только у ~20% героев, композит систематически кучковался у нижней границы шкалы (случайные 5-геройные драфты в среднем ~2.7/10, максимально возможный композит из топ-20 героев — только ~5/10). Финальный `percentileRankScale` растягивает результат обратно на полный диапазон 0-10 по рангу, не трогая веса самого бленда. Подробности проверки — `10-tech-debt-backlog.md`, "evaluation_values — полностью откалибровано".

Blink Dagger/Boots of Travel purchase rate по герою рассматривались как возможный четвёртый вход, но решили не делать это живым рантайм-сигналом — Blink Dagger оказался слабым сигналом на практике (топ покупателей — иниціаторы вроде Sand King/Axe/Legion Commander, использующие блинк для инициации, а не для мобильности по карте). Данные использовались только как вспомогательная проверка при ручной курации Ability Tiers ниже, не как отдельный вес в формуле.

### Ability Tiers (`vision_ability_tier`, `mobility_ability_tier`)

Черновая ручная разметка (`server/scripts/apply-ability-tags.ts`), как и остальные ручные теги — требует проверки.

**`vision_ability_tier`** (прямой reveal/scouting/stealth-интел):
- 10 — Zeus, Spectre, Bounty Hunter, Clockwerk, Bloodseeker, Slark, Nature's Prophet
- 6 — Beastmaster (Hawk)
- 5 — мобильные саммон-герои: Enigma, Warlock, Broodmother, Chen, Lycan, Visage, Ringmaster, Lone Druid, Invoker
- 3 — инвиз/скрытое слежение: Riki, Clinkz, Templar Assassin, Treant Protector, Nyx Assassin, Slardar, Shadow Demon
- 2 — Muerta (единственный из новых героев)
- 1 — Shadow Shaman (статичный вард-саммон, минимальный бонус сверх обычных вардов)

**`mobility_ability_tier`** (встроенный blink/dash/haste, не через предмет):
- 10 — Spirit Breaker, Queen of Pain, Morphling, Anti-Mage, Ember Spirit, Weaver, Nature's Prophet
- 6 — Storm Spirit, Puck, Void Spirit, Earth Spirit, Windranger
- 3 — Invoker, Lina, Necrophos, Keeper of the Light, Viper, Brewmaster (частые покупатели Boots of Travel — вспомогательный сигнал "хочет map presence", не встроенная механика)

### `saving` — блендинг реальных данных + существующего тега

```
saving = 0.4×healingScore(hero_healing_per_min, benchmarks) + 0.6×protectsAllies(бинарный тег synergy_tags, есть/нет)
```

`protects_allies` — уже существующий тег в Hero Knowledge Base (использовался только в Synergy Analyzer для парных правил), переиспользован здесь напрямую, без новой ручной разметки. MVP-версия оси — точная калибровка весов/источника предполагается позже, после полной разметки способностей (см. Ability Tiers выше и `10-tech-debt-backlog.md`).

Пример: Dazzle/Oracle/Winter Wyvern — 10/10, Anti-Mage/Crystal Maiden — ~0.

### Известные артефакты данных

Meepo: `control` 9/10 и `durability` 10/10 выглядят завышенными — вероятно, артефакт того, что OpenDota агрегирует `stuns`/`damage_taken` в одну строку игрока, а у Meepo фактически несколько юнитов-клонов на поле одновременно. Не исправлено, честно зафиксировано здесь.

Перезапуск полного цикла: `npm run fetch-hero-meta` → `npx ts-node scripts/research-tempo-metric-v3.ts` → `npx ts-node scripts/research-tempo-mobility-data.ts` → `npx ts-node scripts/fetch-control-durability-vision-data.ts` → (обновить `hero-constants.json` через `/api/constants/heroes`) → `npm run calibrate-evaluation-values` → `npm run seed`. `saving` не требует отдельного фетча — использует уже собранные `hero-meta.json` (healing) и `heroes.json` (`protects_allies`). Не гонять все Explorer-скрипты подряд без пауз — общий rate-limit OpenDota ловится быстро (см. `11-operational-notes.md`).

## Data File

`heroes.json` — 127 объектов, схема соответствует Hero из 03-data-model.md плюс поля выше (включая `vision_ability_tier`/`mobility_ability_tier`, которые не экспонируются в рантайм-тип `Hero` — только вход для калибровки).

## Next Review Pass

Приоритет ручной проверки:

1. `counter_tags` — самое субъективное поле, автор (ChatGPT/Claude) чаще всего мог ошибиться именно здесь.
2. `vision_ability_tier`/`mobility_ability_tier` — новые, черновые, ещё не проверены (особенно способности новых героев вроде Ringmaster/Kez/Largo — не уверены в их точных механиках). Прямо влияют на калибровку `mobility` и `map_control`, поэтому ошибка здесь протекает в обе оси.
3. `tags`/`synergy_tags` — в целом надёжнее, но стоит выборочно свериться.
