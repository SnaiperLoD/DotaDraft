# Hero Knowledge Base

## Purpose

Единый источник знаний о героях. Используется Evaluation Engine и Battle Engine.
Ничего о героях не должно храниться нигде, кроме этого файла (см. Hero Knowledge Rule в 01-core-rules.md).

## Status

Черновик v0.1. Сгенерирован автоматически, требует ручной проверки.

- `id`, `name`, `primary_attribute`, `attack_type`, `roles` — факт, взято из OpenDota API (127 героев, актуально на июль 2026, включая Kez и Largo). Проверять не нужно.
- `tags`, `synergy_tags`, `counter_tags` — черновая экспертная разметка, сделана по фиксированной таксономии ниже. Требует ревью, особенно `counter_tags` — это самое субъективное поле.
- `vision_ability_tier` — черновой ручной тег (см. Ability Tiers ниже), единственный оставшийся вход старой системы, всё ещё используется в калибровке `map_control`. Требует ревью.
- `mobility_ability_tier` — то же поле физически ещё существует в `heroes.json`, но с этой сессии нигде не читается: `mobility` полностью перешла на новую per-ability систему разметки (см. "Ручная разметка способностей" ниже). Мёртвое поле, кандидат на удаление при следующей чистке схемы.
- `evaluation_values` — 10 осей полностью откалиброваны по реальным данным OpenDota + ручной разметке способностей (`server/scripts/calibrate-evaluation-values.ts`), плюс 11-я ось `initiating` — уже посчитана и записывается сюда же, но пока не используется ни Battle Engine, ни role-fit, ни клиентом (отдельный незакрытый скоуп, см. ниже и `10-tech-debt-backlog.md`).

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

11 числовых осей (0–10) — 10 в активном использовании (Battle Engine, Evaluation Engine, role-fit) плюс `initiating` (посчитана, не подключена дальше, см. ниже). `server/scripts/calibrate-evaluation-values.ts` пересчитывает все 11 при каждом запуске.

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
- **`control`** ← 50% `stuns` (суммарная секунда оглушения, per-minute, прямая метрика OpenDota) + 50% ручной тег `control_strength` (см. "Ручная разметка способностей" ниже). Раньше был 100% `stuns` — заменено, потому что `stuns` считает только жёсткие disable'ы (стан/хекс/рут); сайленсы и слоу флаг не выставляют вообще. Проверено на Silencer/Disruptor/Enigma — все трое с реально сильным контролем (Global Silence/Static Storm/Black Hole) получали `stuns` близко к нулю по всей популяции. Вес 50/50 подобран эмпирически: изначальный 65/35 (в пользу реальных данных, по умолчанию для всех новых осей) оставлял Disruptor почти на дне рейтинга несмотря на максимальный ручной тег — реальный сигнал для таких героев не "слабый", а фактически отсутствующий, и полвеса на почти-ноль всё ещё топит итог.
- **`durability`** ← 75% `SUM(damage_taken) / SUM(deaths)` по всем матчам героя (не среднее по матчам — так не ломается на матчах с 0 смертей) + 25% hand-tagged `damage_mitigation` (per-ability, см. ниже). Блендинг добавлен 2026-08-03: реальная статистика структурно слепа к активному снижению/блоку урона (Bulwark/Kraken Shell/Mana Shield/etc. буквально СНИЖАЮТ числитель `damage_taken` именно потому, что работают — герой, который блокирует урон, по этой метрике выглядит менее живучим, не более). Найдено по репорту пользователя на примере Mars, подтверждено на Medusa (Mana Shield, 98% урона конвертируется в ману) и Treant Protector (Living Armor) — оба были у самого дна durability при репутации одних из самых танкующих героев в игре.

### `mobility` — отдельная ось, из submetric'а `map_control` + item-purchase сигнал

```
mobility = zScoreExtremityScale(mobilityScore, exponent=1.6)

mobilityScore = 0.2×moveSpeedExtremity(move_speed, z-score с усилением хвостов, exponent=1.6) + 0.7×abilityMobilityBonus(ручная разметка способностей, см. ниже) + 0.1×mobilityItemsTier
```

