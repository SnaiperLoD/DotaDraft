# Deploy / hosting prep

Last updated: 2026-08-17.

## What ships

- `pool` — Postgres Opponent Pool (pro drafts + player commits)
- `api` — NestJS (`Dockerfile`), SQLite on a volume, `GET /health`
- `web` — static Vite build behind nginx (`Dockerfile.client`), proxies `/api/*`
  to the API **without** the `/api` prefix (matches local Vite rewrite)

Local `npm start` remains `ts-node` for development. Production entry is
`npm run start:prod --workspace server` → `node dist/main.js`.

## Quick path (Docker Compose)

```bash
cp .env.example .env   # optional; compose sets DATABASE_URL and POOL_DATABASE_URL
docker compose up --build
```

Open http://localhost:8080 — nginx serves the SPA and proxies API calls.

First boot:

1. waits for Postgres health;
2. `prisma migrate deploy` on SQLite;
3. seeds heroes + pro matches from `server/data/*` if `Hero` count is 0
   (no OpenDota refetch);
4. migrates the Opponent Pool and seeds pro drafts from that same snapshot
   if the pool is empty.

Health checks:

- API: `GET http://localhost:8080/api/health` (via nginx) or hit the api
  container on `/health`
- Response shape: `{ status, sqlite, pool }` where `pool` is `ok`,
  `disabled`, or `error`. HTTP 503 only if SQLite is down; a dead pool is
  `degraded` + 200 so Compose still considers the API healthy
- Compose healthcheck on the API image probes `/health` (start period is
  120s — first-boot pool seed of ~764 pro drafts is slow)

Request limits (launch hardening):

- JSON bodies capped at 64kb
- Write endpoints (non-GET except `/health`) limited to 60 req/min per
  owner token (or IP if the header is missing). Disabled when
  `NODE_ENV=test`

## Without Docker

1. `npm ci`
2. Set `DATABASE_URL` (SQLite file path)
3. Provision Postgres and set `POOL_DATABASE_URL` (Battle Mode needs it)
4. `npm run build`
5. `npm run prisma:migrate:deploy --workspace server`
6. `npm run pool:migrate:deploy --workspace server`
7. `npm run seed --workspace server` (once, from existing snapshots)
8. `npm run seed-opponent-pool --workspace server`
9. `NODE_ENV=production npm run start:prod --workspace server`
10. Serve `client/dist` with any static host; reverse-proxy `/api` → Nest with
    path strip, same as nginx.conf

`npm start` without `POOL_DATABASE_URL` still runs Draft / Evaluation /
History. Battle pulls, pool commit, and the pool half of the leaderboard
return 503 until the pool URL is set.

## Env knobs

See `.env.example`. Important:

- `CORS_ORIGIN` — leave empty behind same-origin nginx; set allowlist if SPA
  and API are on different hosts
- `POOL_DATABASE_URL` — required for the advertised Battle core loop.
  Compose sets it to the `pool` service. Empty disables pool features.
- Do not point production at `database/dev.db` from a laptop path

## SQLite backup and restore

The API volume (`dota-draft-data`) holds `prod.db`. Stop writes, copy the
file, start again. Restore is the reverse: stop the API, replace the file,
start.

```bash
# backup (API can stay up; SQLite is one file + optional WAL)
docker compose cp api:/data/prod.db ./backup-prod.db
# if the container is using WAL, copy those too
docker compose exec api sh -c 'ls -l /data'

# restore
docker compose stop api
docker compose cp ./backup-prod.db api:/data/prod.db
docker compose start api
```

Postgres Opponent Pool is a normal `pg_dump` / `pg_restore` of the `pool`
volume. Player commits are keyed by `sourceDraftId` (unique); restoring an
older pool dump will not duplicate those rows on the next commit.

## Still manual after this prep

- Choose a host (Fly / Railway / VPS / etc.) and point DNS
- TLS termination (Caddy, cloud LB, or platform certs)
- Backups for the SQLite volume **and** the Postgres pool volume — commands
  are in this file; you still pick a schedule and off-box destination
- Observability beyond local telemetry (`client/src/telemetry/`)

## Non-goals of this pass

- Accounts / auth
- Switching primary DB to Postgres (SQLite is intentional for MVP)
- Mass lint/format cleanup of research scripts
