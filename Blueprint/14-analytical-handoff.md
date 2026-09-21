# Analytical handoff — 2026-09-21

Пакет для разового внешнего разбора. Не инструкция к реализации. Прод-формула боя не заменена.

Скопируй блок «Промпт» целиком и приложи этот файл. Исходники из списка «Читать» — вторым сообщением, если контекст позволяет. Не скармливай `server/data/pro-matches.json`, `heroes.json` целиком и `node_modules`.

## Промпт

Ты рецензент, не исполнитель. Продукт — браузерная драфт-игра по Dota, не аналитический SaaS. Критерий продукта: бой ощущается честным. Критерий этой калибровки другой и уже зафиксирован: честный self-play, `realWinRateWeight=0`, open-теги включены, hidden-теги выключены, один и тот же mulberry32 seed=1 × 100k. Не предлагай подмешивать реальный винрейт в скор сверх текущего капа. Не предлагай ремикс весов тех же 13 осей: S1/S2/S3 уже провалились. Не предлагай выключить open-теги и не предлагай новый hidden-тег на одного героя.

Нужно альтернативное мнение по трём вопросам:

1. Правильно ли вообще схлопывать combat в PC1, или Battle должен получить другой набор фич, не производный от радара Eval.
2. Hidden-теги — это временный residual, который надо сжать в один вектор, или именованные архетипы, которые надо оставить, потому что данные осей структурно врут.
3. Дыры без тега (Sand King, Pugna, Pangolier и соседние) — это баг фичи, дырка в Hero Knowledge Base или шум самоигры.

Если пакет противоречит коду, верь коду. Если идея красивая и не бьёт цифры ниже, скажи, чем она убивается.

## Что это за продукт

Игрок собирает 5 героев, назначает роли, читает Evaluation (радар, синергии, контрпики) и жмёт бой против чужого драфта из пула. Победителя выбирает Battle, не Eval Total Score. Общая база героев (`evaluation_values`, 0–10). Разные вопросы: Eval — «какой это драфт», Battle — «кто выигрывает».

## Разрыв, который появился

Прод-бой всё ещё считает `overallPower` как взвешенное среднее тех же осей, что рисует радар. Это и есть баг постановки. Исследовательская формула `r2_f_farm` живёт в `server/src/battle/battle-shadow.ts` и включается только env `DOTADRAFT_BATTLE_SHADOW`. Без env прод не меняется. Вечером 2026-09-21 её включили вместе с текущими hidden-тегами: r почти догнал старую формулу, ±7 — нет. Прод из-за этого не переключали.

`r2_f_farm`: пять combat-осей (burst, scaling, objectives, teamfight, durability) → один PC1 с перевёрнутыми loadings из `axis-structure-analysis.json`; у `summon_based` durability и objectives внутри PC1 ×0.7; отсутствующий ключ веса = 0, не 1; `resource_efficiency` = 0; scaling внутри PC1 заменён на `clamp(5 + scaling − tempo)`.

В JSON уже записано, с явного согласия: `resource_efficiency` = 0 во всех фазах. Eval Total Score тоже теряет эту ось, потому что берёт mid-веса из того же файла. Радар ось показывает. `realWinRateWeight` остаётся 2. Mirage Tax удалён из определения, боя и зеркала Eval. Naga и Terrorblade остаются на Army of Clones.

Recap боя (`buildExplanation`, `buildBattleStory`, `axisDeltas`) по-прежнему называет 13 осей. Если shadow влить, текст будет объяснять не ту величину. Это отдельная работа, не калибровка скора.

## Цифры

Один пул, seed=1 × 100k. Open tags ON. Hidden как в строке.

| Срез | r | MAE п.п. | ±7 | ≥10 п.п. |
|---|---:|---:|---:|---:|
| R0, 13 осей | 0.094 | 8.68 | 46.5% | 46 |
| combat_pc1 | 0.138 | 8.40 | 50.4% | 46 |
| r2_f | 0.177 | 8.17 | 48.0% | 37 |
| r2_f_farm, hidden OFF | 0.186 | 8.11 | 51.2% | 43 |
| r2_f_farm, hidden ON, те же величины | 0.372 | 6.80 | 55.1% | 31 |
| R0 Full, hidden ON | 0.381 | 6.39 | 61.4% | 27 |
| r2_f_farm, saving weight 0 | 0.122 | 7.78 | 53.5% | 39 |

r(resource_efficiency, realWR) = −0.117. Сумма осей с RE хуже, чем без.