Раньше `mobility` была единственной осью на исходной ролевой формуле (хардкод 3 или 6, без вариации внутри группы) — заменена на уже существовавший `mobilityScore` (раньше использовался только как внутренний компонент `map_control`, см. ниже).

Прошла через несколько итераций:
1. Сначала — `percentileRankScale` вместо `zScoreExtremityScale` для финального прохода, оказалось багом: 90% героев имели `mobility_ability_tier=0` (тогда ещё старый грубый per-hero тег), и внутри этой "плоской" группы кто-то всё равно ранжировался "выше 70% лиги" просто по построению ранга. Заменено на `zScoreExtremityScale` (не растягивает плотный кластер около среднего, только реальные выбросы толкает к краям) — тот же инструмент, что уже применяется к `move_speed` внутри этой же формулы.
2. `abilityMobilityBonus` был грубым per-hero тегом (`mobility_ability_tier`, 0/3/6/10) — заменён на сумму per-ability ручных тегов из `ability-tagging.csv` (см. "Ручная разметка способностей" ниже), тот же `zScoreExtremityScale`-проход применяется уже к сумме.
3. Веса `0.4/0.5/0.1` сдвинуты на `0.2/0.7/0.1` — базовая скорость передвижения при исходных весах перевешивала реальный набор способностей: герои с move_speed около популяционного максимума (~325 из потолка 330), но без единой способности на мобильность (Sven, Skywrath Mage, Leshrac, Abaddon, Chaos Knight) выходили в топ мобильности, а герои с топовым ручным тегом (Spirit Breaker's Charge of Darkness, Ember Spirit's Fire Remnant) при среднем move_speed оставались в середине рейтинга. После сдвига веса Sven упал с 8.3 до 5.7, Spirit Breaker обогнал его (7.4).

### `mobility_items_tier` — Blink Dagger / Boots of Travel purchase rate

```
mobilityItemsTier = max(percentileRankScale(blinkRate)/10×4, percentileRankScale(botRate)/10×2)
```

Данные — `server/scripts/research-tempo-mobility-data.ts` (Explorer SQL по `purchase_log`). Blink Dagger покупает почти весь ростер (плавный спад 99%→45%, без естественного разрыва в данных, топ покупателей — чистые инициаторы вроде Sand King/Axe/Legion Commander, а не мобильные герои — это уже отмечалось ранее как слабый сигнал), поэтому вместо порогового тега используется ранговая шкала: score зависит только от относительной частоты покупки среди 127 героев, не от абсолютного значения rate. Boots of Travel имеет чёткий разрыв в данных (28.7%→11.6% между Snapfire и Enigma) и скалируется тем же способом для консистентности. Blink ограничен потолком 4, BoT — потолком 2 (Blink — более сильный инструмент позиционирования), берётся `max()` двух, не сумма — чтобы не задваивать бонус герою, покупающему оба предмета часто. Итоговый вес в `mobilityScore` — всего 0.1, чтобы известная слабость сигнала (инициаторы в топе Blink-покупок) не искажала итоговую ось.

Раньше BoT-based данные ошибочно были частью самого `mobility_ability_tier` (см. Ability Tiers ниже, tier=3 у Invoker/Lina/Necrophos/KotL/Viper/Brewmaster) — это смешивало "реальная встроенная способность" с "просто часто покупает предмет". Вынесено в отдельное поле; у этих шести героев `mobility_ability_tier` сброшен в `0` (ни у одного нет встроенного блинка/дэша).

### `map_control` (заменяет старую `vision`) — композитная метрика

Vision был признан устаревшей метрикой (только "покупка вардов" ≈ метрика саппорта, а не реального контроля карты героем). Формула и веса — в отдельном файле `server/data/map-control-weights.json` (специально вынесены из кода, ожидаются частые правки):

```
map_control = percentileRankScale(0.35×visionScore + 0.35×mobilityScore + 0.3×abilityVisionBonus)

visionScore   = 0.7×wardScore(obs_placed+sen_placed per-min) + 0.3×innateVisionRange(day_vision+night_vision, /api/constants/heroes)
```

