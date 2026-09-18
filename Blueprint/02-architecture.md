# Architecture

Last updated: 2026-09-18.

## System shape

DotaDraft is an npm-workspaces modular monolith:

```text
React/Vite SPA
      |
      | /api/* (same-origin proxy, /api prefix stripped)
      v
NestJS API
      |
      +-- Prisma -> SQLite app database
      |
      +-- generated Prisma client -> PostgreSQL opponent pool

client + server -> shared TypeScript contracts and utilities
offline scripts -> versioned local data snapshots -> runtime services
```

There are no runtime microservices. The production Compose stack has three
containers, but only one application process:

- `web` — nginx serving `client/dist` and proxying `/api/*`;
- `api` — one NestJS process;
- `pool` — PostgreSQL for the shared opponent pool.

## Stack

Frontend:

- React 18;
- TypeScript;
- Vite;
- React Router;
- i18next;
- Three.js for isolated presentation effects.

Backend:

- NestJS 10;
- TypeScript;
- Prisma.

Persistence:

- SQLite — heroes, drafts, history, evaluations, battle results, users,
  auth sessions, telemetry, Captains sessions, TI Runs and pro-match rows;
- PostgreSQL — shared player/pro opponent pool and leaderboard outcomes;
- JSON snapshots in `server/data` — offline hero/meta/calibration inputs.

Quality and delivery:

- Jest and Vitest unit tests;
- Jest integration tests with disposable SQLite;
- Playwright end-to-end tests;
- Stryker mutation testing;
- GitHub Actions;
- Docker Compose and nginx.

## Repository structure

- `/client` — React application, pages, UI components and browser API client;
- `/server` — NestJS runtime, Prisma schemas and offline data scripts;
- `/shared` — wire contracts, domain types, constants and pure utilities;
- `/database` — local SQLite files, ignored by git;
- `/docker` — production entrypoint and nginx configuration;
- `/e2e` — Playwright scenarios;
- `/artifacts` — research artifact policy and local experiment outputs;
- `/Blueprint` — product, engine, operating and deployment documentation.

## Client routes

- `/` — landing;
- `/draft` — Battle Mode draft, Evaluation and fights;
- `/captains` — Captains Mode 7.40 against AI;
- `/ti-run` — TI bracket run;
- `/history` — owned draft and result history;
- `/leaderboard` — run and pool rankings;
- `/account` — optional email/password or Google account;
- `/about` — engine scope and accuracy ceiling;
- `/debug` — non-production calibration matrix only.

The client calls relative `/api/*` paths with cookies and the guest owner-token
header. Vite and nginx both strip `/api` before forwarding requests to NestJS.

## Backend modules

Infrastructure:

- `PrismaModule` — SQLite Prisma client lifecycle;
- `HealthModule` — SQLite/pool readiness and degraded health;
- `AuthModule` — guest-session adoption, email/password and Google OAuth;
- `TelemetryModule` — privacy-limited funnel event ingestion and snapshots;
- `DevModule` — calibration matrix, excluded from production module graph.

Core product:

- `HeroModule` — hero roster and ability metadata;
- `DraftModule` — pools, picks, rerolls, roles, ownership and run summaries;
- `HistoryModule` — user-facing draft/evaluation/battle history;
- `EvaluationModule` — single-draft analyzers and percentile score;
- `BattleModule` — opponent resolution, deterministic assessment, game outcome,
  lanes, story and persistence;
- `OpponentPoolModule` — PostgreSQL commits, pulls and leaderboards;
- `CaptainsModule` — timed CM sequence and AI opponent;
- `TiRunModule` — bracket state and fight progression.

Data-backed domain services:

- `HeroMetaModule` — reads the committed OpenDota-derived hero snapshot;
- `ProMatchModule` — exposes committed professional compositions from SQLite.

Professional-match import is an offline script pipeline, not a runtime
`ImportModule`. The old `MatchModule` / `ImportModule` design no longer exists.

## Data ownership

SQLite is the source of truth for one installation:

- private draft ownership;
- account sessions;
- completed evaluations and battles;
- local game-mode progression;
- telemetry.

PostgreSQL is the source of truth only for cross-user opponent-pool state:

- committed player drafts;
- seeded pro drafts;
- W/L counters used by the pool leaderboard.

The pool is optional at process boot. When it is unavailable:

- Draft, Evaluation, History, Account, Captains drafting and local data remain
  available;
- opponent pulls, pool commits and pool leaderboards return a controlled 503;
- `/health` reports `degraded` with HTTP 200 while SQLite remains healthy.

Several SQLite fields store JSON as strings. `Draft.evaluationResult`
now carries `schemaVersion` (1 on write, missing = 0 on read). Other
JSON blobs still need explicit versions before their shape evolves.

## Analytical boundaries

Evaluation and Battle are separate product concepts:

- Evaluation describes one composition and must not decide a battle outcome;
- Battle compares two compositions and then applies the game resolver.

They share role-aware axis math and some tag/archetype behavior through
`server/src/assessment-core/`. Evaluation and Battle both depend on that
core; they do not import each other. Battle-only resolver logic
(`resolveBattle`, tag blessings/curses) stays in `battle/*`. Eval-only
summary copy still lives in `evaluation/score-narrative`.

Persisted `Draft.evaluationResult` JSON is stamped with `schemaVersion`
(current: 1). Readers treat a missing field as version 0. Battle History
rows remain scalar summaries, not a versioned full `BattleResultResponse`.

Offline scripts may build data and model artifacts, but runtime code only reads
committed snapshots. Runtime requests never refetch OpenDota or recompute hero
calibration.

## Deployment constraint: one API instance

The current production architecture explicitly supports **one NestJS API
process**.

The following state is process-local:

- write-rate-limit buckets;
- pending Google OAuth states;
- in-flight Battle deduplication;
- small service caches.

Running two API replicas would make those behaviors inconsistent. Do not scale
the API horizontally until this state is moved to a shared store such as Redis
or the database and the relevant flows have multi-instance tests.

SQLite is also a single-writer database and the current backup/runbook assumes
one API writer. A larger public deployment must revisit both constraints
together rather than adding replicas behind nginx.

## Build and generated clients

Prisma generation is an explicit setup/CI step, separate from TypeScript build:

```bash
npm run prisma:generate --workspace server
npm run build
```

This avoids replacing the Windows Prisma query-engine DLL every time a developer
compiles while a dev server is using it. CI and Docker still generate both
clients before compilation, and the runtime image regenerates platform-correct
clients before migrations/startup.

## Production request path

```text
browser
  -> nginx :8080 / HTTPS tunnel
  -> /api/* proxy with prefix strip
  -> Nest auth-session middleware
  -> write-rate-limit interceptor
  -> domain controller/service
  -> SQLite and, only where required, PostgreSQL pool
```

See `Blueprint/13-deploy.md` for the current Compose topology, health behavior,
backups and public-link strategy.
