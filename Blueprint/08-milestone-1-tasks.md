# Milestone 1 — Task List

## Status

Закрыт. Чеклист не отмечался по ходу реализации, хотя проект давно ушёл дальше — Milestones 2-4 (Evaluation Engine, Pro Match Data, Battle Mode) тоже реализованы, см. `07-development-plan.md`. Отмечено задним числом по факту наличия файлов в репозитории, не по памяти о том, что делалось.

## Goal

Работающий локальный Draft MVP: выбор 5 героев за 5 раундов, ручное назначение ролей, просмотр локальной истории.

Evaluation Engine, Battle Engine и Import Module в этом Milestone НЕ реализуются.

## Order

### 1. Workspace

- [x] Root `package.json` (npm workspaces: client, server, shared)
- [x] `.gitignore`
- [x] Root `tsconfig.base.json`

### 2. /shared

- [x] `shared/types/hero.ts` — тип Hero (см. 03-data-model.md)
- [x] `shared/types/draft.ts` — типы Draft, DraftHero
- [x] `shared/constants/roles.ts` — Carry, Mid, Offlane, Soft Support, Hard Support

### 3. /server — инициализация

- [x] `server/package.json`, `server/tsconfig.json`
- [x] NestJS scaffold: `main.ts`, `app.module.ts`
- [x] Prisma init: `prisma/schema.prisma` (модели Hero, Draft, DraftHero — по 03-data-model.md)
- [x] SQLite файл в `/database/dev.db`
- [x] Prisma migration + generate

### 4. /server — Hero Module

- [x] `server/data/heroes.json` — заглушка данных (заменилась результатом Hero Knowledge Base, см. `09-hero-knowledge-base.md`)
- [x] `hero.module.ts`, `hero.service.ts`, `hero.controller.ts`
- [x] `GET /heroes`
- [x] Seed-скрипт: загрузка heroes.json в SQLite

### 5. /server — Draft Module (по 04-draft-engine.md)

- [x] `draft.module.ts`, `draft.service.ts`, `draft.controller.ts`
- [x] `POST /draft/start` — создает сессию, возвращает первый пул из 5 случайных героев
- [x] `POST /draft/:id/pick` — принимает id героя, удаляет его из пула, возвращает следующий пул или статус завершения
- [x] `POST /draft/:id/roles` — назначает роли пяти выбранным героям
- [x] `GET /draft/:id` — возвращает текущее состояние драфта

### 6. /server — History Module

- [x] `history.module.ts`, `history.service.ts`, `history.controller.ts`
- [x] Сохранение завершенного драфта (герои, роли, timestamp) — по Data Rule оценка НЕ сохраняется
- [x] `GET /history` — список прошлых драфтов

### 7. /client — инициализация

- [x] `client/package.json`, `vite.config.ts`, `client/tsconfig.json`
- [x] React scaffold: `main.tsx`, `App.tsx`
- [x] `api/client.ts` — обертка над fetch для эндпоинтов сервера

### 8. /client — Draft UI

- [x] `pages/DraftPage.tsx` — управляет прохождением 5 раундов
- [x] `components/HeroPool.tsx` — отображает 5 случайных героев, обрабатывает выбор
- [x] `components/RoleAssignment.tsx` — ручное назначение ролей после 5 пиков
- [x] `components/DraftSummary.tsx` — финальный состав команды (реализовано как `components/DraftLedger.tsx`, имя разошлось с планом)

### 9. /client — History UI

- [x] `pages/HistoryPage.tsx` — список прошлых драфтов

### 10. Связка

- [x] Корневые npm-скрипты: `npm run dev` (client), `npm run start` (server)
- [x] Сервер на фиксированном порту, клиент проксирует `/api` на него

## Explicitly Out of Scope

- Evaluation Engine
- Battle Engine
- Import Module
- Визуальная полировка/анимации