`abilityVisionBonus` берётся напрямую из ручного тега `vision_ability_tier` (0-10, см. Ability Tiers ниже) — отсутствие тега (0) осознанно считается частью блендинга, а не "нет данных".

Изначально композит писался в `evaluation_values.map_control` без финального перцентильного прохода — поскольку `vision_ability_tier` тоже есть только у ~20% героев, композит систематически кучковался у нижней границы шкалы. Финальный `percentileRankScale` растягивает результат обратно на полный диапазон 0-10 по рангу.

`mobility` прошла через тот же `percentileRankScale`-фикс и оказалась баговой (см. выше) — `map_control` использует `mobilityScore` как один из трёх компонентов, так что была отдельно проверена тем же строгим методом (сравнение заведомо "неподходящих" героев с сырыми входными данными, не просто визуальный обзор топа): среди 89 героев без единого ability-тега только 1 (Naga Siren) оказался выше среднего при слабом варденье — остальные топовые скоры (Bane 8.9, Oracle 8.8, Winter Wyvern 8.7...) подтверждены реально высоким `wardsPerMin` (Bane — максимум по всей популяции). `map_control` не унаследовал баг `mobility`, потому что `wardScore`/`innateVisionScore` уже несут реальную вариацию по всей популяции (в отличие от бинарного `mobility_ability_tier`), а `abilityVisionBonus` весит всего 0.3, не 0.7. Полное описание проверки — `10-tech-debt-backlog.md`.

### Ability Tiers (только `vision_ability_tier` — `mobility_ability_tier` вытеснена, см. ниже)

Черновая ручная разметка (`server/scripts/apply-ability-tags.ts`), как и остальные ручные теги — требует проверки.

**`vision_ability_tier`** (прямой reveal/scouting/stealth-интел) — всё ещё живой вход в `map_control`, не тронут этой сессией:
- 10 — Zeus, Spectre, Bounty Hunter, Clockwerk, Bloodseeker, Slark, Nature's Prophet
- 6 — Beastmaster (Hawk)
- 5 — мобильные саммон-герои: Enigma, Warlock, Broodmother, Chen, Lycan, Visage, Ringmaster, Lone Druid, Invoker
- 3 — инвиз/скрытое слежение: Riki, Clinkz, Templar Assassin, Treant Protector, Nyx Assassin, Slardar, Shadow Demon
- 2 — Muerta (единственный из новых героев)
- 1 — Shadow Shaman (статичный вард-саммон, минимальный бонус сверх обычных вардов)

**`mobility_ability_tier`** — этот грубый per-hero тег (0/3/6/10) с этой сессии нигде не читается, `mobility` полностью перешла на per-ability разметку ниже. Поле осталось в `heroes.json`, значения не удалялись, но это исторический артефакт, не вход калибровки.

### Ручная разметка способностей (`ability-tagging.csv`) — питает `mobility`, `saving`, `initiating`, `control_strength`, `damage_mitigation`

Отдельная система от Ability Tiers выше — размечается не герой целиком, а каждая способность по отдельности (789 способностей, 127 героев), по 5 категориям (0–10 за способность, пусто = не относится):

- `mobility` — питает ось `mobility` (заменяет `mobility_ability_tier`)
- `saving` — питает ось `saving`
- `initiating` — питает новую ось `initiating` (см. ниже)
- `control_strength` — дополняет ось `control` (см. выше)
- `damage_mitigation` — дополняет ось `durability` (см. выше). **Отличается от остальных 4 категорий по объёму разметки**: не полный проход пользователя по всем 789 способностям, а точечная первая волна (2026-08-03) на 18 способностях с явным активным снижением/блоком урона (Bulwark, Kraken Shell, Mana Shield, Living Armor и т.д.), найденных через ключевой поиск по описаниям, а не полный ручной аудит — см. `10-tech-debt-backlog.md` для методологии и полного списка. Ожидается расширение в будущих сессиях, как и у остальных категорий.

