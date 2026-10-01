# DotaDraft — правила работы для Claude Code

Браузерная драфт-игра по Dota 2 (npm workspaces: `client/` React+Vite, `server/` NestJS+Prisma, `shared/` типы). Документация и решения — `Blueprint/` (вход: `Blueprint/README.md`). Общаемся по-русски, идентификаторы и пути — как в коде.

## Правила автора

1. **Только `master`.** Никаких веток и PR: `git add` → `git commit` → `git push origin master`.
2. **Инструменты разрешены по умолчанию.** Bash, PowerShell, правка файлов, подключение нужных инструментов — без лишних вопросов (см. `.claude/settings.json`). Спрашивать только про необратимое и про то, что ниже в «Границах».
3. **Экономим токены.** Без пробега по всем файлам и глобальных research-поисков без необходимости: сначала точечный `grep`/`Glob` по известному месту, читать нужный кусок, а не файл целиком. Рутинные задачи отдавать субагенту `routine` (Sonnet), широкий поиск — `Explore`.
4. **«комить и пуш»** = сначала обновить `Blueprint/` под внесённые изменения (тот документ, который описывает изменённое место; бэклог/приоритеты — если закрыт или добавлен долг), потом один коммит и push в `master`. Без этой фразы не коммитить. Процедура — скилл `commit-push`.

## Границы (из `Blueprint/01-core-rules.md`)

- **Calibration Change Rule:** не менять коэффициенты, веса, теги, пороги, `realWinRateWeight` и т. п. (`server/data/axis-weights.json`, `battle-diff-inputs.json`, `hero-meta.json`, `server/src/common/calibration-tags.ts`, `server/src/battle/custom-tags.ts`, `battle-shadow.ts`) без явного «ок». Можно: багфикс к уже согласованному значению, текст/UI без смены математики, тесты на существующее поведение.
- **Real-Data Recompute Rule:** не запускать `fetch-*`, `refetch-*`, `recompute-presumed-positions`, `calibrate-evaluation-values`, `compute-axis-percentiles` и любые запросы к OpenDota/Explorer/Liquipedia без явной просьбы. `npm run seed` из локальных файлов — можно.
- **Не читать целиком:** `server/data/heroes.json`, `pro-matches.json`, `hero-meta.json`, `axis-percentile-distributions.json`, `node_modules`, `server/.stryker-tmp`. Нужны сведения — скриптом, в контекст только сводка.
- **Не выдумывать механики Dota:** факты о героях — из данных репозитория со ссылкой на файл.
- **Игроку не показываем процент победы.**

## Окружение

Windows (PowerShell + Git Bash). Грабли — `Blueprint/11-operational-notes.md`: долгие процессы через `run_in_background`, процессы убивать узко (по порту), `prisma generate` падает с EPERM при запущенном сервере.

Локальный CI (как `.github/workflows/ci.yml`): `npm run build` → `npm run lint` → `npm run format:check` → `npx jest --ci` → `npm test --workspace client` → `npm run test:integration --workspace server` → `npm run test:e2e`. Перед «комить и пуш» — минимум lint, typecheck и тесты затронутых частей.

Коммиты: одно английское предложение в повелительном наклонении, «что и зачем» (см. `git log`).
