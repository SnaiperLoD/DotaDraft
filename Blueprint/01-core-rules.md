# Core Rules

## Architecture Rules

### Separation

Evaluation Engine и Battle Engine являются разными системами.

Evaluation Engine отвечает на вопрос:
"Какие характеристики имеет этот драфт?"

Battle Engine отвечает на вопрос:
"Как этот драфт выглядит против другого драфта?"

Они не должны смешиваться.

Практическое следствие (2026-09-21, калибровка R0–R2): общий Hero Knowledge Base — да. Общая вин-формула — нет. `evaluation_values` остаются описательным радаром Eval. Battle в проде всё ещё считает `overallPower` как взвешенное среднее тех же осей, и честный self-play это не оправдывает (r≈0.09). Shadow `r2_f_farm` — лучшая голая формула из этого прохода (r 0.186), но с теми же hidden-тегами она не бьёт текущую формулу (r 0.372 и ±7 55.1% против 0.381 и 61.4%). В прод не влита. Не «выровнять» Eval Total Score и Battle, подкрутив общие веса. Детали и цифры: `14-analytical-handoff.md`, `06-battle-engine.md`.

---

## Draft Score Rule

Draft Score:

- является информационной оценкой;
- используется для отображения пользователю;
- НЕ используется для определения победителя.

---

## Hero Knowledge Rule

Все знания о героях должны находиться в Hero Knowledge Base.

Не создавать отдельные таблицы героев внутри Analyzer-модулей.

---

## Analyzer Rule

Каждый Analyzer должен быть независимым.

Analyzer:

- Input: Draft
- Output: Score, Explanation

Analyzer не должен напрямую обращаться к другим Analyzer.

---

## MVP Rule

Не усложнять архитектуру без необходимости.

Не добавлять:

- авторизацию;
- облако;
- микросервисы;
- сложную инфраструктуру.

Исключение (2026-09-11, коммит `4ac6b63`): опциональные аккаунты (email+password, Google) и персистентный прогресс shipped — гостевая игра без аккаунта остаётся полной. Правило «не добавлять авторизацию» больше не абсолютно; дальше аккаунты не расширять без запроса.

Исключение: Opponent Pool для Battle Mode (см. Data Rule ниже и `06-battle-engine.md`) — по своей природе требует общего хранилища. Это единственная осознанная брешь в правиле, не прецедент для остальных подсистем.

---

## Data Rule

Все данные MVP должны работать локально. Draft, Evaluation, History — без исключений.

Основное хранилище: SQLite.

Исключение (2026-09-11, `4ac6b63`): опциональные аккаунты и персистентный прогресс хранятся в БД сервера (Prisma), а не только локально; гость по-прежнему играет без аккаунта.

Исключение: Opponent Pool (драфты других игроков + импортированные про-драфты, из которых Battle Mode асинхронно подтягивает оппонента) требует общего хранилища, обновляемого динамически — оно не может быть локальным по определению задачи. Это единственное исключение из правила; проектировать его нужно осознанно и изолированно, не как повод постепенно тащить остальные подсистемы в облако.

---

## Hidden Calibration Disclosure Rule (decision 2026-10-01)

Always-hidden calibration tags (`server/src/common/calibration-tags.ts`) correct Evaluation Total Score and set `hiddenCalibrationApplied` in the evaluation result. The player is NOT told when these corrections were applied: no line in the UI, no tag names, no hero names. The flag is internal (history parsing, tests, analysis) and must not be surfaced as player-facing text.

---

## Calibration Change Rule

Перед изменением коэффициентов, тегов (состав / магнитуда / форма эффекта) или весов (axis weights, phase weights, `realWinRateWeight` и аналоги) — **всегда уточнять у пользователя**.

Не «подкручивать по ходу» ради дивергенции или калибровки без явного согласия.

Допустимо без спроса: багфикс, возвращающий уже согласованное значение; copy/UI без смены математики; тесты на существующее поведение.

---

## Real-Data Recompute Rule

Никогда не запускать пересчёт / рефетч на реальных (внешних) данных без явного запроса пользователя.

В том числе: `fetch-hero-meta`, `refetch-incomplete-hero-meta`, `recompute-presumed-positions`, `fetch-pro-matches*`, `calibrate-evaluation-values`, ability-tag aggregate-пайплайны, любые OpenDota/Explorer/Liquipedia pull’ы и полный seed от свежего внешнего снимка.

`npm run seed` из **уже лежащих** локальных data-файлов — ок, когда нужно загрузить существующий снимок в SQLite; сами снимки перед этим не обновлять без запроса.