Пайплайн: `server/data/ability-tagging.csv` (редактируется вручную, пользователем) → `import-ability-tagging.ts` записывает в `hero-abilities.json`'s `categoryScores` → `aggregate-ability-tags.ts` суммирует по герою в каждой категории (`ability-tag-aggregates.json`) → `calibrate-evaluation-values.ts` прогоняет сумму через `zScoreExtremityScale` и блендит с реальными данными там, где они есть.

**Сумма, не среднее.** Способность без тега даёт герою 0 в этой сумме, а не "нет данных" — отсутствие тега так же осмысленно, как и его наличие. Сумма (а не среднее по всем способностям героя, среди которых обычно только 1-2 релевантны) выбрана, чтобы герой с одной выдающейся способностью не терялся в шуме нерелевантных нулей, а герой с несколькими рабочими инструментами получал кредит за глубину кита. Известный побочный эффект: герои-специалисты с одним элитным инструментом (Axe's Berserker's Call, control_strength=8 сам по себе) закономерно суммируют ниже героев с 3-4 умеренными инструментами (Earthshaker — 18 суммарно) — это не баг разметки, а свойство SUM-агрегации, зафиксировано как компромисс.

Веса блендинга и exponent для `zScoreExtremityScale` — в `server/data/ability-tag-weights.json`, не хардкожены (та же причина, что у `map-control-weights.json` — ожидаются частые правки).

### `saving` — блендинг реальных данных + ручной разметки способностей

```
saving = 0.3×healingScore(hero_healing_per_min, benchmarks, ноль если нет реальных данных) + 0.7×savingTagScore(zScoreExtremityScale от суммы ручных тегов saving)
```

Заменяет старую формулу (0.4×healing + 0.6×бинарный тег `protects_allies`). `hero_healing_per_min` оказался обманчивым источником в обе стороны:
1. Считает самолечение/лайфстил наравне с лечением союзников — Necrophos/Lifestealer/Morphling получали высокий реальный хил без единой способности на спасение союзника в ручной разметке.
2. Не видит спасение, не восстанавливающее HP — Bane's Nightmare (неуязвимость), Pudge's Meat Hook (можно тянуть союзника, не лечит), Mirana's Moonlight Shadow (командный disengage через невидимость) — у всех троих реальный хил ровно 0, несмотря на честный ручной тег.