Убито: `skirmish_role` (нулить deaths саппортам вредно, r 0.066). `farm_need` как перцентиль LH/min (r 0.033) — это фарм-аутпут, не «герою нужно время». H-DIS (`control_strength` перцентиль, вес 1 поверх r2_f): сапы MAE 16.1→11.8, но r 0.171 и ≥10 п.п. 37→47. Не стекали. Saving weight 0 на `r2_f_farm`: r(div, saving)=0.514 и кластер ≥6 сел с +10.4 до +2.7, но r пула 0.186→0.122. Не стекать. Tempo снаружи тегов r 0.013. Фаза late−early на бестеговых r −0.045. Гипотезы «area denial / степень на durability / стекло / правка JSON четырёх героев / evasion» цифрами карточек убиты, в коде их нет.

Герои без hidden-тега: MAE 5.6 п.п. С тегом: 12.2. Формула съела середину ростера, не архетипы.

## Кто ещё аномалия

На `r2_f_farm`, hidden OFF. div = favored − realWR, п.п. Плюс = завышен.

Закрылось само, тег был лишним: Naga +13→−2.9, Terrorblade +7→+2.6, Invoker +12→+2.4, Nyx +11→+5.6, Ember +23→+8, Kez +20→+9, Lone Druid +23→+8.

Тег по знаку всё ещё нужен:

- Завышены: Snapfire +26, Necrophos +24, Nature's Prophet +22, Keeper of the Light +21, Chen +19, Legion Commander +19. Paper Utility, False Immortal, Summoning Sickness, Showstopper.
- Занижены: Phantom Lancer −24, Crystal Maiden −21, Elder Titan −19, Shadow Shaman −19, Medusa −18, Spectre −17. Raid Boss, Disable Battery, Agility Crusher, Haunt Absolute.

Дыры без тега, часть раздулась относительно R0: Sand King −18, Pugna +16, Pangolier −15, Ringmaster −12. С hidden ON на `r2_f_farm` они стали хуже (Pugna +22, остальные на 1 п.п.). Новый именованный костыль на них не заводили.

## Читать, в этом порядке

1. `Blueprint/00-project-overview.md` — это игра, не аналитика.
2. `Blueprint/01-core-rules.md` — Eval не выбирает победителя; коэффициенты не крутить без спроса.
3. `Blueprint/06-battle-engine.md` — секция «Eval radar vs Battle win formula».
4. `Blueprint/05-evaluation-engine.md` — что радар всё ещё показывает, включая RE с весом 0.
5. `Blueprint/10-tech-debt-backlog.md` — секции Calibration & model.
6. `server/src/battle/battle-shadow.ts` — кандидат f. Прод-путь: `overallPowerForPhase` в `battle-resolution.ts` (shadow только если env задан).
7. `server/src/battle/custom-tags.ts` и `server/src/common/calibration-tags.ts` — hidden зеркалится в Eval. Магнитуды не выравнивать «на глаз».
8. `server/data/axis-weights.json` — прод-веса. Не предлагать новый JSON без аргумента, чем он бьёт таблицу выше.
9. `artifacts/self-play/r2-farm-2026-09-21/kpi.md`, `r2-residual-farm-2026-09-21/kpi.md`, `r2-noncombat-2026-09-21/kpi.md`, `r2-save0-2026-09-21/kpi.md`, `r2-farm-hidden-2026-09-21/kpi.md`.

Не читать ради этого разбора: клиентский UI, Captains, TI Run, e2e, `pro-matches.json`.

## Идеи, которые уже на столе

- Оставить радар Eval. Заменить только Battle feature set. Общие mid-веса перестают быть вин-формулой.
- PC1 как один combat-вход проверен. Голый он лучше 13 осей (r 0.186 против 0.094). С теми же hidden-тегами он не бьёт старую формулу по ±7 (55.1% против 61.4%). Прод не переключать.
- Residual после заморозки f: архетипы со стабильным знаком оставлены. Сжимать их в один вектор или крутить величины — отдельное решение, не этот вечер. Saving целиком не выключать.
- `disable_presence` с весом сильно ниже 1, не нулевой skirmish саппортов.
- farm-need как «нужно время», не как LH/min. Текущий прокси — scaling минус tempo внутри PC1. Он дал +0.01 r и почти не двинул late cores.
- Не писать двенадцатый тег на Sand King / Pugna, пока не ясно, врёт ось или врёт роль.

## Чего не делать в ответе

Не патчить репозиторий. Не предлагать OpenDota refetch. Не предлагать `realWinRateWeight` выше 2 или снятие капа 0.3 как способ «починить дивергенцию». Не равнять Eval score и Battle score. Не объявлять shadow продом.
