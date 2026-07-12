# Milestone 1 — Task List

## Goal

Работающий локальный Draft MVP: выбор 5 героев за 5 раундов, ручное назначение ролей, просмотр локальной истории.

Evaluation Engine, Battle Engine и Import Module в этом Milestone НЕ реализуются.

## Order

### 1. Workspace

- [ ] Root `package.json` (npm workspaces: client, server, shared)
- [ ] `.gitignore`
- [ ] Root `tsconfig.base.json`

### 2. /shared

- [ ] `shared/types/hero.ts` — тип Hero (см. 03-data-model.md)
- [ ] `shared/types/draft.ts` — типы Draft, DraftHero
- [ ] `shared/constants/roles.ts` — Carry, Mid, Offlane, Soft Support, Hard Support

### 3. /server — инициализация

- [ ] `server/package.json`, `server/tsconfig.json`
- [ ] NestJS scaffold: `main.ts`, `app.module.ts`
- [ ] Prisma init: `prisma/schema.prisma` (модели Hero, Draft, DraftHero — по 03-data-model.md)
- [ ] SQLite файл в `/database/dev.db`
- [ ] Prisma migration + generate

### 4. /server — Hero Module

- [ ] `server/data/heroes.json` — заглушка данных (заменится результатом Hero Knowledge Base)
- [ ] `hero.module.ts`, `hero.service.ts`, `hero.controller.ts`
- [ ] `GET /heroes`
- [ ] Seed-скрипт: загрузка heroes.json в SQLite

### 5. /server — Draft Module (по 04-draft-engine.md)

- [ ] `draft.module.ts`, `draft.service.ts`, `draft.controller.ts`
- [ ] `POST /draft/start` — создает сессию, возвращает первый пул из 5 случайных героев
- [ ] `POST /draft/:id/pick` — принимает id героя, удаляет его из пула, возвращает следующий пул или статус завершения
- [ ] `POST /draft/:id/roles` — назначает роли пяти выбранным героям
- [ ] `GET /draft/:id` — возвращает текущее состояние драфта

### 6. /server — History Module

- [ ] `history.module.ts`, `history.service.ts`, `history.controller.ts`
- [ ] Сохранение завершенного драфта (герои, роли, timestamp) — по Data Rule оценка НЕ сохраняется
- [ ] `GET /history` — список прошлых драфтов

### 7. /client — инициализация

- [ ] `client/package.json`, `vite.config.ts`, `client/tsconfig.json`
- [ ] React scaffold: `main.tsx`, `App.tsx`
- [ ] `api/client.ts` — обертка над fetch для эндпоинтов сервера

### 8. /client — Draft UI

- [ ] `pages/DraftPage.tsx` — управляет прохождением 5 раундов
- [ ] `components/HeroPool.tsx` — отображает 5 случайных героев, обрабатывает выбор
- [ ] `components/RoleAssignment.tsx` — ручное назначение ролей после 5 пиков
- [ ] `components/DraftSummary.tsx` — финальный состав команды

### 9. /client — History UI

- [ ] `pages/HistoryPage.tsx` — список прошлых драфтов

### 10. Связка

- [ ] Корневые npm-скрипты: `npm run dev` (client), `npm run start` (server)
- [ ] Сервер на фиксированном порту, клиент проксирует `/api` на него

## Explicitly Out of Scope

- Evaluation Engine
- Battle Engine
- Import Module
- Визуальная полировка/анимации