Текущее правило: если реальных данных о лечении нет (в т.ч. честный ноль), эта часть формулы даёт буквально `0`, а не выкидывается из блендинга — вес ручного тега остаётся фиксированным на 70%, не перенормируется до 100%. Полностью проблему (1) это не решает: у героя может быть небольшой ненулевой ручной тег (Necrophos's Death Pulse) — тогда контаминированные реальные данные всё равно попадают в бленд. Это осознанно принятое ограничение, не баг — нужен собственный фикс тега, не формулы.

### `initiating` — подключена (Battle Engine, role-fit, Evaluation Engine breakdown)

```
initiating = weightedBlend(0.85×initiatingTagScore(zScoreExtremityScale от суммы ручных тегов initiating), 0.15×blinkPurchaseRateScore(percentileRankScale))
```

Единственная ось без реальных объективных данных (кроме частоты покупки Blink Dagger) — OpenDota не измеряет "кто первый начал файт". Записывается в `evaluation_values.initiating` и теперь читается везде: **Battle Engine** (`AXES` в `battle-resolution.ts`, 10→11 осей), **role-fit** (`ROLE_AXES` в `common/role-fit.ts` — добавлена Offlane, кандидат из `10-tech-debt-backlog.md`) и **Evaluation Engine** (`createAxisAnalyzer('initiating', 'Initiating')` в `evaluation.service.ts`, вес 0.05, как у прочих второстепенных осей). Клиентский UI ничего не потребовал отдельно — и `EvaluationPanel.tsx`, и `BattlePanel.tsx` рендерят breakdown/advantages/disadvantages полностью динамически (по данным с сервера), без захардкоженного списка осей. Перед подключением прогнан `check-axis-distribution.ts` — распределение здоровое (RANDOM mean≈4.87/sd≈0.61, MAXED потолок≈7.13/sd≈0.39), без вырождения в духе старого бага `mobility`. Полная история решения — `10-tech-debt-backlog.md`.

Blink Dagger добавлен с большим весом, чем в `mobility` (0.15 против объединённых 0.1 на Blink+BoT там), потому что для целого класса "даггер + одна ультимативная способность" инициаторов (Tidehunter, Mars, Sven, Dragon Knight) итемизация — не второстепенный сигнал, а основной: у них обычно только 1-2 тегованных способности, и чистая сумма тегов недооценивает их относительно героев с богатым кастующимся китом (Invoker, Tusk, Earth Spirit).

### `skirmish_rate` и `camp_stacking` (переименованы из `aggression`/`farm_priority` 2026-07-24) — новые оси, первые откалиброванные через регрессию против реального winRate

```
skirmish_rate = weightedBlend(0.5×deathsPerMinScore(percentileRankScale), 0.5×invertedLastHitsPerMinScore(percentileRankScale от -last_hits_per_min))
camp_stacking = percentileRankScale(campsStackedPerMin)
```

**Переименование 2026-07-24** (self-play outlier investigation, `10-tech-debt-backlog.md`): старые имена вводили в заблуждение. `aggression` звучало как "боевая агрессивность", `farm_priority` — как "личная потребность в фарме". По факту `camps_stacked_per_min` — это стак крипов **для союзника**, роумерское/сапортское поведение, а не мера того, насколько герою самому нужен фарм. Хардкерри-сплитпушер Phantom Lancer (максимально фарм-зависимый герой в игре) получал `farm_priority≈0.2`, потому что не стакает лагеря — он просто эффективно фармит сам. Поднятие веса этой оси (в рамках калибровки Battle Engine) систематически **ухудшало** оценку именно таких героев, а не улучшало. Ни одна текущая ось не измеряет "нужно ли герою время для скейла" в прямом смысле — см. открытый пункт в `10-tech-debt-backlog.md`.

Первые две оси в истории проекта, добавленные **после**, а не до проверки на реальных данных — обычный порядок (`09`→калибровка→потом сверка с реальностью) был перевёрнут: сессия регрессии (`Blueprint/10-tech-debt-backlog.md`, "Поворотный момент" и последующие находки) сначала нашла статистически значимую простую корреляцию с реальным `winRate` (`deaths_per_min` r=+0.178, `camps_stacked_per_min` r=-0.197, `last_hits_per_min` r=-0.177 — все три по отдельности, не только внутри многофакторной регрессии, которая в этой же сессии дважды дала ложные срабатывания на `burst` и `movement`), и только потом эти метрики оформлены в calibrate-evaluation-values.ts как полноценные оси.

`deaths_per_min` и `last_hits_per_min` объединены в `skirmish_rate`, а не оставлены раздельно — они почти зеркальны (r=-0.726: герой, часто размениваривающийся в файтах, естественно фармит менее эффективно, и наоборот). `camps_stacked_per_min` осталась отдельной осью (`camp_stacking`) — слабо коррелирует с парой deaths/last-hits (|r|<0.17), то есть измеряет что-то самостоятельное (стак лагерей для команды), а не то же самое другими словами.

Источники: `deaths_per_min`/`camps_stacked_per_min` — новый Explorer-фетч (`server/scripts/fetch-deaths-camps-data.ts`, тот же паттерн, что `fetch-control-durability-vision-data.ts`, `server/data/deaths-camps-data.json`); `last_hits_per_min` — уже лежал неиспользуемым в `hero-meta.json`'s `benchmarks` (тот же `/api/benchmarks` фетч, что уже даёт teamfight/burst/scaling/objectives) — новых данных для него собирать не пришлось.

Подключены сразу везде, тем же путём, что `initiating`: **Battle Engine** (`AXES`, 11→13 осей), **Evaluation Engine** (`createAxisAnalyzer`, вес по умолчанию 0.05 — намеренно НЕ повышен только потому, что ось валидирована реальными данными, это отдельное решение по тюнингу весов, не бандл с добавлением оси), **role-fit не тронут** — ни одна роль пока не сопоставлена этим осям, нет данных, какая роль должна получать буст. Клиентский UI снова не потребовал правок (полностью динамический рендеринг breakdown).

### `resource_efficiency` — новая ось (2026-08-05, по запросу пользователя), Evaluation Engine-only

```
resource_efficiency = percentileRankScale(damagePerNetworthShare)

damagePerNetworthShare = AVG_по_матчам(hero_damage / (own_net_worth / team_net_worth))
```

Идея пользователя: оценивать не сырой урон/мин (`teamfight`), а урон **относительно того, какую долю командного нетворса герой на себя оттянул** — герой, наносящий сопоставимый урон меньшей ценой (в фарме), эффективнее, чем герой, которому для того же урона нужен больший приоритет.

Источник данных — новый Explorer-фетч (`server/scripts/fetch-damage-networth-share-data.ts`, `server/data/damage-networth-share-data.json`): `net_worth` — реальное поле `player_matches` (обнаружено через `/api/schema`), командный нетворс считается self-join'ом `player_matches` на себя по `match_id` + стороне (`player_slot < 128` = Radiant/Dire). Усредняется **по матчу** (`AVG` внутри SQL-запроса), а не как отношение сумм — иначе агрегация была бы смещена. Валидировано на выборке из 8 героев перед полным сбором (Zeus/Pudge — высокий эффективный урон при низком фарм-приоритете; Terrorblade/Juggernaut — сопоставимый сырой урон, но "куплен" большой долей нетворса, эффективность заметно ниже), затем прогнано на все 127 (Batrider не прошёл первый проход из-за HTTP 429 от OpenDota, дозапрошен точечно).

Полная выборка (окно ~150M match_id, MIN_GAMES=15) подтвердила паттерн: топ — Techies, Ember Spirit, Zeus, Hoodwink, Venomancer, Clockwerk, Rubick (нюкеры/дизейблеры с низким фарм-приоритетом); дно — Chen, Io, Dazzle, Oracle, Bounty Hunter, Lycan, Meepo, Anti-Mage, Naga Siren (либо чистые саппорты почти без личного урона, либо фарм-хищники, чей урон приходит только при большом фарм-приоритете).

**Deliberately Evaluation Engine-only** — в отличие от `skirmish_rate`/`camp_stacking`, эта ось НЕ проверена простой корреляцией с реальным `winRate` перед подключением (только точечная проверка на здравый смысл по горстке героев), поэтому:
- НЕ добавлена в Battle Engine (`AXES` в `battle-resolution.ts`, `axis-weights.json`) — не участвует в расчёте win probability;
- НЕ добавлена в `hard-carry.ts`'s `NON_SCALING_AXES` / `utility-stacking.ts`'s `UTILITY_AXES` / `role-fit.ts`'s `ROLE_AXES` — не участвует в hard-carry penalty, utility-stacking discount или role-fit boost;
- НЕ добавлена в `WEIGHTS` (`evaluation.service.ts`) — не двигает Total Score, только своя строка в breakdown (то же обращение, что у `counter`).

Percentile-распределение (для процентильной плашки и narrative-брекета) всё же посчитано — `compute-axis-percentiles.ts` сэмплирует эту ось отдельным списком (`AXES_TO_SAMPLE = [...AXES, 'resource_efficiency']`), не трогая настоящий Battle Engine `AXES`, специально чтобы избежать риска: у `axisWeightForPhase()` в `battle-resolution.ts` дефолт для отсутствующего в `axis-weights.json` ключа — **вес 1** (не 0!), так что просто добавить ось в `AXES` без явного веса 0 в `axis-weights.json` тихо утащило бы неоткалиброванный сигнал в реальный расчёт win probability на полную силу — сознательно этого избежали, оставив ось полностью вне Battle Engine.

Требует TypeScript-типизации `resource_efficiency` во всех местах, где `HeroEvaluationValues` тотален по ключам (`AXIS_LABEL` в `battle-resolution.ts` — просто заглушка-лейбл, `describeAxis()` никогда с этим ключом не вызывается; тестовые фикстуры `hero-factory.ts`/`custom-tags.spec.ts`).

Кандидат на будущее (если сигнал понравится пользователю на практике): прогнать через тот же процесс валидации, что `skirmish_rate`/`camp_stacking` — простая корреляция с реальным `winRate`, и только потом подключать в Battle Engine/role-fit — см. `10-tech-debt-backlog.md`.

### Известные артефакты данных

Meepo: `control` 9/10 и `durability` 10/10 выглядят завышенными — вероятно, артефакт того, что OpenDota агрегирует `stuns`/`damage_taken` в одну строку игрока, а у Meepo фактически несколько юнитов-клонов на поле одновременно. Не исправлено, честно зафиксировано здесь.

Necrophos: `saving` 6.3/10 остаётся завышенным несмотря на фикс формулы выше — `hero_healing_per_min` считает его killstreak-реген (Sadist) как лечение, а небольшой ненулевой ручной тег на Death Pulse не даёт формуле полностью исключить эти данные. Известное, осознанно принятое ограничение (см. `saving` выше), не обрабатывать как незамеченный баг.

Общий паттерн, встретившийся трижды в разных осях за эту сессию: реальная OpenDota-метрика может быть "слепой зоной" для целого класса способностей (`stuns` не видит сайленсы/слоу, `hero_healing_per_min` не видит спасение без прямого лечения) **или** контаминированной сигналом другой природы (`hero_healing_per_min` считает самолечение). Стоит держать в уме при добавлении новых осей на реальных данных — сначала проверять на заведомо "неподходящих" героях (как уже описано для `mobility`/`map_control` выше), не доверять глазами топу рейтинга.

Перезапуск полного цикла: `npm run fetch-hero-meta` → `npx ts-node scripts/research-tempo-metric-v3.ts` → `npx ts-node scripts/research-tempo-mobility-data.ts` → `npx ts-node scripts/fetch-control-durability-vision-data.ts` → `npx ts-node scripts/fetch-deaths-camps-data.ts` → `npx ts-node scripts/fetch-damage-networth-share-data.ts` → (обновить `hero-constants.json` через `/api/constants/heroes`) → `npx ts-node scripts/import-ability-tagging.ts` → `npx ts-node scripts/aggregate-ability-tags.ts` → `npm run calibrate-evaluation-values` → `npm run seed`. Не гонять все Explorer-скрипты подряд без пауз — общий rate-limit OpenDota ловится быстро (см. `11-operational-notes.md`). **`npm run seed` — не опционально**: `calibrate-evaluation-values.ts` пишет только в `heroes.json`, сервер читает герои из SQLite (`Hero` таблица) — без ресида новая/изменённая ось будет `NaN` в рантайме несмотря на корректные данные в файле (наступили на это при добавлении `resource_efficiency`, см. выше).

## Data File

`heroes.json` — 127 объектов, схема соответствует Hero из 03-data-model.md плюс поля выше (включая `vision_ability_tier`/`mobility_ability_tier`/`mobility_items_tier`, которые не экспонируются в рантайм-тип `Hero` — только вход для калибровки; `mobility_ability_tier` уже неиспользуемое поле, см. выше).

## Next Review Pass

Приоритет ручной проверки:

1. `counter_tags` — самое субъективное поле, автор (ChatGPT/Claude) чаще всего мог ошибиться именно здесь.
2. `ability-tagging.csv` — пользователь продолжает вручную заполнять/поправлять по мере проверки калибровки на конкретных героях (см. "Ручная разметка способностей" выше); ожидаются дальнейшие точечные правки, не разовая задача.
3. `vision_ability_tier` — новый, черновой, ещё не проверен (особенно способности новых героев вроде Ringmaster/Kez/Largo). Прямо влияет на `map_control`.
4. `tags`/`synergy_tags` — в целом надёжнее, но стоит выборочно свериться.
